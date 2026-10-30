import type { FaceId, HalfEdgeId } from '../core/model/Model';
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
      : 'Select the path first (edges, or a face to follow its edge), then click the profile face.';
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

  /** The path: the selected edges, plus the outer edges of selected faces other than the profile. */
  private path(profile: FaceId): HalfEdgeId[] {
    const model = this.ctx.doc.model;
    const edges = new Set<HalfEdgeId>(this.ctx.selection.edges);
    for (const f of this.ctx.selection.faces) {
      if (f === profile || !model.faces.has(f)) continue;
      for (const h of model.loopHalfEdges(model.face(f).outer)) edges.add(edgeId(model, h));
    }
    // A profile selected along with its own edges (double-click) is not part of the path.
    for (const h of model.faceHalfEdges(profile)) edges.delete(edgeId(model, h));
    return [...edges];
  }

  pointerMove(e: ToolEvent): void {
    this.hover = e.face;
  }

  pointerDown(e: ToolEvent): void {
    if (e.face === null) return;
    const path = this.path(e.face);
    if (!path.length) throw new Error('Select the path first: the edges to follow (or a face to follow its edge)');
    const profile = e.face;
    this.ctx.apply(() => followMe(this.ctx.doc.model, profile, path));
    this.hover = null;
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
