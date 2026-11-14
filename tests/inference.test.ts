import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { drawCircle, drawPolygon, drawRectangle, faceCentre, findFaceAt, GROUND_PLANE, initBooleanKernel, makePlane, Model, pushPull, type Vec3 } from '../src/core';
import { Guides } from '../src/doc/Guides';
import { infer } from '../src/tools/inference';
import type { InferenceHints } from '../src/tools/types';
import { Navigator } from '../src/view/navigation';
import { cameraProjector, screenRay } from '../src/view/projector';

beforeAll(async () => {
  await initBooleanKernel();
});

const VIEWPORT = { width: 1000, height: 800 };

function camera(pos: THREE.Vector3Tuple, target: THREE.Vector3Tuple) {
  const cam = new THREE.PerspectiveCamera(35, VIEWPORT.width / VIEWPORT.height, 0.1, 1e5);
  const nav = new Navigator(cam);
  cam.position.set(...pos);
  nav.lookAt(new THREE.Vector3(...target));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

function box() {
  const m = new Model();
  pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 20);
  return m;
}

/**
 * Infer with the cursor at the screen position of `target` (optionally nudged by some pixels).
 * The face hit is computed exactly like the viewer would (first face along the ray).
 */
function inferAt(m: Model, cam: THREE.Camera, target: Vec3, opts: { nudge?: [number, number]; guides?: Guides; hints?: InferenceHints; faceHit?: boolean } = {}) {
  const proj = cameraProjector(cam, VIEWPORT);
  const s = proj.toScreen(target)!;
  const cursor: [number, number] = [s[0] + (opts.nudge?.[0] ?? 0), s[1] + (opts.nudge?.[1] ?? 0)];
  const ray = screenRay(cam, cursor, VIEWPORT);
  return infer({
    model: m,
    guides: opts.guides ?? new Guides(),
    projector: proj,
    cursor,
    ray,
    faceHit: opts.faceHit === false ? null : faceHitAlong(m, ray),
    hints: opts.hints,
  });
}

/** First face hit along a ray (brute force over faces, like the viewer's raycast). */
function faceHitAlong(m: Model, ray: { origin: Vec3; dir: Vec3 }) {
  let best: { face: number; point: Vec3; distance: number } | null = null;
  for (const f of m.faces.keys()) {
    const plane = m.facePlane(f);
    const denom = ray.dir[0] * plane.normal[0] + ray.dir[1] * plane.normal[1] + ray.dir[2] * plane.normal[2];
    if (Math.abs(denom) < 1e-9) continue;
    const t =
      ((plane.origin[0] - ray.origin[0]) * plane.normal[0] + (plane.origin[1] - ray.origin[1]) * plane.normal[1] + (plane.origin[2] - ray.origin[2]) * plane.normal[2]) /
      denom;
    if (t <= 0) continue;
    const p: Vec3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
    // Only accept points strictly inside the face (findFaceAt checks containment and plane).
    if (findFaceAt(m, p) !== f) continue;
    if (!best || t < best.distance) best = { face: f, point: p, distance: t };
  }
  return best;
}

describe('inference snapping', () => {
  const cam = () => camera([-150, -250, 200], [50, 50, 10]);

  it('snaps to an endpoint near the cursor', () => {
    const s = inferAt(box(), cam(), [100, 0, 20], { nudge: [4, -3] });
    expect(s?.kind).toBe('endpoint');
    expect(s?.point).toEqual([100, 0, 20]);
  });

  it('snaps to a corner from any adjacent face (cursor just off the corner, regression)', () => {
    // Cursor a few pixels below the top-front corner, i.e. over the front face: the hit point is
    // nearer the camera than the corner, but the corner belongs to that face so it is not hidden.
    for (const nudge of [[0, 8], [8, 0], [-6, 6], [6, -6]] as [number, number][]) {
      const s = inferAt(box(), cam(), [0, 0, 20], { nudge });
      expect(s?.kind).toBe('endpoint');
      expect(s?.point).toEqual([0, 0, 20]);
    }
  });

  it('snaps to a midpoint', () => {
    const s = inferAt(box(), cam(), [50, 0, 20], { nudge: [3, 2] });
    expect(s?.kind).toBe('midpoint');
    expect(s!.point[0]).toBeCloseTo(50);
  });

  it('on an edge away from endpoints and midpoints: onEdge, with the point on the edge', () => {
    const s = inferAt(box(), cam(), [20, 0, 20], { nudge: [0, 2] });
    expect(s?.kind).toBe('onEdge');
    expect(s!.point[1]).toBeCloseTo(0, 6);
    expect(s!.point[2]).toBeCloseTo(20, 6);
    expect(s!.point[0]).toBeGreaterThan(15);
    expect(s!.point[0]).toBeLessThan(25);
  });

  it('in the middle of a face: onFace', () => {
    const m = box();
    const s = inferAt(m, cam(), [30, 60, 20]);
    expect(s?.kind).toBe('onFace');
    expect(s?.face).toBe(findFaceAt(m, [30, 60, 20]));
  });

  it('ignores endpoints hidden behind a face', () => {
    // The far bottom corner (100,100,0) is hidden behind the box from this camera.
    const s = inferAt(box(), cam(), [100, 100, 0]);
    expect(s?.kind).not.toBe('endpoint');
  });

  it('snaps to the origin, and to the model axes when no start point is set', () => {
    const m = new Model();
    expect(inferAt(m, cam(), [0, 0, 0], { nudge: [4, 3], faceHit: false })?.kind).toBe('origin');
    const s = inferAt(m, cam(), [-200, 0, 0], { nudge: [0, 3], faceHit: false });
    expect(s?.kind).toBe('axis');
    expect(s?.axis).toBe(0);
    expect(s!.point[1]).toBeCloseTo(0, 6);
    expect(s!.point[2]).toBeCloseTo(0, 6);
  });

  it('a model axis running inside a solid does not snap through the face in front of it (regression)', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [-50, -50, 0], 100, 100).inner!, 150);
    // Cursor on the top face around where the blue axis comes out. Whatever wins (the face, or
    // the axis where it sticks out above), the point must never be inside the box.
    for (const nudge of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2], [2, -2], [-2, 2]] as [number, number][]) {
      const s = inferAt(m, cam(), [0, 0, 150], { nudge });
      expect(s!.point[2]).toBeGreaterThanOrEqual(150 - 1e-6);
    }
  });

  it('falls back to the ground plane in empty space', () => {
    const s = inferAt(box(), cam(), [300, -200, 0], { faceHit: false });
    expect(s?.kind).toBe('ground');
    expect(s!.point[2]).toBeCloseTo(0, 6);
  });

  it('axis inference from a reference point', () => {
    const m = new Model();
    const s = inferAt(m, cam(), [0, 0, 80], { hints: { reference: [0, 0, 0] }, faceHit: false, nudge: [3, 0] });
    expect(s?.kind).toBe('axis');
    expect(s?.axis).toBe(2);
    expect(s!.point[0]).toBeCloseTo(0, 6);
    expect(s!.point[1]).toBeCloseTo(0, 6);
    expect(s!.point[2]).toBeGreaterThan(60);
  });

  it('snaps to guide points, guide lines and their intersections', () => {
    const m = new Model();
    const guides = new Guides();
    guides.addLine([0, 40, 0], [1, 0, 0]);
    guides.addLine([60, 0, 0], [0, 1, 0]);
    guides.addPoint([20, 20, 0]);
    expect(inferAt(m, cam(), [60, 40, 0], { guides, nudge: [3, 3] })?.kind).toBe('guideIntersection');
    expect(inferAt(m, cam(), [20, 20, 0], { guides, nudge: [2, 2] })?.kind).toBe('guidePoint');
    const on = inferAt(m, cam(), [-30, 40, 0], { guides, nudge: [0, 2] });
    expect(on?.kind).toBe('onGuide');
    expect(on!.point[1]).toBeCloseTo(40, 6);
    guides.visible = false;
    expect(inferAt(m, cam(), [20, 20, 0], { guides })?.kind).toBe('ground');
  });

  it('snaps to guides and edges lying on the face under the cursor at grazing angles (regression)', () => {
    const m = box();
    const guides = new Guides();
    guides.addLine([0, 50, 20], [1, 0, 0]); // across the middle of the top face
    const low = camera([-150, -400, 60], [50, 50, 20]); // shallow view across the top face
    for (const nudge of [[0, 2], [0, 4], [0, -3]] as [number, number][]) {
      expect(inferAt(m, low, [50, 50, 20], { guides, nudge })?.kind).toBe('onGuide');
      expect(inferAt(m, low, [30, 100, 20], { nudge })?.kind).toBe('onEdge');
    }
  });

  it('guide lines crossing model edges are snap points', () => {
    const m = box();
    const guides = new Guides();
    guides.addLine([30, 0, 20], [0, 1, 0]); // crosses the top front edge at (30, 0, 20)
    const s = inferAt(m, cam(), [30, 0, 20], { guides, nudge: [3, 0] });
    expect(s?.kind).toBe('guideIntersection');
  });

  it('with a plane hint, point snaps are projected onto the plane', () => {
    const m = box();
    const plane = makePlane([0, 0, 0], [0, 0, 1]);
    const s = inferAt(m, cam(), [100, 0, 20], { hints: { plane }, nudge: [2, 2] });
    expect(s?.kind).toBe('endpoint');
    expect(s?.point).toEqual([100, 0, 0]);
  });

  it('with a plane hint, an off-plane face gives the ray-plane point', () => {
    const m = box();
    const plane = makePlane([0, 0, 50], [0, 0, 1]);
    const s = inferAt(m, cam(), [30, 60, 20], { hints: { plane } });
    expect(s?.kind).toBe('onPlane');
    expect(s!.point[2]).toBeCloseTo(50, 6);
  });

  it('Move: near the middle of a face, snaps to its centre', () => {
    const m = box();
    const top = findFaceAt(m, [50, 50, 20]);
    const s = inferAt(m, cam(), [50, 50, 20], { hints: { centres: true }, nudge: [8, 6] });
    expect(s?.kind).toBe('centre');
    s!.point.forEach((x, i) => expect(x).toBeCloseTo([50, 50, 20][i], 6));
    expect(s?.face).toBe(top);
    // Further off it is just on the face; and other tools never get the centre.
    expect(inferAt(m, cam(), [30, 60, 20], { hints: { centres: true } })?.kind).toBe('onFace');
    expect(inferAt(m, cam(), [50, 50, 20], { nudge: [3, 3] })?.kind).toBe('onFace');
  });

  it('the centre of a tilted rectangle and of a circle standing upright lies on the face, in its middle', () => {
    const m = new Model();
    const tilted = makePlane([0, 0, 0], [0, -0.6, 0.8]);
    const rect = drawRectangle(m, tilted, [0, 0, 0], 100, 40).inner!;
    const corners = m.faceVertexLoops(rect)[0].map((v) => m.pos(v));
    const middle = corners.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4] as Vec3, [0, 0, 0] as Vec3);
    faceCentre(m, rect).forEach((x, i) => expect(x).toBeCloseTo(middle[i], 6));
    const upright = drawCircle(m, makePlane([300, 0, 50], [0.6, 0.8, 0]), [300, 0, 50], 30).inner!;
    faceCentre(m, upright).forEach((x, i) => expect(x).toBeCloseTo([300, 0, 50][i], 6));
    const s = inferAt(m, camera([540, 320, 150], [300, 0, 50]), [300, 0, 50], { hints: { centres: true }, nudge: [5, -4] });
    expect(s?.kind).toBe('centre');
    s!.point.forEach((x, i) => expect(x).toBeCloseTo([300, 0, 50][i], 6));
  });

  it('the centre of an L-shape is the balance point of its area, and a hole is left out', () => {
    const m = new Model();
    const l = drawPolygon(m, GROUND_PLANE, [[0, 0, 0], [200, 0, 0], [200, 100, 0], [100, 100, 0], [100, 200, 0], [0, 200, 0]]).inner!;
    // Three 100 x 100 squares centred at (50,50), (150,50) and (50,150).
    faceCentre(m, l).forEach((x, i) => expect(x).toBeCloseTo([250 / 3, 250 / 3, 0][i], 6));
    const ring = new Model();
    const outer = drawRectangle(ring, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    drawRectangle(ring, GROUND_PLANE, [10, 10, 0], 20, 20, outer);
    const c = faceCentre(ring, findFaceAt(ring, [80, 80, 0])!);
    // 10000 at (50,50) less 400 at (20,20).
    expect(c[0]).toBeCloseTo((10000 * 50 - 400 * 20) / 9600, 6);
    expect(c[1]).toBeCloseTo((10000 * 50 - 400 * 20) / 9600, 6);
  });

  it('a locked move can go as far as a face centre', () => {
    const m = box();
    const s = inferAt(m, cam(), [50, 50, 20], { hints: { centres: true, reference: [0, 50, 20], lock: { dir: [1, 0, 0], axis: 0 } }, nudge: [6, 0] });
    expect(s?.locked).toBe(true);
    s!.point.forEach((x, i) => expect(x).toBeCloseTo([50, 50, 20][i], 6));
  });

  it('a line in the model nearer the cursor than the axis wins over the axis, and the other way round', () => {
    const m = box();
    const hints: InferenceHints = { reference: [-50, 30, 20] }; // the red axis runs across the top at y = 30
    const onLine = inferAt(m, cam(), [100, 28, 20], { hints });
    expect(onLine?.kind).toBe('onEdge');
    expect(onLine!.point[0]).toBeCloseTo(100, 6);
    const onAxis = inferAt(m, cam(), [98, 30, 20], { hints });
    expect(onAxis?.kind).toBe('axis');
    expect(onAxis!.point[1]).toBeCloseTo(30, 6);
  });
});
