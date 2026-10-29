import { booleanInPlace, booleanKernelReady, manifoldVolume } from '../boolean/manifold';
import { offsetPlane, planesCoincide, toPlane2D } from '../math/plane';
import { interiorPoint, intersectSegments, pointInRegion, type Vec2 } from '../math/polygon2d';
import { ANGLE_TOL, TOL } from '../math/tolerance';
import { add, dot, scale, type Vec3 } from '../math/vec3';
import { Model, type CurveId, type FaceId, type HalfEdgeId, type VertexId } from '../model/Model';
import { mergeCoplanarFaces, onCircle, removeCollinearVertices } from './cleanup';
import { imprintSegments, type ImprintSegment } from './imprint';

export type PushPullMode = 'none' | 'extrude' | 'flush-through' | 'boolean';

export interface PushPullResult {
  mode: PushPullMode;
  /** The pushed face at its new position (same id as the input face), if it still exists. */
  face: FaceId | undefined;
  /** Faces created by the operation. */
  faces: FaceId[];
}

/** How far a cutting tool reaches past a face into empty space, to avoid exactly coplanar booleans. */
const OVERSHOOT = 0.01;

/**
 * Push or pull a face along its normal by `distance` (positive = outward).
 * - A face on its own becomes a solid (the original face stays as the base).
 * - A face that is part of an open surface moves out with side walls, bumping the surface.
 * - On a closed solid, pulling out adds material and pushing in removes it. If a push lands exactly
 *   on an opposite face of the solid, both faces are removed and the side walls kept (a through-hole);
 *   otherwise Manifold computes the boolean, so cuts follow whatever the solid looks like.
 */
export function pushPull(model: Model, faceId: FaceId, distance: number): PushPullResult {
  if (Math.abs(distance) <= TOL) return { mode: 'none', face: faceId, faces: [] };
  const shell = model.connectedFaces(faceId);
  if (!model.isClosed(shell)) return extrudeOpenFace(model, faceId, distance);
  if (distance < 0) {
    const flush = tryFlushPushThrough(model, faceId, distance, shell);
    if (flush) return flush;
  }
  return booleanPushPull(model, faceId, distance, shell);
}

/**
 * Extrude a free-standing face into a solid: base (original, reversed), side walls, and the cap,
 * which keeps the face id. A negative distance extrudes behind the face.
 */
export function extrudeOpenFace(model: Model, faceId: FaceId, distance: number): PushPullResult {
  if (model.adjacentFaces(faceId).size > 0) return extrudeAttachedFace(model, faceId, distance);
  if (distance < 0) {
    model.flipFace(faceId);
    distance = -distance;
  }
  const n = model.face(faceId).normal;
  const rings = model.faceVertexLoops(faceId);
  const edgeCurves = ringEdgeCurves(model, rings);
  const top = new Map<VertexId, VertexId>();
  for (const v of rings.flat()) top.set(v, model.addVertex(add(model.pos(v), scale(n, distance))));
  const lift = (r: VertexId[]) => r.map((v) => top.get(v)!);

  model.removeFace(faceId);
  const base = model.addFace([...rings[0]].reverse(), rings.slice(1).map((r) => [...r].reverse()), { normal: scale(n, -1) });
  const walls = buildWalls(model, rings, top);
  const cap = model.addFace(lift(rings[0]), rings.slice(1).map(lift), { normal: n, id: faceId });
  tagOffsetCurves(model, edgeCurves, top, n, distance);
  return { mode: 'extrude', face: cap, faces: [base, ...walls, cap] };
}

/**
 * Push/pull a face that is joined to other faces of an open surface (one half of a split sheet,
 * a rectangle drawn inside a bigger face, the floor of an open box), as SketchUp does: the face
 * moves and side walls join it to where it was, with no new face left behind, so the surface
 * gets a bump (or a dent). Walls that line up with neighbouring faces merge into them.
 */
function extrudeAttachedFace(model: Model, faceId: FaceId, distance: number): PushPullResult {
  const n = model.face(faceId).normal;
  const rings = model.faceVertexLoops(faceId);
  const edgeCurves = ringEdgeCurves(model, rings);
  const top = new Map<VertexId, VertexId>();
  for (const v of rings.flat()) top.set(v, model.addVertex(add(model.pos(v), scale(n, distance))));
  const lift = (r: VertexId[]) => r.map((v) => top.get(v)!);

  model.removeFace(faceId);
  // Each wall takes over the directed edge the face used, so it joins the neighbour across it.
  const walls = buildWalls(model, rings, top);
  const cap = model.addFace(lift(rings[0]), rings.slice(1).map(lift), { normal: n, id: faceId });
  tagOffsetCurves(model, edgeCurves, top, n, distance);
  const touched = new Set<VertexId>();
  mergeCoplanarFaces(model, walls, touched);
  removeCollinearVertices(model, touched);
  return { mode: 'extrude', face: cap, faces: [...walls.filter((w) => model.faces.has(w)), cap] };
}

function buildWalls(model: Model, rings: VertexId[][], top: Map<VertexId, VertexId>): FaceId[] {
  const walls: FaceId[] = [];
  for (const ring of rings) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      walls.push(model.addFace([a, b, top.get(b)!, top.get(a)!]));
    });
  }
  return walls;
}

type EdgeCurve = { a: VertexId; b: VertexId; curve: CurveId };

function ringEdgeCurves(model: Model, rings: VertexId[][]): EdgeCurve[] {
  const out: EdgeCurve[] = [];
  for (const ring of rings) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const curve = model.he(model.halfEdgeBetween(a, b)!).curve;
      if (curve !== null) out.push({ a, b, curve });
    });
  }
  return out;
}

/** Copy curve tags from base edges to their offset copies, creating offset circles as needed. */
function tagOffsetCurves(model: Model, edgeCurves: EdgeCurve[], top: Map<VertexId, VertexId>, n: Vec3, d: number): void {
  const offsetCurve = new Map<CurveId, CurveId>();
  for (const { a, b, curve } of edgeCurves) {
    let c = offsetCurve.get(curve);
    if (c === undefined) {
      const src = model.curves.get(curve)!;
      c = model.addCurve({ ...src, center: add(src.center, scale(n, d)) });
      offsetCurve.set(curve, c);
    }
    model.setEdgeCurve(top.get(a)!, top.get(b)!, c);
  }
}

/** Positions of the face's rings moved along its normal. */
function offsetRings(model: Model, faceId: FaceId, d: number): Vec3[][] {
  const n = model.face(faceId).normal;
  return model.faceVertexLoops(faceId).map((r) => r.map((v) => add(model.pos(v), scale(n, d))));
}

/** A closed prism in a scratch model: the face's outline swept from `start` to `end` along its normal. */
function buildPrism(model: Model, faceId: FaceId, start: number, end: number): { scratch: Model; cap: FaceId } {
  const scratch = new Model();
  const ids = offsetRings(model, faceId, start).map((r) => r.map((p) => scratch.addVertex(p)));
  const base = scratch.addFace(ids[0], ids.slice(1), { normal: model.face(faceId).normal });
  const { face } = extrudeOpenFace(scratch, base, end - start);
  return { scratch, cap: face! };
}

/**
 * Flush push-through: the pushed face lands exactly on a coplanar, opposite-facing face of the same
 * solid and fits strictly inside it. Imprint the outline there, delete the landing area and the
 * pushed face, and connect the two openings with side walls.
 */
function tryFlushPushThrough(model: Model, faceId: FaceId, d: number, shell: Set<FaceId>): PushPullResult | null {
  const face = model.face(faceId);
  const n = face.normal;
  const capPlane = offsetPlane(model.facePlane(faceId), d);
  const rings = model.faceVertexLoops(faceId);
  const cap3 = offsetRings(model, faceId, d);

  for (const g of shell) {
    if (g === faceId || dot(model.face(g).normal, n) > -1 + ANGLE_TOL) continue;
    const gPlane = model.facePlane(g);
    if (!planesCoincide(gPlane, capPlane)) continue;
    const g2 = model.faceVertexLoops(g).map((r) => r.map((v) => toPlane2D(gPlane, model.pos(v))));
    const cap2 = cap3.map((r) => r.map((p) => toPlane2D(gPlane, p)));
    if (!ringsStrictlyInside(cap2, g2)) continue;
    if (booleanKernelReady() && !prismInsideSolid(model, faceId, d, shell)) return null;

    const edgeCurves = ringEdgeCurves(model, rings);
    const curveOf = new Map(edgeCurves.map((e) => [`${e.a}>${e.b}`, e.curve]));
    const offsetCurve = new Map<CurveId, CurveId>();
    const segments: ImprintSegment[] = [];
    rings.forEach((ring, ri) => {
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        const src = curveOf.get(`${a}>${b}`);
        let curve: CurveId | null = null;
        if (src !== undefined) {
          if (!offsetCurve.has(src)) {
            const c = model.curves.get(src)!;
            offsetCurve.set(src, model.addCurve({ ...c, center: add(c.center, scale(n, d)) }));
          }
          curve = offsetCurve.get(src)!;
        }
        segments.push({ a: cap3[ri][i], b: cap3[ri][(i + 1) % ring.length], curve });
      });
    });

    const pieces = imprintSegments(model, g, segments);
    const released: HalfEdgeId[] = model.faceHalfEdges(faceId);
    for (const piece of pieces) {
      const pr = model.faceVertexLoops(piece).map((r) => r.map((v) => toPlane2D(gPlane, model.pos(v))));
      if (pointInRegion(interiorPoint(pr[0], pr.slice(1)), cap2[0], cap2.slice(1)) === 'inside') {
        released.push(...model.faceHalfEdges(piece));
        model.removeFace(piece);
      }
    }
    const top = new Map<VertexId, VertexId>();
    rings.forEach((ring, ri) =>
      ring.forEach((v, i) => {
        const w = model.findVertex(cap3[ri][i]);
        if (w === undefined) throw new Error('Flush push-through lost a cap vertex');
        top.set(v, w);
      }),
    );
    model.removeFace(faceId);
    const walls = buildWalls(model, rings, top);
    model.purgeFree(released);
    return { mode: 'flush-through', face: undefined, faces: walls };
  }
  return null;
}

/** Every ring point strictly inside the region and no edges crossing its boundary. */
function ringsStrictlyInside(rings: Vec2[][], region: Vec2[][]): boolean {
  for (const ring of rings) {
    if (ring.some((p) => pointInRegion(p, region[0], region.slice(1)) !== 'inside')) return false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      for (const r of region) {
        for (let j = 0; j < r.length; j++) if (intersectSegments(a, b, r[j], r[(j + 1) % r.length]).length) return false;
      }
    }
  }
  return true;
}

/** The swept volume lies entirely in the solid (nothing else is crossed on the way). */
function prismInsideSolid(model: Model, faceId: FaceId, d: number, shell: Set<FaceId>): boolean {
  const { scratch } = buildPrism(model, faceId, 0, d);
  const prism = { model: scratch, faces: [...scratch.faces.keys()] };
  const full = manifoldVolume(null, prism);
  const inside = manifoldVolume('intersect', { model, faces: shell }, prism);
  return Math.abs(full - inside) <= 1e-6 * Math.max(1, full);
}

function booleanPushPull(model: Model, faceId: FaceId, d: number, shell: Set<FaceId>): PushPullResult {
  const n = model.face(faceId).normal;
  let start = 0;
  let end = d;
  if (d < 0) {
    // Start the cutter just outside the face, and run it past a far face it lands on exactly.
    start = OVERSHOOT;
    const capPlane = offsetPlane(model.facePlane(faceId), d);
    const landsOnFarFace = [...shell].some((g) => dot(model.face(g).normal, n) < -1 + ANGLE_TOL && planesCoincide(model.facePlane(g), capPlane));
    if (landsOnFarFace) end = d - OVERSHOOT;
  }
  const shellCurves = [...shell].flatMap((f) => model.faceHalfEdges(f).map((h) => model.he(h).curve));
  const curves = [...new Set(shellCurves.filter((c): c is CurveId => c !== null))].map((c) => model.curves.get(c)!);
  // Circles of the pushed face, moved to where the cap (boss top or pocket floor) will be.
  const faceCurves = new Set(ringEdgeCurves(model, model.faceVertexLoops(faceId)).map((e) => e.curve));
  const capCurves: CurveCandidate[] = [...faceCurves].map((c) => {
    const src = model.curves.get(c)!;
    return { ...src, center: add(src.center, scale(n, d)), scratch: true };
  });
  const { scratch, cap } = buildPrism(model, faceId, start, end);

  const result = booleanInPlace(model, shell, { model: scratch, faces: [...scratch.faces.keys()] }, d > 0 ? 'union' : 'subtract');

  // The moved face (cap of the prism) takes over the pushed face's id.
  const capId = result.toolFaceIds.get(cap);
  let face: FaceId | undefined;
  if (capId !== undefined && model.faces.has(capId) && !model.faces.has(faceId)) {
    renameFace(model, capId, faceId);
    face = faceId;
  }
  const toolFaces = [...result.toolFaceIds.values()].filter((f) => f !== capId && model.faces.has(f));
  const touched = new Set<VertexId>(result.newVertices);
  mergeCoplanarFaces(model, toolFaces, touched);
  removeCollinearVertices(model, touched);

  const live = new Set<FaceId>();
  for (const f of [...result.faces, ...(face === undefined ? [] : [face])]) {
    if (model.faces.has(f) && !live.has(f)) for (const g of model.connectedFaces(f)) live.add(g);
  }
  retagCurves(model, live, [...curves, ...capCurves]);
  return { mode: 'boolean', face, faces: [...live].filter((f) => !shell.has(f) || f === face) };
}

function renameFace(model: Model, from: FaceId, to: FaceId): void {
  const rings = model.faceVertexLoops(from);
  const normal = model.face(from).normal;
  model.removeFace(from);
  model.addFace(rings[0], rings.slice(1), { normal, id: to });
}

type CurveCandidate = { id: CurveId; center: Vec3; normal: Vec3; radius: number; segments: number; kind: 'circle'; scratch?: true };

/**
 * After a boolean, put true-curve tags back on edges that are segments of a known circle
 * (both ends on the circle and the chord length of one segment). Circles that came from the
 * scratch prism are added to the model the first time an edge matches them.
 */
function retagCurves(model: Model, faces: Set<FaceId>, candidates: CurveCandidate[]): void {
  const adopted = new Map<CurveCandidate, CurveId>();
  for (const f of faces) {
    for (const h of model.faceHalfEdges(f)) {
      const he = model.he(h);
      if (he.curve !== null || h > he.twin) continue;
      const a = model.pos(he.origin);
      const b = model.pos(model.dest(h));
      const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const c = candidates.find(
        (c) => onCircle(a, c) && onCircle(b, c) && Math.abs(len - 2 * c.radius * Math.sin(Math.PI / c.segments)) <= TOL * 10,
      );
      if (!c) continue;
      let id = c.scratch ? adopted.get(c) : c.id;
      if (id === undefined) {
        id = model.addCurve({ kind: 'circle', center: c.center, normal: c.normal, radius: c.radius, segments: c.segments });
        adopted.set(c, id);
      }
      model.setEdgeCurve(he.origin, model.dest(h), id);
    }
  }
}
