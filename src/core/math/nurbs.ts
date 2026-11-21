import type { Vec3 } from './vec3';

/**
 * A NURBS curve (B-spline, rational when `weights` are given), as CAD files store splines: degree,
 * knot vector (control points + degree + 1 values) and control points.
 */
export interface Nurbs {
  degree: number;
  knots: readonly number[];
  points: readonly Vec3[];
  weights?: readonly number[];
}

/** A knot vector for `count` control points: clamped and evenly spaced (for files that leave it out). */
export function clampedKnots(count: number, degree: number): number[] {
  const inner = count - degree - 1;
  return [...Array<number>(degree + 1).fill(0), ...Array.from({ length: Math.max(0, inner) }, (_, i) => (i + 1) / (inner + 1)), ...Array<number>(degree + 1).fill(1)];
}

/** The curve made usable: a degree that fits the points, and a knot vector of the right length. */
export function normalizeNurbs(c: Nurbs): Nurbs {
  const degree = Math.max(1, Math.min(Math.round(c.degree), c.points.length - 1));
  const knots = c.knots.length === c.points.length + degree + 1 && c.knots.every((k, i) => i === 0 || k >= c.knots[i - 1]) ? c.knots : clampedKnots(c.points.length, degree);
  const weights = c.weights && c.weights.length === c.points.length && c.weights.every((w) => w > 0) && c.weights.some((w) => Math.abs(w - 1) > 1e-12) ? c.weights : undefined;
  return { degree, knots, points: c.points, ...(weights ? { weights } : {}) };
}

/** The parameter range the curve is defined over. */
export function nurbsDomain(c: Nurbs): [number, number] {
  return [c.knots[c.degree], c.knots[c.knots.length - 1 - c.degree]];
}

/** Distinct knot values inside the domain, ends included: where the curve's polynomial pieces join. */
export function nurbsBreaks(c: Nurbs): number[] {
  const [t0, t1] = nurbsDomain(c);
  const out = [t0];
  for (const k of c.knots) if (k > out[out.length - 1] + 1e-12 && k < t1 - 1e-12) out.push(k);
  out.push(t1);
  return out;
}

/** The point at parameter t (de Boor's algorithm, in homogeneous coordinates for rational curves). */
export function nurbsPoint(c: Nurbs, t: number): Vec3 {
  const p = c.degree;
  const U = c.knots;
  const n = c.points.length - 1;
  const [t0, t1] = nurbsDomain(c);
  t = Math.min(t1, Math.max(t0, t));
  // The span k with U[k] <= t < U[k+1] (the last non-empty span at the very end).
  let k = p;
  while (k < n && U[k + 1] <= t) k++;
  while (k > p && U[k] >= U[k + 1]) k--;
  const d: [number, number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const q = c.points[j + k - p];
    const w = c.weights?.[j + k - p] ?? 1;
    d.push([q[0] * w, q[1] * w, q[2] * w, w]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = U[i + p - r + 1] - U[i];
      const a = den === 0 ? 0 : (t - U[i]) / den;
      for (let m = 0; m < 4; m++) d[j][m] = (1 - a) * d[j - 1][m] + a * d[j][m];
    }
  }
  const [x, y, z, w] = d[p];
  return [x / w, y / w, z / w];
}
