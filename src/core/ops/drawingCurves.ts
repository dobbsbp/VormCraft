import { makePlane, toPlane2D, fromPlane2D } from '../math/plane';
import { normalizeNurbs, nurbsBreaks, nurbsDomain, nurbsPoint, type Nurbs } from '../math/nurbs';
import { TOL } from '../math/tolerance';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';

/**
 * The curves of a 2D/3D drawing (DXF and the like), before they become edges: straight paths,
 * conic arcs (circles, arcs and ellipses) and splines. All in millimetres.
 */
export type DrawingCurve =
  | { kind: 'path'; points: readonly Vec3[] }
  /** p(t) = center + u cos t + v sin t for t from `start` to `end` (end > start). A circle when u and v are equal and square. */
  | { kind: 'conic'; center: Vec3; u: Vec3; v: Vec3; start: number; end: number }
  | ({ kind: 'spline' } & Nurbs);

/** The true circle a path runs along (becomes a model curve, so it can be re-divided later). */
export interface PathCurve {
  center: Vec3;
  normal: Vec3;
  radius: number;
  /** Segments per full turn (fractional for arcs). */
  segments: number;
}

/** A run of straight segments through `points`, on a true circle if `curve` is set. */
export interface LinePath {
  points: Vec3[];
  curve?: PathCurve;
}

/** How finely curves become segments. */
export interface CurveDetail {
  /** Segments for a full circle; arcs get their share. */
  circleSegments: number;
  /** Other curves (ellipses, free-form splines): the largest gap allowed between the curve and its segments (mm). */
  tolerance: number;
  /** Recognise splines that are really arcs or circles (CAD programs often write arcs as splines). */
  arcs: boolean;
}

export const DEFAULT_CURVE_DETAIL: CurveDetail = { circleSegments: 24, tolerance: 0.05, arcs: true };

/** How far a spline may stray from a circle and still count as one: a hair, relative to its size. */
const arcFitTolerance = (radius: number) => Math.max(0.01, radius * 5e-4);
/** Most segments one curve may become (a safety net for a tiny tolerance on a huge curve). */
const MAX_SEGMENTS = 20000;

/** A circular arc: p(t) = center + r (x cos t + y sin t) for t from start to start + sweep (sweep > 0). */
interface CircleArc {
  center: Vec3;
  x: Vec3;
  y: Vec3;
  radius: number;
  start: number;
  sweep: number;
}

const arcAt = (a: CircleArc, t: number): Vec3 => add(a.center, add(scale(a.x, a.radius * Math.cos(t)), scale(a.y, a.radius * Math.sin(t))));

/** The arc as a path with its true circle; its end points can be pinned to exact ones (so neighbours still meet). */
function arcPath(a: CircleArc, detail: CurveDetail, first?: Vec3, last?: Vec3): LinePath {
  const full = a.sweep >= 2 * Math.PI - 1e-9;
  const n = Math.max(full ? 3 : 1, Math.min(MAX_SEGMENTS, Math.round((detail.circleSegments * a.sweep) / (2 * Math.PI))));
  const points: Vec3[] = [];
  for (let i = 0; i <= n; i++) points.push(arcAt(a, a.start + (a.sweep * i) / n));
  if (first) points[0] = first;
  if (last) points[n] = last;
  if (full) points[n] = points[0];
  return { points, curve: { center: a.center, normal: cross(a.x, a.y), radius: a.radius, segments: (n * 2 * Math.PI) / a.sweep } };
}

/** Points along f over each interval between `breaks`, splitting until every piece is within `tol` of its chord. */
function sampleAdaptive(f: (t: number) => Vec3, breaks: readonly number[], tol: number): Vec3[] {
  const out: Vec3[] = [f(breaks[0])];
  const budget = { left: MAX_SEGMENTS };
  const flat = (a: number, b: number, pa: Vec3, pb: Vec3) => {
    const d = sub(pb, pa);
    const len2 = dot(d, d);
    for (let i = 1; i < 8; i++) {
      const p = f(a + ((b - a) * i) / 8);
      const s = len2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, pa), d) / len2)) : 0;
      if (distance(p, add(pa, scale(d, s))) > tol) return false;
    }
    return true;
  };
  const split = (a: number, b: number, pa: Vec3, pb: Vec3, depth: number) => {
    if (depth >= 16 || budget.left <= 0 || flat(a, b, pa, pb)) {
      out.push(pb);
      budget.left--;
      return;
    }
    const m = (a + b) / 2;
    const pm = f(m);
    split(a, m, pa, pm, depth + 1);
    split(m, b, pm, pb, depth + 1);
  };
  for (let i = 0; i + 1 < breaks.length; i++) split(breaks[i], breaks[i + 1], out[out.length - 1], f(breaks[i + 1]), 0);
  return out;
}

/** True if every point lies within `tol` of the straight line from the first point to the last. */
function straight(pts: readonly Vec3[], tol = TOL): boolean {
  const a = pts[0];
  const d = sub(pts[pts.length - 1], a);
  const len = length(d);
  if (len <= TOL) return false;
  const u = scale(d, 1 / len);
  return pts.every((p) => {
    const w = sub(p, a);
    const s = dot(w, u);
    return s >= -tol && s <= len + tol && length(sub(w, scale(u, s))) <= tol;
  });
}

/**
 * The circular arc through these points, if they lie on one (least-squares circle in their plane,
 * every point within a hair of it, going round one way and at most once). Null otherwise.
 */
export function fitArc(pts: readonly Vec3[]): CircleArc | null {
  if (pts.length < 4) return null;
  const closed = distance(pts[0], pts[pts.length - 1]) <= TOL;
  // The plane they span (Newell's method; nothing if they are in a line).
  const ring = closed ? pts.slice(0, -1) : pts;
  const nn: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    nn[0] += (p[1] - q[1]) * (p[2] + q[2]);
    nn[1] += (p[2] - q[2]) * (p[0] + q[0]);
    nn[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const span = distance(pts[0], pts[Math.floor(pts.length / 2)]) + distance(pts[0], pts[pts.length - 1]);
  if (length(nn) <= 1e-9 * span * span) return null;
  const n = normalize(nn);
  const c0 = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as Vec3), 1 / pts.length);
  const plane = makePlane(c0, n);
  const q = pts.map((p) => toPlane2D(plane, p));
  // Kåsa fit: x² + y² + Dx + Ey + F = 0, by least squares (coordinates about the centroid).
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of q) {
    const z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; sxz += x * z; syz += y * z; sz += z;
  }
  const N = q.length;
  const m = [
    [sxx, sxy, sx, -sxz],
    [sxy, syy, sy, -syz],
    [sx, sy, N, -sz],
  ];
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-18) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const k = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= k * m[col][c];
    }
  }
  const D = m[0][3] / m[0][0];
  const E = m[1][3] / m[1][1];
  const F = m[2][3] / m[2][2];
  const cx = -D / 2;
  const cy = -E / 2;
  const r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);
  const tol = arcFitTolerance(radius);
  if (pts.some((p) => Math.abs(signedOffPlane(plane, p)) > tol)) return null;
  if (q.some(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - radius) > tol)) return null;
  // Going round one way, at most once.
  const ang = q.map(([x, y]) => Math.atan2(y - cy, x - cx));
  let sweep = 0;
  let sign = 0;
  for (let i = 1; i < ang.length; i++) {
    let d = ang[i] - ang[i - 1];
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    if (Math.abs(d) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(d);
    else if (Math.sign(d) !== sign) return null;
    sweep += d;
  }
  if (sign === 0 || Math.abs(sweep) > 2 * Math.PI + 1e-6) return null;
  if (closed && Math.abs(Math.abs(sweep) - 2 * Math.PI) > 1e-3) return null;
  const center = fromPlane2D(plane, [cx, cy]);
  const x = plane.u;
  const y = sign > 0 ? plane.v : scale(plane.v, -1);
  return { center, x, y, radius, start: sign * ang[0], sweep: closed ? 2 * Math.PI : Math.abs(sweep) };
}

const signedOffPlane = (plane: { origin: Vec3; normal: Vec3 }, p: Vec3) => dot(sub(p, plane.origin), plane.normal);

/** Two arcs on the same circle, the second carrying on from the first. */
function sameCircle(a: CircleArc, b: CircleArc): boolean {
  const tol = arcFitTolerance(Math.max(a.radius, b.radius));
  return distance(a.center, b.center) <= tol && Math.abs(a.radius - b.radius) <= tol && dot(cross(a.x, a.y), cross(b.x, b.y)) > 1 - 1e-6;
}

/** Arc a carried on by b (on the same circle, starting where a ends) as one arc, if that is at most a full turn. */
function joinArcs(a: CircleArc, b: CircleArc): CircleArc | null {
  const sweep = a.sweep + b.sweep;
  if (sweep > 2 * Math.PI + 1e-6) return null;
  return { ...a, sweep: Math.abs(sweep - 2 * Math.PI) < 1e-6 ? 2 * Math.PI : sweep };
}

type Piece = { kind: 'line' | 'free'; t0: number; t1: number } | { kind: 'arc'; t0: number; t1: number; arc: CircleArc };

function samples(f: (t: number) => Vec3, t0: number, t1: number, n: number): Vec3[] {
  return Array.from({ length: n + 1 }, (_, i) => f(t0 + ((t1 - t0) * i) / n));
}

/** Turn one drawing curve into paths of straight segments, keeping true circles where there are any. */
export function curveToPaths(c: DrawingCurve, detail: CurveDetail = DEFAULT_CURVE_DETAIL): LinePath[] {
  const tol = Math.max(detail.tolerance, TOL);
  if (c.kind === 'path') return c.points.length >= 2 ? [{ points: [...c.points] }] : [];

  if (c.kind === 'conic') {
    const ru = length(c.u);
    const rv = length(c.v);
    const sweep = Math.min(c.end - c.start, 2 * Math.PI);
    if (ru <= TOL || rv <= TOL || sweep <= 1e-12) return [];
    const f = (t: number): Vec3 => add(c.center, add(scale(c.u, Math.cos(t)), scale(c.v, Math.sin(t))));
    if (Math.abs(ru - rv) <= Math.max(TOL, ru * 1e-6) && Math.abs(dot(c.u, c.v)) <= ru * rv * 1e-6) {
      const x = scale(c.u, 1 / ru);
      const y = normalize(sub(c.v, scale(x, dot(c.v, x))));
      return [arcPath({ center: c.center, x, y, radius: ru, start: c.start, sweep }, detail)];
    }
    // An ellipse: start from quarter turns so its shape is never missed.
    const breaks = [c.start];
    for (let k = Math.ceil(c.start / (Math.PI / 2) + 1e-9); (k * Math.PI) / 2 < c.start + sweep - 1e-9; k++) breaks.push((k * Math.PI) / 2);
    breaks.push(c.start + sweep);
    const pts = sampleAdaptive(f, breaks, tol);
    if (sweep >= 2 * Math.PI - 1e-9) pts[pts.length - 1] = pts[0];
    return [{ points: pts }];
  }

  const s = normalizeNurbs(c);
  if (s.points.length < 2) return [];
  const f = (t: number) => nurbsPoint(s, t);
  const [t0, t1] = nurbsDomain(s);
  const breaks = nurbsBreaks(s);
  const first = f(t0);
  const last = f(t1);
  const whole = samples(f, t0, t1, Math.max(32, (breaks.length - 1) * 8));
  if (straight(whole)) return [{ points: [first, last] }];
  if (!detail.arcs) return [{ points: sampleAdaptive(f, breaks, tol) }];
  const arc = fitArc(whole);
  if (arc) return [arcPath(arc, detail, first, last)];

  // Piece by piece (each polynomial span): lines, arcs, and the free-form rest.
  const pieces: Piece[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const a = breaks[i];
    const b = breaks[i + 1];
    const pts = samples(f, a, b, 16);
    const prev = pieces[pieces.length - 1];
    if (straight(pts)) {
      if (prev?.kind === 'line' && straight(samples(f, prev.t0, b, 32))) prev.t1 = b;
      else pieces.push({ kind: 'line', t0: a, t1: b });
      continue;
    }
    const fit = fitArc(pts);
    if (fit) {
      const joined = prev?.kind === 'arc' && sameCircle(prev.arc, fit) ? joinArcs(prev.arc, fit) : null;
      if (joined && prev?.kind === 'arc') {
        prev.arc = joined;
        prev.t1 = b;
      } else pieces.push({ kind: 'arc', t0: a, t1: b, arc: fit });
      continue;
    }
    if (prev?.kind === 'free') prev.t1 = b;
    else pieces.push({ kind: 'free', t0: a, t1: b });
  }
  const out: LinePath[] = [];
  const plain = (pts: Vec3[]) => {
    const tail = out[out.length - 1];
    if (tail && !tail.curve) tail.points.push(...pts.slice(1));
    else out.push({ points: pts });
  };
  for (const p of pieces) {
    if (p.kind === 'arc') out.push(arcPath(p.arc, detail, f(p.t0), f(p.t1)));
    else if (p.kind === 'line') plain([f(p.t0), f(p.t1)]);
    else plain(sampleAdaptive(f, breaks.filter((k) => k >= p.t0 - 1e-12 && k <= p.t1 + 1e-12), tol));
  }
  return out;
}
