import { makePlane, planesCoincide, signedDistance, toPlane2D, type Plane } from '../math/plane';
import { pointInRegion, signedArea } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { CurveId, FaceId, HalfEdgeId, Model, VertexId } from '../model/Model';
import { assembleFaces, traceLoops } from '../model/region';
import { imprintSegments } from './imprint';

export interface DrawEdgesResult {
  /** The edges now making up the drawn path (canonical lower half-edge ids). */
  edges: HalfEdgeId[];
  /** Faces created or reshaped (split) by the new edges. */
  faces: FaceId[];
}

/** Closest points between segments p→q and a→b: parameters s (on pq), t (on ab) and distance. */
function closestSegmentSegment(p: Vec3, q: Vec3, a: Vec3, b: Vec3): { s: number; t: number; dist: number } {
  const d1 = sub(q, p);
  const d2 = sub(b, a);
  const r = sub(p, a);
  const A = dot(d1, d1);
  const E = dot(d2, d2);
  const F = dot(d2, r);
  const C = dot(d1, r);
  const B = dot(d1, d2);
  const denom = A * E - B * B;
  let s = denom > 1e-12 * A * E ? Math.min(1, Math.max(0, (B * F - C * E) / denom)) : 0;
  let t = (B * s + F) / E;
  if (t < 0) {
    t = 0;
    s = Math.min(1, Math.max(0, -C / A));
  } else if (t > 1) {
    t = 1;
    s = Math.min(1, Math.max(0, (B - C) / A));
  }
  return { s, t, dist: distance(add(p, scale(d1, s)), add(a, scale(d2, t))) };
}

/** A vertex at p: an existing vertex, else a new one splitting the edge p lies on, else a new one. */
function vertexAtPoint(model: Model, p: Vec3): VertexId {
  const existing = model.findVertex(p);
  if (existing !== undefined) return existing;
  for (const e of [...model.edges()]) {
    const a = model.pos(model.he(e).origin);
    const b = model.pos(model.dest(e));
    const ab = sub(b, a);
    const t = dot(sub(p, a), ab) / dot(ab, ab);
    if (t <= 0 || t >= 1) continue;
    if (distance(add(a, scale(ab, t)), p) <= TOL) {
      const v = model.addVertex(add(a, scale(ab, t)));
      model.splitEdge(e, v);
      return v;
    }
  }
  return model.addVertex(p);
}

/**
 * Insert the segment p→q as edges: endpoints snap to existing vertices or split the edges they
 * land on, and the segment is split wherever it crosses or touches other edges (which are split
 * too, keeping their faces valid). Returns the half-edges along p→q in order.
 */
export function insertSegment(model: Model, p: Vec3, q: Vec3, curve: CurveId | null = null): HalfEdgeId[] {
  if (distance(p, q) <= TOL) return [];
  const va = vertexAtPoint(model, p);
  const vb = vertexAtPoint(model, q);
  const P = model.pos(va);
  const Q = model.pos(vb);
  const stops: { s: number; v: VertexId }[] = [
    { s: 0, v: va },
    { s: 1, v: vb },
  ];
  // Existing vertices lying on the segment.
  const pq = sub(Q, P);
  const len2 = dot(pq, pq);
  for (const v of model.vertices.values()) {
    if (v.id === va || v.id === vb || model.outgoing(v.id).size === 0) continue;
    const s = dot(sub(v.pos, P), pq) / len2;
    if (s <= 0 || s >= 1) continue;
    if (distance(add(P, scale(pq, s)), v.pos) <= TOL) stops.push({ s, v: v.id });
  }
  // Edges crossing the segment in their interior.
  for (const e of [...model.edges()]) {
    const h = model.he(e);
    const a = model.pos(h.origin);
    const b = model.pos(model.dest(e));
    const c = closestSegmentSegment(P, Q, a, b);
    if (c.dist > TOL) continue;
    const eps = TOL / Math.max(length(sub(b, a)), TOL);
    if (c.t <= eps || c.t >= 1 - eps) continue; // touches at an end vertex: handled above
    const sEps = TOL / Math.sqrt(len2);
    if (c.s <= sEps || c.s >= 1 - sEps) continue; // our own end lies on it: vertexAtPoint split it
    const v = model.addVertex(add(a, scale(sub(b, a), c.t)));
    model.splitEdge(e, v);
    stops.push({ s: c.s, v });
  }
  stops.sort((x, y) => x.s - y.s);
  const out: HalfEdgeId[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i].v;
    const b = stops[i + 1].v;
    if (a === b) continue;
    const he = model.addEdge(a, b, curve);
    if (curve !== null && model.he(he).curve === null) model.setEdgeCurve(a, b, curve);
    out.push(he);
  }
  return out;
}

/** Faces whose plane contains the segment and whose area it lies in (boundary included). */
function hostFaceOf(model: Model, a: Vec3, b: Vec3): FaceId | undefined {
  const mid = scale(add(a, b), 0.5);
  for (const f of model.faces.keys()) {
    const plane = model.facePlane(f);
    if (Math.abs(signedDistance(plane, a)) > TOL || Math.abs(signedDistance(plane, b)) > TOL) continue;
    const rings = model.faceVertexLoops(f).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
    const inside = (p: Vec3) => pointInRegion(toPlane2D(plane, p), rings[0], rings.slice(1)) !== 'outside';
    // The midpoint must be strictly inside (an edge along the boundary is not "on" the face).
    if (inside(a) && inside(b) && pointInRegion(toPlane2D(plane, mid), rings[0], rings.slice(1)) === 'inside') return f;
  }
  return undefined;
}

const isWire = (model: Model, e: HalfEdgeId) => model.he(e).loop === null && model.he(model.he(e).twin).loop === null;

/** Loose edges lying on a face (inside it or on its boundary). */
function wiresOnFace(model: Model, f: FaceId): HalfEdgeId[] {
  const plane = model.facePlane(f);
  const rings = model.faceVertexLoops(f).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
  const out: HalfEdgeId[] = [];
  for (const e of model.edges()) {
    if (!isWire(model, e)) continue;
    const pts = [model.pos(model.he(e).origin), model.pos(model.dest(e))];
    if (pts.some((p) => Math.abs(signedDistance(plane, p)) > TOL)) continue;
    const mid = scale(add(pts[0], pts[1]), 0.5);
    if ([...pts, mid].every((p) => pointInRegion(toPlane2D(plane, p), rings[0], rings.slice(1)) !== 'outside')) out.push(e);
  }
  return out;
}

/** A conventional normal for a new face on a plane: up for ground-like planes, else a fixed side. */
function preferredNormal(n: Vec3): Vec3 {
  const s = Math.abs(n[2]) > 1e-9 ? Math.sign(n[2]) : Math.abs(n[1]) > 1e-9 ? -Math.sign(n[1]) : Math.sign(n[0]);
  return scale(n, s || 1);
}

/** Planes through edge e and a non-collinear loose (or face-outline) edge at either end. */
function candidatePlanes(model: Model, e: HalfEdgeId): Plane[] {
  const a = model.he(e).origin;
  const b = model.dest(e);
  const dir = sub(model.pos(b), model.pos(a));
  const planes: Plane[] = [];
  for (const v of [a, b]) {
    for (const h of model.outgoing(v)) {
      const w = model.dest(h);
      if (w === a || w === b) continue;
      const n = cross(dir, sub(model.pos(w), model.pos(v)));
      if (length(n) <= TOL * length(dir)) continue;
      const plane = makePlane(model.pos(a), preferredNormal(normalize(n)));
      if (!planes.some((p) => planesCoincide(p, plane))) planes.push(plane);
    }
  }
  return planes;
}

/**
 * Make faces from closed loops of loose edges that include any of `fresh` (the edges just drawn),
 * as SketchUp does when you close a shape with lines. Loops are found per plane; outlines of
 * existing coplanar faces take part on their free side, so a loop drawn around a face becomes a
 * ring around it.
 */
function closeLoops(model: Model, fresh: HalfEdgeId[]): FaceId[] {
  const created: FaceId[] = [];
  for (const e0 of fresh) {
    if (!model.halfEdges.has(e0) || !isWire(model, e0)) continue;
    for (const plane of candidatePlanes(model, e0)) {
      if (!isWire(model, e0)) break;
      const onPlane = (v: VertexId) => Math.abs(signedDistance(plane, model.pos(v))) <= TOL;
      const directed: [VertexId, VertexId][] = [];
      for (const e of model.edges()) {
        const h = model.he(e);
        const a = h.origin;
        const b = model.dest(e);
        if (!onPlane(a) || !onPlane(b)) continue;
        if (isWire(model, e)) directed.push([a, b], [b, a]);
        else {
          // An outline edge of an existing face on this plane, facing the same way: only its free side.
          for (const side of [e, h.twin]) {
            const t = model.he(model.he(side).twin);
            if (model.he(side).loop !== null || t.loop === null) continue;
            const owner = model.face(model.loop(t.loop).face);
            if (dot(owner.normal, plane.normal) > 1 - 1e-6) directed.push([model.he(side).origin, model.dest(side)]);
          }
        }
      }
      const pos2 = (v: VertexId) => toPlane2D(plane, model.pos(v));
      let loops: VertexId[][];
      try {
        loops = traceLoops(directed, pos2);
      } catch {
        continue; // dangling one-sided outline edges: no closed region on this plane
      }
      const freshKeys = new Set(fresh.filter((e) => model.halfEdges.has(e)).flatMap((e) => [`${model.he(e).origin}>${model.dest(e)}`, `${model.dest(e)}>${model.he(e).origin}`]));
      const touchesFresh = (ring: VertexId[]) => ring.some((v, i) => freshKeys.has(`${v}>${ring[(i + 1) % ring.length]}`));
      const { faces } = assembleFaces(loops, pos2);
      for (const f of faces) {
        if (!touchesFresh(f.outer) && !f.holes.some(touchesFresh)) continue;
        if (Math.abs(signedArea(f.outer.map(pos2))) <= TOL * TOL) continue;
        // Skip loops that walk an edge twice (a bridge) — they enclose nothing new.
        const keys = f.outer.map((v, i) => `${v}>${f.outer[(i + 1) % f.outer.length]}`);
        if (new Set(keys).size !== keys.length) continue;
        try {
          created.push(model.addFace(f.outer, f.holes, { normal: plane.normal }));
        } catch {
          // A directed edge is already taken (e.g. by a face on the other side): leave this loop open.
        }
      }
    }
  }
  return created;
}

/**
 * Draw a path of edges through `points` (Line and Arc tools). Where the path lies on a face the
 * face is split (once the path divides it); elsewhere the edges are loose, and any closed planar
 * loop they complete becomes a face.
 */
export function drawEdges(model: Model, points: readonly Vec3[], opts: { curve?: CurveId | null } = {}): DrawEdgesResult {
  const curve = opts.curve ?? null;
  const inserted: HalfEdgeId[] = [];
  for (let i = 0; i + 1 < points.length; i++) inserted.push(...insertSegment(model, points[i], points[i + 1], curve));
  const ends = new Set<VertexId>(inserted.flatMap((h) => [model.he(h).origin, model.dest(h)]));
  const canonical = () => [...new Set(inserted.filter((h) => model.halfEdges.has(h)).map((h) => Math.min(h, model.he(h).twin)))];

  const faces: FaceId[] = [];
  // Split faces the new edges lie on, using every loose edge on that face (earlier lines included).
  const hosts = new Set<FaceId>();
  for (const h of canonical()) {
    const f = hostFaceOf(model, model.pos(model.he(h).origin), model.pos(model.dest(h)));
    if (f !== undefined) hosts.add(f);
  }
  for (const f of hosts) {
    if (!model.faces.has(f)) continue;
    const wires = wiresOnFace(model, f);
    const segments = wires.map((e) => ({ a: model.pos(model.he(e).origin), b: model.pos(model.dest(e)), curve: model.he(e).curve }));
    const pieces = imprintSegments(model, f, segments);
    if (pieces.length > 1 || pieces[0] !== f) faces.push(...pieces);
  }
  faces.push(...closeLoops(model, canonical()));

  // Re-collect the path's edges by its vertices (splits may have renumbered half-edges).
  const edges = canonical();
  if (edges.length === 0 && ends.size) {
    for (const v of ends) for (const h of model.outgoing(v)) if (ends.has(model.dest(h))) edges.push(Math.min(h, model.he(h).twin));
  }
  return { edges: [...new Set(edges)], faces: [...new Set(faces)].filter((f) => model.faces.has(f)) };
}
