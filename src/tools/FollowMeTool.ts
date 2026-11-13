import type { FaceId, HalfEdgeId } from '../core/model/Model';
import { faceWithinSolid } from '../core/check/solid';
import { followMe } from '../core/ops/followMe';
import { edgeId } from './Selection';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';

/**
 * Follow Me: select the path first (edges, or a face to follow its outline, e.g. a circle for a
 * lathe), then click the profile face: it is swept along the path with mitred corners. A profile
 * on a solid cuts into it (a groove or chamfer along the path).
 */
export class FollowMeTool implements Tool {
  readonly id = 'followMe';
  readonly name = 'Follow Me';
  private hover: FaceId | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return this.hasPath()
      ? 'Click the profile face to sweep it along the selected path.'
      : 'Select the path first (edges, or a face to follow its edge, e.g. a big circle), then click the profile (e.g. a small circle standing upright on its edge: press → or ← while drawing it).';
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

  private hasPath(): boolean {
    return this.ctx.selection.edges.size > 0 || this.ctx.selection.faces.size > 0;
  }

  /**
   * The path: the selected edges, plus the outer edges of selected faces other than the profile.
   * A profile selected along with its own edges (double-click) does not make them path; but a
   * selected face's outline stays whole, even where the profile shares an edge with it (a fillet
   * drawn at the corner of a box's top follows the whole top outline).
   */
  private path(profile: FaceId): HalfEdgeId[] {
    const model = this.ctx.doc.model;
    const own = new Set(model.faceHalfEdges(profile).map((h) => edgeId(model, h)));
    const edges = new Set<HalfEdgeId>([...this.ctx.selection.edges].filter((e) => !own.has(e)));
    for (const f of this.ctx.selection.faces) {
      if (f === profile || !model.faces.has(f)) continue;
      for (const h of model.loopHalfEdges(model.face(f).outer)) edges.add(edgeId(model, h));
    }
    return [...edges];
  }

  /**
   * One loose line selected: the whole chain of loose lines joined to it end to end (as drawn with
   * the Line tool), stopping where lines branch. Returns the chain if it is longer than the line.
   */
  private chainFrom(line: HalfEdgeId): HalfEdgeId[] | null {
    const model = this.ctx.doc.model;
    const loose = (h: HalfEdgeId) => model.he(h).loop === null && model.he(model.he(h).twin).loop === null;
    if (!loose(line)) return null;
    const chain = new Set<HalfEdgeId>([edgeId(model, line)]);
    for (const start of [model.he(line).origin, model.dest(line)]) {
      let at = start;
      for (;;) {
        const out = [...model.outgoing(at)];
        if (out.length !== 2) break;
        const next = out.find((h) => !chain.has(edgeId(model, h)));
        if (next === undefined || !loose(next)) break;
        chain.add(edgeId(model, next));
        at = model.dest(next);
      }
    }
    return chain.size > 1 ? [...chain] : null;
  }

  pointerMove(e: ToolEvent): void {
    this.hover = e.face;
  }

  pointerDown(e: ToolEvent): void {
    if (e.face === null) return;
    let path = this.path(e.face);
    if (!path.length) throw new Error('Select the path first: the edges to follow (or a face to follow its edge)');
    const profile = e.face;
    // One loose line selected: follow every line joined to it end to end (Shift: just that line).
    const whole = path.length === 1 && !this.ctx.selection.faces.size && !e.shift ? this.chainFrom(path[0]) : null;
    if (whole) path = whole;
    const pathFaces = [...this.ctx.selection.faces].filter((f) => f !== profile);
    this.ctx.apply(() => {
      const model = this.ctx.doc.model;
      const result = followMe(model, profile, path);
      // A path face left inside the new solid or on its surface (the disc in the middle of a sphere,
      // under a dome or a cylinder) is in the way: it goes. One outside it (a ring's disc) stays.
      const made = new Set<FaceId>();
      for (const f of result.faces) if (model.faces.has(f) && !made.has(f)) for (const g of model.connectedFaces(f, false)) made.add(g);
      if (!model.isClosed(made)) return;
      for (const f of pathFaces) {
        if (!model.faces.has(f) || made.has(f) || model.isClosed(model.connectedFaces(f, false)) || !faceWithinSolid(model, f, made)) continue;
        const edges = model.faceHalfEdges(f);
        model.removeFace(f);
        model.purgeFree(edges);
      }
    });
    this.hover = null;
    this.said = whole ? `Followed the ${whole.length} lines joined to the one selected (hold Shift when clicking the profile to follow only the selected line)` : null;
  }

  /** What the last sweep did that is worth saying. */
  private said: string | null = null;

  notice(): string | null {
    const said = this.said;
    this.said = null;
    return said;
  }

  typed(): void {
    throw new Error('Follow Me takes no typed value: click the profile face');
  }

  cancel(): void {}

  reset(): void {}

  preview(): Preview {
    return this.hover !== null && this.ctx.doc.model.faces.has(this.hover) ? { faces: [this.hover] } : {};
  }
}
