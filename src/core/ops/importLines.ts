import { makePlane, planesCoincide, toPlane2D, type Plane } from '../math/plane';
import { SpatialHash } from '../math/spatialHash';
import { TOL } from '../math/tolerance';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';
import { volume } from '../check/measure';
import { Model, type CurveId, type FaceId, type VertexId } from '../model/Model';
import { assembleFaces, traceLoops } from '../model/region';
import type { LinePath, PathCurve } from './drawingCurves';
import { reverseFaces } from './orient';

export interface LineImportOptions {
  /** Fill closed flat outlines with faces (as drawing them with the Line tool would). */
  faces?: boolean;
}

export interface LineImportResult {
  model: Model;
  edges: number;
  faces: number;
}

export interface LayerImportResult {
  /** One model per layer, in order. */
  models: Model[];
  edges: number;
  faces: number;
  /** True circles (each shared by its arcs). */
  circles: number;
}

interface Seg {
  a: number;
  b: number;
  curve: number;
  layer: number;
  /** Points splitting it: [parameter along a→b, point index]. */
  splits: [number, number][];
}

/** A normal pointing up, else towards the front (-Y), else +X: the way drawn faces face. */
function preferred(n: Vec3): Vec3 {
  const s = Math.abs(n[2]) > 1e-9 ? Math.sign(n[2]) : Math.abs(n[1]) > 1e-9 ? -Math.sign(n[1]) : Math.sign(n[0]);
  return scale(n, s || 1);
}

/** Closest points of segments p→q and a→b: parameters s and t, and their distance. */
function closest(p: Vec3, q: Vec3, a: Vec3, b: Vec3): { s: number; t: number; dist: number } | null {
  const d1 = sub(q, p);
  const d2 = sub(b, a);
  const r = sub(p, a);
  const A = dot(d1, d1);
  const E = dot(d2, d2);
  const F = dot(d2, r);
  const C = dot(d1, r);
  const B = dot(d1, d2);
  const den = A * E - B * B;
  // Parallel: overlaps are found from the end points instead.
  if (den <= 1e-10 * A * E) return null;
  const s = (B * F - C * E) / den;
  const t = (A * F - B * C) / den;
  if (s < 0 || s > 1 || t < 0 || t > 1) return null;
  return { s, t, dist: distance(add(p, scale(d1, s)), add(a, scale(d2, t))) };
}

/** Where point x lies along p→q (0..1) if it is on the segment, else null. */
function along(x: Vec3, p: Vec3, q: Vec3): number | null {
  const d = sub(q, p);
  const len2 = dot(d, d);
  const s = dot(sub(x, p), d) / len2;
  if (s <= 0 || s >= 1) return null;
  return distance(x, add(p, scale(d, s))) <= TOL ? s : null;
}

/**
 * Build edges from the paths of a drawing (DXF import), all at once: ends closer than the model
 * tolerance are joined, lines are split where they cross or touch, arcs keep their true circle,
 * and, if asked, every closed flat outline becomes a face (faces inside others become holes in
 * them as well as faces of their own, as with the Line tool). Fast for drawings with many
 * thousands of segments, unlike drawing them one by one.
 */
export function importLines(paths: readonly LinePath[], opts: LineImportOptions = {}): LineImportResult {
  const r = importLayers([paths], opts);
  return { model: r.models[0], edges: r.edges, faces: r.faces };
}

/**
 * `importLines` for a drawing in layers, each to become a model of its own. Faces are found with
 * every layer together (holes drawn on one layer still cut the outline drawn on another): each
 * face goes to the layer most of its outline is on, with copies of the edges it needs from others.
 */
export function importLayers(layers: readonly (readonly LinePath[])[], opts: LineImportOptions = {}): LayerImportResult {
  const pts: Vec3[] = [];
  const hash = new SpatialHash<number>();
  const point = (p: Vec3): number => {
    let i = hash.find(p);
    if (i === undefined) {
      i = pts.length;
      pts.push([p[0], p[1], p[2]]);
      hash.insert(p, i);
    }
    return i;
  };

  // True circles, one per circle (pieces of the same circle share it).
  const curves: PathCurve[] = [];
  const curveOf = (c: PathCurve | undefined): number => {
    if (!c) return -1;
    const n = preferred(normalize(c.normal));
    const tol = Math.max(TOL * 10, c.radius * 1e-6);
    const i = curves.findIndex((o) => distance(o.center, c.center) <= tol && Math.abs(o.radius - c.radius) <= tol && Math.abs(dot(o.normal, n)) > 1 - 1e-6);
    if (i >= 0) {
      curves[i] = { ...curves[i], segments: Math.max(curves[i].segments, c.segments) };
      return i;
    }
    curves.push({ ...c, normal: n });
    return curves.length - 1;
  };

  const segs: Seg[] = [];
  layers.forEach((paths, layer) => {
    for (const path of paths) {
      const curve = curveOf(path.curve);
      for (let i = 0; i + 1 < path.points.length; i++) {
        const a = point(path.points[i]);
        const b = point(path.points[i + 1]);
        if (a !== b) segs.push({ a, b, curve, layer, splits: [] });
      }
    }
  });

  // Crossings and touches: sweep along X, testing segments whose boxes overlap.
  const box = segs.map((s) => {
    const p = pts[s.a];
    const q = pts[s.b];
    return [0, 1, 2].map((k) => [Math.min(p[k], q[k]) - TOL, Math.max(p[k], q[k]) + TOL]);
  });
  const order = segs.map((_, i) => i).sort((i, j) => box[i][0][0] - box[j][0][0]);
  let active: number[] = [];
  for (const i of order) {
    const bi = box[i];
    active = active.filter((j) => box[j][0][1] >= bi[0][0]);
    for (const j of active) {
      const bj = box[j];
      if (bj[1][1] < bi[1][0] || bj[1][0] > bi[1][1] || bj[2][1] < bi[2][0] || bj[2][0] > bi[2][1]) continue;
      const si = segs[i];
      const sj = segs[j];
      // An end of one on the other.
      for (const [x, y] of [
        [si, sj],
        [sj, si],
      ]) {
        for (const v of [y.a, y.b]) {
          if (v === x.a || v === x.b) continue;
          const s = along(pts[v], pts[x.a], pts[x.b]);
          if (s !== null) x.splits.push([s, v]);
        }
      }
      // A crossing inside both.
      const c = closest(pts[si.a], pts[si.b], pts[sj.a], pts[sj.b]);
      if (c && c.dist <= TOL) {
        const p = add(pts[si.a], scale(sub(pts[si.b], pts[si.a]), c.s));
        const v = point(p);
        if (v !== si.a && v !== si.b && v !== sj.a && v !== sj.b) {
          si.splits.push([c.s, v]);
          sj.splits.push([c.t, v]);
        }
      }
    }
    active.push(i);
  }

  const model = new Model();
  const vid = new Map<number, VertexId>();
  const vertex = (i: number) => {
    let v = vid.get(i);
    if (v === undefined) vid.set(i, (v = model.addVertex(pts[i])));
    return v;
  };
  const curveIds = curves.map((c) => model.addCurve({ kind: 'circle', ...c }));
  const edges: [VertexId, VertexId][] = [];
  const key = (a: VertexId, b: VertexId) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const onLayers = new Map<string, Set<number>>();
  for (const s of segs) {
    const stops = [[0, s.a] as [number, number], ...s.splits.sort((x, y) => x[0] - y[0]), [1, s.b] as [number, number]];
    for (let k = 0; k + 1 < stops.length; k++) {
      const a = stops[k][1];
      const b = stops[k + 1][1];
      if (a === b) continue;
      const va = vertex(a);
      const vb = vertex(b);
      const known = model.halfEdgeBetween(va, vb) !== undefined;
      const curve: CurveId | null = s.curve >= 0 ? curveIds[s.curve] : null;
      model.addEdge(va, vb, curve);
      const ek = key(va, vb);
      if (!onLayers.has(ek)) onLayers.set(ek, new Set());
      onLayers.get(ek)!.add(s.layer);
      if (known) {
        if (curve !== null && model.he(model.halfEdgeBetween(va, vb)!).curve === null) model.setEdgeCurve(va, vb, curve);
      } else edges.push([va, vb]);
    }
  }

  const faces = opts.faces === false ? 0 : fillFaces(model, edges);
  if (layers.length === 1) return { models: [model], edges: edges.length, faces, circles: curves.length };

  // Share out: each layer's edges, and each face to the layer most of its outline (by length) is on.
  const models = layers.map(() => new Model());
  const maps = layers.map(() => new Map<VertexId, VertexId>());
  const curveMaps = layers.map(() => new Map<CurveId, CurveId>());
  const at = (layer: number, v: VertexId) => {
    let w = maps[layer].get(v);
    if (w === undefined) maps[layer].set(v, (w = models[layer].addVertex(model.pos(v))));
    return w;
  };
  const curveIn = (layer: number, c: CurveId | null): CurveId | null => {
    if (c === null) return null;
    let d = curveMaps[layer].get(c);
    if (d === undefined) {
      const { id: _id, ...fields } = model.curves.get(c)!;
      curveMaps[layer].set(c, (d = models[layer].addCurve(fields)));
    }
    return d;
  };
  for (const e of model.edges()) {
    const h = model.he(e);
    for (const layer of onLayers.get(key(h.origin, model.dest(e))) ?? []) models[layer].addEdge(at(layer, h.origin), at(layer, model.dest(e)), curveIn(layer, h.curve));
  }
  for (const f of model.faces.values()) {
    const rings = model.faceVertexLoops(f.id);
    const votes = new Map<number, number>();
    rings[0].forEach((a, i) => {
      const b = rings[0][(i + 1) % rings[0].length];
      const len = distance(model.pos(a), model.pos(b));
      for (const layer of onLayers.get(key(a, b)) ?? []) votes.set(layer, (votes.get(layer) ?? 0) + len);
    });
    const owner = [...votes].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0] ?? 0;
    const mapped = rings.map((r) => r.map((v) => at(owner, v)));
    models[owner].addFace(mapped[0], mapped.slice(1), { normal: f.normal });
    // Edges copied from other layers keep their true circles.
    rings.forEach((r) =>
      r.forEach((a, i) => {
        const b = r[(i + 1) % r.length];
        const c = model.he(model.halfEdgeBetween(a, b)!).curve;
        const ma = at(owner, a);
        const mb = at(owner, b);
        if (c !== null && models[owner].he(models[owner].halfEdgeBetween(ma, mb)!).curve === null) models[owner].setEdgeCurve(ma, mb, curveIn(owner, c));
      }),
    );
  }
  return { models, edges: edges.length, faces, circles: curves.length };
}

/** Edges left after repeatedly dropping those with a loose end (they cannot bound a face). */
function withoutLooseEnds(edges: readonly [VertexId, VertexId][]): [VertexId, VertexId][] {
  let list = [...edges];
  for (;;) {
    const degree = new Map<VertexId, number>();
    for (const [a, b] of list) {
      degree.set(a, (degree.get(a) ?? 0) + 1);
      degree.set(b, (degree.get(b) ?? 0) + 1);
    }
    const next = list.filter(([a, b]) => degree.get(a)! > 1 && degree.get(b)! > 1);
    if (next.length === list.length) return list;
    list = next;
  }
}

/** Connected sets of edges. */
function components(edges: readonly [VertexId, VertexId][]): [VertexId, VertexId][][] {
  const parent = new Map<VertexId, VertexId>();
  const find = (v: VertexId): VertexId => {
    let r = v;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(v, r);
    return r;
  };
  for (const [a, b] of edges) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  }
  const groups = new Map<VertexId, [VertexId, VertexId][]>();
  for (const e of edges) {
    const r = find(e[0]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(e);
  }
  return [...groups.values()];
}

/** The plane all these points lie in, if there is one. */
function planeOf(model: Model, vs: readonly VertexId[]): Plane | null {
  const p = vs.map((v) => model.pos(v));
  const p0 = p[0];
  let p1 = p0;
  for (const q of p) if (distance(q, p0) > distance(p1, p0)) p1 = q;
  const d = sub(p1, p0);
  if (length(d) <= TOL) return null;
  let best = 0;
  let n: Vec3 = [0, 0, 0];
  for (const q of p) {
    const c = cross(d, sub(q, p0));
    if (length(c) > best) {
      best = length(c);
      n = c;
    }
  }
  if (best <= TOL * length(d)) return null;
  const plane = makePlane(p0, preferred(normalize(n)), [1, 0, 0]);
  return p.every((q) => Math.abs(dot(sub(q, p0), plane.normal)) <= TOL) ? plane : null;
}

/**
 * Planes a set of edges outlines shapes in: those in which several corners (two edges meeting at
 * a vertex) lie, most corners first. A 3D wireframe box gives its six sides.
 */
function cornerPlanes(model: Model, edges: readonly [VertexId, VertexId][]): Plane[] {
  const near = new Map<VertexId, VertexId[]>();
  for (const [a, b] of edges) {
    if (!near.has(a)) near.set(a, []);
    if (!near.has(b)) near.set(b, []);
    near.get(a)!.push(b);
    near.get(b)!.push(a);
  }
  const tally = new Map<string, { plane: Plane; corners: number }>();
  for (const [v, ws] of near) {
    if (ws.length < 2 || ws.length > 8) continue;
    const p = model.pos(v);
    for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++) {
        const d1 = sub(model.pos(ws[i]), p);
        const d2 = sub(model.pos(ws[j]), p);
        const c = cross(d1, d2);
        if (length(c) <= 1e-6 * length(d1) * length(d2)) continue;
        const n = preferred(normalize(c));
        const key = `${n.map((x) => Math.round(x * 1e4)).join(',')}|${Math.round(dot(n, p) / (TOL * 10))}`;
        const t = tally.get(key);
        if (t) t.corners++;
        else tally.set(key, { plane: makePlane(p, n, [1, 0, 0]), corners: 1 });
      }
  }
  const out: Plane[] = [];
  for (const t of [...tally.values()].filter((t) => t.corners >= 3).sort((a, b) => b.corners - a.corners)) {
    if (out.length >= 500) break;
    if (!out.some((o) => planesCoincide(o, t.plane))) out.push(t.plane);
  }
  return out;
}

/** Make faces from the closed outlines among `edges` (new loose edges of the model). */
function fillFaces(model: Model, edges: readonly [VertexId, VertexId][]): number {
  const made: FaceId[] = [];
  const fill = (plane: Plane, set: [VertexId, VertexId][]) => {
    const pos2 = (v: VertexId) => toPlane2D(plane, model.pos(v));
    let list = withoutLooseEnds(set);
    let loops: VertexId[][] = [];
    // Edges with the same loop on both sides (a line joining two shapes) cannot bound a face:
    // drop them and trace again.
    for (let round = 0; round < 100 && list.length; round++) {
      loops = traceLoops(
        list.flatMap(([a, b]) => [[a, b] as const, [b, a] as const]),
        pos2,
      );
      const bridges = new Set<string>();
      for (const ring of loops) {
        const dir = new Set(ring.map((a, i) => `${a}>${ring[(i + 1) % ring.length]}`));
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          if (dir.has(`${b}>${a}`)) bridges.add(a < b ? `${a}-${b}` : `${b}-${a}`);
        }
      }
      if (!bridges.size) break;
      list = withoutLooseEnds(list.filter(([a, b]) => !bridges.has(a < b ? `${a}-${b}` : `${b}-${a}`)));
      loops = [];
    }
    if (!list.length) return;
    for (const f of assembleFaces(loops, pos2).faces) {
      try {
        made.push(model.addFace(f.outer, f.holes, { normal: plane.normal }));
      } catch {
        // A face next to it (in another plane) already runs that way along an edge: face the other way.
        try {
          made.push(model.addFace([...f.outer].reverse(), f.holes.map((h) => [...h].reverse()), { normal: scale(plane.normal, -1) }));
        } catch {
          // An outline the model cannot take (it touches itself): left as edges.
        }
      }
    }
  };
  // Outlines are filled plane by plane, all together, so a shape inside another becomes a hole in it.
  const planes: { plane: Plane; edges: [VertexId, VertexId][] }[] = [];
  const add = (plane: Plane, set: readonly [VertexId, VertexId][]) => {
    if (!set.length) return;
    const g = planes.find((o) => planesCoincide(o.plane, plane));
    if (g) g.edges.push(...set);
    else planes.push({ plane, edges: [...set] });
  };
  for (const comp of components(withoutLooseEnds(edges))) {
    const plane = planeOf(model, [...new Set(comp.flat())]);
    if (plane) {
      add(plane, comp);
      continue;
    }
    // Not flat as a whole (a 3D wireframe, or lines at several heights joined up): each plane
    // its corners outline.
    const onPlane = (pl: Plane, v: VertexId) => Math.abs(dot(sub(model.pos(v), pl.origin), pl.normal)) <= TOL;
    for (const pl of cornerPlanes(model, comp)) add(pl, comp.filter(([a, b]) => onPlane(pl, a) && onPlane(pl, b)));
  }
  for (const g of planes) fill(g.plane, g.edges);
  turnClosedShellsOut(model, made);
  return made.length;
}

/** Faces that close up into a solid (every edge between two of them) are turned to face outwards. */
function turnClosedShellsOut(model: Model, faces: readonly FaceId[]): void {
  const seen = new Set<FaceId>();
  for (const start of faces) {
    if (seen.has(start) || !model.faces.has(start)) continue;
    const shell: FaceId[] = [];
    let closed = true;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const f = stack.pop()!;
      shell.push(f);
      for (const l of [model.face(f).outer, ...model.face(f).holes])
        for (const h of model.loopHalfEdges(l)) {
          const other = model.faceOf(model.he(h).twin);
          if (other === null) closed = false;
          else if (!seen.has(other)) {
            seen.add(other);
            stack.push(other);
          }
        }
    }
    if (closed && shell.length >= 4 && volume(model, shell) < 0) {
      try {
        reverseFaces(model, shell);
      } catch {
        // Left as it is.
      }
    }
  }
}
