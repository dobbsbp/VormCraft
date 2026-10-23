import { fromPlane2D, planesCoincide, toPlane2D, type Plane } from '../math/plane';
import { cross2, intersectSegments, pointInRegion, signedArea, sub2, type Vec2 } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { add, scale, sub, type Vec3 } from '../math/vec3';
import type { CurveId, FaceId, Model, VertexId } from '../model/Model';
import { imprintSegments, type ImprintSegment } from './imprint';

/**
 * Offset a closed 2D ring to its left by `d` (negative = to its right), with mitred corners.
 * For a face, every loop has the face on its left, so d > 0 always moves into the face.
 */
export function offsetRing2D(ring: readonly Vec2[], d: number): Vec2[] {
  const n = ring.length;
  const dirs: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const e = sub2(ring[(i + 1) % n], ring[i]);
    const len = Math.hypot(e[0], e[1]);
    dirs.push([e[0] / len, e[1] / len]);
  }
  const left = (v: Vec2): Vec2 => [-v[1], v[0]];
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = dirs[(i - 1 + n) % n];
    const next = dirs[i];
    const lp = left(prev);
    const ln = left(next);
    const denom = cross2(prev, next);
    if (Math.abs(denom) < 1e-9) {
      // Collinear corner: just move the point sideways.
      out.push([ring[i][0] + ln[0] * d, ring[i][1] + ln[1] * d]);
      continue;
    }
    // Intersect the two offset lines: p + lp*d + prev*s  ==  p + ln*d + next*t.
    const w: Vec2 = [(ln[0] - lp[0]) * d, (ln[1] - lp[1]) * d];
    const s = cross2(w, next) / denom;
    out.push([ring[i][0] + lp[0] * d + prev[0] * s, ring[i][1] + lp[1] * d + prev[1] * s]);
  }
  return out;
}

/**
 * An offset ring is usable when it keeps its orientation, no edge flips direction (which is what
 * happens when the distance is larger than a feature), and it does not cross itself.
 */
export function offsetRingValid(orig: readonly Vec2[], off: readonly Vec2[]): boolean {
  const n = orig.length;
  if (Math.sign(signedArea(orig)) !== Math.sign(signedArea(off)) || Math.abs(signedArea(off)) <= TOL * TOL) return false;
  for (let i = 0; i < n; i++) {
    const a = sub2(orig[(i + 1) % n], orig[i]);
    const b = sub2(off[(i + 1) % n], off[i]);
    if (a[0] * b[0] + a[1] * b[1] <= 0) return false;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersectSegments(off[i], off[(i + 1) % n], off[j], off[(j + 1) % n]).length) return false;
    }
  }
  return true;
}

export interface OffsetRing {
  points: Vec3[];
  /** Circle curve for the new ring when the source ring was a whole circle. */
  curve: { center: Vec3; normal: Vec3; radius: number; segments: number } | null;
}

/**
 * Offset every loop of a face by `d` within its plane: d > 0 moves inward (the outer loop shrinks,
 * holes grow), d < 0 outward. A loop that is a whole circle stays a true circle of radius r ∓ d.
 * Throws if the distance is too large for the shape.
 */
export function offsetFaceRings(model: Model, faceId: FaceId, d: number): OffsetRing[] {
  const plane = model.facePlane(faceId);
  return model.faceVertexLoops(faceId).map((ring) => {
    const circle = wholeCircle(model, ring);
    const ring2 = ring.map((v) => toPlane2D(plane, model.pos(v)));
    if (circle) {
      // Moving left shrinks a counter-clockwise circle and grows a clockwise one.
      const radius = circle.radius - Math.sign(signedArea(ring2)) * d;
      if (radius <= TOL) throw new Error('Offset distance is larger than the circle');
      const k = radius / circle.radius;
      return {
        points: ring.map((v) => add(circle.center, scale(sub(model.pos(v), circle.center), k))),
        curve: { center: circle.center, normal: circle.normal, radius, segments: circle.segments },
      };
    }
    const off = offsetRing2D(ring2, d);
    if (!offsetRingValid(ring2, off)) throw new Error('Offset distance is too large for this face');
    return { points: off.map((p) => fromPlane2D(plane, p)), curve: null };
  });
}

function wholeCircle(model: Model, ring: VertexId[]) {
  let curve: CurveId | null | undefined;
  for (let i = 0; i < ring.length; i++) {
    const c = model.he(model.halfEdgeBetween(ring[i], ring[(i + 1) % ring.length])!).curve;
    if (c === null || (curve !== undefined && c !== curve)) return undefined;
    curve = c;
  }
  const c = model.curves.get(curve!);
  return c && c.segments === ring.length ? c : undefined;
}

function ringSegments(model: Model, rings: OffsetRing[]): ImprintSegment[] {
  const segments: ImprintSegment[] = [];
  for (const r of rings) {
    const curve = r.curve ? model.addCurve({ kind: 'circle', ...r.curve }) : null;
    r.points.forEach((a, i) => segments.push({ a, b: r.points[(i + 1) % r.points.length], curve }));
  }
  return segments;
}

/** Faces edge-connected to `faceId` through faces on the same plane, facing the same way. */
function coplanarRegion(model: Model, faceId: FaceId): Set<FaceId> {
  const plane = model.facePlane(faceId);
  const seen = new Set([faceId]);
  const stack = [faceId];
  while (stack.length) {
    for (const g of model.adjacentFaces(stack.pop()!)) {
      if (!seen.has(g) && planesCoincide(plane, model.facePlane(g), true)) {
        seen.add(g);
        stack.push(g);
      }
    }
  }
  return seen;
}

function insideRegion(model: Model, plane: Plane, faces: Iterable<FaceId>, p: Vec3): boolean {
  const q = toPlane2D(plane, p);
  for (const f of faces) {
    const rings = model.faceVertexLoops(f).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
    if (pointInRegion(q, rings[0], rings.slice(1)) !== 'outside') return true;
  }
  return false;
}

/**
 * Offset a face's boundary and split the face along the new loops (inward, d > 0), or draw the
 * loops on the surrounding coplanar faces (outward, d < 0). Outward from a free-standing face, the
 * area between the old and new outer loop becomes a new face. Returns the faces touched.
 */
export function offsetFace(model: Model, faceId: FaceId, d: number): FaceId[] {
  if (Math.abs(d) <= TOL) return [faceId];
  const rings = offsetFaceRings(model, faceId, d);
  if (d > 0) return imprintSegments(model, faceId, ringSegments(model, rings));

  const plane = model.facePlane(faceId);
  const region = coplanarRegion(model, faceId);
  const outer = model.faceVertexLoops(faceId)[0];
  const outerFree = outer.every((v, i) => model.faceOf(model.he(model.halfEdgeBetween(v, outer[(i + 1) % outer.length])!).twin) === null);
  const result: FaceId[] = [];

  rings.forEach((ring, i) => {
    const mid = (k: number) => scale(add(ring.points[k], ring.points[(k + 1) % ring.points.length]), 0.5);
    const covered = ring.points.every((p, k) => insideRegion(model, plane, region, p) && insideRegion(model, plane, region, mid(k)));
    if (covered) {
      for (const f of [...region]) if (model.faces.has(f)) result.push(...imprintSegments(model, f, ringSegments(model, [ring])));
      return;
    }
    if (i === 0 && outerFree) {
      // A new ring face between the offset outline (outer loop) and the old outline (hole).
      const verts = ring.points.map((p) => model.vertexAt(p));
      const ringFace = model.addFace(verts, [[...outer].reverse()], { normal: model.face(faceId).normal });
      if (ring.curve) {
        const c = model.addCurve({ kind: 'circle', ...ring.curve });
        verts.forEach((v, k) => model.setEdgeCurve(v, verts[(k + 1) % verts.length], c));
      }
      result.push(ringFace);
      return;
    }
    throw new Error('Offset goes past the edge of the surface');
  });
  return [...new Set(result.filter((f) => model.faces.has(f))), ...(model.faces.has(faceId) ? [faceId] : [])];
}
