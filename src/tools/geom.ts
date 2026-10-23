import { makePlane, projectToPlane, type Plane } from '../core/math/plane';
import { ANGLE_TOL } from '../core/math/tolerance';
import { add, dot, length, scale, sub, type Vec3 } from '../core/math/vec3';
import type { Ray } from './types';

export const AXES: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Where the ray meets the plane (in front of the ray origin), if it does. */
export function rayPlane(ray: Ray, plane: Plane): Vec3 | null {
  const denom = dot(ray.dir, plane.normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(sub(plane.origin, ray.origin), plane.normal) / denom;
  return t > 0 ? add(ray.origin, scale(ray.dir, t)) : null;
}

/**
 * Closest point on an infinite line to a ray, as the line parameter `s` (point = p + dir * s)
 * and the ray parameter `t`. Null when the ray and line are parallel.
 */
export function closestRayLine(ray: Ray, p: Vec3, dir: Vec3): { s: number; t: number; point: Vec3 } | null {
  const w = sub(ray.origin, p);
  const a = dot(dir, dir);
  const b = dot(dir, ray.dir);
  const c = dot(ray.dir, ray.dir);
  const d = dot(dir, w);
  const e = dot(ray.dir, w);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-12 * a * c) return null;
  const s = (c * d - b * e) / denom;
  const t = (b * d - a * e) / denom;
  return { s, t, point: add(p, scale(dir, s)) };
}

/** Closest point on a segment to a ray (clamped to the segment), or null if parallel/behind. */
export function closestRaySegment(ray: Ray, a: Vec3, b: Vec3): Vec3 | null {
  const dir = sub(b, a);
  if (length(dir) === 0) return a;
  const r = closestRayLine(ray, a, dir);
  if (!r || r.t <= 0) return null;
  return add(a, scale(dir, Math.max(0, Math.min(1, r.s))));
}

/**
 * The drawing plane for a face normal through a point, with u along the red axis (green when the
 * plane is perpendicular to red) so rectangles line up with the model axes like in SketchUp.
 */
export function drawingPlane(origin: Vec3, normal: Vec3): Plane {
  const uHint: Vec3 = Math.abs(dot(normal, AXES[0])) > 1 - ANGLE_TOL * 1e3 ? AXES[1] : AXES[0];
  return makePlane(origin, normal, uHint);
}

/** The inferred point if there is one, else where the ray meets the plane; always on the plane. */
export function pointOnPlane(snapPoint: Vec3 | undefined, ray: Ray, plane: Plane): Vec3 | null {
  if (snapPoint) return projectToPlane(plane, snapPoint);
  return rayPlane(ray, plane);
}
