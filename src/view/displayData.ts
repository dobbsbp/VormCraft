import { facesWithCurveEdges, isSoftEdge } from '../core/model/surfaces';
import type { FaceId, HalfEdgeId, Model } from '../core/model/Model';

export { isSoftEdge };
import { triangulateFace, triangulateFaces } from '../core/triangulate';

/**
 * Everything the viewport draws, derived from the model. It is rebuilt after every model change
 * and never written back: picking resolves triangles and segments to model ids through it.
 */
export interface DisplayData {
  /** Shared vertex positions (xyz) for the face mesh. */
  positions: Float32Array;
  /** Three indices per triangle into `positions`. */
  indices: Uint32Array;
  /** Model face id of each triangle (index = triangle index from a raycast). */
  triangleFaces: Uint32Array;
  /** Two endpoints (6 floats) per visible edge. */
  edgePositions: Float32Array;
  /** Model edge id (lower half-edge id of the pair) of each segment in `edgePositions`. */
  segmentEdges: Uint32Array;
}

export function buildDisplayData(model: Model): DisplayData {
  const mesh = triangulateFaces(model);
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
    positions: mesh.positions,
    indices: mesh.indices,
    triangleFaces: mesh.faceIds,
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
