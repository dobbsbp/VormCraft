import { makePlane, signedDistance, toPlane2D, type Plane } from '../core/math/plane';
import { closestOnSegment, cross2, pointInRegion, sub2, type Vec2 } from '../core/math/polygon2d';
import { TOL } from '../core/math/tolerance';
import { dot, length, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import type { FaceId, HalfEdgeId } from '../core/model/Model';
import { offsetFace, offsetFaceRings } from '../core/ops/offset';
import { chainPlane, edgeChain, offsetChainPoints, offsetEdges, type EdgeChain } from '../core/ops/offsetEdges';
import type { DocumentSnapshot } from '../doc/Document';
import { drawingPlane, pointOnPlane } from './geom';
import { closedSegments } from './RectangleTool';
import type { InferenceHints, Preview, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

/** What is being offset: a face's loops, or a chain of selected edges within a plane. */
type Source = { kind: 'face'; face: FaceId; plane: Plane } | { kind: 'edges'; edges: HalfEdgeId[]; chain: EdgeChain; plane: Plane };

/**
 * Offset: click a face, move in or out, click to finish (or type a distance + Enter; positive =
 * inward, negative = outward). The new loop follows the cursor: its distance from the face edge is
 * the cursor's distance from it. With edges selected (and no faces), it offsets that chain of
 * edges instead, to the side of the cursor (typing a negative distance switches sides). Typing
 * after finishing changes the last offset.
 */
export class OffsetTool implements Tool {
  readonly id = 'offset';
  readonly name = 'Offset';
  readonly dragIsClick = true;
  private hover: FaceId | null = null;
  /** `distance` is signed: for a face, positive is inward; for edges, positive is the chain's left. */
  private active: { source: Source; distance: number } | null = null;
  private last: { base: DocumentSnapshot; source: Source; distance: number } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  /** Offsetting the selection's edges rather than a face: edges selected and no faces. */
  private edgeMode(): boolean {
    const { selection } = this.ctx;
    return selection.edges.size > 0 && selection.faces.size === 0;
  }

  hint(): string {
    if (this.active?.source.kind === 'edges') return 'Move to the side and click, or type a distance and press Enter (negative goes to the other side).';
    if (this.active) return 'Move in or out and click, or type a distance and press Enter (negative goes outward).';
    return this.edgeMode() ? 'Click to start offsetting the selected edges.' : 'Click a face to offset its edges (or select edges first to offset just those).';
  }

  vcbLabel(): string {
    return 'Distance';
  }

  vcbValue(): string {
    const shown = (s: Source, d: number) => formatLength(s.kind === 'edges' ? Math.abs(d) : d);
    if (this.active) return shown(this.active.source, this.active.distance);
    return this.last ? shown(this.last.source, this.last.distance) : '';
  }

  inference(): InferenceHints {
    return this.active ? { plane: this.active.source.plane } : {};
  }

  pointerMove(e: ToolEvent): void {
    if (!this.active) {
      this.hover = this.edgeMode() ? null : e.face;
      return;
    }
    const { source } = this.active;
    const p = pointOnPlane(e.snap?.point, e.ray, source.plane);
    if (!p) return;
    const p2 = toPlane2D(source.plane, p);
    this.active.distance = source.kind === 'face' ? this.signedDistanceToBoundary(source.face, source.plane, p2) : this.signedDistanceToChain(source, p2);
  }

  /** Distance from a point to the face's nearest edge: positive inside the face, negative outside. */
  private signedDistanceToBoundary(face: FaceId, plane: Plane, p: Vec2): number {
    const model = this.ctx.doc.model;
    const rings = model.faceVertexLoops(face).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
    let best = Infinity;
    for (const r of rings) r.forEach((a, i) => (best = Math.min(best, closestOnSegment(p, a, r[(i + 1) % r.length]).dist)));
    return pointInRegion(p, rings[0], rings.slice(1)) === 'outside' ? -best : best;
  }

  /** Distance from a point to the chain: positive on its left (looking down the plane normal). */
  private signedDistanceToChain(source: Extract<Source, { kind: 'edges' }>, p: Vec2): number {
    const model = this.ctx.doc.model;
    const pts = source.chain.vertices.map((v) => toPlane2D(source.plane, model.pos(v)));
    if (source.chain.closed) pts.push(pts[0]);
    let best = { dist: Infinity, side: 1 };
    for (let i = 0; i + 1 < pts.length; i++) {
      const c = closestOnSegment(p, pts[i], pts[i + 1]);
      if (c.dist < best.dist) best = { dist: c.dist, side: cross2(sub2(pts[i + 1], pts[i]), sub2(p, pts[i])) >= 0 ? 1 : -1 };
    }
    return best.dist * best.side;
  }

  pointerDown(e: ToolEvent): void {
    if (!this.active) {
      const source = this.edgeMode() ? this.edgeSource(e) : e.face !== null ? ({ kind: 'face', face: e.face, plane: this.ctx.doc.model.facePlane(e.face) } as const) : null;
      if (!source) return;
      this.active = { source, distance: 0 };
      this.pointerMove(e);
      return;
    }
    this.pointerMove(e);
    if (Math.abs(this.active.distance) <= TOL) return;
    this.commit(this.active.source, this.active.distance);
  }

  /**
   * The selected edges as a chain, and the plane to offset them in: the plane they span, or for a
   * straight chain the face clicked or a face next to them, else level, else facing the viewer.
   */
  private edgeSource(e: ToolEvent): Source {
    const model = this.ctx.doc.model;
    const edges = [...this.ctx.selection.edges];
    const chain = edgeChain(model, edges);
    const pts = chain.vertices.map((v) => model.pos(v));
    const contains = (pl: Plane) => pts.every((p) => Math.abs(signedDistance(pl, p)) <= TOL);
    const adjacent: FaceId[] = [];
    for (const ed of edges) {
      for (const side of [ed, model.he(ed).twin]) {
        const f = model.faceOf(side);
        if (f !== null) adjacent.push(f);
      }
    }
    const candidates = [...(e.face !== null ? [e.face] : []), ...adjacent].filter((f) => model.faces.has(f) && contains(model.facePlane(f)));
    const prefer = candidates.length ? model.face(candidates[0]).normal : ([0, 0, 1] as Vec3);
    const plane = chainPlane(model, chain, prefer);
    if (plane) return { kind: 'edges', edges, chain, plane };
    if (candidates.length) return { kind: 'edges', edges, chain, plane: model.facePlane(candidates[0]) };
    const dir = normalize(sub(pts[pts.length - 1], pts[0]));
    if (Math.abs(dir[2]) < 1e-6) return { kind: 'edges', edges, chain, plane: drawingPlane(pts[0], [0, 0, 1]) };
    // A free sloping or upright line: the plane through it that faces the camera.
    const toward = sub(e.ray.dir, scale(dir, dot(e.ray.dir, dir)));
    if (length(toward) < 1e-9) throw new Error('Look at the edge from the side to offset it');
    return { kind: 'edges', edges, chain, plane: makePlane(pts[0], normalize(scale(toward, -1))) };
  }

  typed(text: string): void {
    const d = parseLength(text);
    if (d === undefined || Math.abs(d) <= TOL) throw new Error('Type a distance (e.g. 5 inward, -5 outward)');
    // For edges the typed distance goes to the side the cursor is on.
    const signed = (s: Source, current: number) => (s.kind === 'edges' ? d * (current < 0 ? -1 : 1) : d);
    if (this.active) this.commit(this.active.source, signed(this.active.source, this.active.distance));
    else if (this.last) this.commit(this.last.source, signed(this.last.source, this.last.distance), this.last.base);
    else throw new Error(this.edgeMode() ? 'Click to start, then type the distance' : 'Click a face first, then type the distance');
  }

  private commit(source: Source, distance: number, base?: DocumentSnapshot): void {
    this.active = null;
    const model = this.ctx.doc.model;
    const before = this.ctx.apply(() => (source.kind === 'face' ? offsetFace(model, source.face, distance) : offsetEdges(model, source.edges, source.plane, distance)), base);
    this.last = { base: before, source, distance };
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
    const { source, distance } = this.active;
    const faces = source.kind === 'face' ? [source.face] : [];
    if (Math.abs(distance) <= TOL) return { faces };
    try {
      if (source.kind === 'edges') {
        const pts = offsetChainPoints(model, source.chain, source.plane, distance);
        return { lines: [{ points: pts.slice(1).flatMap((p, i) => [pts[i], p]), color: 'preview', width: 2 }] };
      }
      const rings = offsetFaceRings(model, source.face, distance);
      return { faces, lines: rings.map((r) => ({ points: closedSegments(r.points), color: 'preview' as const, width: 2 })) };
    } catch {
      return { faces }; // too far for this shape: show nothing until it is valid again
    }
  }
}
