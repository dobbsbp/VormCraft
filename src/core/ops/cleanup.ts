import { planesCoincide, toPlane2D } from '../math/plane';
import { TOL } from '../math/tolerance';
import { cross, distance, dot, length, sub } from '../math/vec3';
import type { FaceId, HalfEdgeId, Model, VertexId } from '../model/Model';
import { assembleFaces, traceLoops } from '../model/region';

export function facesCoplanar(model: Model, f: FaceId, g: FaceId): boolean {
  return planesCoincide(model.facePlane(f), model.facePlane(g), true);
}

/**
 * Merge two adjacent coplanar faces by removing the edges between them. The merged face keeps
 * `keepId` (one of the two). Returns the resulting face ids (usually one).
 */
export function mergeFaces(model: Model, f: FaceId, g: FaceId, keepId: FaceId = g, touched?: Set<VertexId>): FaceId[] {
  const pair = new Set([f, g]);
  const plane = model.facePlane(keepId);
  const normal = model.face(keepId).normal;
  const boundary: [VertexId, VertexId][] = [];
  const internal: HalfEdgeId[] = [];
  for (const face of pair) {
    for (const h of model.faceHalfEdges(face)) {
      const other = model.faceOf(model.he(h).twin);
      if (other !== null && pair.has(other)) {
        internal.push(h);
        touched?.add(model.he(h).origin);
      }
      else boundary.push([model.he(h).origin, model.dest(h)]);
    }
  }
  const pos2 = (v: VertexId) => toPlane2D(plane, model.pos(v));
  const { faces } = assembleFaces(traceLoops(boundary, pos2), pos2);
  const material = model.face(keepId).material;
  model.removeFace(f);
  model.removeFace(g);
  const result = faces.map((r, i) => model.addFace(r.outer, r.holes, { normal, id: i === 0 ? keepId : undefined, material }));
  model.purgeFree(internal);
  return result;
}

/**
 * Repeatedly merge any candidate face with an adjacent coplanar face (SketchUp-style healing after
 * an operation). Non-candidate face ids are preserved. Returns the candidate faces still standing;
 * end points of removed edges are added to `touched` (candidates for collinear-vertex cleanup).
 */
export function mergeCoplanarFaces(model: Model, candidates: Iterable<FaceId>, touched?: Set<VertexId>): Set<FaceId> {
  const cand = new Set(candidates);
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of cand) {
      if (!model.faces.has(f)) {
        cand.delete(f);
        continue;
      }
      const g = [...model.adjacentFaces(f)].find((g) => facesCoplanar(model, f, g));
      if (g === undefined) continue;
      // Merging into a non-candidate keeps that face's id and stops there, so coplanar faces the
      // user split on purpose are never merged with each other.
      const bothCandidates = cand.has(g);
      cand.delete(f);
      cand.delete(g);
      const merged = mergeFaces(model, f, g, bothCandidates ? f : g, touched);
      if (bothCandidates) for (const r of merged) cand.add(r);
      changed = true;
      break;
    }
  }
  return cand;
}

/**
 * Remove vertices that sit in the middle of a straight run of exactly two edges (left over after
 * merges or booleans). Only vertices whose edges all bound faces are touched.
 */
export function removeCollinearVertices(model: Model, candidates: Iterable<VertexId>): number {
  let removed = 0;
  for (const v of [...candidates]) {
    if (!model.vertices.has(v)) continue;
    const outs = [...model.outgoing(v)];
    if (outs.length !== 2) continue;
    const [a, b] = outs.map((h) => model.dest(h));
    if (model.halfEdgeBetween(a, b) !== undefined) continue;
    const pa = model.pos(a);
    const pb = model.pos(b);
    const pv = model.pos(v);
    const ab = sub(pb, pa);
    const len = length(ab);
    if (len <= TOL) continue;
    if (length(cross(ab, sub(pv, pa))) / len > TOL || dot(sub(pv, pa), ab) <= 0 || dot(sub(pv, pb), ab) >= 0) continue;
    const hes = outs.flatMap((h) => [h, model.he(h).twin]);
    if (hes.some((h) => model.he(h).loop === null)) continue;
    const curveA = model.he(outs[0]).curve;
    const curve = curveA === model.he(outs[1]).curve ? curveA : null;
    const faces = new Set(hes.map((h) => model.faceOf(h)!));
    const rebuilt = [...faces].map((f) => ({
      f,
      normal: model.face(f).normal,
      material: model.face(f).material,
      rings: model.faceVertexLoops(f).map((r) => r.filter((x) => x !== v)),
    }));
    if (rebuilt.some((r) => r.rings.some((ring) => ring.length < 3))) continue;
    for (const r of rebuilt) model.removeFace(r.f);
    for (const r of rebuilt) model.addFace(r.rings[0], r.rings.slice(1), { normal: r.normal, id: r.f, material: r.material });
    if (curve !== null) model.setEdgeCurve(a, b, curve);
    model.purgeFree(hes);
    removed++;
  }
  return removed;
}

/** True when p lies on the circle (within tol), used to re-tag curve edges after a boolean. */
export function onCircle(p: readonly [number, number, number], c: { center: readonly [number, number, number]; normal: readonly [number, number, number]; radius: number }): boolean {
  const d = sub(p, c.center);
  return Math.abs(dot(d, c.normal)) <= TOL && Math.abs(distance(p, c.center) - c.radius) <= TOL * 10;
}
