import { intersectSegments, type Vec2 } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import type { Vec3 } from '../math/vec3';
import { Model, type FaceId } from '../model/Model';
import { drawEdges } from './edges';
import { pushPull } from './pushPull';

/** Where a wall lies against the line it is drawn along (looking along the line). */
export type WallAlign = 'centre' | 'left' | 'right';

/** A wall's outline on the floor: one loop, or for a closed run the outside and the inside. */
export interface WallFootprint {
  outer: Vec2[];
  inner?: Vec2[];
}

/** Corners sharper than this (mitres longer than this many times the offset) are refused. */
const MAX_MITRE = 6;

/**
 * The outline of a run of walls `thickness` thick along the points (in plan: x, y), with mitred
 * corners. An open run gives one closed outline round it; a closed run (`closed`, the last point
 * joining the first) gives the outside and the inside outline. Throws, saying why, for a corner
 * too sharp for the thickness, or walls that would cross each other.
 */
export function wallFootprint(points: readonly Vec2[], thickness: number, align: WallAlign, closed: boolean): WallFootprint {
  if (!(thickness > TOL)) throw new Error('Walls need a thickness of more than zero');
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > TOL);
  if (closed && pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= TOL) pts.pop();
  if (pts.length < (closed ? 3 : 2)) throw new Error(closed ? 'A closed run of walls needs at least three corners' : 'Draw at least one wall length');
  // Offsets of each side from the line: + is to the left.
  const [left, right] = align === 'centre' ? [thickness / 2, -thickness / 2] : align === 'left' ? [thickness, 0] : [0, -thickness];
  const a = offsetLine(pts, left, closed);
  const b = offsetLine(pts, right, closed);
  if (!closed) {
    const outline = [...a, ...b.reverse()];
    if (selfCrosses(outline)) throw new Error('These walls would run into each other');
    return { outer: outline };
  }
  const [outer, inner] = Math.abs(area(a)) >= Math.abs(area(b)) ? [a, b] : [b, a];
  if (selfCrosses(outer) || selfCrosses(inner)) throw new Error('These walls would run into each other');
  return { outer, inner };
}

/** The line through the points moved sideways by `d` (+ to the left), with mitred corners. */
function offsetLine(pts: readonly Vec2[], d: number, closed: boolean): Vec2[] {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  const normals: Vec2[] = [];
  for (let i = 0; i < segs; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    normals.push([-(q[1] - p[1]) / len, (q[0] - p[0]) / len]);
  }
  return pts.map((p, i) => {
    const before = closed ? normals[(i - 1 + segs) % segs] : normals[i - 1];
    const after = closed ? normals[i % segs] : normals[i];
    if (!before) return [p[0] + after[0] * d, p[1] + after[1] * d];
    if (!after) return [p[0] + before[0] * d, p[1] + before[1] * d];
    const dotN = before[0] * after[0] + before[1] * after[1];
    if (dotN < -1 + 1e-9) throw new Error('A wall cannot turn straight back on itself');
    const m: Vec2 = [(before[0] + after[0]) / (1 + dotN), (before[1] + after[1]) / (1 + dotN)];
    if (Math.hypot(m[0], m[1]) > MAX_MITRE) throw new Error('A corner is too sharp for walls this thick: make the angle wider');
    return [p[0] + m[0] * d, p[1] + m[1] * d];
  });
}

const area = (p: readonly Vec2[]) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;

/** Whether two sides of a closed outline that are not neighbours touch or cross. */
function selfCrosses(loop: readonly Vec2[]): boolean {
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (intersectSegments(loop[i], loop[(i + 1) % n], loop[j], loop[(j + 1) % n]).length) return true;
    }
  }
  return false;
}

/**
 * Walls as a closed solid in a model of their own: the footprint at height `z`, pushed up by
 * `height`. Returns the model (to be put in a group) and its faces.
 */
export function buildWalls(points: readonly Vec3[], thickness: number, height: number, align: WallAlign, closed: boolean): { model: Model; faces: FaceId[] } {
  if (!(height > TOL)) throw new Error('Walls need a height of more than zero');
  const z = points[0][2];
  const fp = wallFootprint(
    points.map((p): Vec2 => [p[0], p[1]]),
    thickness,
    align,
    closed,
  );
  const model = new Model();
  const at = (p: Vec2): Vec3 => [p[0], p[1], z];
  const base = drawEdges(model, [...fp.outer.map(at), at(fp.outer[0])]).faces;
  if (base.length !== 1) throw new Error('Could not make the walls');
  let floor = base[0];
  if (fp.inner) {
    const made = drawEdges(model, [...fp.inner.map(at), at(fp.inner[0])]).faces;
    // The inside outline splits the floor: drop the middle, keeping the ring.
    const middle = made.find((f) => model.faceVertexLoops(f).length === 1 && model.faceVertexLoops(f)[0].length === fp.inner!.length && f !== floor);
    if (middle === undefined) throw new Error('Could not make the walls');
    model.removeFace(middle);
    floor = [...model.faces.keys()][0];
  }
  pushPull(model, floor, model.face(floor).normal[2] > 0 ? height : -height);
  return { model, faces: [...model.faces.keys()] };
}
