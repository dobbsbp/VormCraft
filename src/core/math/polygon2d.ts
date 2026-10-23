import earcut from 'earcut';
import { TOL } from './tolerance';

export type Vec2 = readonly [number, number];

export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const cross2 = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const dist2 = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Shoelace area: positive for counter-clockwise loops. */
export function signedArea(poly: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Closest-point parameter of p on segment ab, clamped to [0, 1], and the distance to it. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; dist: number } {
  const d = sub2(b, a);
  const len2 = d[0] * d[0] + d[1] * d[1];
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2;
  t = Math.max(0, Math.min(1, t));
  return { t, dist: dist2(p, [a[0] + d[0] * t, a[1] + d[1] * t]) };
}

export type Containment = 'inside' | 'outside' | 'boundary';

export function pointInPolygon(p: Vec2, poly: readonly Vec2[], tol = TOL): Containment {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (closestOnSegment(p, a, b).dist <= tol) return 'boundary';
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside ? 'inside' : 'outside';
}

/** Containment in a polygon with holes. */
export function pointInRegion(p: Vec2, outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], tol = TOL): Containment {
  const o = pointInPolygon(p, outer, tol);
  if (o !== 'inside') return o;
  for (const h of holes) {
    const c = pointInPolygon(p, h, tol);
    if (c === 'boundary') return 'boundary';
    if (c === 'inside') return 'outside';
  }
  return 'inside';
}

/**
 * All points where two segments touch or cross (within tol). Collinear overlaps are reported by
 * their end points. Duplicates are removed.
 */
export function intersectSegments(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, tol = TOL): Vec2[] {
  const out: Vec2[] = [];
  const push = (p: Vec2) => {
    if (!out.some((q) => dist2(p, q) <= tol)) out.push(p);
  };
  if (closestOnSegment(a0, b0, b1).dist <= tol) push(a0);
  if (closestOnSegment(a1, b0, b1).dist <= tol) push(a1);
  if (closestOnSegment(b0, a0, a1).dist <= tol) push(b0);
  if (closestOnSegment(b1, a0, a1).dist <= tol) push(b1);
  const d = sub2(a1, a0);
  const e = sub2(b1, b0);
  const denom = cross2(d, e);
  if (Math.abs(denom) > 1e-12 * Math.hypot(...d) * Math.hypot(...e)) {
    const w = sub2(b0, a0);
    const ta = cross2(w, e) / denom;
    const tb = cross2(w, d) / denom;
    if (ta > 0 && ta < 1 && tb > 0 && tb < 1) push([a0[0] + d[0] * ta, a0[1] + d[1] * ta]);
  }
  return out;
}

/** Triangulate a polygon with holes. Returns index triples into [outer, ...holes] flattened, CCW. */
export function triangulate2D(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[] = []): [number, number, number][] {
  const coords: number[] = [];
  const holeStarts: number[] = [];
  const all: Vec2[] = [];
  for (const p of outer) {
    coords.push(p[0], p[1]);
    all.push(p);
  }
  for (const h of holes) {
    holeStarts.push(all.length);
    for (const p of h) {
      coords.push(p[0], p[1]);
      all.push(p);
    }
  }
  const idx = earcut(coords, holeStarts.length ? holeStarts : undefined, 2);
  const tris: [number, number, number][] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    const area = cross2(sub2(all[b], all[a]), sub2(all[c], all[a]));
    if (area === 0) continue;
    tris.push(area > 0 ? [a, b, c] : [a, c, b]);
  }
  return tris;
}

/** A point strictly inside a polygon with holes (centroid of its largest triangle). */
export function interiorPoint(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[] = []): Vec2 {
  const all = [...outer, ...holes.flat()];
  let best: Vec2 | undefined;
  let bestArea = -1;
  for (const [a, b, c] of triangulate2D(outer, holes)) {
    const area = Math.abs(cross2(sub2(all[b], all[a]), sub2(all[c], all[a])));
    if (area > bestArea) {
      bestArea = area;
      best = [(all[a][0] + all[b][0] + all[c][0]) / 3, (all[a][1] + all[b][1] + all[c][1]) / 3];
    }
  }
  if (!best) throw new Error('Degenerate polygon has no interior point');
  return best;
}
