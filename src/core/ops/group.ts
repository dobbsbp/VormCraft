import { SpatialHash } from '../math/spatialHash';
import type { Vec3 } from '../math/vec3';
import { Model, type CurveId, type FaceId, type HalfEdgeId, type MaterialId, type VertexId } from '../model/Model';
import { applyAffine, scaling, transformVertices, type Affine } from './transform';

/**
 * Groups keep their geometry in a model of their own, so it never sticks to anything outside.
 * These operations move geometry between models: making a group takes the selection out of a
 * model, exploding one merges its geometry back in.
 */

interface CopyOptions {
  /** Reuse vertices and edges already in the target at the same place (exploding). */
  weld?: boolean;
  /** Paint for copied faces that have none (a group's own paint, baked in when exploding). */
  material?: MaterialId;
}

/**
 * Copy faces (with their edges) and loose edges from `src` into `dst`, with their curves, paint
 * and edge smoothing.
 */
function copyGeometry(src: Model, dst: Model, faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>, opts: CopyOptions = {}): void {
  const hash = new SpatialHash<VertexId>();
  if (opts.weld) for (const v of dst.vertices.values()) hash.insert(v.pos, v.id);
  const vmap = new Map<VertexId, VertexId>();
  const vertex = (v: VertexId): VertexId => {
    let c = vmap.get(v);
    if (c === undefined) {
      const p = src.pos(v);
      c = (opts.weld ? hash.find(p) : undefined) ?? dst.addVertex(p);
      if (opts.weld) hash.insert(p, c);
      vmap.set(v, c);
    }
    return c;
  };
  const cmap = new Map<CurveId, CurveId>();
  const curve = (c: CurveId | null): CurveId | null => {
    if (c === null) return null;
    if (!cmap.has(c)) {
      const s = src.curves.get(c);
      if (!s) return null;
      cmap.set(c, dst.addCurve({ kind: 'circle', center: s.center, normal: s.normal, radius: s.radius, segments: s.segments }));
    }
    return cmap.get(c)!;
  };
  const copyEdge = (e: HalfEdgeId) => {
    const h = src.he(e);
    const a = vertex(h.origin);
    const b = vertex(src.dest(e));
    if (a === b) return;
    const existed = dst.halfEdgeBetween(a, b) !== undefined;
    dst.addEdge(a, b);
    // A welded edge that was already there keeps its own curve and smoothing.
    if (existed) return;
    const c = curve(h.curve);
    if (c !== null) dst.setEdgeCurve(a, b, c);
    if (h.soft !== undefined) dst.setEdgeSoft(a, b, h.soft);
  };

  const faceList = [...faces].filter((f) => src.faces.has(f));
  for (const f of faceList) {
    for (const h of src.faceHalfEdges(f)) copyEdge(Math.min(h, src.he(h).twin));
    const face = src.face(f);
    const rings = src.faceVertexLoops(f).map((r) => r.map(vertex));
    const material = face.material ?? opts.material;
    try {
      dst.addFace(rings[0], rings.slice(1), { normal: face.normal, ...(material !== undefined ? { material } : {}) });
    } catch {
      throw new Error('The group’s faces would overlap faces outside it');
    }
  }
  for (const e of edges) if (src.halfEdges.has(e)) copyEdge(e);
}

/**
 * Take faces and edges out of `model` into a new model (making a group). Faces go with their
 * edges; an edge also bounding a face that stays is copied, not taken, so what stays is intact.
 */
export function extractGeometry(model: Model, faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>): Model {
  const faceList = [...new Set(faces)].filter((f) => model.faces.has(f));
  const edgeList = [...new Set(edges)].filter((e) => model.halfEdges.has(e));
  const out = new Model();
  copyGeometry(model, out, faceList, edgeList);
  const candidates = new Set<HalfEdgeId>(edgeList);
  for (const f of faceList) for (const h of model.faceHalfEdges(f)) candidates.add(h);
  for (const f of faceList) model.removeFace(f);
  // Edges left bounding no face go; edges still bounding a face that stays are kept.
  model.purgeFree(candidates);
  return out;
}

/**
 * Merge all of `src` into `dst` (exploding a group): coincident vertices and edges are shared, so
 * the geometry joins up with what it touches. Where that is impossible (two solids touching
 * face to face would put four faces on one edge) it is merged without joining. Faces without
 * paint take `material`.
 */
export function mergeGeometry(dst: Model, src: Model, material?: MaterialId): void {
  const welded = dst.clone();
  try {
    copyGeometry(src, welded, src.faces.keys(), [...src.edges()], { weld: true, material });
  } catch {
    copyGeometry(src, dst, src.faces.keys(), [...src.edges()], { material });
    return;
  }
  dst.copyFrom(welded);
}

/** Transform a whole model (a group moved, rotated, scaled or mirrored as one piece). */
export function transformModel(model: Model, a: Affine): void {
  if (model.vertices.size) transformVertices(model, new Set(model.vertices.keys()), a);
}

/** Scale a whole model about `base` (negative factors mirror). */
export function scaleModel(model: Model, base: Vec3, factors: Vec3): void {
  transformModel(model, scaling(base, factors));
}

/** Axis-aligned bounds of models' vertices, or null when they are empty. */
export function modelBounds(models: Iterable<Model>, a?: Affine): { min: Vec3; max: Vec3 } | null {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const m of models) {
    for (const v of m.vertices.values()) {
      const p = a ? applyAffine(a, v.pos) : v.pos;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
      any = true;
    }
  }
  return any ? { min: [min[0], min[1], min[2]], max: [max[0], max[1], max[2]] } : null;
}
