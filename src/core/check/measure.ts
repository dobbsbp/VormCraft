import { add, cross, dot, length, scale, sub, type Vec3 } from '../math/vec3';
import type { FaceId, Model } from '../model/Model';
import { triangulateFace } from '../triangulate';

export function faceArea(model: Model, face: FaceId): number {
  let a = 0;
  for (const [p, q, r] of triangulateFace(model, face)) {
    const P = model.pos(p);
    a += length(cross(sub(model.pos(q), P), sub(model.pos(r), P))) / 2;
  }
  return a;
}

/**
 * The centre of a face: the balance point of its area (holes left out), lying on the face's plane
 * whatever angle it is at. The middle of a rectangle, circle or regular polygon.
 */
export function faceCentre(model: Model, face: FaceId): Vec3 {
  let total = 0;
  let sum: Vec3 = [0, 0, 0];
  for (const [p, q, r] of triangulateFace(model, face)) {
    const P = model.pos(p);
    const Q = model.pos(q);
    const R = model.pos(r);
    const a = length(cross(sub(Q, P), sub(R, P))) / 2;
    total += a;
    sum = add(sum, scale(add(add(P, Q), R), a / 3));
  }
  return total > 0 ? scale(sum, 1 / total) : model.pos(model.loopVertices(model.face(face).outer)[0]);
}

/** Signed volume enclosed by closed, outward-oriented faces (divergence theorem). */
export function volume(model: Model, faces: Iterable<FaceId> = model.faces.keys()): number {
  let v = 0;
  for (const f of faces) {
    for (const [p, q, r] of triangulateFace(model, f)) v += dot(model.pos(p), cross(model.pos(q), model.pos(r))) / 6;
  }
  return v;
}
