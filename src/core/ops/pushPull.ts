import { booleanInPlace, booleanKernelReady, manifoldVolume } from '../boolean/manifold';
import { facesPressed } from '../check/solid';
import { offsetPlane, planesCoincide, toPlane2D } from '../math/plane';
import { interiorPoint, intersectSegments, pointInRegion, type Vec2 } from '../math/polygon2d';
import { ANGLE_TOL, TOL } from '../math/tolerance';
import { add, dot, length, scale, sub, type Vec3 } from '../math/vec3';
import { Model, type CurveId, type FaceId, type HalfEdgeId, type VertexId } from '../model/Model';
import { findFaceAt } from '../model/query';
import { facesCoplanar, mergeCoplanarFaces, mergeFaces, onCircle, removeCollinearVertices, retagCurves, type CurveCandidate } from './cleanup';
import { drawEdges } from './edges';
import { imprintSegments, type ImprintSegment } from './imprint';
import { unifySolids } from './mergeShapes';
import { BendError, transformVertices, translation } from './transform';

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
 * A face that ends up level with a neighbouring face merges with it, as walls that line up do.
 * With `newStart` (Ctrl, SketchUp's "new starting face"), the new side walls stay separate faces:
 * an edge loop is left where the face was instead of the walls merging with the neighbouring
 * faces they line up with (stacking floors, for example), and a face pushed level keeps its edges.
 */
export function pushPull(model: Model, faceId: FaceId, distance: number, opts: { newStart?: boolean } = {}): PushPullResult {
  if (Math.abs(distance) <= TOL) return { mode: 'none', face: faceId, faces: [] };
  const shell = model.connectedFaces(faceId);
  if (!model.isClosed(shell)) return joinPressedSolids(model, extrudeOpenFace(model, faceId, distance, opts));
  if (distance < 0) {
    const flush = tryFlushPushThrough(model, faceId, distance, shell);
    if (flush) return flush;
  }
  if (!opts.newStart || distance < 0) return booleanPushPull(model, faceId, distance, shell, !opts.newStart);
  // A new starting face on a solid: an ordinary pull (so whatever the new part touches is joined
  // properly), then the face's old outline drawn back where it shows, like lines drawn by hand.
  const outline = outlineSegments(model, faceId);
  const result = booleanPushPull(model, faceId, distance, shell, false);
  redrawOutline(model, outline);
  return result;
}

/**
 * A free-standing face pushed out alongside a solid it touches (a shape drawn against a solid's
 * edge, pushed out as deep as the solid) would leave two solids pressed face to face, with faces
 * back to back inside them. They are joined into one solid instead, as Merge Shapes would join them.
 * Solids touching only along an edge or at a point stay apart (see "touching parts").
 */
function joinPressedSolids(model: Model, result: PushPullResult): PushPullResult {
  if (result.mode !== 'extrude' || result.face === undefined || !model.faces.has(result.face)) return result;
  const prism = model.connectedFaces(result.face, false);
  if (!model.isClosed(prism)) return result;
  const pressed = new Set<FaceId>();
  for (const f of model.faces.keys()) {
    if (!prism.has(f) && !pressed.has(f) && [...prism].some((p) => facesPressed(model, p, f))) {
      const part = model.connectedFaces(f, false);
      if (model.isClosed(part)) for (const g of part) pressed.add(g);
    }
  }
  if (!pressed.size) return result;
  const parts: Set<FaceId>[] = [];
  for (const f of pressed) if (!parts.some((p) => p.has(f))) parts.push(model.connectedFaces(f, false));
  const faces = unifySolids(model, [prism, ...parts]);
  return { mode: 'extrude', face: model.faces.has(result.face) ? result.face : undefined, faces };
}

type OutlineSegment = { a: Vec3; b: Vec3; curve: CurveId | null };

/** The edges around a face, as positions (with their true-curve tags). */
function outlineSegments(model: Model, faceId: FaceId): OutlineSegment[] {
  return model.faceVertexLoops(faceId).flatMap((ring) =>
    ring.map((v, i) => {
      const w = ring[(i + 1) % ring.length];
      return { a: model.pos(v), b: model.pos(w), curve: model.he(model.halfEdgeBetween(v, w)!).curve };
    }),
  );
}

/** Draw outline segments that lie on a face now (not those inside the solid, or already edges). */
function redrawOutline(model: Model, segments: OutlineSegment[]): void {
  for (const s of segments) {
    const va = model.findVertex(s.a);
    const vb = model.findVertex(s.b);
    if (va !== undefined && vb !== undefined && model.halfEdgeBetween(va, vb) !== undefined) continue;
    if (findFaceAt(model, scale(add(s.a, s.b), 0.5)) === undefined) continue;
    const curve = s.curve !== null && model.curves.has(s.curve) ? s.curve : null;
    drawEdges(model, [s.a, s.b], { curve });
  }
}

/**
 * Extrude a free-standing face into a solid: base (original, reversed), side walls, and the cap,
 * which keeps the face id. A negative distance extrudes behind the face.
 */
export function extrudeOpenFace(model: Model, faceId: FaceId, distance: number, opts: { newStart?: boolean } = {}): PushPullResult {
  if (model.adjacentFaces(faceId).size > 0) return extrudeAttachedFace(model, faceId, distance, opts.newStart ?? false);
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
 * gets a bump (or a dent). Walls that line up with neighbouring faces merge into them, unless
 * `keepEdges` (a new starting face).
 */
function extrudeAttachedFace(model: Model, faceId: FaceId, distance: number, keepEdges: boolean): PushPullResult {
  if (!keepEdges) {
    const retracted = retractBump(model, faceId, distance);
    if (retracted) return retracted;
  }
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
  if (keepEdges) return { mode: 'extrude', face: cap, faces: [...walls, cap] };
  const touched = new Set<VertexId>();
  mergeCoplanarFaces(model, walls, touched);
  const face = mergeLevelOutline(model, cap, touched);
  removeCollinearVertices(model, touched);
  return { mode: 'extrude', face, faces: [...walls, cap].filter((f) => model.faces.has(f)) };
}

/**
 * Pushing a bump (or dent) of an open surface back the way it came, as SketchUp does: its walls
 * shorten instead of new walls folding back over them. Pushed all the way back, the walls go and
 * the face joins the surface again; pushed further, the bump carries on into a dent. Applies when
 * every corner of the face has an edge running straight back along the push and every edge of
 * the face borders a wall reaching back along those edges; null otherwise.
 */
function retractBump(model: Model, faceId: FaceId, d: number): PushPullResult | null {
  const n = model.face(faceId).normal;
  const along = scale(n, Math.sign(d));
  const rings = model.faceVertexLoops(faceId);
  const partner = new Map<VertexId, VertexId>();
  let depth = Infinity;
  let deepest = 0;
  for (const v of rings.flat()) {
    for (const h of model.outgoing(v)) {
      const e = sub(model.pos(model.dest(h)), model.pos(v));
      const len = length(e);
      if (len <= TOL || dot(e, along) < len - TOL) continue;
      partner.set(v, model.dest(h));
      depth = Math.min(depth, len);
      deepest = Math.max(deepest, len);
      break;
    }
    if (!partner.has(v)) return null;
  }
  const walls = new Set<FaceId>();
  for (const h of model.faceHalfEdges(faceId)) {
    const wall = model.faceOf(model.he(h).twin);
    if (wall === null) return null;
    const corners = new Set(model.faceVertexLoops(wall).flat());
    if (!corners.has(partner.get(model.he(h).origin)!) || !corners.has(partner.get(model.dest(h))!)) return null;
    walls.add(wall);
  }

  const dist = Math.abs(d);
  if (dist < depth - TOL) {
    try {
      transformVertices(model, new Set(partner.keys()), translation(scale(n, d)));
    } catch (err) {
      if (err instanceof BendError) return null;
      throw err;
    }
    return { mode: 'extrude', face: faceId, faces: [faceId] };
  }

  // All the way back: the walls must be just the strips between the face and where it was.
  if (deepest - depth > TOL) return null;
  const allowed = new Set([...partner.keys(), ...partner.values()]);
  for (const w of walls) if (!model.faceVertexLoops(w).flat().every((v) => allowed.has(v))) return null;
  const released = [faceId, ...walls].flatMap((f) => model.faceHalfEdges(f));
  const material = model.face(faceId).material;
  model.removeFace(faceId);
  for (const w of walls) model.removeFace(w);
  const back = (r: VertexId[]) => r.map((v) => partner.get(v)!);
  model.addFace(back(rings[0]), rings.slice(1).map(back), { normal: n, id: faceId, material });
  model.purgeFree(released);
  if (dist - depth > TOL) return extrudeAttachedFace(model, faceId, Math.sign(d) * (dist - depth), false);
  const touched = new Set<VertexId>(partner.values());
  const face = mergeLevelOutline(model, faceId, touched);
  removeCollinearVertices(model, touched);
  return { mode: 'extrude', face, faces: [] };
}

/**
 * Remove the edges of a face's outline that now lie flat between two level faces (it was pushed
 * level with its neighbours), merging the faces on each side. Other edges are left alone, so
 * lines drawn on purpose elsewhere stay. Returns the face if it is still separate.
 */
function mergeLevelOutline(model: Model, faceId: FaceId, touched: Set<VertexId>): FaceId | undefined {
  const outline = model.faceHalfEdges(faceId).map((h) => [model.he(h).origin, model.dest(h)] as const);
  for (const [a, b] of outline) {
    if (!model.vertices.has(a) || !model.vertices.has(b)) continue;
    const h = model.halfEdgeBetween(a, b);
    if (h === undefined) continue;
    const f = model.faceOf(h);
    const g = model.faceOf(model.he(h).twin);
    if (f === null || g === null || f === g || !facesCoplanar(model, f, g)) continue;
    mergeFaces(model, f, g, f === faceId ? g : f, touched);
  }
  return model.faces.has(faceId) ? faceId : undefined;
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

function booleanPushPull(model: Model, faceId: FaceId, d: number, shell: Set<FaceId>, mergeCap: boolean): PushPullResult {
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
  // A face pushed level with a neighbour (a step pulled up to the next one) joins it, unless Ctrl.
  if (face !== undefined && mergeCap) face = mergeLevelOutline(model, face, touched);
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
  const { normal, material } = model.face(from);
  model.removeFace(from);
  model.addFace(rings[0], rings.slice(1), { normal, id: to, material });
}

export { retagCurves, type CurveCandidate };
