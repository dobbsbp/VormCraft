import { dot } from '../math/vec3';
import type { FaceId, HalfEdgeId, Model } from './Model';

/** Seams between facets of a curved surface are soft below this angle; 46° covers 8-gon circles. */
const SOFT_EDGE_COS = Math.cos((46 * Math.PI) / 180);

/**
 * Faces that border a true curve (circle or arc edges) or a soft edge: candidates for being facets
 * of a curved surface.
 */
export function facesWithCurveEdges(model: Model): Set<FaceId> {
  const out = new Set<FaceId>();
  for (const h of model.halfEdges.values()) {
    if ((h.curve === null && !h.soft) || h.loop === null) continue;
    out.add(model.loop(h.loop).face);
  }
  return out;
}

/**
 * A soft edge is one marked soft, or (unless marked hard) a straight seam between two facets of the same curved surface (e.g. the side of
 * a cylinder): no curve of its own, both faces border a curve, and a shallow angle between them.
 * Soft edges are hidden in the viewport, and the facets they join act as one surface.
 */
export function isSoftEdge(model: Model, e: HalfEdgeId, curvedFaces = facesWithCurveEdges(model)): boolean {
  const h = model.he(e);
  const f = model.faceOf(e);
  const g = model.faceOf(h.twin);
  if (f === null || g === null || f === g) return false;
  // Marked soft (e.g. the seams of a swept pipe) unless the faces are coplanar, or marked hard.
  if (h.soft !== undefined) return h.soft && dot(model.face(f).normal, model.face(g).normal) < 1 - 1e-9;
  if (h.curve !== null) return false;
  if (!curvedFaces.has(f) || !curvedFaces.has(g)) return false;
  const c = dot(model.face(f).normal, model.face(g).normal);
  return c >= SOFT_EDGE_COS && c < 1 - 1e-9;
}

/**
 * The whole smooth surface a face belongs to: the faces reachable across soft edges (all the
 * facets of a cylinder wall, say). A flat face on its own is a surface of one face.
 */
export function smoothSurface(model: Model, face: FaceId, curvedFaces = facesWithCurveEdges(model)): FaceId[] {
  if (!curvedFaces.has(face)) return [face];
  const seen = new Set([face]);
  const stack = [face];
  while (stack.length) {
    for (const h of model.faceHalfEdges(stack.pop()!)) {
      const other = model.faceOf(model.he(h).twin);
      if (other === null || seen.has(other) || !isSoftEdge(model, h, curvedFaces)) continue;
      seen.add(other);
      stack.push(other);
    }
  }
  return [...seen];
}

/** The visible (non-soft) edges bounding a set of faces, as canonical edge ids. */
export function surfaceOutline(model: Model, faces: Iterable<FaceId>, curvedFaces = facesWithCurveEdges(model)): HalfEdgeId[] {
  const out = new Set<HalfEdgeId>();
  for (const f of faces) {
    for (const h of model.faceHalfEdges(f)) {
      if (!isSoftEdge(model, h, curvedFaces)) out.add(Math.min(h, model.he(h).twin));
    }
  }
  return [...out];
}
