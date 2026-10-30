import type { FaceId, HalfEdgeId } from '../core/model/Model';
import { erase } from '../core/ops/erase';
import type { Document, DocumentSnapshot } from '../doc/Document';
import { History } from '../doc/History';
import { facesWithCurveEdges, smoothSurface } from '../core/model/surfaces';
import type { LabelId } from '../doc/Labels';
import { ArcTool } from './ArcTool';
import { CircleTool } from './CircleTool';
import { guideAt } from './guidePick';
import { LassoTool } from './LassoTool';
import { LineTool } from './LineTool';
import { MoveTool } from './MoveTool';
import { RotateTool } from './RotateTool';
import { ScaleTool } from './ScaleTool';
import { TextTool } from './TextTool';
import { EraserTool } from './EraserTool';
import { NavigationTool } from './NavigationTool';
import { infer } from './inference';
import { OffsetTool } from './OffsetTool';
import { PushPullTool } from './PushPullTool';
import { RectangleTool } from './RectangleTool';
import { RotatedRectangleTool } from './RotatedRectangleTool';
import { ZoomWindowTool } from './ZoomWindowTool';
import { SelectTool } from './SelectTool';
import { Selection } from './Selection';
import { TapeMeasureTool } from './TapeMeasureTool';
import { distance, normalize, sub, type Vec3 } from '../core/math/vec3';
import { AXES } from './geom';
import type { AxisLock, InferenceHints, Preview, Projector, Ray, Snap, Tool, ToolContext, ToolEvent, ToolId } from './types';

/** A pointer sample from the viewport after picking (the viewer's part of the job). */
export interface PointerSample {
  screen: [number, number];
  ray: Ray;
  faceHit: { face: FaceId; point: Vec3; distance: number } | null;
  edge: HalfEdgeId | null;
  shift: boolean;
  ctrl: boolean;
  down: boolean;
}

/**
 * Runs the active tool: turns pointer samples into tool events (with inference), routes typed
 * Measurements input, applies model changes atomically (rolling back on error), and tells the
 * UI when anything visible changed.
 */
export class ToolController {
  readonly selection = new Selection();
  readonly tools: Record<ToolId, Tool>;
  tool: Tool;
  /** Last inferred point (drawn as the snap cue). */
  snap: Snap | null = null;
  /** Arrow-key inference lock for the current step (cleared by a click, Escape or a tool change). */
  lock: AxisLock | null = null;
  /** Direction of the edge most recently under the cursor (for the parallel lock). */
  private lastEdgeDir: Vec3 | null = null;
  /** The edge direction captured when ↓ was pressed (hovering other edges later does not change it). */
  private lockDir: Vec3 | null = null;
  /** Error from the last action, shown in the status bar until the next action. */
  error: string | null = null;
  /** Information (e.g. "Saved part.benup"), shown until the next action. */
  notice: string | null = null;
  /** Called after the model or guides changed (rebuild display). */
  onModelChanged: () => void = () => {};
  /** Called after anything visible changed (overlay, status bar, Measurements box). */
  onUpdate: () => void = () => {};
  /** Zoom Window finished: zoom the view to this screen box. */
  onZoomWindow: (from: [number, number], to: [number, number]) => void = () => {};
  /** Ask a yes/no question (the app shows a dialog). Tests answer yes. */
  ask: (message: string) => boolean | Promise<boolean> = () => true;

  readonly history = new History();
  /** True when the document changed since it was last saved or opened. */
  dirty = false;
  /** The context tools run in (exposed for tests that drive tools with hand-built events). */
  readonly ctx: ToolContext;
  private pressAt: [number, number] | null = null;

  constructor(
    readonly doc: Document,
    private readonly projector: () => Projector,
  ) {
    this.ctx = {
      doc,
      selection: this.selection,
      apply: (change, base, label) => this.apply(change, base, this.tool, label),
      confirm: (message, action) => {
        const answer = this.ask(message);
        if (answer === true) action();
        else if (answer !== false) void answer.then((ok) => ok && this.run(action));
      },
      projector,
    };
    this.tools = {
      select: new SelectTool(this.ctx),
      rectangle: new RectangleTool(this.ctx),
      rectangle3: new RotatedRectangleTool(this.ctx),
      circle: new CircleTool(this.ctx),
      polygon: new CircleTool(this.ctx, 'polygon'),
      pie: new ArcTool(this.ctx, 'pie'),
      pushpull: new PushPullTool(this.ctx),
      offset: new OffsetTool(this.ctx),
      tape: new TapeMeasureTool(this.ctx),
      eraser: new EraserTool(this.ctx),
      lasso: new LassoTool(this.ctx),
      line: new LineTool(this.ctx),
      arc2: new ArcTool(this.ctx, 'arc2'),
      arc3: new ArcTool(this.ctx, 'arc3'),
      arc: new ArcTool(this.ctx, 'arc'),
      scale: new ScaleTool(this.ctx),
      move: new MoveTool(this.ctx),
      rotate: new RotateTool(this.ctx),
      text: new TextTool(this.ctx),
      orbit: new NavigationTool('orbit'),
      pan: new NavigationTool('pan'),
      zoom: new NavigationTool('zoom'),
      zoomWindow: new ZoomWindowTool((from, to) => this.onZoomWindow(from, to)),
    };
    this.tool = this.tools.select;
    this.selection.onChange(() => this.onUpdate());
  }

  setTool(id: ToolId): void {
    this.notice = null;
    this.lock = null;
    this.tool.cancel();
    this.tool = this.tools[id];
    this.snap = null;
    this.error = null;
    this.onUpdate();
  }

  /**
   * Apply a change as one undoable step; on failure restore the document exactly and rethrow.
   * With `base` the last step is redone with new values (re-dimensioning) and stays one step.
   */
  private apply(change: () => void, base: DocumentSnapshot | undefined, by: Tool | null, label = by?.name ?? 'Edit'): DocumentSnapshot {
    const before = this.doc.snapshot();
    try {
      if (base) this.doc.restore(base);
      change();
      this.doc.model.validate();
    } catch (err) {
      this.doc.restore(before);
      throw err;
    }
    if (base) this.history.amendLast(label);
    else {
      this.history.record(label, before);
      // Only the tool that made the latest change may re-dimension it.
      for (const t of Object.values(this.tools)) if (t !== by) t.reset();
    }
    this.dirty = true;
    this.afterDocumentChange();
    return base ?? before;
  }

  private afterDocumentChange(): void {
    this.selection.prune(this.doc.model, this.doc.labels, this.doc.guides);
    this.onModelChanged();
    this.onUpdate();
  }

  undo(): void {
    this.tool.cancel();
    const label = this.history.undo(this.doc);
    this.error = label ? null : 'Nothing to undo';
    this.notice = label ? `Undo ${label}` : null;
    if (label) this.afterHistoryJump();
    this.onUpdate();
  }

  redo(): void {
    this.tool.cancel();
    const label = this.history.redo(this.doc);
    this.error = label ? null : 'Nothing to redo';
    this.notice = label ? `Redo ${label}` : null;
    if (label) this.afterHistoryJump();
    this.onUpdate();
  }

  private afterHistoryJump(): void {
    for (const t of Object.values(this.tools)) t.reset();
    this.dirty = true;
    this.afterDocumentChange();
  }

  /** Replace the whole document (New / Open). Clears history and selection. */
  replaceDocument(next: Document): void {
    for (const t of Object.values(this.tools)) t.reset();
    this.doc.restore({ model: next.model, guides: next.guides, labels: next.labels });
    this.history.clear();
    this.selection.clear();
    this.dirty = false;
    this.error = null;
    this.afterDocumentChange();
  }

  markSaved(): void {
    this.dirty = false;
    this.onUpdate();
  }

  /** The tool's inference hints plus the arrow-key lock, if one is set and the tool has a start point. */
  private hints(): InferenceHints {
    const hints = this.tool.inference();
    if (!this.lock || !hints.reference) return hints;
    if (this.lock === 'parallel') return this.lockDir ? { ...hints, lock: { dir: this.lockDir } } : hints;
    if (this.lock === 'perpendicular') return this.lockDir ? { ...hints, lockPlane: { normal: this.lockDir } } : hints;
    const axis = ({ x: 0, y: 1, z: 2 } as const)[this.lock];
    return { ...hints, lock: { dir: AXES[axis], axis } };
  }

  /** Ctrl tapped on its own: toggle copy mode in tools that copy (Move, Rotate). */
  toggleCopy(): void {
    if (!this.tool.toggleCopy) return;
    this.notice = this.tool.toggleCopy() ? `${this.tool.name}: copy mode on (tap Ctrl to switch off)` : `${this.tool.name}: copy mode off`;
    this.onUpdate();
  }

  /** Arrow keys: lock (or unlock, pressing the same key again) the next point to a direction. */
  toggleLock(lock: AxisLock): void {
    const own = this.tool.lockAxis?.(lock);
    if (own) {
      this.notice = own;
      this.onUpdate();
      return;
    }
    // ↓ cycles: parallel → perpendicular → off (the edge direction is kept from the first press).
    if (lock === 'parallel' && this.lock === 'parallel') {
      this.lock = 'perpendicular';
      this.notice = 'Locked perpendicular to the edge (press ↓ again to unlock)';
    } else if (lock === 'parallel' && this.lock === 'perpendicular') {
      this.lock = null;
      this.notice = null;
    } else if (this.lock === lock) {
      this.lock = null;
      this.notice = null;
    } else if (lock === 'parallel' && !this.lastEdgeDir) {
      this.notice = 'Hover an edge first, then press ↓ to stay parallel to it';
    } else if (!this.tool.inference().reference) {
      this.notice = `Axis lock applies once ${this.tool.name} has a start point`;
    } else {
      this.lock = lock;
      if (lock === 'parallel') this.lockDir = this.lastEdgeDir;
      this.notice =
        lock === 'parallel'
          ? 'Locked parallel to the edge (press ↓ again for perpendicular)'
          : { x: 'Locked to the red axis', y: 'Locked to the green axis', z: 'Locked to the blue axis', perpendicular: 'Locked perpendicular to the edge' }[lock] + ' (press the arrow again to unlock)';
    }
    this.onUpdate();
  }

  private event(s: PointerSample): ToolEvent {
    this.snap = infer({
      model: this.doc.model,
      guides: this.doc.guides,
      projector: this.projector(),
      cursor: s.screen,
      ray: s.ray,
      faceHit: s.faceHit,
      hints: this.hints(),
    });
    const edge = s.edge ?? this.snap?.edge;
    if (edge !== undefined && edge !== null && this.doc.model.halfEdges.has(edge)) {
      const a = this.doc.model.pos(this.doc.model.he(edge).origin);
      const b = this.doc.model.pos(this.doc.model.dest(edge));
      if (distance(a, b) > 0) this.lastEdgeDir = normalize(sub(b, a));
    }
    const guide = guideAt({ model: this.doc.model, guides: this.doc.guides, projector: this.projector(), cursor: s.screen, ray: s.ray, faceHit: s.faceHit });
    return {
      snap: this.snap,
      guide,
      face: s.faceHit?.face ?? null,
      facePoint: s.faceHit?.point ?? null,
      edge: s.edge,
      ray: s.ray,
      screen: s.screen,
      shift: s.shift,
      ctrl: s.ctrl,
      down: s.down,
    };
  }

  /** Run a tool callback; errors become a status message and reset the tool's current step. */
  private run(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.tool.cancel();
    }
    this.onUpdate();
  }

  pointerMove(s: PointerSample): void {
    const e = this.event(s);
    this.run(() => this.tool.pointerMove(e));
  }

  pointerDown(s: PointerSample): void {
    this.error = null;
    this.notice = null;
    this.pressAt = s.screen;
    const e = this.event(s);
    this.lock = null; // a lock holds for one step: the click that uses it
    this.run(() => this.tool.pointerDown(e));
  }

  pointerUp(s: PointerSample): void {
    const dragged = !!this.pressAt && Math.hypot(s.screen[0] - this.pressAt[0], s.screen[1] - this.pressAt[1]) > 4;
    this.pressAt = null;
    const e = this.event(s);
    this.run(() => {
      this.tool.pointerUp?.(e, dragged);
      // Press-drag-release in a drawing tool finishes the shape like a second click.
      if (dragged && this.tool.dragIsClick) this.tool.pointerDown(e);
    });
  }

  doubleClick(s: PointerSample): void {
    const e = this.event(s);
    this.run(() => this.tool.doubleClick?.(e));
  }

  /** Enter in the Measurements box. */
  typed(text: string): void {
    this.error = null;
    if (!text.trim()) return;
    this.run(() => this.tool.typed(text.trim()));
  }

  escape(): void {
    this.error = null;
    this.lock = null;
    this.tool.cancel();
    if (this.tool.id === 'select') this.selection.clear();
    this.onUpdate();
  }

  /** A label was clicked in the viewport: edit it (Text tool) or select it (Select tool). */
  labelClicked(id: LabelId, shift: boolean): void {
    if (this.tool instanceof TextTool) {
      this.tool.editLabel(id);
      this.notice = 'Type the new text and press Enter';
    } else if (this.tool.id === 'select') this.selection.toggleLabel(id, shift);
    this.onUpdate();
  }

  /** Select every face and edge. */
  selectAll(): void {
    this.selection.set(this.doc.model.faces.keys(), this.doc.model.edges());
  }

  deleteSelection(): void {
    if (this.selection.size === 0) return;
    const { faces, edges, labels, guides } = this.selection;
    this.run(() =>
      this.apply(
        () => {
          erase(this.doc.model, [...faces], [...edges]);
          for (const l of labels) this.doc.labels.delete(l);
          for (const g of guides) this.doc.guides.delete(g);
        },
        undefined,
        null,
        'Erase',
      ),
    );
    this.selection.clear();
  }

  toggleGuides(): void {
    this.doc.guides.visible = !this.doc.guides.visible;
    this.onModelChanged();
    this.onUpdate();
  }

  deleteGuides(): void {
    if (this.doc.guides.items.size === 0) return;
    this.run(() => this.apply(() => this.doc.guides.clear(), undefined, null, 'Delete guides'));
  }

  /** Show a message in the status bar until the next action. */
  notify(message: string): void {
    this.notice = message;
    this.onUpdate();
  }

  hint(): string {
    if (this.error) return this.error;
    if (this.notice) return this.notice;
    const { faces, edges } = this.selection;
    if ((this.tool.id === 'select' || this.tool.id === 'lasso') && this.selection.size > 0) {
      const part = (n: number, word: string) => (n ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
      // Facets of a curved surface count as one surface, as they select and highlight as one.
      const curved = facesWithCurveEdges(this.doc.model);
      const seen = new Set<FaceId>();
      let surfaces = 0;
      let flat = 0;
      for (const f of faces) {
        if (seen.has(f) || !this.doc.model.faces.has(f)) continue;
        const group = smoothSurface(this.doc.model, f, curved).filter((g) => faces.has(g));
        group.forEach((g) => seen.add(g));
        if (group.length > 1) surfaces++;
        else flat++;
      }
      const items = [part(surfaces, 'curved surface'), part(flat, 'face'), part(edges.size, 'edge'), part(this.selection.guides.size, 'guide'), part(this.selection.labels.size, 'label')];
      return `Selected: ${items.filter(Boolean).join(', ')}. Delete erases, Esc clears.`;
    }
    return this.tool.hint();
  }

  preview(): Preview {
    return this.tool.preview();
  }
}
