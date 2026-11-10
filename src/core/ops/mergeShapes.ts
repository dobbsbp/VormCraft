import { booleanInPlace } from '../boolean/manifold';
import { fromPlane2D, planesCoincide, toPlane2D } from '../math/plane';
import { closestOnSegment, dist2, intersectSegments, pointInRegion, type Vec2 } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { dot } from '../math/vec3';
import type { FaceId, HalfEdgeId, Model, VertexId } from '../model/Model';
import { assembleFaces, traceLoops } from '../model/region';
import { mergeCoplanarFaces, removeCollinearVertices } from './cleanup';
import { extractGeometry } from './group';
import { retagCurves, type CurveCandidate } from './pushPull';

/** Thrown when the selected shapes cannot be merged (the message says why). */
export class MergeError extends Error {}

/**
 * The shapes the given faces belong to: closed solids (each whole; a face of one of several
 * touching parts brings in all of them, each as a solid of its own) and flat faces that are not
 * part of a closed solid.
 */
export function shapesOf(model: Model, faces: Iterable<FaceId>): { solids: Set<FaceId>[]; flat: FaceId[] } {
  const solids: Set<FaceId>[] = [];
  const flat: FaceId[] = [];
  const seen = new Set<FaceId>();
  for (const f of faces) {
    if (seen.has(f) || !model.faces.has(f)) continue;
    const shell = model.connectedFaces(f);
    if (model.isClosed(shell)) {
      // Touching parts count as one object, but each part is a solid of its own.
      for (const g of shell) {
        if (seen.has(g)) continue;
        const part = model.connectedFaces(g, false);
        solids.push(part);
        for (const p of part) seen.add(p);
      }
    } else {
      flat.push(f);
      seen.add(f);
    }
  }
  return { solids, flat };
}

/**
 * Join closed solids into one (a boolean union): where they overlap the faces inside are removed,
 * where they touch face to face the touching faces go, and faces left lying in one plane are
 * merged. Returns the faces of the result.
 */
export function unifySolids(model: Model, solids: readonly Set<FaceId>[]): FaceId[] {
  if (solids.length < 2) throw new MergeError('Select at least two solids to unify');
  const curves = new Map<number, CurveCandidate>();
  for (const shell of solids) {
    for (const f of shell) {
      for (const h of model.faceHalfEdges(f)) {
        const c = model.he(h).curve;
        if (c !== null && !curves.has(c)) curves.set(c, { ...model.curves.get(c)! });
      }
    }
  }
  let target = new Set(solids[0]);
  for (const shell of solids.slice(1)) {
    const tool = extractGeometry(model, shell, []);
    const result = booleanInPlace(model, target, { model: tool, faces: [...tool.faces.keys()] }, 'union');
    const toolFaces = [...result.toolFaceIds.values()].filter((f) => model.faces.has(f));
    const touched = new Set<VertexId>(result.newVertices);
    mergeCoplanarFaces(model, toolFaces, touched);
    removeCollinearVertices(model, touched);
    target = new Set();
    for (const f of [...result.faces, ...toolFaces]) {
      if (model.faces.has(f) && !target.has(f)) for (const g of model.connectedFaces(f)) target.add(g);
    }
  }
  // Circles whose curve went with an extracted solid come back as new curves.
  const candidates = [...curves.values()].map((c) => (model.curves.has(c.id) ? c : { ...c, scratch: true as const }));
  retagCurves(model, target, candidates);
  return [...target];
}

/**
 * Merge flat faces lying in one plane into the region they cover together: overlapping or
 * touching faces become one face (holes kept where nothing covers them), faces apart stay apart.
 * The result faces the way the first face does and takes its paint. Returns the new faces.
 */
export function mergeFlatFaces(model: Model, faces: readonly FaceId[]): FaceId[] {
  if (faces.length < 2) throw new MergeError('Select at least two flat faces to merge');
  const plane = model.facePlane(faces[0]);
  const { normal, material } = model.face(faces[0]);
  for (const f of faces) {
    if (!planesCoincide(plane, model.facePlane(f))) throw new MergeError('Flat faces can only be merged when they lie in one plane');
  }

  // Each face's region in the plane, wound counter-clockwise (outer) about the first face's normal.
  const regions = faces.map((f) => {
    const flip = dot(model.face(f).normal, normal) < 0;
    const rings = model.faceVertexLoops(f).map((r) => {
      const ring = r.map((v) => toPlane2D(plane, model.pos(v)));
      return flip ? ring.reverse() : ring;
    });
    return { outer: rings[0], holes: rings.slice(1) };
  });
  const covered = (p: Vec2) => regions.some((r) => pointInRegion(p, r.outer, r.holes) === 'inside');

  const segments: [Vec2, Vec2][] = [];
  for (const r of regions) for (const ring of [r.outer, ...r.holes]) ring.forEach((a, i) => segments.push([a, ring[(i + 1) % ring.length]]));

  // Cut every segment where others cross or touch it; keep the pieces with the merged region on
  // their left only (its boundary), directed so the region stays on the left.
  const boundary = new Map<string, [Vec2, Vec2]>();
  const key = (p: Vec2) => `${Math.round(p[0] / TOL)},${Math.round(p[1] / TOL)}`;
  for (const [a, b] of segments) {
    const cuts: Vec2[] = [a, b];
    for (const [c, d] of segments) for (const p of intersectSegments(a, b, c, d)) if (!cuts.some((q) => dist2(p, q) <= TOL)) cuts.push(p);
    cuts.sort((p, q) => closestOnSegment(p, a, b).t - closestOnSegment(q, a, b).t);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [p, q] = [cuts[i], cuts[i + 1]];
      const len = dist2(p, q);
      if (len <= TOL) continue;
      const eps = Math.min(len / 4, 1e-3 * Math.max(1, len), 0.05);
      const mid: Vec2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const left: Vec2 = [mid[0] - ((q[1] - p[1]) / len) * eps, mid[1] + ((q[0] - p[0]) / len) * eps];
      const right: Vec2 = [mid[0] + ((q[1] - p[1]) / len) * eps, mid[1] - ((q[0] - p[0]) / len) * eps];
      const inLeft = covered(left);
      if (inLeft === covered(right)) continue;
      const piece: [Vec2, Vec2] = inLeft ? [p, q] : [q, p];
      boundary.set(`${key(piece[0])}>${key(piece[1])}`, piece);
    }
  }
  if (boundary.size === 0) throw new MergeError('Those faces cover no area together');

  const released: HalfEdgeId[] = faces.flatMap((f) => model.faceHalfEdges(f));
  for (const f of faces) model.removeFace(f);
  const vertex = (p: Vec2) => model.vertexAt(fromPlane2D(plane, p));
  const edges = [...boundary.values()].map(([p, q]) => [vertex(p), vertex(q)] as const).filter(([a, b]) => a !== b);
  const pos2 = (v: VertexId) => toPlane2D(plane, model.pos(v));
  const { faces: rings } = assembleFaces(traceLoops(edges, pos2), pos2);
  const merged = rings.map((r, i) => model.addFace(r.outer, r.holes, { normal, id: i === 0 ? faces[0] : undefined, material }));
  model.purgeFree(released);
  const touched = new Set<VertexId>(merged.flatMap((f) => model.faceVertexLoops(f).flat()));
  removeCollinearVertices(model, touched);
  return merged.filter((f) => model.faces.has(f));
}
