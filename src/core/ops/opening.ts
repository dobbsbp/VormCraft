import { booleanInPlace } from '../boolean/manifold';
import { checkWatertight } from '../check/watertight';
import { TOL } from '../math/tolerance';
import { add, cross, dot, normalize, scale, sub, type Vec3 } from '../math/vec3';
import { Model, type FaceId } from '../model/Model';
import { findFaceAt } from '../model/query';
import { drawEdges } from './edges';
import { pushPull } from './pushPull';

/** An opening for a door or window: its size, and the middle of its bottom edge on the wall face. */
export interface Opening {
  width: number;
  height: number;
  bottom: Vec3;
}

/**
 * How thick a wall is at `point` on `face`: the distance to the nearest face behind it facing the
 * other way (the wall's other side), or null if there is none.
 */
export function wallThickness(model: Model, face: FaceId, point: Vec3): number | null {
  const n = model.face(face).normal;
  let best: number | null = null;
  for (const f of model.faces.values()) {
    if (f.id === face || dot(f.normal, n) > -1 + 1e-6) continue;
    const any = model.pos(model.faceVertexLoops(f.id)[0][0]);
    const t = dot(sub(point, any), n);
    if (t <= TOL || (best !== null && t >= best)) continue;
    if (findFaceAt(model, sub(point, scale(n, t))) === f.id) best = t;
  }
  return best;
}

/** The corners of an opening on its wall face (bottom left, bottom right, top right, top left, seen from outside). */
export function openingCorners(model: Model, face: FaceId, o: Opening): Vec3[] {
  const n = model.face(face).normal;
  const right = normalize(cross([0, 0, 1], n));
  const half = scale(right, -o.width / 2);
  const up: Vec3 = [0, 0, o.height];
  const a = add(o.bottom, half);
  const b = sub(o.bottom, half);
  return [a, b, add(b, up), add(a, up)];
}

/**
 * Cut an opening right through an upright wall, from `face` to the wall's other side (a door or
 * window putting itself in). The opening must lie within the face; its bottom may sit on the
 * face's bottom edge (a door at floor level), which notches the wall. A wall that is a closed solid
 * is cut with a boolean (so it stays closed); an open wall (no back to it, or open underneath) is
 * cut by drawing the opening and pushing it through. Returns the wall's thickness there.
 */
export function cutOpening(model: Model, face: FaceId, o: Opening): number {
  const n = model.face(face).normal;
  if (Math.abs(n[2]) > 1e-6) throw new Error('Doors and windows go in upright walls');
  if (!(o.width > TOL) || !(o.height > TOL)) throw new Error('The opening needs a width and a height');
  const corners = openingCorners(model, face, o);
  const centre: Vec3 = add(o.bottom, [0, 0, o.height / 2]);
  // Each corner nudged in towards the middle must be on the face: the opening fits on it.
  for (const c of corners) {
    const inward = add(c, scale(normalize(sub(centre, c)), 0.5));
    if (findFaceAt(model, inward) !== face) throw new Error('It does not fit on this wall there: move it, or pick a smaller size');
  }
  const thickness = wallThickness(model, face, centre);
  if (thickness === null) throw new Error('This wall has no other side to cut through');
  const shell = model.connectedFaces(face);
  const lowest = Math.min(...model.faceVertexLoops(face)[0].map((v) => model.pos(v)[2]));
  if (checkWatertight(model, shell).watertight) {
    // A box from just outside the face to just past the back, and below the floor if it stands on it.
    const tool = new Model();
    const drop = Math.abs(o.bottom[2] - lowest) <= TOL ? 1 : 0;
    const out = scale(n, 1);
    const ring = corners.map((c, i) => add(add(c, out), [0, 0, i < 2 ? -drop : 0]));
    const made = drawEdges(tool, [...ring, ring[0]]).faces;
    if (made.length !== 1) throw new Error('Could not cut the opening');
    const f = made[0];
    pushPull(tool, f, dot(tool.face(f).normal, n) < 0 ? thickness + 2 : -(thickness + 2));
    booleanInPlace(model, shell, { model: tool, faces: tool.faces.keys() }, 'subtract');
    return thickness;
  }
  drawEdges(model, [...corners, corners[0]]);
  const inner = findFaceAt(model, centre);
  if (inner === undefined) throw new Error('Could not cut the opening');
  pushPull(model, inner, -thickness);
  return thickness;
}
