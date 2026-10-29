import type { FaceId, HalfEdgeId } from '../core/model/Model';
import type { GuideId } from '../doc/Guides';
import { smoothSurface, surfaceOutline } from '../core/model/surfaces';
import { boxSelect } from './boxSelect';
import { edgeId } from './Selection';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';

/**
 * Select: click a face or edge (Shift adds/removes), drag a box (left→right: fully inside;
 * right→left: touching), double-click a face for the face plus its edges, double-click an edge for
 * the edge plus its faces, triple-click for everything connected. A facet of a curved surface
 * (a cylinder wall, say) selects and highlights the whole surface.
 */
export class SelectTool implements Tool {
  readonly id = 'select';
  readonly name = 'Select';
  private press: { screen: [number, number] } | null = null;
  private box: { from: [number, number]; to: [number, number] } | null = null;
  private hoverFace: FaceId | null = null;
  private hoverEdge: HalfEdgeId | null = null;
  private hoverGuide: GuideId | null = null;
  private lastDouble: { time: number; screen: [number, number] } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return 'Click or drag to select (faces, edges, guides). Shift = add/remove. Double-click a face: face and its edges. Delete erases.';
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
    this.hoverEdge = this.hoverGuide === null && e.edge !== null ? edgeId(this.ctx.doc.model, e.edge) : null;
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
      if (e.shift) selection.toggle(hit.faces, hit.edges, hit.guides);
      else selection.set(hit.faces, hit.edges, hit.guides);
    } else if (this.press) {
      // A click right after a double-click at the same spot is a triple-click.
      const guide = guideFirst(e);
      if (guide !== null) {
        if (e.shift) selection.toggle([], [], [guide]);
        else selection.set([], [], [guide]);
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
    if (guideFirst(e) !== null) return; // the click already selected the guide
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
    else if (this.hoverEdge !== null) p.edges = [this.hoverEdge];
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

const performanceNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const near = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 6;
