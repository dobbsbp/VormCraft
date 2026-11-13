import { booleanInPlace, manifoldVolume } from '../boolean/manifold';
import { volume } from '../check/measure';
import { facesPressed } from '../check/solid';
import { makePlane, type Plane } from '../math/plane';
import { TOL } from '../math/tolerance';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';
import { Model, type CircleCurve, type CurveId, type FaceId, type HalfEdgeId, type VertexId } from '../model/Model';
import { mergeCoplanarFaces, onCircle, removeCollinearVertices } from './cleanup';
import { extractGeometry } from './group';
import { unifySolids } from './mergeShapes';
import { edgeChain } from './offsetEdges';
import { reverseFaces } from './orient';
import { retagCurves, type CurveCandidate } from './pushPull';

/** How far a cutting sweep reaches past its ends, to avoid exactly coplanar booleans. */
const OVERSHOOT = 0.01;

export type FollowMeMode = 'solid' | 'attached' | 'boolean';

export interface FollowMeResult {
  /**
   * 'solid': a free-standing profile became a new solid. 'attached': a profile that is part of an
   * open surface was swept out of it. 'boolean': a profile on a solid cut into it (or added to it).
   */
  mode: FollowMeMode;
  /** Faces created by the sweep. */
  faces: FaceId[];
}

type CircleSpec = Omit<CircleCurve, 'id'>;

/** Rotate v by the smallest rotation taking unit vector `from` to unit vector `to`. */
function rotateMinimal(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = length(axis);
  const c = dot(from, to);
  if (s < 1e-12) return v; // parallel (a path doubling back is refused earlier)
  const k = scale(axis, 1 / s);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** The sweep of a profile along a path: the profile's ring points at every path vertex. */
interface Sweep {
  closed: boolean;
  /** stages[j][ring][k]: where profile point k of each ring lands at path vertex j. */
  stages: Vec3[][][];
  /** Direction of the path segment leaving each path vertex (closed: the last wraps round). */
  dirs: Vec3[];
  /** The curve of each path segment, if it is part of an arc. */
  segCurves: (CircleCurve | null)[];
  /** True where the path vertex lies inside an arc (both neighbouring segments on the same curve). */
  smoothStage: boolean[];
  /** Maps a point at the start of the path rigidly to the end (open paths). */
  transport: (p: Vec3) => Vec3;
  /** The same rotation, for directions. */
  rotate: (v: Vec3) => Vec3;
}

/** A point carried along direction d until it meets the plane. */
function along(p: Vec3, d: Vec3, plane: Plane): Vec3 {
  const den = dot(d, plane.normal);
  if (Math.abs(den) < 1e-9) throw new Error('The path turns too sharply for this profile');
  return add(p, scale(d, dot(sub(plane.origin, p), plane.normal) / den));
}

/**
 * Carry the profile rings along the path with mitred corners: at each path vertex the profile is
 * cut by the plane halving the turn; an open path ends on the profile's plane carried rigidly to
 * the path's end. `rings` must face along the path (their normal `n` points the way it runs).
 */
function computeSweep(model: Model, rings: Vec3[][], n: Vec3, path: VertexId[], closed: boolean): Sweep {
  const pts = path.map((v) => model.pos(v));
  const segs = closed ? pts.length : pts.length - 1;
  const dirs: Vec3[] = [];
  const segCurves: (CircleCurve | null)[] = [];
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % pts.length;
    dirs.push(normalize(sub(pts[j], pts[i])));
    const c = model.he(model.halfEdgeBetween(path[i], path[j])!).curve;
    segCurves.push(c === null ? null : (model.curves.get(c) ?? null));
  }
  // Across the path, not along it: a profile turned more than about 75° from facing along the path
  // would sweep into a paper-thin shape.
  if (Math.abs(dot(n, dirs[0])) < 0.25) {
    throw new Error('The profile lies along the path instead of across it. Draw it standing across the start of the path, facing along it (press → or ← while drawing to stand it upright), then try again.');
  }
  const miter = (j: number): Plane => {
    const m = add(dirs[(j - 1 + segs) % segs], dirs[j]);
    if (length(m) < 1e-9) throw new Error('The path doubles back on itself');
    return makePlane(pts[j], normalize(m));
  };
  const carry = (stage: Vec3[][], d: Vec3, plane: Plane) => stage.map((r) => r.map((p) => along(p, d, plane)));
  const stages: Vec3[][][] = [];
  if (closed) {
    stages.push(carry(rings, dirs[0], miter(0)));
    for (let j = 1; j < pts.length; j++) stages.push(carry(stages[j - 1], dirs[j - 1], miter(j)));
  } else {
    stages.push(rings);
    for (let j = 1; j < pts.length - 1; j++) stages.push(carry(stages[j - 1], dirs[j - 1], miter(j)));
  }
  const rotate = (v: Vec3) => dirs.slice(1).reduce((acc, d, i) => rotateMinimal(acc, dirs[i], d), v);
  const transport = (p: Vec3) => add(pts[pts.length - 1], rotate(sub(p, pts[0])));
  if (!closed) {
    const end = makePlane(transport(rings[0][0]), rotate(n));
    stages.push(carry(stages[stages.length - 1], dirs[segs - 1], end));
  }
  // Every point of the profile must go forward along each step of the path (or stay put, on the
  // axis of a lathe). One going backwards means the profile reaches past the middle of a bend, so
  // the sweep would fold over itself (typically the path and profile picked the wrong way round).
  const steps = closed ? [...stages.keys()].map((j) => [j, (j + 1) % stages.length]) : [...stages.keys()].slice(1).map((j) => [j - 1, j]);
  for (const [a, b] of steps) {
    const d = dirs[a % segs];
    if (stages[a].some((r, i) => r.some((p, k) => dot(sub(stages[b][i][k], p), d) < -TOL))) {
      throw new Error(
        'The profile is bigger than the bend of the path, so the sweep would fold over itself. Did you pick them the wrong way round? Select the path first (e.g. the big circle), then click the profile (e.g. a small circle standing upright on its edge).',
      );
    }
  }
  // Seams inside an arc of the path are smooth, and so are seams where a straight part runs on
  // into an arc (or one arc into another) without a corner: the turn there is no more than one
  // segment of the arc. Real corners stay sharp (mitres).
  const smoothStage = pts.map((_, j) => {
    if (!closed && (j === 0 || j === pts.length - 1)) return false;
    const a = segCurves[(j - 1 + segs) % segs];
    const b = segCurves[j];
    if (a !== null && a === b) return true;
    if (a === null && b === null) return false;
    const step = Math.max(...[a, b].filter((c): c is CircleCurve => c !== null).map((c) => (2 * Math.PI) / c.segments));
    const turn = Math.acos(Math.min(1, Math.max(-1, dot(dirs[(j - 1 + segs) % segs], dirs[j]))));
    return turn <= step * 0.75 + 1e-9;
  });
  return { closed, stages, dirs, segCurves, smoothStage, transport, rotate };
}

/** Drop repeated vertices (a profile point on the axis of a turn stays put), cyclically. */
function distinctRing(ids: VertexId[]): VertexId[] {
  return ids.filter((v, i) => v !== ids[(i + 1) % ids.length]);
}

interface BuildOptions {
  /** Vertex ids for stage 0 (the profile's own vertices), or undefined to make new ones. */
  startIds?: VertexId[][];
  base: boolean;
  /** Profile curve tags per ring edge (k → k+1), copied to the start (when new) and the end cap. */
  profileCurves: (CircleSpec | null)[][];
  /** Id to give the base face. */
  baseId?: FaceId;
}

/** Add the sweep's faces to `target`: optional base (the profile, reversed), walls, and end cap. */
function buildSweep(target: Model, sweep: Sweep, n: Vec3, opts: BuildOptions): FaceId[] {
  const { stages, closed } = sweep;
  const ids: VertexId[][][] = [];
  stages.forEach((stage, j) => {
    ids.push(
      stage.map((ring, r) =>
        ring.map((p, k) => {
          if (j === 0 && opts.startIds) return opts.startIds[r][k];
          const prev = j > 0 ? ids[j - 1][r][k] : undefined;
          return prev !== undefined && distance(target.pos(prev), p) <= TOL ? prev : target.addVertex(p);
        }),
      ),
    );
  });
  const faces: FaceId[] = [];
  const last = stages.length - 1;
  if (opts.base) faces.push(target.addFace([...ids[0][0]].reverse(), ids[0].slice(1).map((r) => [...r].reverse()), { normal: scale(n, -1), id: opts.baseId }));

  const spans = closed ? stages.length : stages.length - 1;
  for (let j = 0; j < spans; j++) {
    const A = ids[j];
    const B = ids[(j + 1) % stages.length];
    A.forEach((ring, r) =>
      ring.forEach((a, k) => {
        const k2 = (k + 1) % ring.length;
        const quad = distinctRing([a, ring[k2], B[r][k2], B[r][k]]);
        if (quad.length >= 3) faces.push(target.addFace(quad));
      }),
    );
  }
  if (!closed) faces.push(target.addFace(ids[last][0], ids[last].slice(1), { normal: sweep.rotate(n) }));

  // Curve tags: each profile point turns about the axis of an arc in the path.
  const turns = new Map<string, CurveId>();
  for (let j = 0; j < spans; j++) {
    const c = sweep.segCurves[j];
    if (!c) continue;
    stages[j].forEach((ring, r) =>
      ring.forEach((p, k) => {
        const a = ids[j][r][k];
        const b = ids[(j + 1) % stages.length][r][k];
        if (a === b) return;
        const centre = add(c.center, scale(c.normal, dot(sub(p, c.center), c.normal)));
        const radius = distance(p, centre);
        if (radius <= TOL) return;
        const key = `${c.id}:${r}:${k}`;
        if (!turns.has(key)) turns.set(key, target.addCurve({ kind: 'circle', center: centre, normal: c.normal, radius, segments: c.segments }));
        target.setEdgeCurve(a, b, turns.get(key)!);
      }),
    );
  }
  // The profile's own curves: on new start vertices, and carried to the end cap.
  const tag = (stageIds: VertexId[][], move: (p: Vec3) => Vec3, rot: (v: Vec3) => Vec3) => {
    const made = new Map<CircleSpec, CurveId>();
    opts.profileCurves.forEach((ring, r) =>
      ring.forEach((spec, k) => {
        if (!spec) return;
        const circle = { ...spec, center: move(spec.center), normal: rot(spec.normal) };
        const a = stageIds[r][k];
        const b = stageIds[r][(k + 1) % ring.length];
        if (!onCircle(target.pos(a), circle) || !onCircle(target.pos(b), circle)) return;
        if (!made.has(spec)) made.set(spec, target.addCurve(circle));
        target.setEdgeCurve(a, b, made.get(spec)!);
      }),
    );
  };
  if (!opts.startIds) tag(ids[0], (p) => p, (v) => v);
  if (!closed) tag(ids[last], sweep.transport, sweep.rotate);

  // Soft seams: along the sweep where the profile is curved, across it where the path is.
  opts.profileCurves.forEach((ring, r) =>
    ring.forEach((spec, k) => {
      const before = ring[(k - 1 + ring.length) % ring.length];
      if (!spec || before !== spec) return;
      for (let j = 0; j < spans; j++) {
        const a = ids[j][r][k];
        const b = ids[(j + 1) % stages.length][r][k];
        if (a !== b) target.setEdgeSoft(a, b, true);
      }
    }),
  );
  // Across the sweep: soft inside an arc of the path, and always shown at a corner (a mitre).
  sweep.smoothStage.forEach((smooth, j) => {
    if (!closed && (j === 0 || j === stages.length - 1)) return;
    for (const ring of ids[j]) {
      ring.forEach((a, k) => {
        const b = ring[(k + 1) % ring.length];
        if (target.halfEdgeBetween(a, b) !== undefined) target.setEdgeSoft(a, b, smooth);
      });
    }
  });
  return faces;
}

/** The curve of each ring edge k → k+1 of a face (as a spec, shared per curve). */
function ringCurves(model: Model, rings: VertexId[][]): (CircleSpec | null)[][] {
  return rings.map((ring) =>
    ring.map((a, k) => {
      const c = model.he(model.halfEdgeBetween(a, ring[(k + 1) % ring.length])!).curve;
      return c === null ? null : (model.curves.get(c) ?? null);
    }),
  );
}

/**
 * Follow Me: sweep a profile face along a path of connected edges, with mitred corners, as in
 * SketchUp. The path starts at the end nearest the profile (a closed path, at the vertex nearest
 * it), so the profile is usually drawn across the start of the path.
 * - A free-standing profile becomes a new solid (consumed by a closed path, as for a lathe).
 * - A profile that is part of an open surface is swept out of it, like push/pull.
 * - A profile on a closed solid cuts the swept shape out of it (a groove or chamfer), or adds it
 *   when the sweep lies outside the solid.
 * Arcs in the path give true-curve tags on the swept edges, and curved parts of the profile or
 * the path give soft seams, so swept pipes and turned shapes look smooth.
 */
export function followMe(model: Model, profile: FaceId, pathEdges: Iterable<HalfEdgeId>): FollowMeResult {
  const own = new Set(model.faceHalfEdges(profile).flatMap((h) => [h, model.he(h).twin]));
  const path = [...pathEdges];
  const chain = edgeChain(model, path);
  // A closed path may run along one of the profile's edges (a fillet at the corner of a box's top);
  // otherwise the path must not use the profile's edges.
  if (path.some((e) => own.has(e)) && (!chain.closed || path.every((e) => own.has(e)))) throw new Error("The path can't include the profile's own edges");
  const rings = model.faceVertexLoops(profile);
  const n = model.face(profile).normal;
  const ringPos = rings.map((r) => r.map((v) => model.pos(v)));
  const flat = ringPos.flat();
  const near = (v: VertexId) => Math.min(...flat.map((q) => distance(model.pos(v), q)));

  // Orient the path: start nearest the profile, and (closed) run the way the profile faces best.
  let verts = [...chain.vertices];
  if (!chain.closed) {
    if (near(verts[verts.length - 1]) < near(verts[0]) - TOL) verts.reverse();
  } else {
    // Nearest the profile; of corners equally near (a profile touching the path at two corners),
    // the one where the path runs most squarely across the profile.
    const across = (i: number) => {
      const p = model.pos(verts[i]);
      const dir = (j: number) => Math.abs(dot(n, normalize(sub(model.pos(verts[(j + verts.length) % verts.length]), p))));
      return Math.max(dir(i + 1), dir(i - 1));
    };
    const nearest = Math.min(...verts.map(near));
    const start = verts.reduce((best, v, i) => (near(v) <= nearest + TOL && (best < 0 || across(i) > across(best) + 1e-9) ? i : best), -1);
    verts = [...verts.slice(start), ...verts.slice(0, start)];
    const fwd = Math.abs(dot(n, normalize(sub(model.pos(verts[1]), model.pos(verts[0])))));
    const back = Math.abs(dot(n, normalize(sub(model.pos(verts[verts.length - 1]), model.pos(verts[0])))));
    if (back > fwd + 1e-9) verts = [verts[0], ...verts.slice(1).reverse()];
  }
  const d0 = normalize(sub(model.pos(verts[1]), model.pos(verts[0])));
  const facing = dot(n, d0) >= 0;

  const shell = model.connectedFaces(profile);
  if (shell.size > 1 && model.isClosed(shell)) return sweepIntoSolid(model, shell, rings, ringPos, n, facing, verts, chain.closed);

  if (model.adjacentFaces(profile).size > 0) {
    // Part of an open surface (sharing edges with it; touching it at a point does not count): the walls take over the profile's edges (no base), as in push/pull.
    const sweep = computeSweep(model, ringPos, facing ? n : scale(n, -1), verts, chain.closed);
    if (chain.closed && sweep.stages[0].some((r, i) => r.some((p, k) => distance(p, ringPos[i][k]) > TOL))) {
      throw new Error('To sweep a profile out of a surface along a closed path, draw the profile across a corner of the path');
    }
    const curves = ringCurves(model, rings);
    model.removeFace(profile);
    const faces = buildSweep(model, sweep, n, { startIds: rings, base: false, profileCurves: curves });
    const touched = new Set<VertexId>();
    mergeCoplanarFaces(model, faces, touched);
    removeCollinearVertices(model, touched);
    const made = faces.filter((f) => model.faces.has(f));
    faceOutward(model, made);
    return { mode: 'attached', faces: made };
  }

  // A free-standing face: turn it to face along the path, then build the solid around it.
  if (!facing) model.flipFace(profile);
  const oriented = model.faceVertexLoops(profile);
  const on = model.face(profile).normal;
  const sweep = computeSweep(model, oriented.map((r) => r.map((v) => model.pos(v))), on, verts, chain.closed);
  const curves = ringCurves(model, oriented);
  const edges = model.faceHalfEdges(profile);
  model.removeFace(profile);
  const faces = chain.closed
    ? buildSweep(model, sweep, on, { base: false, profileCurves: curves })
    : buildSweep(model, sweep, on, { startIds: oriented, base: true, profileCurves: curves, baseId: profile });
  if (chain.closed) model.purgeFree(edges);
  // Flat parts swept from one profile edge (a dome's or a cylinder's base, round the axis) become
  // one face each, not a fan of wedges.
  const touched = new Set<VertexId>();
  const merged = [...mergeCoplanarFaces(model, faces, touched)];
  removeCollinearVertices(model, touched);
  const made = [...new Set([...faces, ...merged])].filter((f) => model.faces.has(f));
  faceOutward(model, made);
  return settleIntoSolids(model, made) ?? { mode: 'solid', faces: made };
}

/**
 * Whichever way round the path runs and whichever way the profile faces, a swept shape that closes
 * up must face outward: tools cannot join, cut or push an inside-out solid properly.
 */
function faceOutward(model: Model, faces: readonly FaceId[]): void {
  const seen = new Set<FaceId>();
  for (const f of faces) {
    if (seen.has(f) || !model.faces.has(f)) continue;
    const part = model.connectedFaces(f, false);
    for (const g of part) seen.add(g);
    if (model.isClosed(part) && volume(model, part) < 0) reverseFaces(model, part);
  }
}

/** The pairs of faces a soft seam joins, in a swept solid about to be cut into another. */
function softSeams(m: Model): [FaceId, FaceId][] {
  const out: [FaceId, FaceId][] = [];
  for (const e of m.edges()) {
    const f = m.faceOf(e);
    const g = m.faceOf(m.he(e).twin);
    if (m.he(e).soft && f !== null && g !== null) out.push([f, g]);
  }
  return out;
}

/**
 * Booleans rebuild faces and lose which seams were soft: soften again the seams between faces
 * that came from faces joined by a soft seam (a fillet's or a groove's curved surface stays smooth).
 */
function carrySoftSeams(model: Model, pairs: [FaceId, FaceId][], ids: Map<FaceId, FaceId>): void {
  for (const [f, g] of pairs) {
    const a = ids.get(f);
    const b = ids.get(g);
    if (a === undefined || b === undefined || !model.faces.has(a) || !model.faces.has(b)) continue;
    for (const h of model.faceHalfEdges(a)) if (model.faceOf(model.he(h).twin) === b) model.setEdgeSoft(model.he(h).origin, model.dest(h), true);
  }
}

/** Corners of the box around some faces. */
function facesBox(model: Model, faces: Iterable<FaceId>): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const f of faces) {
    for (const v of model.faceVertexLoops(f)[0]) {
      const p = model.pos(v);
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    }
  }
  return { min, max };
}

/**
 * A free-standing profile swept into a solid that overlaps another closed solid, or lies against
 * it face to face: drawn mostly inside that solid, the sweep is cut out of it (a groove round a
 * cylinder); otherwise it is joined on (a band, a rim). No shapes are left overlapping or pressed
 * together. Returns null when the sweep touches nothing.
 */
function settleIntoSolids(model: Model, made: FaceId[]): FollowMeResult | null {
  const sweep = new Set(made.filter((f) => model.faces.has(f)));
  if (!sweep.size || !model.isClosed(sweep)) return null;
  const size = Math.abs(volume(model, sweep));
  const box = facesBox(model, sweep);
  const others: { part: Set<FaceId>; inside: number }[] = [];
  const seen = new Set<FaceId>(sweep);
  for (const f of model.faces.keys()) {
    if (seen.has(f)) continue;
    const part = model.connectedFaces(f, false);
    for (const g of part) seen.add(g);
    if (!model.isClosed(part)) continue;
    const b = facesBox(model, part);
    if ([0, 1, 2].some((i) => b.min[i] > box.max[i] + TOL || b.max[i] < box.min[i] - TOL)) continue;
    const inside = manifoldVolume('intersect', { model, faces: part }, { model, faces: sweep });
    if (inside > 1e-6 * size || [...sweep].some((p) => [...part].some((g) => facesPressed(model, p, g)))) others.push({ part, inside });
  }
  if (!others.length) return null;
  const host = others.find((o) => o.inside >= 0.5 * size);
  if (!host) return { mode: 'boolean', faces: unifySolids(model, [sweep, ...others.map((o) => o.part)]) };
  const candidates: CurveCandidate[] = [...host.part].flatMap((f) => model.faceHalfEdges(f).map((h) => model.he(h).curve)).filter((c): c is CurveId => c !== null).map((c) => model.curves.get(c)!);
  const tool = extractGeometry(model, sweep, []);
  for (const c of tool.curves.values()) candidates.push({ ...c, scratch: true });
  const soft = softSeams(tool);
  const result = booleanInPlace(model, host.part, { model: tool, faces: [...tool.faces.keys()] }, 'subtract');
  carrySoftSeams(model, soft, result.toolFaceIds);
  const toolFaces = [...result.toolFaceIds.values()].filter((f) => model.faces.has(f));
  const touched = new Set<VertexId>(result.newVertices);
  mergeCoplanarFaces(model, toolFaces, touched);
  removeCollinearVertices(model, touched);
  const live = new Set<FaceId>();
  for (const f of result.faces) if (model.faces.has(f) && !live.has(f)) for (const g of model.connectedFaces(f)) live.add(g);
  retagCurves(model, live, candidates);
  return { mode: 'boolean', faces: [...live] };
}

/** A profile on a closed solid: build the swept solid apart, then cut it out of the solid (or add it). */
function sweepIntoSolid(model: Model, shell: Set<FaceId>, rings: VertexId[][], ringPos: Vec3[][], n: Vec3, facing: boolean, verts: VertexId[], closed: boolean): FollowMeResult {
  // Face along the path: reverse the rings when the profile faces the other way.
  const pos = facing ? ringPos : ringPos.map((r) => [...r].reverse());
  const ids = facing ? rings : rings.map((r) => [...r].reverse());
  const on = facing ? n : scale(n, -1);
  const sweep = computeSweep(model, pos, on, verts, closed);
  if (!closed) {
    // Reach a little past both ends, so the cut leaves faces it starts or ends on cleanly.
    const first = sweep.dirs[0];
    const lastDir = sweep.dirs[sweep.dirs.length - 1];
    sweep.stages[0] = sweep.stages[0].map((r) => r.map((p) => sub(p, scale(first, OVERSHOOT))));
    const e = sweep.stages.length - 1;
    sweep.stages[e] = sweep.stages[e].map((r) => r.map((p) => add(p, scale(lastDir, OVERSHOOT))));
  }
  const scratch = new Model();
  buildSweep(scratch, sweep, on, { base: !closed, profileCurves: ringCurves(model, ids) });
  const tool = { model: scratch, faces: [...scratch.faces.keys()] };
  const size = manifoldVolume(null, tool);
  const inside = manifoldVolume('intersect', { model, faces: shell }, tool);
  const candidates: CurveCandidate[] = [
    ...[...shell].flatMap((f) => model.faceHalfEdges(f).map((h) => model.he(h).curve)).filter((c): c is CurveId => c !== null),
  ].map((c) => model.curves.get(c)!);
  for (const c of scratch.curves.values()) candidates.push({ ...c, scratch: true });
  const soft = softSeams(scratch);
  const result = booleanInPlace(model, shell, tool, inside > 1e-6 * size ? 'subtract' : 'union');
  carrySoftSeams(model, soft, result.toolFaceIds);
  const toolFaces = [...result.toolFaceIds.values()].filter((f) => model.faces.has(f));
  const touched = new Set<VertexId>(result.newVertices);
  mergeCoplanarFaces(model, toolFaces, touched);
  removeCollinearVertices(model, touched);
  const live = new Set<FaceId>();
  for (const f of result.faces) if (model.faces.has(f) && !live.has(f)) for (const g of model.connectedFaces(f)) live.add(g);
  retagCurves(model, live, candidates);
  return { mode: 'boolean', faces: [...live].filter((f) => !shell.has(f)) };
}
