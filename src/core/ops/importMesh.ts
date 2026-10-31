import { SpatialHash } from '../math/spatialHash';
import { TOL } from '../math/tolerance';
import { cross, dot, newellNormal, type Vec3 } from '../math/vec3';
import { Model, type VertexId } from '../model/Model';
import { removeCollinearVertices } from './cleanup';

/** Polygons from a mesh file (OBJ, STL, ...): each a list of corner points, in order. */
export type MeshPolygon = readonly Vec3[];

export interface MeshImportOptions {
  /** Soften edges between faces meeting at less than this angle (degrees), so curved surfaces look smooth. 0: none. */
  smoothAngle?: number;
}

export interface MeshImportResult {
  model: Model;
  /** Polygons in the file. */
  polygons: number;
  /** Polygons left out: degenerate (no area) or impossible to join to the rest (mesh errors). */
  skipped: number;
}

/**
 * Turn a polygon mesh into our geometry: corners at the same place are joined, neighbouring
 * polygons in the same plane are merged into one face (so a triangulated box comes in as six
 * faces), and polygons that cannot form a valid surface with the rest (flipped or doubled
 * triangles, more than two faces on an edge) are skipped and counted. Edges between faces that
 * meet at a shallow angle are softened, so curved surfaces look smooth.
 */
export function importMesh(polygons: readonly MeshPolygon[], opts: MeshImportOptions = {}): MeshImportResult {
  const model = new Model();
  const hash = new SpatialHash<VertexId>();
  const vertex = (p: Vec3): VertexId => {
    let v = hash.find(p);
    if (v === undefined) {
      v = model.addVertex([p[0], p[1], p[2]]);
      hash.insert(p, v);
    }
    return v;
  };

  // Clean polygons: welded corners, no repeats, with an area and a plane.
  interface Poly {
    ring: VertexId[];
    normal: Vec3;
    /** Plane offset (normal · point). */
    d: number;
  }
  const polys: Poly[] = [];
  let skipped = 0;
  for (const points of polygons) {
    const ring: VertexId[] = [];
    for (const p of points) {
      const v = vertex(p);
      if (ring[ring.length - 1] !== v) ring.push(v);
    }
    while (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    const pts = ring.map((v) => model.pos(v));
    let normal: Vec3;
    try {
      if (ring.length < 3 || new Set(ring).size !== ring.length) throw new Error('degenerate');
      normal = newellNormal(pts);
      if (area(pts, normal) <= TOL * TOL) throw new Error('no area');
    } catch {
      skipped++;
      continue;
    }
    const d = dot(normal, pts[0]);
    // A polygon that is not flat (some OBJ n-gons) is split into a fan of triangles.
    if (pts.some((p) => Math.abs(dot(normal, p) - d) > TOL * 10)) {
      for (let i = 1; i + 1 < ring.length; i++) {
        const tri = [ring[0], ring[i], ring[i + 1]];
        const tp = tri.map((v) => model.pos(v));
        try {
          const n = newellNormal(tp);
          if (area(tp, n) > TOL * TOL) polys.push({ ring: tri, normal: n, d: dot(n, tp[0]) });
        } catch {
          // A sliver: leave it out.
        }
      }
      continue;
    }
    polys.push({ ring, normal, d });
  }

  // Group neighbours that share an edge (running opposite ways, as in a consistent surface) and
  // lie in the same plane.
  const parent = polys.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const directed = new Map<string, number>();
  polys.forEach((p, i) => p.ring.forEach((a, k) => directed.set(`${a}>${p.ring[(k + 1) % p.ring.length]}`, i)));
  polys.forEach((p, i) => {
    p.ring.forEach((a, k) => {
      const b = p.ring[(k + 1) % p.ring.length];
      const j = directed.get(`${b}>${a}`);
      if (j === undefined || j === i) return;
      const q = polys[j];
      if (dot(p.normal, q.normal) > 1 - 1e-9 && Math.abs(p.d - q.d) <= TOL) parent[find(i)] = find(j);
    });
  });
  const clusters = new Map<number, number[]>();
  polys.forEach((_, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(i);
  });

  const addFace = (rings: VertexId[][], normal: Vec3): boolean => {
    try {
      model.addFace(rings[0], rings.slice(1), { normal });
      return true;
    } catch {
      return false;
    }
  };

  for (const members of clusters.values()) {
    const normal = polys[members[0]].normal;
    const rings = members.length === 1 ? [polys[members[0]].ring] : outline(members.map((i) => polys[i].ring));
    if (rings && addFace(orderRings(model, rings, normal), normal)) continue;
    // The merged outline did not work out (a pinch point, say): add the pieces one by one.
    for (const i of members) if (!addFace([polys[i].ring], polys[i].normal)) skipped++;
  }

  removeCollinearVertices(model, [...model.vertices.keys()]);
  model.purgeFree();

  const smooth = opts.smoothAngle ?? 0;
  if (smooth > 0) {
    const limit = Math.cos((smooth * Math.PI) / 180);
    for (const e of [...model.edges()]) {
      const f = model.faceOf(e);
      const g = model.faceOf(model.he(e).twin);
      if (f === null || g === null) continue;
      if (dot(model.face(f).normal, model.face(g).normal) >= limit) model.setEdgeSoft(model.he(e).origin, model.dest(e), true);
    }
  }
  model.validate();
  return { model, polygons: polygons.length, skipped };
}

/** Area of a flat polygon with the given unit normal. */
function area(pts: readonly Vec3[], normal: Vec3): number {
  let s: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const c = cross(pts[i], pts[(i + 1) % pts.length]);
    s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
  }
  return Math.abs(dot(s, normal)) / 2;
}

/**
 * The boundary loops of a set of polygons in one plane: their edges, less those shared by two of
 * them, chained into rings. Null when the chaining is ambiguous (two loops touching at a point).
 */
function outline(rings: VertexId[][]): VertexId[][] | null {
  const edges = new Set<string>();
  for (const r of rings) r.forEach((a, k) => edges.add(`${a}>${r[(k + 1) % r.length]}`));
  const next = new Map<VertexId, VertexId>();
  for (const key of edges) {
    const [a, b] = key.split('>').map(Number);
    if (edges.has(`${b}>${a}`)) continue;
    if (next.has(a)) return null;
    next.set(a, b);
  }
  const out: VertexId[][] = [];
  const seen = new Set<VertexId>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const ring: VertexId[] = [];
    let v = start;
    while (!seen.has(v)) {
      seen.add(v);
      ring.push(v);
      const n = next.get(v);
      if (n === undefined) return null;
      v = n;
    }
    if (v !== start || ring.length < 3) return null;
    out.push(ring);
  }
  return out.length ? out : null;
}

/** The outer ring first (the one enclosing the most area), then the holes. */
function orderRings(model: Model, rings: VertexId[][], normal: Vec3): VertexId[][] {
  const signed = (r: VertexId[]) => {
    const pts = r.map((v) => model.pos(v));
    let s: Vec3 = [0, 0, 0];
    for (let i = 0; i < pts.length; i++) {
      const c = cross(pts[i], pts[(i + 1) % pts.length]);
      s = [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
    }
    return dot(s, normal);
  };
  return [...rings].sort((a, b) => signed(b) - signed(a));
}

/** Size of a set of points (for showing an import's dimensions before choosing units). */
export function meshBounds(polygons: readonly MeshPolygon[]): { min: Vec3; max: Vec3 } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const poly of polygons)
    for (const p of poly)
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
  return min[0] === Infinity ? null : { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] };
}
