import { cross, dot, length, sub } from '../math/vec3';
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

/** Signed volume enclosed by closed, outward-oriented faces (divergence theorem). */
export function volume(model: Model, faces: Iterable<FaceId> = model.faces.keys()): number {
  let v = 0;
  for (const f of faces) {
    for (const [p, q, r] of triangulateFace(model, f)) v += dot(model.pos(p), cross(model.pos(q), model.pos(r))) / 6;
  }
  return v;
}
