import { makePlane, signedDistance, toPlane2D, type Plane } from '../core/math/plane';
import { triangulate2D, type Vec2 } from '../core/math/polygon2d';
import { TOL } from '../core/math/tolerance';
import { add, cross, dot, length, scale, sub, type Vec3 } from '../core/math/vec3';
import type { CircleCurve, FaceId, HalfEdgeId, Model, VertexId } from '../core/model/Model';

export interface TessellationOptions {
  /**
   * Maximum distance between a curved surface and its triangles, in mm. Circles are re-divided
   * from their true radius until every chord is within it. Undefined exports the facets exactly
   * as modelled.
   */
  maxDeviation?: number;
}

/** An indexed triangle mesh (float64 positions; vertices shared between faces). */
export interface ExportMesh {
  positions: number[];
  triangles: number[];
}

/** Largest arc angle whose chord stays within `tol` of a circle of radius r. */
function maxArcAngle(radius: number, tol: number): number {
  if (tol >= radius) return Math.PI / 2;
  return 2 * Math.acos(1 - tol / radius);
}

/** Cylinder coordinates around a circle's axis. */
class Cylinder {
  readonly basis: Plane;
  constructor(readonly curve: CircleCurve) {
    this.basis = makePlane(curve.center, curve.normal);
  }
  angle(p: Vec3): number {
    const [x, y] = toPlane2D(this.basis, p);
    return Math.atan2(y, x);
  }
  height(p: Vec3): number {
    return signedDistance(this.basis, p);
  }
  radiusOf(p: Vec3): number {
    const d = sub(p, this.curve.center);
    return length(sub(d, scale(this.curve.normal, dot(d, this.curve.normal))));
  }
  /** Point on the true cylinder at angle θ, height h. */
  at(theta: number, h: number): Vec3 {
    const { u, v, normal } = this.basis;
    const r = this.curve.radius;
    return add(this.curve.center, add(add(scale(u, r * Math.cos(theta)), scale(v, r * Math.sin(theta))), scale(normal, h)));
  }
  /** Angles strictly between a and b along the short way, splitting the arc into k equal steps. */
  static between(a: number, b: number, k: number): number[] {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Array.from({ length: k - 1 }, (_, i) => a + (d * (i + 1)) / k);
  }
  steps(a: number, b: number, tol: number): number {
    let d = Math.abs(b - a) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return Math.max(1, Math.ceil(d / maxArcAngle(this.curve.radius, tol) - 1e-9));
  }
}

/**
 * Triangulate faces for export. With `maxDeviation`, curved surfaces made from circles (the
 * facets between circle edges, e.g. cylinder walls, holes and bosses) are refined against the
 * true radius. Every edge is refined once and shared by both faces, so a watertight model gives a
 * watertight mesh.
 */
export function tessellate(model: Model, faces: Iterable<FaceId> = model.faces.keys(), opts: TessellationOptions = {}): ExportMesh {
  const faceList = [...faces];
  const positions: number[] = [];
  const triangles: number[] = [];
  const vertexIndex = new Map<VertexId, number>();
  const pushPoint = (p: Vec3) => {
    positions.push(p[0], p[1], p[2]);
    return positions.length / 3 - 1;
  };
  const indexOf = (v: VertexId) => {
    let i = vertexIndex.get(v);
    if (i === undefined) {
      i = pushPoint(model.pos(v));
      vertexIndex.set(v, i);
    }
    return i;
  };

  const tol = opts.maxDeviation;
  const walls = new Map<FaceId, Cylinder>();
  /** Extra points inside each edge, keyed by the half-edge they run along (origin → dest). */
  const inserts = new Map<HalfEdgeId, { points: Vec3[]; ids: number[] }>();
  const setInserts = (h: HalfEdgeId, points: Vec3[]) => {
    if (!points.length) return;
    const ids = points.map(pushPoint);
    inserts.set(h, { points, ids });
    inserts.set(model.he(h).twin, { points: [...points].reverse(), ids: [...ids].reverse() });
  };

  if (tol !== undefined && tol > 0) {
    const cylinders = new Map<number, Cylinder>();
    const cylinderOf = (c: CircleCurve) => {
      if (!cylinders.has(c.id)) cylinders.set(c.id, new Cylinder(c));
      return cylinders.get(c.id)!;
    };
    // 1. Circle edges: extra points on the true circle.
    for (const e of model.edges()) {
      const he = model.he(e);
      const curve = he.curve === null ? undefined : model.curves.get(he.curve);
      if (!curve) continue;
      const cyl = cylinderOf(curve);
      const a = model.pos(he.origin);
      const b = model.pos(model.dest(e));
      const ta = cyl.angle(a);
      const tb = cyl.angle(b);
      const h = cyl.height(a);
      setInserts(e, Cylinder.between(ta, tb, cyl.steps(ta, tb, tol)).map((t) => cyl.at(t, h)));
    }
    // 2. Wall facets: faces parallel to a circle's axis with every vertex on that cylinder.
    for (const f of faceList) {
      const face = model.face(f);
      for (const h of model.faceHalfEdges(f)) {
        const c = model.he(h).curve === null ? undefined : model.curves.get(model.he(h).curve!);
        if (!c || Math.abs(dot(c.normal, face.normal)) > 1e-6) continue;
        const cyl = cylinderOf(c);
        if (model.faceVertexLoops(f).flat().every((v) => Math.abs(cyl.radiusOf(model.pos(v)) - c.radius) <= TOL * 10)) {
          walls.set(f, cyl);
          break;
        }
      }
    }
    // 3. The other rim of a wall facet where it meets a flat face (e.g. a hole leaving through a
    //    sloped face): points where the refined cylinder lines cross that face's plane.
    for (const [f, cyl] of walls) {
      const n = cyl.curve.normal;
      for (const h of model.faceHalfEdges(f)) {
        if (inserts.has(h)) continue;
        const he = model.he(h);
        const a = model.pos(he.origin);
        const b = model.pos(model.dest(h));
        const dir = sub(b, a);
        if (length(cross(dir, n)) <= TOL * length(dir)) continue; // a cylinder line, not a rim
        const other = model.faceOf(he.twin);
        if (other === null || walls.has(other)) continue;
        const plane = model.facePlane(other);
        const denom = dot(n, plane.normal);
        if (Math.abs(denom) < 1e-9) continue;
        const ta = cyl.angle(a);
        const tb = cyl.angle(b);
        const points = Cylinder.between(ta, tb, cyl.steps(ta, tb, tol)).map((t) => {
          const onAxisLine = cyl.at(t, 0);
          return add(onAxisLine, scale(n, -signedDistance(plane, onAxisLine) / denom));
        });
        setInserts(h, points);
      }
    }
  }

  for (const f of faceList) {
    // Each loop as (index, position) pairs including refinement points.
    const rings = model.faceVertexLoops(f).map((ring) =>
      ring.flatMap((v, i) => {
        const w = ring[(i + 1) % ring.length];
        const extra = inserts.get(model.halfEdgeBetween(v, w)!);
        const own = { id: indexOf(v), p: model.pos(v) };
        return extra ? [own, ...extra.points.map((p, k) => ({ id: extra.ids[k], p }))] : [own];
      }),
    );
    const cyl = walls.get(f);
    const normal = model.face(f).normal;
    const emit = (a: { id: number; p: Vec3 }, b: { id: number; p: Vec3 }, c: { id: number; p: Vec3 }) => {
      const facing = dot(cross(sub(b.p, a.p), sub(c.p, a.p)), normal);
      triangles.push(...(facing >= 0 ? [a.id, b.id, c.id] : [a.id, c.id, b.id]));
    };
    if (cyl && rings.length === 1 && zipperStrip(rings[0], cyl, emit)) continue;
    let rings2: Vec2[][];
    if (cyl) {
      // Unroll the facet around the axis (angle x radius, height): planar and undistorted.
      const ref = cyl.angle(rings[0][0].p);
      const unwrap = (t: number) => {
        let d = t - ref;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d;
      };
      rings2 = rings.map((r) => r.map(({ p }) => [unwrap(cyl.angle(p)) * cyl.curve.radius, cyl.height(p)] as Vec2));
    } else {
      const plane = model.facePlane(f);
      rings2 = rings.map((r) => r.map(({ p }) => toPlane2D(plane, p)));
    }
    const flat = rings.flat();
    for (const [i, j, k] of triangulate2D(rings2[0], rings2.slice(1))) emit(flat[i], flat[j], flat[k]);
  }
  return { positions, triangles };
}

type RingPoint = { id: number; p: Vec3 };

/**
 * Triangulate a cylinder facet as a strip: split its loop at the two lines parallel to the axis
 * (generators) into two rims, then zip the rims together in angle order. Unrolling the facet flat
 * and using a general triangulator would line the refined rim points up and let it join three of
 * them into a sliver, cutting across the arc. Returns false if the facet is not a simple strip.
 */
function zipperStrip(ring: RingPoint[], cyl: Cylinder, emit: (a: RingPoint, b: RingPoint, c: RingPoint) => void): boolean {
  const n = ring.length;
  const angle = ring.map(({ p }) => cyl.angle(p));
  const sameAngle = (i: number, j: number) => {
    let d = Math.abs(angle[i] - angle[j]) % (2 * Math.PI);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d < 1e-9;
  };
  const generators = ring.map((_, i) => i).filter((i) => sameAngle(i, (i + 1) % n));
  if (generators.length !== 2) return false;
  // Rim A runs from the end of the first generator to the start of the second; rim B the rest.
  const chain = (from: number, to: number) => {
    const out: RingPoint[] = [];
    for (let i = from; ; i = (i + 1) % n) {
      out.push(ring[i]);
      if (i === to) break;
    }
    return out;
  };
  const [g0, g1] = generators;
  const a = chain((g0 + 1) % n, g1);
  const b = chain((g1 + 1) % n, g0).reverse(); // now runs alongside A, same direction
  const ref = cyl.angle(a[0].p);
  const t = (q: RingPoint) => {
    let d = cyl.angle(q.p) - ref;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const dir = Math.sign(t(a[a.length - 1])) || 1;
  let i = 0;
  let j = 0;
  while (i < a.length - 1 || j < b.length - 1) {
    const advanceA = j === b.length - 1 || (i < a.length - 1 && dir * t(a[i + 1]) <= dir * t(b[j + 1]));
    if (advanceA) {
      emit(a[i], a[i + 1], b[j]);
      i++;
    } else {
      emit(a[i], b[j + 1], b[j]);
      j++;
    }
  }
  return true;
}

/** Number of directed triangle edges without an opposite edge (0 for a closed mesh). */
export function openMeshEdges(mesh: ExportMesh): number {
  const count = new Map<string, number>();
  const t = mesh.triangles;
  for (let i = 0; i < t.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = t[i + k];
      const b = t[i + ((k + 1) % 3)];
      const rev = `${b}>${a}`;
      if ((count.get(rev) ?? 0) > 0) count.set(rev, count.get(rev)! - 1);
      else count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of count.values()) open += n;
  return open;
}

/** Signed volume of a closed mesh (positive when outward-facing). */
export function meshVolume(mesh: ExportMesh): number {
  const p = mesh.positions;
  const t = mesh.triangles;
  let v = 0;
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i], t[i + 1], t[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]] as Vec3);
    v += dot(a, cross(b, c)) / 6;
  }
  return v;
}
