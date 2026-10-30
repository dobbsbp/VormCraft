import { cross, normalize, type Vec3 } from '../core/math/vec3';
import { facesWithCurveEdges, isSoftEdge } from '../core/model/surfaces';
import type { FaceId, HalfEdgeId, MaterialId, Model } from '../core/model/Model';

export { isSoftEdge };
import { triangulateFace } from '../core/triangulate';

/** A run of triangles drawn with one material (`null` = the default face colour). */
export interface DisplayGroup {
  /** First index (into `indices`) and number of indices. */
  start: number;
  count: number;
  material: MaterialId | null;
}

/**
 * Everything the viewport draws, derived from the model. It is rebuilt after every model change
 * and never written back: picking resolves triangles and segments to model ids through it.
 */
export interface DisplayData {
  /** Vertex positions (xyz) for the face mesh; each face has its own vertices. */
  positions: Float32Array;
  /** Texture coordinates (uv) per vertex, in millimetres along the face (see `faceUVAxes`). */
  uvs: Float32Array;
  /** Three indices per triangle into `positions`. */
  indices: Uint32Array;
  /** Model face id of each triangle (index = triangle index from a raycast). */
  triangleFaces: Uint32Array;
  /** Triangles grouped by material, in order. */
  groups: DisplayGroup[];
  /** Two endpoints (6 floats) per visible edge. */
  edgePositions: Float32Array;
  /** Model edge id (lower half-edge id of the pair) of each segment in `edgePositions`. */
  segmentEdges: Uint32Array;
}

/**
 * Directions on a face along which a texture runs (u across, v up): level faces use the red and
 * green axes; other faces run u level along the face and v up its slope, so textures such as
 * brick stand upright on walls.
 */
export function faceUVAxes(normal: Vec3): { u: Vec3; v: Vec3 } {
  if (Math.abs(normal[2]) > 0.999) return { u: [1, 0, 0], v: [0, 1, 0] };
  const u = normalize(cross([0, 0, 1], normal));
  return { u, v: cross(normal, u) };
}

/** `fallback`: paint for faces without their own (a group's paint). */
export function buildDisplayData(model: Model, fallback?: MaterialId): DisplayData {
  const byMaterial = new Map<MaterialId | null, FaceId[]>();
  for (const f of model.faces.values()) {
    const key = f.material ?? fallback ?? null;
    if (!byMaterial.has(key)) byMaterial.set(key, []);
    byMaterial.get(key)!.push(f.id);
  }
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const triangleFaces: number[] = [];
  const groups: DisplayGroup[] = [];
  for (const [material, faces] of byMaterial) {
    const start = indices.length;
    for (const f of faces) {
      const { u, v } = faceUVAxes(model.face(f).normal);
      const local = new Map<number, number>();
      for (const tri of triangulateFace(model, f)) {
        for (const vid of tri) {
          let i = local.get(vid);
          if (i === undefined) {
            const p = model.pos(vid);
            i = positions.length / 3;
            local.set(vid, i);
            positions.push(p[0], p[1], p[2]);
            uvs.push(p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]);
          }
          indices.push(i);
        }
        triangleFaces.push(f);
      }
    }
    groups.push({ start, count: indices.length - start, material });
  }
  const edgePositions: number[] = [];
  const segmentEdges: number[] = [];
  const curvedFaces = facesWithCurveEdges(model);
  for (const e of model.edges()) {
    if (isSoftEdge(model, e, curvedFaces)) continue;
    const h = model.he(e);
    edgePositions.push(...model.pos(h.origin), ...model.pos(model.dest(e)));
    segmentEdges.push(e);
  }
  return {
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
    triangleFaces: Uint32Array.from(triangleFaces),
    groups,
    edgePositions: Float32Array.from(edgePositions),
    segmentEdges: Uint32Array.from(segmentEdges),
  };
}

/** Triangles of a single face, as flat xyz positions (for the hover/selection overlay). */
export function faceTriangles(model: Model, face: FaceId): Float32Array {
  const out: number[] = [];
  for (const tri of triangulateFace(model, face)) for (const v of tri) out.push(...model.pos(v));
  return Float32Array.from(out);
}

/** Outline segments of a face (all of its loops), as flat xyz pairs. */
export function faceOutline(model: Model, face: FaceId): Float32Array {
  const out: number[] = [];
  for (const h of model.faceHalfEdges(face)) out.push(...model.pos(model.he(h).origin), ...model.pos(model.dest(h)));
  return Float32Array.from(out);
}

export function edgeSegment(model: Model, edge: HalfEdgeId): Float32Array {
  return Float32Array.from([...model.pos(model.he(edge).origin), ...model.pos(model.dest(edge))]);
}
