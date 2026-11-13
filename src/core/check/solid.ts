import { fromPlane2D, planesCoincide, toPlane2D } from '../math/plane';
import { interiorPoint, pointInRegion } from '../math/polygon2d';
import { ANGLE_TOL, TOL } from '../math/tolerance';
import { cross, dot, normalize, sub, type Vec3 } from '../math/vec3';
import type { FaceId, HalfEdgeId, Model } from '../model/Model';
import { triangulateFace } from '../triangulate';
import { volume } from './measure';

/** What a set of faces makes, as solids: the problems a person would need to fix to have solids. */
export interface SolidReport {
  /** Closed shapes (each part counted once). */
  solids: number;
  /** The volume of each closed shape (cubic millimetres; an inside-out one counts as its size). */
  volumes: number[];
  /** Closed shapes facing inwards (all their faces reversed): Reverse Faces turns them right. */
  insideOut: number;
  /** Shapes that are not closed (flat faces on their own not counted). */
  open: number;
  /** Edges of those shapes with a face on one side only. */
  openEdges: HalfEdgeId[];
  /** Flat faces or flat surfaces on their own (not meant to be solids). */
  flat: number;
  /** Faces of different shapes lying against each other, back to back (Merge Shapes joins them). */
  pressed: number;
}

/** Above this many faces the back-to-back check (every pair of faces) is skipped. */
const PRESSED_CHECK_LIMIT = 2000;

/** Two faces lying in one plane, facing each other (back to back), and covering some of the same area. */
export function facesPressed(model: Model, a: FaceId, b: FaceId): boolean {
  if (dot(model.face(a).normal, model.face(b).normal) > -1 + ANGLE_TOL) return false;
  const plane = model.facePlane(a);
  if (!planesCoincide(plane, model.facePlane(b))) return false;
  const region = (f: FaceId) => model.faceVertexLoops(f).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
  const [ra, rb] = [region(a), region(b)];
  return pointInRegion(interiorPoint(ra[0], ra.slice(1)), rb[0], rb.slice(1)) === 'inside' || pointInRegion(interiorPoint(rb[0], rb.slice(1)), ra[0], ra.slice(1)) === 'inside';
}

/**
 * Whether a point is inside a closed solid (`faces`), by counting where a ray from it crosses the
 * solid's triangles (an odd count: inside). A slanted ray avoids running along edges.
 */
export function pointInSolid(model: Model, faces: Iterable<FaceId>, p: Vec3): boolean {
  const d = normalize([0.5773, 0.5779, 0.5767]);
  let crossings = 0;
  for (const f of faces) {
    for (const [a, b, c] of triangulateFace(model, f)) {
      const [p0, p1, p2] = [model.pos(a), model.pos(b), model.pos(c)];
      const e1 = sub(p1, p0);
      const e2 = sub(p2, p0);
      const q = cross(d, e2);
      const det = dot(e1, q);
      if (Math.abs(det) < 1e-12) continue;
      const s = sub(p, p0);
      const u = dot(s, q) / det;
      if (u < 0 || u > 1) continue;
      const r = cross(s, e1);
      const v = dot(d, r) / det;
      if (v < 0 || u + v > 1) continue;
      if (dot(e2, r) / det > TOL) crossings++;
    }
  }
  return crossings % 2 === 1;
}

/**
 * Whether a flat face lies inside a closed solid or on its surface (a lathe's path face left in
 * the middle of a sphere, or under a dome's base): then it is in the way and can go.
 */
export function faceWithinSolid(model: Model, face: FaceId, solid: ReadonlySet<FaceId>): boolean {
  const plane = model.facePlane(face);
  const loops = model.faceVertexLoops(face).map((r) => r.map((v) => toPlane2D(plane, model.pos(v))));
  const p = fromPlane2D(plane, interiorPoint(loops[0], loops.slice(1)));
  for (const g of solid) {
    if (!planesCoincide(plane, model.facePlane(g))) continue;
    const gPlane = model.facePlane(g);
    const region = model.faceVertexLoops(g).map((r) => r.map((v) => toPlane2D(gPlane, model.pos(v))));
    if (pointInRegion(toPlane2D(gPlane, p), region[0], region.slice(1)) !== 'outside') return true;
  }
  return pointInSolid(model, solid, p);
}

/** Check the shapes the given faces belong to (whole shapes, each once). */
export function solidReport(model: Model, faces: Iterable<FaceId> = model.faces.keys()): SolidReport {
  const r: SolidReport = { solids: 0, volumes: [], insideOut: 0, open: 0, openEdges: [], flat: 0, pressed: 0 };
  const seen = new Set<FaceId>();
  const partOf = new Map<FaceId, number>();
  const closedFaces: FaceId[] = [];
  for (const f of faces) {
    if (seen.has(f) || !model.faces.has(f)) continue;
    const part = model.connectedFaces(f, false);
    const index = partOf.size;
    for (const g of part) {
      seen.add(g);
      partOf.set(g, index);
    }
    if (model.isClosed(part)) {
      r.solids++;
      const v = volume(model, part);
      r.volumes.push(Math.abs(v));
      if (v < 0) r.insideOut++;
      closedFaces.push(...part);
      continue;
    }
    const n = model.face(f).normal;
    if ([...part].every((g) => dot(model.face(g).normal, n) > 1 - ANGLE_TOL || dot(model.face(g).normal, n) < -1 + ANGLE_TOL)) {
      r.flat++;
      continue;
    }
    r.open++;
    for (const g of part) for (const h of model.faceHalfEdges(g)) if (model.he(model.he(h).twin).loop === null) r.openEdges.push(Math.min(h, model.he(h).twin));
  }
  if (closedFaces.length <= PRESSED_CHECK_LIMIT) {
    const pressed = new Set<FaceId>();
    for (let i = 0; i < closedFaces.length; i++) {
      for (let j = i + 1; j < closedFaces.length; j++) {
        const [a, b] = [closedFaces[i], closedFaces[j]];
        if (partOf.get(a) !== partOf.get(b) && facesPressed(model, a, b)) pressed.add(a).add(b);
      }
    }
    r.pressed = pressed.size;
  }
  return r;
}

/** What a change made worse about the solids, in a few words, or null if nothing. */
export function solidsMadeWorse(before: SolidReport, after: SolidReport): string | null {
  const worse: string[] = [];
  const opened = after.openEdges.length - before.openEdges.length;
  if (opened > 0) worse.push(`opened a solid (${opened} more open edge${opened === 1 ? '' : 's'})`);
  if (after.insideOut > before.insideOut) worse.push('turned a solid inside out');
  if (after.pressed > before.pressed) worse.push('left solids pressed face to face');
  return worse.length ? worse.join('; ') : null;
}

/** Above this many things with a volume, Entity Info gives a count and the total instead of a list. */
const VOLUME_LIST_LIMIT = 5;

/**
 * Entity Info's volume lines for the selected things that have one (each group, each loose solid):
 * one gives its volume; up to five are listed by name with the total; more give a count and the
 * total. Things without a volume (flat or open) are left out.
 */
export function volumeLines(things: readonly { name: string; volume: number }[], format: (mm3: number) => string): [string, string][] {
  const solid = things.filter((t) => t.volume > 0);
  if (!solid.length) return [];
  if (solid.length === 1) return [['Volume', format(solid[0].volume)]];
  const total: [string, string] = ['Total volume', format(solid.reduce((a, t) => a + t.volume, 0))];
  if (solid.length > VOLUME_LIST_LIMIT) return [['Solids', String(solid.length)], total];
  return [...solid.map((t): [string, string] => [t.name, format(t.volume)]), total];
}

/** The report in a few words, for Entity Info: "Solid", or what is wrong and how to fix it. */
export function describeSolid(r: SolidReport): string {
  const problems: string[] = [];
  if (r.open) problems.push(`not closed: ${r.openEdges.length} open edge${r.openEdges.length === 1 ? '' : 's'}`);
  if (r.insideOut) problems.push(`${r.insideOut === 1 ? 'inside out' : `${r.insideOut} inside out`} (select all its faces, then Reverse Faces)`);
  if (r.pressed) problems.push('solids pressed face to face (Merge Shapes joins them)');
  if (problems.length) return problems.join('; ').replace(/^./, (c) => c.toUpperCase());
  if (r.solids) return r.solids === 1 ? 'Solid' : `${r.solids} solids`;
  return r.flat ? 'Flat (not a solid)' : '';
}
