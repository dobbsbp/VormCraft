import type { FaceId, HalfEdgeId, Model, VertexId } from '../model/Model';
import { facesCoplanar, mergeFaces, removeCollinearVertices } from './cleanup';

/**
 * Erase faces and edges, as SketchUp does: erasing a face leaves its edges; erasing the line
 * between two faces lying flat in one plane joins them into one face; erasing any other edge also
 * erases the faces it bounds (they can no longer be closed). A line kept twice where shapes touch
 * (see `Model.coincidentVertices`) counts as one line. Vertices left with no edges go too.
 */
export function erase(model: Model, faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>): void {
  const doomedFaces = new Set([...faces].filter((f) => model.faces.has(f)));
  const doomedEdges = [...edges].filter((e) => model.halfEdges.has(e));
  // A line with a copy where shapes touch: both copies go.
  const copies = model.coincidentVertices();
  if (copies.size) for (const e of [...doomedEdges]) for (const c of copiesOf(model, e, copies)) if (!doomedEdges.includes(c)) doomedEdges.push(c);
  const merged = new Set<VertexId>();
  for (const e of doomedEdges) {
    if (!model.halfEdges.has(e)) continue;
    const f = model.faceOf(e);
    const g = model.faceOf(model.he(e).twin);
    if (f === null || g === null || f === g || doomedFaces.has(f) || doomedFaces.has(g) || !facesCoplanar(model, f, g)) continue;
    mergeFaces(model, f, g, g, merged);
  }
  if (copies.size) mergeAcrossCopies(model, doomedEdges, doomedFaces, copies, merged);
  // Corners left in the middle of a straight side by a merge go too.
  removeCollinearVertices(model, merged);
  for (const e of doomedEdges) {
    if (!model.halfEdges.has(e)) continue;
    for (const h of [e, model.he(e).twin]) {
      const f = model.faceOf(h);
      if (f !== null) doomedFaces.add(f);
    }
  }
  for (const f of doomedFaces) if (model.faces.has(f)) model.removeFace(f);
  const touched = new Set<VertexId>();
  for (const e of doomedEdges) {
    if (!model.halfEdges.has(e)) continue;
    touched.add(model.he(e).origin);
    touched.add(model.dest(e));
    model.removeEdge(e);
  }
  for (const v of touched) model.removeVertexIfIsolated(v);
}

/** Other edges at the same place as `e` (its copies where shapes touch). */
function copiesOf(model: Model, e: HalfEdgeId, copies: Map<VertexId, VertexId[]>): HalfEdgeId[] {
  const a = model.he(e).origin;
  const b = model.dest(e);
  const out: HalfEdgeId[] = [];
  for (const x of copies.get(a) ?? [a]) {
    for (const y of copies.get(b) ?? [b]) {
      if (x === a && y === b) continue;
      const h = model.halfEdgeBetween(x, y);
      if (h !== undefined) out.push(Math.min(h, model.he(h).twin));
    }
  }
  return out;
}

/**
 * Two faces lying flat in one plane on either copy of an erased line (a triangle drawn off a box's
 * top edge, say): join them into one face. The faces at an angle to them along that line (the
 * box's front) go, as they can no longer be closed. The joined face uses the existing corners, so
 * the copies disappear.
 */
function mergeAcrossCopies(model: Model, doomedEdges: HalfEdgeId[], doomedFaces: Set<FaceId>, copies: Map<VertexId, VertexId[]>, merged: Set<VertexId>): void {
  for (const e of doomedEdges) {
    if (!model.halfEdges.has(e)) continue;
    const group = [e, ...copiesOf(model, e, copies)].filter((x) => model.halfEdges.has(x));
    if (group.length < 2) continue;
    const around = [...new Set(group.flatMap((x) => [model.faceOf(x), model.faceOf(model.he(x).twin)]).filter((f): f is FaceId => f !== null))];
    let pair: [FaceId, FaceId] | null = null;
    for (const f of around) for (const g of around) if (!pair && f !== g && !doomedFaces.has(f) && !doomedFaces.has(g) && facesCoplanar(model, f, g)) pair = [f, g];
    if (!pair) continue;
    // The face whose corners there connect to less (the shape drawn against the other) moves.
    const reach = (f: FaceId) => model.faceVertexLoops(f).flat().filter((v) => copies.has(v)).reduce((n, v) => n + model.outgoing(v).size, 0);
    const [keep, other] = reach(pair[0]) >= reach(pair[1]) ? pair : [pair[1], pair[0]];
    // The faces at an angle along this line go first, freeing its far side.
    for (const f of around) if (f !== keep && f !== other) model.removeFace(f);
    // Rebuild the other face on the kept face's corners where they share a spot.
    const keepVerts = new Set(model.faceVertexLoops(keep).flat());
    const swap = (v: VertexId) => (copies.get(v) ?? []).find((w) => w !== v && keepVerts.has(w)) ?? v;
    const { normal, material } = model.face(other);
    const rings = model.faceVertexLoops(other);
    const old = model.faceHalfEdges(other);
    model.removeFace(other);
    let rebuilt: FaceId;
    try {
      rebuilt = model.addFace(rings[0].map(swap), rings.slice(1).map((r) => r.map(swap)), { normal, material });
    } catch {
      model.addFace(rings[0], rings.slice(1), { id: other, normal, material });
      continue;
    }
    mergeFaces(model, rebuilt, keep, keep, merged);
    // The face's old edges at the copied corners, and those corners, go.
    model.purgeFree(old);
  }
}
