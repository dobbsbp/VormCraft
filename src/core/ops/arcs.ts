import { fromPlane2D, makePlane, toPlane2D, type Plane } from '../math/plane';
import { TOL } from '../math/tolerance';
import { cross, distance, length, normalize, sub, type Vec3 } from '../math/vec3';
import type { Model } from '../model/Model';
import { drawEdges, type DrawEdgesResult } from './edges';

export const DEFAULT_ARC_SEGMENTS = 12;

/** A circular arc: its circle, and where it starts and how far it sweeps (radians, CCW about normal). */
export interface Arc {
  plane: Plane; // origin = centre
  radius: number;
  start: number;
  sweep: number;
}

export function arcPoints(arc: Arc, segments: number): Vec3[] {
  const n = Math.max(1, Math.round(segments));
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = arc.start + (arc.sweep * i) / n;
    pts.push(fromPlane2D(arc.plane, [arc.radius * Math.cos(t), arc.radius * Math.sin(t)]));
  }
  return pts;
}

/**
 * Arc from a to b on `plane` with signed bulge (sagitta): positive bulges to the left of a→b
 * (looking down the plane normal). Bulge = half the chord gives a semicircle.
 */
export function arcFromBulge(plane: Plane, a: Vec3, b: Vec3, bulge: number): Arc {
  const A = toPlane2D(plane, a);
  const B = toPlane2D(plane, b);
  const c = Math.hypot(B[0] - A[0], B[1] - A[1]);
  if (c <= TOL) throw new Error('The arc needs two different end points');
  if (Math.abs(bulge) <= TOL) throw new Error('The arc needs a bulge');
  const s = Math.abs(bulge);
  const r = (c * c) / (8 * s) + s / 2;
  // Unit chord direction and its left normal.
  const ux = (B[0] - A[0]) / c;
  const uy = (B[1] - A[1]) / c;
  const lx = -uy;
  const ly = ux;
  const side = Math.sign(bulge);
  const mx = (A[0] + B[0]) / 2;
  const my = (A[1] + B[1]) / 2;
  // The centre sits on the other side of the chord from the bulge, at distance r - s.
  const cx = mx - side * lx * (r - s);
  const cy = my - side * ly * (r - s);
  const ta = Math.atan2(A[1] - cy, A[0] - cx);
  const tb = Math.atan2(B[1] - cy, B[0] - cx);
  // Bulging left of a→b means going clockwise around the centre, i.e. a negative sweep.
  let sweep = tb - ta;
  if (side > 0) {
    while (sweep >= 0) sweep -= 2 * Math.PI;
  } else {
    while (sweep <= 0) sweep += 2 * Math.PI;
  }
  return { plane: { ...plane, origin: fromPlane2D(plane, [cx, cy]) }, radius: r, start: ta, sweep };
}

/** Arc through three points (start, a point on the arc, end); the plane is the points' plane. */
export function arcThroughPoints(a: Vec3, m: Vec3, b: Vec3): Arc {
  const n = cross(sub(m, a), sub(b, a));
  if (length(n) <= TOL * Math.max(distance(a, b), 1)) throw new Error('The three points are in a line');
  let plane = makePlane(a, normalize(n));
  const [A, M, B] = [a, m, b].map((p) => toPlane2D(plane, p));
  // Circumcentre in 2D.
  const d = 2 * (A[0] * (M[1] - B[1]) + M[0] * (B[1] - A[1]) + B[0] * (A[1] - M[1]));
  const sq = (p: readonly number[]) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(A) * (M[1] - B[1]) + sq(M) * (B[1] - A[1]) + sq(B) * (A[1] - M[1])) / d;
  const cy = (sq(A) * (B[0] - M[0]) + sq(M) * (A[0] - B[0]) + sq(B) * (M[0] - A[0])) / d;
  plane = { ...plane, origin: fromPlane2D(plane, [cx, cy]) };
  const ang = (P: readonly number[]) => Math.atan2(P[1] - cy, P[0] - cx);
  const ta = ang(A);
  // The plane normal makes a → m → b counter-clockwise, so sweep positively from a to b.
  let sweep = ang(B) - ta;
  while (sweep <= 0) sweep += 2 * Math.PI;
  return { plane, radius: Math.hypot(A[0] - cx, A[1] - cy), start: ta, sweep };
}

/** Arc around a centre, from the start point, sweeping `sweep` radians (positive = CCW about normal). */
export function arcAroundCenter(plane: Plane, center: Vec3, start: Vec3, sweep: number): Arc {
  const p = { ...plane, origin: center };
  const S = toPlane2D(p, start);
  const r = Math.hypot(S[0], S[1]);
  if (r <= TOL) throw new Error('The arc needs a radius');
  return { plane: p, radius: r, start: Math.atan2(S[1], S[0]), sweep };
}

/**
 * Draw an arc as edges (split faces it lies on, close loops into faces), tagged with its true
 * circle. `segments` counts the arc's own segments; the curve records the equivalent per full turn.
 */
export function drawArc(model: Model, arc: Arc, segments = DEFAULT_ARC_SEGMENTS): DrawEdgesResult {
  const n = Math.max(1, Math.round(segments));
  const curve = model.addCurve({
    kind: 'circle',
    center: arc.plane.origin,
    normal: arc.plane.normal,
    radius: arc.radius,
    segments: (n * 2 * Math.PI) / Math.abs(arc.sweep),
  });
  return drawEdges(model, arcPoints(arc, n), { curve });
}

/**
 * A pie (sector): the arc plus the two radii back to its centre, closed into a face (splitting a
 * face it is drawn on). The arc keeps its true circle.
 */
export function drawPie(model: Model, arc: Arc, segments = DEFAULT_ARC_SEGMENTS): DrawEdgesResult {
  if (Math.abs(arc.sweep) >= 2 * Math.PI - 1e-9) throw new Error('A pie must be less than a full circle');
  const n = Math.max(1, Math.round(segments));
  const pts = arcPoints(arc, n);
  const a = drawArc(model, arc, n);
  const b = drawEdges(model, [pts[n], arc.plane.origin, pts[0]]);
  return { edges: [...new Set([...a.edges, ...b.edges])].filter((e) => model.halfEdges.has(e)), faces: [...new Set([...a.faces, ...b.faces])].filter((f) => model.faces.has(f)) };
}
