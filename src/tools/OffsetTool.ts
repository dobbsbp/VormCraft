import { toPlane2D, type Plane } from '../core/math/plane';
import { closestOnSegment, pointInRegion, type Vec2 } from '../core/math/polygon2d';
import { TOL } from '../core/math/tolerance';
import type { FaceId } from '../core/model/Model';
import { offsetFace, offsetFaceRings } from '../core/ops/offset';
import type { DocumentSnapshot } from '../doc/Document';
import { pointOnPlane } from './geom';
import { closedSegments } from './RectangleTool';
import type { InferenceHints, Preview, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

/**
 * Offset: click a face, move in or out, click to finish (or type a distance + Enter; positive =
 * inward, negative = outward). The new loop follows the cursor: its distance from the face edge is
 * the cursor's distance from it. Typing after finishing changes the last offset.
 */
export class OffsetTool implements Tool {
  readonly id = 'offset';
  readonly name = 'Offset';
  readonly dragIsClick = true;
  private hover: FaceId | null = null;
  private active: { face: FaceId; plane: Plane; distance: number } | null = null;
  private last: { base: DocumentSnapshot; face: FaceId; distance: number } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return this.active
      ? 'Move in or out and click, or type a distance and press Enter (negative goes outward).'
      : 'Click a face to offset its edges.';
  }

  vcbLabel(): string {
    return 'Distance';
  }

  vcbValue(): string {
    if (this.active) return formatLength(this.active.distance);
    return this.last ? formatLength(this.last.distance) : '';
  }

  inference(): InferenceHints {
    return this.active ? { plane: this.active.plane } : {};
  }

  pointerMove(e: ToolEvent): void {
    if (!this.active) {
      this.hover = e.face;
      return;
    }
    const p = pointOnPlane(e.snap?.point, e.ray, this.active.plane);
    if (p) this.active.distance = this.signedDistanceToBoundary(this.active.face, this.active.plane, toPlane2D(this.active.plane, p));
  }

  /** Distance from a point to the face's nearest edge: positive inside the face, negative outside. */
  private signedDistanceToBoundary(face: FaceId, plane: Plane, p: Vec2): number {
    const model = this.ctx.doc.model;
    const rings = model.faceVertexLoops(face).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
    let best = Infinity;
    for (const r of rings) r.forEach((a, i) => (best = Math.min(best, closestOnSegment(p, a, r[(i + 1) % r.length]).dist)));
    return pointInRegion(p, rings[0], rings.slice(1)) === 'outside' ? -best : best;
  }

  pointerDown(e: ToolEvent): void {
    if (!this.active) {
      if (e.face === null) return;
      this.active = { face: e.face, plane: this.ctx.doc.model.facePlane(e.face), distance: 0 };
      this.pointerMove(e);
      return;
    }
    this.pointerMove(e);
    if (Math.abs(this.active.distance) <= TOL) return;
    this.commit(this.active.face, this.active.distance);
  }

  typed(text: string): void {
    const d = parseLength(text);
    if (d === undefined || Math.abs(d) <= TOL) throw new Error('Type a distance (e.g. 5 inward, -5 outward)');
    if (this.active) this.commit(this.active.face, d);
    else if (this.last) this.commit(this.last.face, d, this.last.base);
    else throw new Error('Click a face first, then type the distance');
  }

  private commit(face: FaceId, distance: number, base?: DocumentSnapshot): void {
    this.active = null;
    const before = this.ctx.apply(() => offsetFace(this.ctx.doc.model, face, distance), base);
    this.last = { base: before, face, distance };
  }

  cancel(): void {
    this.active = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    const model = this.ctx.doc.model;
    if (!this.active) return this.hover !== null && model.faces.has(this.hover) ? { faces: [this.hover] } : {};
    if (Math.abs(this.active.distance) <= TOL) return { faces: [this.active.face] };
    try {
      const rings = offsetFaceRings(model, this.active.face, this.active.distance);
      return { faces: [this.active.face], lines: rings.map((r) => ({ points: closedSegments(r.points), color: 'preview' as const, width: 2 })) };
    } catch {
      return { faces: [this.active.face] }; // too far for this shape: show nothing until it is valid again
    }
  }
}
