import { makePlane } from '../core/math/plane';
import { add, distance, dot, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import { rayPlane } from './geom';
import type { Ray } from './types';

/**
 * Where a dimension's line runs: parallel to the measured line from `a` to `b`, moved out by
 * `offset` (square to it). `from` and `to` are the ends of the dimension line, `mid` where its
 * text sits.
 */
export interface DimensionLayout {
  offset: Vec3;
  from: Vec3;
  to: Vec3;
  mid: Vec3;
  length: number;
}

/** The layout of a dimension from `a` to `b` whose line passes through (or square to) `through`. */
export function dimensionLayout(a: Vec3, b: Vec3, through: Vec3): DimensionLayout {
  const length = distance(a, b);
  const d = length > 0 ? scale(sub(b, a), 1 / length) : ([1, 0, 0] as Vec3);
  const centre = scale(add(a, b), 0.5);
  const rel = sub(through, centre);
  const offset = sub(rel, scale(d, dot(rel, d)));
  return { offset, from: add(a, offset), to: add(b, offset), mid: add(centre, offset), length };
}

/**
 * The point a dimension's line is dragged to: where the pick ray meets the plane through the
 * measured line that faces the viewer most. The line stays parallel to the measured line, so only
 * the distance out from it (and its side) changes.
 */
export function dimensionDragPoint(a: Vec3, b: Vec3, ray: Ray): Vec3 | null {
  const d = distance(a, b) > 0 ? normalize(sub(b, a)) : ([1, 0, 0] as Vec3);
  // The view direction without its part along the line: the plane holds the line and faces the eye.
  const n = sub(ray.dir, scale(d, dot(ray.dir, d)));
  if (Math.hypot(...n) < 1e-9) return null;
  return rayPlane(ray, makePlane(a, normalize(n)));
}
