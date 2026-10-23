import { signedDistance, toPlane2D } from '../math/plane';
import { pointInRegion } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { dot, type Vec3 } from '../math/vec3';
import type { FaceId, Model } from './Model';

/**
 * The face containing a point (on its plane and inside its outline, holes excluded). If `normal`
 * is given, only faces facing that way are considered. Points on a face boundary do not count.
 */
export function findFaceAt(model: Model, point: Vec3, normal?: Vec3): FaceId | undefined {
  for (const face of model.faces.values()) {
    if (normal && dot(face.normal, normal) < 1 - 1e-6) continue;
    const plane = model.facePlane(face.id);
    if (Math.abs(signedDistance(plane, point)) > TOL) continue;
    const rings = model.faceVertexLoops(face.id).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
    if (pointInRegion(toPlane2D(plane, point), rings[0], rings.slice(1)) === 'inside') return face.id;
  }
  return undefined;
}
