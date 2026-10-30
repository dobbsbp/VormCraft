import { fromPlane2D, makePlane, signedDistance, toPlane2D, type Plane } from '../math/plane';
import { cross2, sub2, type Vec2 } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { CircleCurve, CurveId, HalfEdgeId, Model, VertexId } from '../model/Model';
import { drawEdges, type DrawEdgesResult } from './edges';
import { offsetRing2D, offsetRingValid } from './offset';

/** Edges joined end to end: the vertices in order, and whether the chain closes on itself. */
export interface EdgeChain {
  vertices: VertexId[];
  closed: boolean;
}

/** Order a set of edges into one chain. Throws if they branch or are not all connected. */
export function edgeChain(model: Model, edges: Iterable<HalfEdgeId>): EdgeChain {
  const next = new Map<VertexId, VertexId[]>();
  const link = (a: VertexId, b: VertexId) => next.set(a, [...(next.get(a) ?? []), b]);
  const seen = new Set<string>();
  for (const e of edges) {
    if (!model.halfEdges.has(e)) continue;
    const a = model.he(e).origin;
    const b = model.dest(e);
    const key = a < b ? `${a}>${b}` : `${b}>${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    link(a, b);
    link(b, a);
  }
  if (seen.size === 0) throw new Error('Select the edges to offset');
  if ([...next.values()].some((n) => n.length > 2)) throw new Error('The selected edges branch: select one connected chain of edges');
  const ends = [...next.keys()].filter((v) => next.get(v)!.length === 1);
  const closed = ends.length === 0;
  const start = closed ? next.keys().next().value! : ends[0];
  const vertices = [start];
  let prev: VertexId | undefined;
  let at = start;
  for (;;) {
    const step: VertexId | undefined = next.get(at)!.find((v) => v !== prev);
    if (step === undefined || step === start) break;
    vertices.push(step);
    prev = at;
    at = step;
  }
  if (vertices.length - (closed ? 0 : 1) !== seen.size) throw new Error('The selected edges are not connected: select one chain of edges');
  return { vertices, closed };
}

/**
 * The plane a chain lies in, or null when it is a straight line (any plane through it would do).
 * The normal is turned to agree with `prefer` when given. Throws if the chain is not flat.
 */
export function chainPlane(model: Model, chain: EdgeChain, prefer?: Vec3): Plane | null {
  const pts = chain.vertices.map((v) => model.pos(v));
  let best: Vec3 | null = null;
  let bestLen = 0;
  for (let i = 1; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const n = cross(sub(pts[i], pts[0]), sub(pts[j], pts[0]));
      if (length(n) > bestLen) {
        bestLen = length(n);
        best = n;
      }
    }
  }
  const extent = Math.max(...pts.map((p) => length(sub(p, pts[0]))));
  if (!best || bestLen <= TOL * extent) return null;
  let normal = normalize(best);
  if (prefer && dot(normal, prefer) < 0) normal = scale(normal, -1);
  const plane = makePlane(pts[0], normal);
  if (pts.some((p) => Math.abs(signedDistance(plane, p)) > TOL)) throw new Error('The selected edges do not lie in one plane');
  return plane;
}

/**
 * Offset an open or closed 2D polyline to its left by `d` (negative = right), with mitred corners;
 * the ends of an open one move straight sideways. Throws if the distance is too large for the
 * shape (a segment would flip over).
 */
export function offsetPolyline2D(points: readonly Vec2[], closed: boolean, d: number): Vec2[] {
  if (closed) {
    const off = offsetRing2D(points, d);
    if (!offsetRingValid(points, off)) throw new Error('Offset distance is too large for these edges');
    return off;
  }
  const n = points.length;
  const dirs: Vec2[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const e = sub2(points[i + 1], points[i]);
    const len = Math.hypot(e[0], e[1]);
    dirs.push([e[0] / len, e[1] / len]);
  }
  const left = (v: Vec2): Vec2 => [-v[1], v[0]];
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = dirs[i - 1];
    const next = dirs[i];
    if (!prev || !next || Math.abs(cross2(prev, next)) < 1e-9) {
      const l = left(next ?? prev);
      out.push([points[i][0] + l[0] * d, points[i][1] + l[1] * d]);
      continue;
    }
    const lp = left(prev);
    const ln = left(next);
    const w: Vec2 = [(ln[0] - lp[0]) * d, (ln[1] - lp[1]) * d];
    const s = cross2(w, next) / cross2(prev, next);
    out.push([points[i][0] + lp[0] * d + prev[0] * s, points[i][1] + lp[1] * d + prev[1] * s]);
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = sub2(points[i + 1], points[i]);
    const b = sub2(out[i + 1], out[i]);
    if (a[0] * b[0] + a[1] * b[1] <= 0) throw new Error('Offset distance is too large for these edges');
  }
  return out;
}

/** A new circle for the offset copy of an arc. */
type CircleSpec = Omit<CircleCurve, 'id'>;

/**
 * The offset chain as 3D points (first point repeated at the end when closed), in chain order,
 * and for each segment the circle it lies on when the source segment was part of an arc. Points
 * on an arc go straight out from its centre, so they lie on the new circle.
 */
export function offsetChain(model: Model, chain: EdgeChain, plane: Plane, d: number): { points: Vec3[]; curves: (CircleSpec | null)[] } {
  const pts = chain.vertices.map((v) => model.pos(v));
  if (pts.some((p) => Math.abs(signedDistance(plane, p)) > TOL)) throw new Error('The selected edges do not lie in one plane');
  const vs = chain.closed ? [...chain.vertices, chain.vertices[0]] : chain.vertices;
  const specs = new Map<CurveId, CircleSpec>();
  const segCurve = vs.slice(0, -1).map((a, i): CurveId | null => {
    const c = model.he(model.halfEdgeBetween(a, vs[i + 1])!).curve;
    const src = c === null ? undefined : model.curves.get(c);
    if (c === null || !src) return null;
    if (!specs.has(c)) {
      // Moving left of the edge shrinks the circle when its centre is on the left.
      const A = toPlane2D(plane, model.pos(a));
      const B = toPlane2D(plane, model.pos(vs[i + 1]));
      const C = toPlane2D(plane, src.center);
      const radius = src.radius + (cross2(sub2(B, A), sub2(C, A)) > 0 ? -d : d);
      if (radius <= TOL) throw new Error('Offset distance is larger than an arc radius');
      specs.set(c, { kind: 'circle', center: src.center, normal: src.normal, radius, segments: src.segments });
    }
    return c;
  });
  const off = offsetPolyline2D(
    pts.map((p) => toPlane2D(plane, p)),
    chain.closed,
    d,
  ).map((p) => fromPlane2D(plane, p));
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const around = chain.closed ? [segCurve[(i - 1 + n) % n], segCurve[i]] : [segCurve[i - 1], segCurve[i]].filter((c) => c !== undefined);
    const c = around[0];
    if (c === null || c === undefined || around.some((x) => x !== c)) continue;
    const spec = specs.get(c)!;
    const r = distance(pts[i], spec.center);
    if (r > TOL) off[i] = add(spec.center, scale(sub(pts[i], spec.center), spec.radius / r));
  }
  return { points: chain.closed ? [...off, off[0]] : off, curves: segCurve.map((c) => (c === null ? null : specs.get(c)!)) };
}

/** The offset chain as 3D points (first point repeated at the end when closed), in chain order. */
export function offsetChainPoints(model: Model, chain: EdgeChain, plane: Plane, d: number): Vec3[] {
  return offsetChain(model, chain, plane, d).points;
}

/**
 * Draw a copy of a chain of edges offset by `d` within `plane` (to the left of the chain's
 * direction looking down the normal; negative = right). Arcs stay true arcs about the same centre.
 * The new edges split faces they cross, like any drawn line.
 */
export function offsetEdges(model: Model, edges: Iterable<HalfEdgeId>, plane: Plane, d: number): DrawEdgesResult {
  if (Math.abs(d) <= TOL) throw new Error('Offset distance must be more than zero');
  const { points, curves } = offsetChain(model, edgeChain(model, edges), plane, d);
  const ids = new Map<CircleSpec, CurveId>();
  const curveIds = curves.map((spec) => {
    if (!spec) return null;
    if (!ids.has(spec)) ids.set(spec, model.addCurve(spec));
    return ids.get(spec)!;
  });
  return drawEdges(model, points, { curves: curveIds });
}
