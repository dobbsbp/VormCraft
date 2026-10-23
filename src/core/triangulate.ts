import { toPlane2D } from './math/plane';
import { triangulate2D } from './math/polygon2d';
import type { FaceId, Model, VertexId } from './model/Model';

/** Triangles of one face as vertex-id triples, CCW about the face normal. */
export function triangulateFace(model: Model, face: FaceId): [VertexId, VertexId, VertexId][] {
  const plane = model.facePlane(face);
  const rings = model.faceVertexLoops(face);
  const flat = rings.flat();
  const rings2 = rings.map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
  return triangulate2D(rings2[0], rings2.slice(1)).map(([a, b, c]) => [flat[a], flat[b], flat[c]]);
}

export interface TriangleMesh {
  /** xyz per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
  /** Source face id of each triangle (used for picking). */
  faceIds: Uint32Array;
  /** Model vertex id of each mesh vertex. */
  vertexIds: VertexId[];
}

/** Display/boolean mesh for a set of faces (all faces by default). Vertices are shared between faces. */
export function triangulateFaces(model: Model, faces: Iterable<FaceId> = model.faces.keys()): TriangleMesh {
  const index = new Map<VertexId, number>();
  const vertexIds: VertexId[] = [];
  const indices: number[] = [];
  const faceIds: number[] = [];
  for (const f of faces) {
    for (const tri of triangulateFace(model, f)) {
      for (const v of tri) {
        let i = index.get(v);
        if (i === undefined) {
          i = vertexIds.length;
          index.set(v, i);
          vertexIds.push(v);
        }
        indices.push(i);
      }
      faceIds.push(f);
    }
  }
  const positions = new Float32Array(vertexIds.length * 3);
  vertexIds.forEach((v, i) => positions.set(model.pos(v), i * 3));
  return { positions, indices: Uint32Array.from(indices), faceIds: Uint32Array.from(faceIds), vertexIds };
}
