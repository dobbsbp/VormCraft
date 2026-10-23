import { ANGLE_TOL, TOL } from './tolerance';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from './vec3';
import type { Vec2 } from './polygon2d';

/**
 * A plane with an orthonormal in-plane basis. (u, v, normal) is right-handed, so a loop that is
 * counter-clockwise in (u, v) coordinates is counter-clockwise about the normal.
 */
export interface Plane {
  readonly origin: Vec3;
  readonly normal: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
}

/** Build a plane. If `uHint` is given (e.g. the red axis) it is projected into the plane and used as u. */
export function makePlane(origin: Vec3, normal: Vec3, uHint?: Vec3): Plane {
  const n = normalize(normal);
  let u: Vec3 | undefined;
  if (uHint) {
    const projected = sub(uHint, scale(n, dot(uHint, n)));
    if (Math.hypot(...projected) > 1e-9) u = normalize(projected);
  }
  if (!u) {
    // Prefer world X as u, then world Y, so ground and wall planes get intuitive axes.
    const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    u = normalize(sub(ref, scale(n, dot(ref, n))));
  }
  const v = cross(n, u);
  return { origin, normal: n, u, v };
}

/** The ground plane z = 0, normal +Z, u = red (X), v = green (Y). */
export const GROUND_PLANE: Plane = makePlane([0, 0, 0], [0, 0, 1], [1, 0, 0]);

export const toPlane2D = (plane: Plane, p: Vec3): Vec2 => {
  const d = sub(p, plane.origin);
  return [dot(d, plane.u), dot(d, plane.v)];
};

export const fromPlane2D = (plane: Plane, p: Vec2): Vec3 =>
  add(plane.origin, add(scale(plane.u, p[0]), scale(plane.v, p[1])));

export const signedDistance = (plane: Plane, p: Vec3): number => dot(sub(p, plane.origin), plane.normal);

export const projectToPlane = (plane: Plane, p: Vec3): Vec3 => sub(p, scale(plane.normal, signedDistance(plane, p)));

export const offsetPlane = (plane: Plane, d: number): Plane => ({
  ...plane,
  origin: add(plane.origin, scale(plane.normal, d)),
});

/** Same geometric plane, ignoring orientation unless `sameSide` is set. */
export function planesCoincide(a: Plane, b: Plane, sameSide = false, tol = TOL): boolean {
  const d = dot(a.normal, b.normal);
  if (sameSide ? d < 1 - ANGLE_TOL : Math.abs(d) < 1 - ANGLE_TOL) return false;
  return Math.abs(signedDistance(a, b.origin)) <= tol;
}
