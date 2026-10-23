import type { FaceId, HalfEdgeId, Model, VertexId } from '../model/Model';

/**
 * Erase faces and edges, as SketchUp does: erasing a face leaves its edges; erasing an edge also
 * erases the faces it bounds (they can no longer be closed). Vertices left with no edges go too.
 */
export function erase(model: Model, faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>): void {
  const doomedFaces = new Set([...faces].filter((f) => model.faces.has(f)));
  const doomedEdges = [...edges].filter((e) => model.halfEdges.has(e));
  for (const e of doomedEdges) {
    for (const h of [e, model.he(e).twin]) {
      const f = model.faceOf(h);
      if (f !== null) doomedFaces.add(f);
    }
  }
  for (const f of doomedFaces) model.removeFace(f);
  const touched = new Set<VertexId>();
  for (const e of doomedEdges) {
    if (!model.halfEdges.has(e)) continue;
    touched.add(model.he(e).origin);
    touched.add(model.dest(e));
    model.removeEdge(e);
  }
  for (const v of touched) model.removeVertexIfIsolated(v);
}
