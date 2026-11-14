import { TOL } from '../core/math/tolerance';
import { add, distance, dot, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import type { VertexId } from '../core/model/Model';
import { pointVertices } from '../core/ops/points';
import { connectedVertices, scalePieces } from '../core/ops/scale';
import type { DocumentSnapshot } from '../doc/Document';
import type { GroupId } from '../doc/Groups';
import { scaleModel } from '../core/ops/group';
import { closestRayLine, rayPlane } from './geom';
import { groupModels } from './groupModels';
import { makePlane } from '../core/math/plane';
import { parseLength, parseLengths } from './units';
import type { InferenceHints, Preview, SnapKind, Tool, ToolContext, ToolEvent } from './types';

type Targets = { vertices: Set<VertexId>; groups: GroupId[] };
type Axes = [boolean, boolean, boolean];

/**
 * A handle on the box round what is being scaled: a corner (all three axes), the middle of a box
 * edge (two) or the middle of a side (one). `index` is 0, 1 or 2 (min, middle, max) per axis.
 */
export interface Grip {
  at: Vec3;
  index: [number, number, number];
  axes: Axes;
  /** A corner of the shape (of a flat one too, which has no grips off its plane). */
  corner: boolean;
}

/** How near the cursor (in pixels) a grip must be to take it. */
const GRIP_PX = 9;
const POINT_SNAPS: readonly SnapKind[] = ['endpoint', 'origin', 'midpoint', 'centre', 'guidePoint', 'guideIntersection'];

/** A vector from a value per axis. */
const perAxis = (f: (a: number) => number): Vec3 => [f(0), f(1), f(2)];
const axesOf = (f: (a: number) => boolean): Axes => [f(0), f(1), f(2)];

/** The box round some geometry, aligned with the red, green and blue axes. */
export function targetBox(ctx: ToolContext, targets: Targets): { min: Vec3; max: Vec3 } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (p: Vec3) => p.forEach((x, i) => ((min[i] = Math.min(min[i], x)), (max[i] = Math.max(max[i], x))));
  const model = ctx.doc.model;
  for (const v of targets.vertices) if (model.vertices.has(v)) grow(model.pos(v));
  for (const id of targets.groups) for (const m of groupModels(ctx.doc, id)) for (const v of m.vertices.values()) grow(v.pos);
  return min[0] === Infinity ? null : { min: perAxis((a) => min[a]), max: perAxis((a) => max[a]) };
}

/** The grips of a box: 8 corners, 12 edge middles, 6 side middles; a flat box has none off its plane. */
export function boxGrips(box: { min: Vec3; max: Vec3 }): Grip[] {
  const flat = [0, 1, 2].map((a) => box.max[a] - box.min[a] <= TOL);
  const grips: Grip[] = [];
  for (const i of [0, 1, 2]) {
    for (const j of [0, 1, 2]) {
      for (const k of [0, 1, 2]) {
        const index: [number, number, number] = [i, j, k];
        if (index.every((x) => x === 1) || index.some((x, a) => flat[a] && x !== 1)) continue;
        const at = perAxis((a) => [box.min[a], (box.min[a] + box.max[a]) / 2, box.max[a]][index[a]]);
        grips.push({ at, index, axes: axesOf((a) => index[a] !== 1), corner: index.every((x, a) => flat[a] || x !== 1) });
      }
    }
  }
  return grips;
}

/** The point a grip scales about: the opposite grip, or the box's centre (Ctrl). */
function anchorOf(box: { min: Vec3; max: Vec3 }, grip: Grip, fromCentre: boolean): Vec3 {
  return perAxis((a) => [box.min[a], (box.min[a] + box.max[a]) / 2, box.max[a]][fromCentre ? 1 : 2 - grip.index[a]]);
}

/**
 * Scale: with something selected (or pointed at), a yellow box with grips appears round it. Drag a
 * grip (or click it, move and click): a corner scales in proportion, the middle of a box edge
 * scales the two directions along that side in proportion, the middle of a side stretches one way.
 * Shift frees corners and edges to stretch each way on its own; Ctrl scales about the centre
 * instead of the opposite grip. Or click a base point elsewhere (it stays put), click a reference
 * point, then move and click: the object grows by how far you moved along that direction. Typing
 * a factor ("1.5"), per-axis factors ("2,1,1" for red, green, blue), or a length ("300mm", the new
 * size) works while scaling and after. Negative factors mirror. Always works on whole connected
 * objects (and whole groups).
 */
export class ScaleTool implements Tool {
  readonly id = 'scale';
  readonly name = 'Scale';
  readonly dragIsClick = true;
  private targets: Targets | null = null;
  private base: Vec3 | null = null;
  private ref: Vec3 | null = null;
  private factor = 1;
  /** What the grips are round when nothing is being scaled yet: the selection, else the object under the cursor. */
  private boxTargets: Targets | null = null;
  private hovered: Grip | null = null;
  private dragging: { grip: Grip; box: { min: Vec3; max: Vec3 }; anchor: Vec3; factors: Vec3; free: boolean } | null = null;
  private last: { snapshot: DocumentSnapshot; targets: Targets; base: Vec3; refLength: number; factors: Vec3; axes: Axes } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    if (this.dragging) {
      const g = this.dragging.grip;
      const n = g.axes.filter(Boolean).length;
      const how = n === 1 ? 'Stretching one way' : this.dragging.free ? 'Stretching each way on its own (Shift)' : 'Scaling in proportion (Shift: each way on its own)';
      return `${how}. Ctrl: about the centre. Click to finish, or type a factor or a new size (300mm).`;
    }
    if (this.base) return this.ref ? 'Move and click to scale, or type a factor (2 or 2,1,1) or a new length (300mm). Negative mirrors.' : 'Click a reference point, or type a factor (2 or 2,1,1).';
    if (this.hovered) {
      const n = this.hovered.axes.filter(Boolean).length;
      return this.hovered.corner && n > 1 ? 'Corner: drag to scale in proportion (Shift: each way on its own; Ctrl: about the centre).' : n === 2 ? 'Edge: drag to scale this side in proportion (Shift: each way on its own; Ctrl: about the centre).' : 'Side: drag to stretch one way (Ctrl: about the centre).';
    }
    if (this.boxTargets) return 'Drag a grip on the yellow box: corners scale in proportion, sides stretch one way. Or click a base point.';
    return 'Select what to scale, or point at an object: a yellow box with grips appears round it.';
  }

  vcbLabel(): string {
    return 'Scale';
  }

  vcbValue(): string {
    const round = (f: number) => Math.round(f * 1000) / 1000;
    if (this.dragging) {
      const { factors, grip } = this.dragging;
      const used = factors.filter((_, a) => grip.axes[a]);
      return used.every((f) => Math.abs(f - used[0]) <= 1e-9) ? `${round(used[0])}` : factors.map(round).join(', ');
    }
    if (this.ref) return `${round(this.factor)}`;
    if (this.last) return this.last.factors.map(round).join(', ');
    return '';
  }

  inference(): InferenceHints {
    if (this.dragging) return { reference: this.dragging.grip.at, centres: true };
    return this.base ? { reference: this.ref ?? this.base, centres: true } : { centres: true };
  }

  /** The selection's targets, or null when nothing is selected. */
  private selected(): Targets | null {
    const { selection, doc } = this.ctx;
    if (selection.faces.size || selection.edges.size || selection.groups.size) return { vertices: connectedVertices(doc.model, selection.faces, selection.edges), groups: [...selection.groups] };
    // Points alone: just those points (spreading or drawing them together).
    if (selection.points.size) return { vertices: pointVertices(doc.model, selection.points), groups: [] };
    return null;
  }

  private under(e: ToolEvent): Targets | null {
    const model = this.ctx.doc.model;
    if (e.edge !== null) return { vertices: connectedVertices(model, [], [e.edge]), groups: [] };
    if (e.group !== null) return { vertices: new Set(), groups: [e.group] };
    if (e.face !== null) return { vertices: connectedVertices(model, [e.face], []), groups: [] };
    return null;
  }

  /** The grips of the box round `boxTargets`, nearest the cursor first within reach. */
  private gripAt(e: ToolEvent): Grip | null {
    if (!this.boxTargets) return null;
    const box = targetBox(this.ctx, this.boxTargets);
    if (!box) return null;
    const proj = this.ctx.projector();
    let best: Grip | null = null;
    let bestPx = GRIP_PX;
    for (const g of boxGrips(box)) {
      const s = proj.toScreen(g.at);
      const px = s ? Math.hypot(s[0] - e.screen[0], s[1] - e.screen[1]) : Infinity;
      if (px <= bestPx) {
        best = g;
        bestPx = px;
      }
    }
    return best;
  }

  pointerMove(e: ToolEvent): void {
    if (this.dragging) {
      this.dragTo(e);
      return;
    }
    if (!this.base) {
      // The box stays on the object last pointed at, so its grips can be reached across empty
      // space (a cylinder's corners) or over another object.
      this.hovered = this.selected() ? null : this.gripAt(e);
      if (!this.hovered) {
        this.boxTargets = this.selected() ?? this.under(e) ?? this.boxTargets;
        this.hovered = this.gripAt(e);
      }
      return;
    }
    if (!this.ref || !e.snap) return;
    const d = sub(this.ref, this.base);
    this.factor = dot(sub(e.snap.point, this.base), normalize(d)) / Math.hypot(...d);
  }

  /** Where the dragged grip has got to: the factors for its axes. */
  private dragTo(e: ToolEvent): void {
    const drag = this.dragging!;
    const { grip, box } = drag;
    drag.anchor = anchorOf(box, grip, e.ctrl);
    const n = grip.axes.filter(Boolean).length;
    drag.free = e.shift && n > 1;
    const span = sub(grip.at, drag.anchor);
    const point = e.snap && POINT_SNAPS.includes(e.snap.kind) ? e.snap.point : null;
    let p: Vec3 | null;
    if (!drag.free) {
      // Along the line from the anchor through the grip (for a side, that is its axis).
      p = point ? add(drag.anchor, scale(span, dot(sub(point, drag.anchor), span) / dot(span, span))) : (closestRayLine(e.ray, drag.anchor, span)?.point ?? null);
    } else if (n === 2) {
      const normal = perAxis((a) => (grip.axes[a] ? 0 : 1));
      p = point ?? rayPlane(e.ray, makePlane(grip.at, normal));
    } else p = point ?? e.snap?.point ?? null;
    if (!p) return;
    if (!drag.free) {
      const f = dot(sub(p, drag.anchor), span) / dot(span, span);
      drag.factors = perAxis((a) => (grip.axes[a] ? f : 1));
    } else {
      drag.factors = perAxis((a) => (grip.axes[a] && Math.abs(span[a]) > TOL ? (p![a] - drag.anchor[a]) / span[a] : 1));
    }
  }

  pointerDown(e: ToolEvent): void {
    if (this.dragging) {
      this.dragTo(e);
      const { factors, anchor, grip, box } = this.dragging;
      if (factors.some((f) => Math.abs(f) <= 1e-6) || factors.every((f) => Math.abs(f - 1) <= 1e-9)) return;
      this.commit(factors, undefined, { targets: this.targets!, base: anchor, refLength: gripSize(box, grip.axes), axes: grip.axes });
      return;
    }
    if (!this.base) {
      const grip = this.gripAt(e);
      if (grip && this.boxTargets) {
        const box = targetBox(this.ctx, this.boxTargets)!;
        this.targets = this.boxTargets;
        this.dragging = { grip, box, anchor: anchorOf(box, grip, e.ctrl), factors: [1, 1, 1], free: false };
        return;
      }
    }
    const p = e.snap?.point;
    if (!p) return;
    if (!this.base) {
      const targets = this.selected() ?? this.under(e);
      if (!targets) throw new Error('Select something to scale, or click on the object to scale');
      this.targets = targets;
      this.base = p;
      this.hovered = null;
      return;
    }
    if (!this.ref) {
      if (distance(p, this.base) <= TOL) return;
      this.ref = p;
      this.factor = 1;
      return;
    }
    this.pointerMove(e);
    if (Math.abs(this.factor) <= 1e-6 || Math.abs(this.factor - 1) <= 1e-9) return;
    this.commit([this.factor, this.factor, this.factor]);
  }

  private commit(factors: Vec3, base?: DocumentSnapshot, from?: { targets: Targets; base: Vec3; refLength: number; axes: Axes }): void {
    const targets = from?.targets ?? (base ? this.last!.targets : this.targets!);
    const basePoint = from?.base ?? (base ? this.last!.base : this.base!);
    const refLength = from?.refLength ?? (base ? this.last!.refLength : this.ref ? distance(this.ref, this.base!) : 0);
    const axes = from?.axes ?? (base ? this.last!.axes : ([true, true, true] as Axes));
    this.targets = this.base = this.ref = null;
    this.dragging = null;
    this.hovered = null;
    const snapshot = this.ctx.apply(() => {
      if (targets.vertices.size) scalePieces(this.ctx.doc.model, targets.vertices, basePoint, factors);
      for (const id of targets.groups) for (const m of groupModels(this.ctx.doc, id)) scaleModel(m, basePoint, factors);
    }, base);
    this.last = { snapshot, targets, base: basePoint, refLength, factors, axes };
  }

  /**
   * "2" → uniform factor (on a grip's axes only); "2,1,1" → per axis; "300mm" → the reference
   * distance (a grip's size: its side, or the longest side it scales) becomes 300 mm.
   */
  private parse(text: string, refLength: number, axes: Axes): Vec3 {
    const only = (f: number) => perAxis((a) => (axes[a] ? f : 1));
    if (/[a-z'"]/i.test(text)) {
      const len = parseLength(text);
      if (len === undefined || refLength <= TOL) throw new Error('Click a reference point before typing a length');
      return only(len / refLength);
    }
    const v = parseLengths(text);
    if (!v || v.some((x) => x === undefined || x === 0)) throw new Error('Type a factor (e.g. 2) or factors per axis (e.g. 2,1,1)');
    if (v.length === 1) return only(v[0]!);
    if (v.length === 3) return [v[0]!, v[1]!, v[2]!];
    throw new Error('Type one factor, or three (red, green, blue)');
  }

  typed(text: string): void {
    if (this.dragging) {
      const { grip, box, anchor } = this.dragging;
      const from = { targets: this.targets!, base: anchor, refLength: gripSize(box, grip.axes), axes: grip.axes };
      this.commit(this.parse(text, from.refLength, grip.axes), undefined, from);
    } else if (this.base) {
      const refLength = this.ref ? distance(this.ref, this.base) : 0;
      this.commit(this.parse(text, refLength, [true, true, true]));
    } else if (this.last) {
      this.commit(this.parse(text, this.last.refLength, this.last.axes), this.last.snapshot);
    } else throw new Error('Drag a grip or click the base point first');
  }

  cancel(): void {
    if (!this.base && !this.dragging) this.boxTargets = this.hovered = null;
    this.targets = this.base = this.ref = null;
    this.dragging = null;
  }

  reset(): void {
    this.cancel();
    this.boxTargets = null;
    this.hovered = null;
    this.last = null;
  }

  preview(): Preview {
    const lines: NonNullable<Preview['lines']> = [];
    if (this.dragging) {
      const { anchor, factors, box } = this.dragging;
      const at = (p: Vec3) => perAxis((a) => anchor[a] + (p[a] - anchor[a]) * factors[a]);
      lines.push({ points: this.edgePoints(this.targets!).map(at), color: 'select', width: 1.5 });
      const scaled = { min: at(box.min), max: at(box.max) };
      lines.push({ points: boxLines(scaled), color: 'scaleBox', width: 1.5 });
      return { lines, grips: [{ at: at(this.dragging.grip.at), hot: true }] };
    }
    if (this.base && this.targets) {
      const f = this.ref ? this.factor : 1;
      const at = (p: Vec3) => add(this.base!, scale(sub(p, this.base!), f));
      lines.push({ points: this.edgePoints(this.targets).map(at), color: 'select', width: 1.5 });
      if (this.ref) lines.push({ points: [this.base, this.ref], color: 'preview', dashed: true });
      return { lines };
    }
    const box = this.boxTargets && targetBox(this.ctx, this.boxTargets);
    if (!box) return {};
    const hot = this.hovered;
    return {
      lines: [{ points: boxLines(box), color: 'scaleBox', width: 1.5 }],
      grips: boxGrips(box).map((g) => ({ at: g.at, hot: !!hot && distance(g.at, hot.at) <= TOL })),
    };
  }

  /** Every edge of the targets as segment endpoint pairs. */
  private edgePoints(targets: Targets): Vec3[] {
    const model = this.ctx.doc.model;
    const pts: Vec3[] = [];
    for (const e of model.edges()) {
      const a = model.he(e).origin;
      const b = model.dest(e);
      if (targets.vertices.has(a) && targets.vertices.has(b)) pts.push(model.pos(a), model.pos(b));
    }
    for (const id of targets.groups) {
      for (const m of groupModels(this.ctx.doc, id)) for (const e of m.edges()) pts.push(m.pos(m.he(e).origin), m.pos(m.dest(e)));
    }
    return pts;
  }
}

/** The length a typed size applies to: the box's side along a grip's one axis, or its longest side among them. */
function gripSize(box: { min: Vec3; max: Vec3 }, axes: Axes): number {
  return Math.max(...axes.map((on, a) => (on ? box.max[a] - box.min[a] : 0)));
}

/** The 12 edges of a box as segment endpoint pairs. */
function boxLines({ min, max }: { min: Vec3; max: Vec3 }): Vec3[] {
  const c = (i: number): Vec3 => [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
  const pts: Vec3[] = [];
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) pts.push(c(i), c(i | bit));
  return pts;
}
