import type { Document } from '../doc/Document';
import type { LabelId } from '../doc/Labels';
import type { FaceId, HalfEdgeId, VertexId } from '../core/model/Model';
import { isPoint } from '../core/ops/points';
import type { GroupId } from '../doc/Groups';
import type { GuideId } from '../doc/Guides';
import { smoothSurface, surfaceOutline } from '../core/model/surfaces';
import { boxSelect, polygonSelectGroups, rectPolygon } from './boxSelect';
import { contextGroups } from './groupModels';
import { edgeId } from './Selection';
import type { Preview, Projector, Tool, ToolContext, ToolEvent } from './types';

/**
 * Select: click a face, edge or point (where two or more lines meet; Shift adds/removes), drag a box (left→right: fully inside;
 * right→left: touching), double-click a face for the face plus its edges, double-click an edge for
 * the edge plus its faces, triple-click for everything connected. A facet of a curved surface
 * (a cylinder wall, say) selects and highlights the whole surface. A group selects as one piece;
 * double-click it to edit its contents, and click outside it (or press Esc) to close it again.
 */
export class SelectTool implements Tool {
  readonly id = 'select';
  readonly name = 'Select';
  private press: { screen: [number, number] } | null = null;
  private box: { from: [number, number]; to: [number, number] } | null = null;
  private hoverFace: FaceId | null = null;
  private hoverEdge: HalfEdgeId | null = null;
  private hoverPoint: VertexId | null = null;
  private hoverGuide: GuideId | null = null;
  private hoverGroup: GroupId | null = null;
  private lastDouble: { time: number; screen: [number, number] } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return 'Click or drag to select (faces, edges, points, groups, guides). Shift = add/remove. Double-click a face: face and its edges; a group: edit it. Delete erases.';
  }

  vcbLabel(): string {
    return '';
  }

  vcbValue(): string {
    return '';
  }

  inference() {
    return {};
  }

  pointerMove(e: ToolEvent): void {
    this.hoverGuide = guideFirst(e);
    this.hoverPoint = this.hoverGuide === null ? pointUnder(this.ctx, e) : null;
    this.hoverEdge = this.hoverGuide === null && this.hoverPoint === null && e.edge !== null ? edgeId(this.ctx.doc.model, e.edge) : null;
    this.hoverGroup = this.hoverGuide === null && this.hoverEdge === null ? e.group : null;
    this.hoverFace = this.hoverGuide === null && this.hoverEdge === null ? e.face : null;
    if (this.press && e.down) {
      const [x, y] = this.press.screen;
      if (this.box || Math.hypot(e.screen[0] - x, e.screen[1] - y) > 4) this.box = { from: this.press.screen, to: e.screen };
    }
  }

  pointerDown(e: ToolEvent): void {
    this.press = { screen: e.screen };
    this.box = null;
  }

  pointerUp(e: ToolEvent): void {
    const { selection, doc } = this.ctx;
    if (this.box) {
      const crossing = this.box.to[0] < this.box.from[0];
      const hit = boxSelect(doc.model, this.ctx.projector(), this.box, crossing, doc.guides);
      const groups = polygonSelectGroups(contextGroups(doc), this.ctx.projector(), rectPolygon(this.box), crossing);
      const labels = labelsInBox(doc, this.ctx.projector(), this.box);
      if (e.shift) selection.toggle(hit.faces, hit.edges, hit.guides, groups, [], labels);
      else selection.set(hit.faces, hit.edges, hit.guides, groups, [], labels);
    } else if (this.press) {
      // A click right after a double-click at the same spot is a triple-click.
      const guide = guideFirst(e);
      const point = guide === null ? pointUnder(this.ctx, e) : null;
      if (point !== null) {
        if (e.shift) selection.toggle([], [], [], [], [point]);
        else selection.set([], [], [], [], [point]);
      } else if (guide !== null) {
        if (e.shift) selection.toggle([], [], [guide]);
        else selection.set([], [], [guide]);
      } else if (e.group !== null && e.edge === null) {
        if (e.shift) selection.toggle([], [], [], [e.group]);
        else selection.set([], [], [], [e.group]);
      } else if (e.outside && e.edge === null) {
        this.ctx.exitGroup();
      } else if (this.lastDouble && performanceNow() - this.lastDouble.time < 400 && near(this.lastDouble.screen, e.screen)) {
        this.selectConnected(e);
      } else {
        // A face of a curved surface stands for the whole surface (all facets of a cylinder wall).
        const faces = e.edge === null && e.face !== null ? smoothSurface(doc.model, e.face) : [];
        const edges = e.edge !== null ? [edgeId(doc.model, e.edge)] : [];
        if (e.shift && faces.length) {
          // Add or remove the surface as one unit, following the state of the clicked facet.
          const selected = selection.faces.has(e.face!);
          selection.toggle(
            faces.filter((f) => selection.faces.has(f) === selected),
            [],
          );
        } else if (e.shift) selection.toggle(faces, edges);
        else if (faces.length || edges.length) selection.set(faces, edges);
        else selection.clear();
      }
    }
    this.press = null;
    this.box = null;
  }

  doubleClick(e: ToolEvent): void {
    const { selection, doc } = this.ctx;
    const model = doc.model;
    let faces: FaceId[] = [];
    let edges: HalfEdgeId[] = [];
    if (guideFirst(e) !== null || pointUnder(this.ctx, e) !== null) return; // the click already selected it
    if (e.group !== null && e.edge === null) {
      this.ctx.enterGroup(e.group);
      return;
    }
    if (e.edge !== null) {
      edges = [edgeId(model, e.edge)];
      faces = [model.faceOf(e.edge), model.faceOf(model.he(e.edge).twin)].filter((f): f is FaceId => f !== null);
    } else if (e.face !== null) {
      faces = smoothSurface(model, e.face);
      edges = surfaceOutline(model, faces);
    } else return;
    if (e.shift) selection.add(faces, edges);
    else selection.set(faces, edges);
    this.lastDouble = { time: performanceNow(), screen: e.screen };
  }

  /** Everything edge-connected to the clicked face or edge. */
  private selectConnected(e: ToolEvent): void {
    const model = this.ctx.doc.model;
    const start = e.face ?? (e.edge !== null ? model.faceOf(e.edge) ?? model.faceOf(model.he(e.edge).twin) : null);
    if (start === null) return;
    const faces = [...model.connectedFaces(start)];
    const edges = new Set(faces.flatMap((f) => model.faceHalfEdges(f).map((h) => edgeId(model, h))));
    this.ctx.selection.set(faces, edges);
    this.lastDouble = null;
  }

  typed(): void {
    throw new Error('Select has no typed input');
  }

  cancel(): void {
    this.press = null;
    this.box = null;
  }

  reset(): void {
    this.cancel();
    this.lastDouble = null;
  }

  preview(): Preview {
    const p: Preview = {};
    if (this.box) p.box = { from: this.box.from, to: this.box.to, crossing: this.box.to[0] < this.box.from[0] };
    else if (this.hoverGuide !== null) p.guides = [this.hoverGuide];
    else if (this.hoverPoint !== null) p.points = [this.hoverPoint];
    else if (this.hoverEdge !== null) p.edges = [this.hoverEdge];
    else if (this.hoverGroup !== null) p.groups = [this.hoverGroup];
    else if (this.hoverFace !== null && this.ctx.doc.model.faces.has(this.hoverFace)) p.faces = smoothSurface(this.ctx.doc.model, this.hoverFace);
    return p;
  }
}

/**
 * The guide to act on for a click, if any: a guide point always wins; a guide line wins unless an
 * edge is under the cursor too (geometry comes first).
 */
export function guideFirst(e: ToolEvent): GuideId | null {
  if (!e.guide) return null;
  return e.guide.kind === 'point' || e.edge === null ? e.guide.id : null;
}

/** How close (in pixels) the cursor must be to a point to pick it. */
const POINT_PX = 8;

/**
 * The point under the cursor: an end of the edge under the cursor, within a few pixels (less on
 * an edge short on screen, so its middle still picks the edge), where two or more lines meet.
 * Points win over the edge and face they sit on.
 */
export function pointUnder(ctx: ToolContext, e: ToolEvent): VertexId | null {
  const model = ctx.doc.model;
  if (e.edge === null || !model.halfEdges.has(e.edge)) return null;
  const proj = ctx.projector();
  const ends = [model.he(e.edge).origin, model.dest(e.edge)];
  const screen = ends.map((v) => proj.toScreen(model.pos(v)));
  let best: VertexId | null = null;
  let bestPx = screen[0] && screen[1] ? Math.min(POINT_PX, Math.hypot(screen[0][0] - screen[1][0], screen[0][1] - screen[1][1]) / 3) : POINT_PX;
  for (const [i, v] of ends.entries()) {
    const s = screen[i];
    const px = s ? Math.hypot(s[0] - e.screen[0], s[1] - e.screen[1]) : Infinity;
    if (px <= bestPx && isPoint(model, v)) {
      best = v;
      bestPx = px;
    }
  }
  return best;
}

const performanceNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 6;

/** Labels whose text sits inside a screen box (they are not geometry, so window and crossing agree). */
export function labelsInBox(doc: Document, projector: Projector, box: { from: [number, number]; to: [number, number] }): LabelId[] {
  const [x0, x1] = [Math.min(box.from[0], box.to[0]), Math.max(box.from[0], box.to[0])];
  const [y0, y1] = [Math.min(box.from[1], box.to[1]), Math.max(box.from[1], box.to[1])];
  const out: LabelId[] = [];
  for (const l of doc.labels.items.values()) {
    const p = projector.toScreen(l.position);
    if (p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1) out.push(l.id);
  }
  return out;
}
