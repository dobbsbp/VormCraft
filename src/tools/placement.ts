import type { Plane } from '../core/math/plane';
import { signedDistance } from '../core/math/plane';
import { TOL } from '../core/math/tolerance';
import type { Vec3 } from '../core/math/vec3';
import type { FaceId, Model } from '../core/model/Model';
import { findFaceAt } from '../core/model/query';
import { drawingPlane } from './geom';
import type { ToolEvent } from './types';

export interface Placement {
  point: Vec3;
  plane: Plane;
  /** The face being drawn on (it will be split), if any. */
  host: FaceId | undefined;
}

/**
 * Where a drawing tool's first click lands: on the face under the cursor (when the inferred point
 * lies on its plane, including on its edges and corners), else on a face containing the point,
 * else on a plane parallel to the ground through the point.
 */
export function placementAt(model: Model, e: ToolEvent): Placement | null {
  const point = e.snap?.point;
  if (!point) return null;
  const onPlaneOf = (f: FaceId | null | undefined) =>
    f !== null && f !== undefined && model.faces.has(f) && Math.abs(signedDistance(model.facePlane(f), point)) <= TOL;
  let host: FaceId | undefined;
  if (onPlaneOf(e.snap?.face)) host = e.snap!.face;
  else if (onPlaneOf(e.face)) host = e.face!;
  else host = findFaceAt(model, point);
  const normal: Vec3 = host !== undefined ? model.face(host).normal : [0, 0, 1];
  return { point, plane: drawingPlane(point, normal), host };
}
