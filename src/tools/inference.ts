import { GROUND_PLANE, makePlane, planesCoincide, projectToPlane, signedDistance } from '../core/math/plane';
import { TOL } from '../core/math/tolerance';
import { add, distance, dot, scale, sub, type Vec3 } from '../core/math/vec3';
import type { FaceId, Model } from '../core/model/Model';
import type { Guides } from '../doc/Guides';
import { AXES, closestRayLine, closestRaySegment, rayPlane } from './geom';
import type { InferenceHints, Projector, Ray, Snap, SnapKind } from './types';

export interface InferenceInput {
  model: Model;
  guides: Guides;
  projector: Projector;
  /** Cursor in CSS pixels. */
  cursor: [number, number];
  ray: Ray;
  /** The face hit by the pick ray (not considering edges). Things behind it are hidden. */
  faceHit: { face: FaceId; point: Vec3; distance: number } | null;
  hints?: InferenceHints;
  /** Pixel radius for point snaps (endpoints, midpoints, guide points). */
  pointTolerancePx?: number;
  /** Pixel radius for line snaps (edges, guides, axes). */
  lineTolerancePx?: number;
}

/**
 * Whether a point near the cursor is visible, given the face under the cursor. A point is hidden
 * only if it is behind that face: deeper along the ray than the hit AND behind the face's plane.
 * The plane test keeps everything lying on the face (its edges, corners, guides drawn on it)
 * visible even at grazing angles, where a few pixels of cursor offset put the hit point well in
 * front of them along the ray. There is no depth slack: it would let points just behind the
 * face (an axis running inside a solid, say) through.
 */
export function visibilityTest(model: Model, ray: Ray, faceHit: InferenceInput['faceHit']): (p: Vec3) => boolean {
  const occluder = faceHit?.distance ?? Infinity;
  const occluderPlane = faceHit ? model.facePlane(faceHit.face) : null;
  const towardCamera = occluderPlane && dot(occluderPlane.normal, ray.dir) > 0 ? -1 : 1;
  return (p: Vec3) => {
    if (dot(sub(p, ray.origin), ray.dir) <= occluder) return true;
    return !!occluderPlane && towardCamera * signedDistance(occluderPlane, p) >= -TOL;
  };
}

/** Snap kinds in priority order: the first kind with any candidate wins. */
export const SNAP_PRIORITY: readonly SnapKind[] = [
  'endpoint',
  'origin',
  'midpoint',
  'guideIntersection',
  'guidePoint',
  'axis',
  'onEdge',
  'onGuide',
  'onFace',
  'ground',
];

interface Candidate {
  snap: Snap;
  px: number;
}

/**
 * Inference snapping: find the most meaningful point under the cursor. Point-like snaps
 * (endpoints, midpoints, guide intersections and points) beat axis inference, which beats lying
 * on an edge or guide, which beats lying on a face; the ground plane is the fallback. Geometry
 * hidden behind the face under the cursor is ignored. With a plane hint, the result is kept on
 * that plane (point snaps are projected onto it).
 */
export function infer(input: InferenceInput): Snap | null {
  const { model, guides, projector, cursor, ray, faceHit } = input;
  const pointTol = input.pointTolerancePx ?? 10;
  const lineTol = input.lineTolerancePx ?? 7;
  const visible = visibilityTest(model, ray, faceHit);
  const px = (p: Vec3) => {
    const s = projector.toScreen(p);
    return s ? Math.hypot(s[0] - cursor[0], s[1] - cursor[1]) : Infinity;
  };
  const found = new Map<SnapKind, Candidate>();
  const offer = (snap: Snap, tol: number) => {
    if (!visible(snap.point)) return;
    const d = px(snap.point);
    if (d > tol) return;
    const prev = found.get(snap.kind);
    if (!prev || d < prev.px) found.set(snap.kind, { snap, px: d });
  };

  for (const v of model.vertices.values()) {
    if (model.outgoing(v.id).size > 0) offer({ kind: 'endpoint', point: v.pos }, pointTol);
  }
  for (const e of model.edges()) {
    const a = model.pos(model.he(e).origin);
    const b = model.pos(model.dest(e));
    offer({ kind: 'midpoint', point: scale(add(a, b), 0.5), edge: e }, pointTol);
    const on = closestRaySegment(ray, a, b);
    if (on) offer({ kind: 'onEdge', point: on, edge: e }, lineTol);
  }

  if (guides.visible) {
    const lines = guides.lines();
    for (let i = 0; i < lines.length; i++) {
      const g = lines[i];
      const on = closestRayLine(ray, g.point, g.dir);
      if (on && on.t > 0) offer({ kind: 'onGuide', point: on.point, guide: g.id }, lineTol);
      for (let j = i + 1; j < lines.length; j++) {
        const x = intersectLines(g.point, g.dir, lines[j].point, lines[j].dir);
        if (x) offer({ kind: 'guideIntersection', point: x, guide: g.id }, pointTol);
      }
      for (const e of model.edges()) {
        const a = model.pos(model.he(e).origin);
        const b = model.pos(model.dest(e));
        const x = intersectLines(g.point, g.dir, a, sub(b, a));
        if (x && onSegment(x, a, b)) offer({ kind: 'guideIntersection', point: x, guide: g.id, edge: e }, pointTol);
      }
    }
    for (const p of guides.points()) offer({ kind: 'guidePoint', point: p.pos, guide: p.id }, pointTol);
  }

  // The model origin, and the red/green/blue axes: through the tool's start point if it has one,
  // otherwise the model axes through the origin.
  const ORIGIN: Vec3 = [0, 0, 0];
  offer({ kind: 'origin', point: ORIGIN }, pointTol);
  const ref = input.hints?.reference;
  const axisFrom = ref ?? ORIGIN;
  AXES.forEach((axis, i) => {
    const on = closestRayLine(ray, axisFrom, axis);
    if (on && on.t > 0 && distance(on.point, axisFrom) > TOL) offer({ kind: 'axis', point: on.point, axis: i as 0 | 1 | 2, from: axisFrom }, lineTol);
  });

  if (faceHit) found.set('onFace', { snap: { kind: 'onFace', point: faceHit.point, face: faceHit.face }, px: 0 });
  const ground = rayPlane(ray, GROUND_PLANE);
  if (ground) found.set('ground', { snap: { kind: 'ground', point: ground }, px: 0 });

  const lock = input.hints?.lock;
  if (lock && ref) return lockedSnap(found, ray, ref, lock);
  const lockPlane = input.hints?.lockPlane;
  if (lockPlane && ref) return perpendicularSnap(found, ray, ref, lockPlane.normal);

  let best: Snap | null = null;
  for (const kind of SNAP_PRIORITY) {
    const c = found.get(kind);
    if (c) {
      best = c.snap;
      break;
    }
  }
  return constrainToPlane(best, input, model);
}

/**
 * Perpendicular lock: the point stays on the plane through the reference at right angles to the
 * edge. A hovered point is projected onto that plane; otherwise the ray meets it.
 */
function perpendicularSnap(found: Map<SnapKind, Candidate>, ray: Ray, ref: Vec3, normal: Vec3): Snap | null {
  const base = { kind: 'perpendicular' as const, from: ref, locked: true };
  const onPlane = (p: Vec3) => sub(p, scale(normal, dot(sub(p, ref), normal)));
  for (const k of POINT_KINDS) {
    const c = found.get(k);
    if (!c) continue;
    const point = onPlane(c.snap.point);
    if (distance(point, ref) > TOL) return { ...base, point };
  }
  const p = rayPlane(ray, makePlane(ref, normal));
  return p ? { ...base, point: p } : null;
}

const POINT_KINDS: readonly SnapKind[] = ['endpoint', 'origin', 'midpoint', 'guideIntersection', 'guidePoint'];

/**
 * Arrow-key lock: the point stays on the line through the reference in the locked direction.
 * Hovering a point (an endpoint, say) gives that point's position along the line, so you can
 * lock to red and then pick "as far as that corner".
 */
function lockedSnap(found: Map<SnapKind, Candidate>, ray: Ray, ref: Vec3, lock: NonNullable<InferenceHints['lock']>): Snap | null {
  const kind: SnapKind = lock.axis === undefined ? 'parallel' : 'axis';
  const base = { kind, axis: lock.axis, from: ref, locked: true };
  for (const k of POINT_KINDS) {
    const c = found.get(k);
    if (!c) continue;
    const point = add(ref, scale(lock.dir, dot(sub(c.snap.point, ref), lock.dir)));
    // A point that projects onto the start itself says nothing about the distance: ignore it.
    if (distance(point, ref) > TOL) return { ...base, point };
  }
  const on = closestRayLine(ray, ref, lock.dir);
  return on ? { ...base, point: on.point } : null;
}

function constrainToPlane(snap: Snap | null, input: InferenceInput, model: Model): Snap | null {
  const plane = input.hints?.plane;
  if (!plane) return snap;
  if (snap && snap.kind !== 'onFace' && snap.kind !== 'ground') {
    return Math.abs(signedDistance(plane, snap.point)) <= TOL ? snap : { ...snap, point: projectToPlane(plane, snap.point) };
  }
  if (snap?.kind === 'onFace' && snap.face !== undefined && planesCoincide(model.facePlane(snap.face), plane)) return snap;
  const p = rayPlane(input.ray, plane);
  return p ? { kind: 'onPlane', point: p } : snap;
}

/** Intersection of two 3D lines if they actually meet (within tolerance) and are not parallel. */
export function intersectLines(p: Vec3, u: Vec3, q: Vec3, v: Vec3): Vec3 | null {
  const r = closestRayLine({ origin: q, dir: v }, p, u);
  if (!r) return null;
  const onOther = add(q, scale(v, r.t));
  return distance(r.point, onOther) <= TOL ? r.point : null;
}

function onSegment(x: Vec3, a: Vec3, b: Vec3): boolean {
  const ab = distance(a, b);
  return Math.abs(distance(a, x) + distance(x, b) - ab) <= TOL;
}
