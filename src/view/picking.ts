import * as THREE from 'three';
import type { Vec3 } from '../core/math/vec3';
import type { FaceId, HalfEdgeId } from '../core/model/Model';
import type { DisplayData } from './displayData';

export type Pick =
  | { kind: 'face'; face: FaceId; point: Vec3; distance: number }
  | { kind: 'edge'; edge: HalfEdgeId; point: Vec3; distance: number };

export interface PickInput {
  camera: THREE.Camera;
  /** Cursor in normalised device coordinates (-1..1). */
  ndc: THREE.Vector2;
  /** Viewport size in CSS pixels, for the edge tolerance. */
  viewport: { width: number; height: number };
  /** Meshes whose triangles index `data.triangleFaces` (e.g. front- and back-side meshes). */
  faceObjects: THREE.Object3D[];
  data: DisplayData;
  /** How close (in pixels) the cursor must be to an edge to pick it. */
  edgeTolerancePx?: number;
}

export type FacePick = Extract<Pick, { kind: 'face' }>;
export type EdgePick = Extract<Pick, { kind: 'edge' }>;

/** The nearest face along the ray and the nearest visible edge near the cursor, separately. */
export function pickHits(input: PickInput): { face: FacePick | null; edge: EdgePick | null } {
  const { camera, ndc, data } = input;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(input.faceObjects, false).filter((h) => h.faceIndex !== undefined && h.faceIndex !== null);
  const faceHit = hits[0];
  const face: FacePick | null = faceHit
    ? { kind: 'face', face: data.triangleFaces[faceHit.faceIndex!], point: [faceHit.point.x, faceHit.point.y, faceHit.point.z], distance: faceHit.distance }
    : null;
  // The plane of the hit face, turned to face the camera: edges on or in front of it are not hidden.
  const occluder = faceHit?.face ? new THREE.Plane().setFromNormalAndCoplanarPoint(faceHit.face.normal.clone(), faceHit.point) : null;
  if (occluder && occluder.normal.dot(raycaster.ray.direction) > 0) occluder.negate();
  return { face, edge: pickEdge(input, raycaster.ray, face?.distance ?? Infinity, occluder) };
}

/**
 * What is under the cursor: the nearest visible edge within the pixel tolerance wins over the
 * face behind it (as in SketchUp), otherwise the nearest face. Results are model ids.
 */
export function pick(input: PickInput): Pick | null {
  const { face, edge } = pickHits(input);
  return edge ?? face;
}

function pickEdge(input: PickInput, ray: THREE.Ray, occluderDistance: number, occluder: THREE.Plane | null): EdgePick | null {
  const { camera, ndc, data, viewport } = input;
  const tol = input.edgeTolerancePx ?? 6;
  const cursor = new THREE.Vector2(((ndc.x + 1) / 2) * viewport.width, ((1 - ndc.y) / 2) * viewport.height);
  const view = camera.matrixWorldInverse;
  const near = camera instanceof THREE.PerspectiveCamera ? camera.near : 1e-6;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const pa = new THREE.Vector2();
  const pb = new THREE.Vector2();
  const onSeg = new THREE.Vector3();
  const onRay = new THREE.Vector3();
  let best: EdgePick | null = null;
  let bestPx = tol;
  const n = data.segmentEdges.length;
  for (let i = 0; i < n; i++) {
    a.fromArray(data.edgePositions, i * 6).applyMatrix4(view);
    b.fromArray(data.edgePositions, i * 6 + 3).applyMatrix4(view);
    if (!clipToNear(a, b, near)) continue;
    toScreen(a, camera, viewport, pa);
    toScreen(b, camera, viewport, pb);
    if (distToSegment2(cursor, pa, pb) > bestPx) continue;
    // Closest point on the 3D edge to the pick ray, for depth and the reported point.
    const s0 = new THREE.Vector3().fromArray(data.edgePositions, i * 6);
    const s1 = new THREE.Vector3().fromArray(data.edgePositions, i * 6 + 3);
    ray.distanceSqToSegment(s0, s1, onRay, onSeg);
    const distance = onRay.distanceTo(ray.origin);
    // Hidden only when deeper than the hit face and behind its plane (edges on the face stay
    // pickable at grazing angles, where the hit point is well in front of them along the ray).
    if (distance > occluderDistance && (!occluder || occluder.distanceToPoint(onSeg) < -1e-3)) continue;
    bestPx = distToSegment2(cursor, pa, pb);
    best = { kind: 'edge', edge: data.segmentEdges[i], point: [onSeg.x, onSeg.y, onSeg.z], distance };
  }
  return best;
}

/** Clip a view-space segment to z <= -near. Returns false when it is entirely behind the camera. */
function clipToNear(a: THREE.Vector3, b: THREE.Vector3, near: number): boolean {
  const za = -a.z;
  const zb = -b.z;
  if (za < near && zb < near) return false;
  if (za < near) a.lerp(b, (near - za) / (zb - za));
  else if (zb < near) b.lerp(a, (near - zb) / (za - zb));
  return true;
}

function toScreen(viewPoint: THREE.Vector3, camera: THREE.Camera, viewport: { width: number; height: number }, out: THREE.Vector2): void {
  const p = viewPoint.clone().applyMatrix4(camera.projectionMatrix);
  out.set(((p.x + 1) / 2) * viewport.width, ((1 - p.y) / 2) * viewport.height);
}

export function distToSegment2(p: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
