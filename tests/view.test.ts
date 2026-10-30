import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDemoModel } from '../src/app/demoModel';
import { checkWatertight, drawCircle, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, pushPull } from '../src/core';
import { buildDisplayData, faceTriangles, type DisplayData } from '../src/view/displayData';
import { dragModeFor, Navigator } from '../src/view/navigation';
import { pick } from '../src/view/picking';

beforeAll(async () => {
  await initBooleanKernel();
});

const VIEWPORT = { width: 800, height: 600 };

function box(w = 10, d = 10, h = 10) {
  const m = new Model();
  const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], w, d).inner!;
  pushPull(m, f, h);
  return m;
}

/** A Z-up camera at `pos` looking at `target`, matrices up to date. */
function cameraAt(pos: THREE.Vector3Tuple, target: THREE.Vector3Tuple): { camera: THREE.PerspectiveCamera; nav: Navigator } {
  const camera = new THREE.PerspectiveCamera(35, VIEWPORT.width / VIEWPORT.height, 0.1, 1e5);
  const nav = new Navigator(camera);
  camera.position.set(...pos);
  nav.lookAt(new THREE.Vector3(...target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return { camera, nav };
}

function meshes(data: DisplayData): THREE.Mesh[] {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  g.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const front = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.FrontSide }));
  const back = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
  return [front, back];
}

function ndcOf(p: THREE.Vector3Tuple, camera: THREE.Camera): THREE.Vector2 {
  const v = new THREE.Vector3(...p).project(camera);
  return new THREE.Vector2(v.x, v.y);
}

describe('display data', () => {
  it('tags every triangle with its source face and every segment with its edge', () => {
    const m = box();
    const data = buildDisplayData(m);
    expect(data.indices.length / 3).toBe(12);
    expect(data.triangleFaces).toHaveLength(12);
    const perFace = new Map<number, number>();
    for (const f of data.triangleFaces) perFace.set(f, (perFace.get(f) ?? 0) + 1);
    expect([...perFace.keys()].sort()).toEqual([...m.faces.keys()].sort());
    expect([...perFace.values()].every((n) => n === 2)).toBe(true);
    expect([...data.segmentEdges].sort()).toEqual([...m.edges()].sort());
  });

  it('triangles of a face lie inside that face (face ids are not shuffled)', () => {
    const m = box(30, 20, 10);
    const data = buildDisplayData(m);
    for (let t = 0; t < data.triangleFaces.length; t++) {
      const face = m.face(data.triangleFaces[t]);
      const plane = m.facePlane(face.id);
      for (let k = 0; k < 3; k++) {
        const i = data.indices[t * 3 + k];
        const p = [data.positions[i * 3], data.positions[i * 3 + 1], data.positions[i * 3 + 2]];
        const d = (p[0] - plane.origin[0]) * plane.normal[0] + (p[1] - plane.origin[1]) * plane.normal[1] + (p[2] - plane.origin[2]) * plane.normal[2];
        expect(Math.abs(d)).toBeLessThan(1e-4);
      }
    }
  });

  it('hides the soft seams of a cylinder but keeps its rims', () => {
    const m = new Model();
    pushPull(m, drawCircle(m, GROUND_PLANE, [0, 0, 0], 10, 24).inner!, 20);
    expect([...m.edges()]).toHaveLength(72);
    expect(buildDisplayData(m).segmentEdges).toHaveLength(48);
  });

  it('keeps the edges of a box with a hole (rims and box edges are hard)', () => {
    const m = box(40, 40, 10);
    const top = findFaceAt(m, [5, 5, 10])!;
    pushPull(m, drawCircle(m, m.facePlane(top), [20, 20, 10], 5, 16, top).inner!, -10);
    const data = buildDisplayData(m);
    expect(data.segmentEdges).toHaveLength(12 + 16 * 2);
  });

  it('face overlay triangles cover exactly that face', () => {
    const m = box(10, 20, 30);
    const top = findFaceAt(m, [5, 5, 30])!;
    const tris = faceTriangles(m, top);
    expect(tris.length).toBe(2 * 9);
    for (let i = 2; i < tris.length; i += 3) expect(tris[i]).toBe(30);
  });
});

describe('picking', () => {
  it('a ray onto the top of a box picks the top face', () => {
    const m = box();
    const data = buildDisplayData(m);
    const { camera } = cameraAt([5, 5, 60], [5, 5, 0]);
    const hit = pick({ camera, ndc: ndcOf([4, 6, 10], camera), viewport: VIEWPORT, faceObjects: meshes(data), data });
    expect(hit?.kind).toBe('face');
    expect(hit?.kind === 'face' && hit.face).toBe(findFaceAt(m, [5, 5, 10]));
    expect(hit!.point[2]).toBeCloseTo(10);
  });

  it('the cursor near an edge picks the edge, not the face', () => {
    const m = box();
    const data = buildDisplayData(m);
    const { camera } = cameraAt([5, -20, 40], [5, 5, 5]);
    // Just off the top front edge (y = 0, z = 10), on the top face side.
    const ndc = ndcOf([5, 0.05, 10], camera);
    const hit = pick({ camera, ndc, viewport: VIEWPORT, faceObjects: meshes(data), data });
    expect(hit?.kind).toBe('edge');
    if (hit?.kind !== 'edge') return;
    const a = m.pos(m.he(hit.edge).origin);
    const b = m.pos(m.dest(hit.edge));
    expect([a[1], b[1], a[2], b[2]]).toEqual([0, 0, 10, 10]);
  });

  it('edges of the hit face stay pickable at grazing angles (regression)', () => {
    const m = box(100, 100, 20);
    const data = buildDisplayData(m);
    const { camera } = cameraAt([-150, -400, 60], [50, 50, 20]);
    for (const dy of [2, 4]) {
      const ndc = ndcOf([30, 100, 20], camera);
      ndc.y -= (dy / VIEWPORT.height) * 2; // a few pixels below the far top edge, on the top face
      const hit = pick({ camera, ndc, viewport: VIEWPORT, faceObjects: meshes(data), data });
      expect(hit?.kind).toBe('edge');
    }
  });

  it('edges hidden behind faces are not picked', () => {
    const m = box();
    const data = buildDisplayData(m);
    // Looking down from above the centre: the bottom edges project inside the top face.
    const { camera } = cameraAt([5, 5, 30], [5, 5, 0]);
    const hit = pick({ camera, ndc: ndcOf([5, 0, 0], camera), viewport: VIEWPORT, faceObjects: meshes(data), data });
    expect(hit?.kind).toBe('face');
  });

  it('empty space picks nothing', () => {
    const m = box();
    const data = buildDisplayData(m);
    const { camera } = cameraAt([5, 5, 60], [5, 5, 0]);
    expect(pick({ camera, ndc: new THREE.Vector2(0.95, 0.95), viewport: VIEWPORT, faceObjects: meshes(data), data })).toBeNull();
  });

  it('back faces are pickable (a lone face seen from below)', () => {
    const m = new Model();
    const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    const data = buildDisplayData(m);
    const { camera } = cameraAt([5, 5, -40], [5, 5, 0]);
    const hit = pick({ camera, ndc: ndcOf([5, 5, 0], camera), viewport: VIEWPORT, faceObjects: meshes(data), data });
    expect(hit?.kind === 'face' && hit.face).toBe(f);
  });
});

describe('mouse buttons', () => {
  it('right drag orbits, middle drag pans', () => {
    expect(dragModeFor(2, null)).toBe('orbit');
    expect(dragModeFor(1, null)).toBe('pan');
  });

  it('the left button belongs to the active tool (navigates only with Orbit/Pan/Zoom active)', () => {
    expect(dragModeFor(0, null)).toBeNull();
    expect(dragModeFor(0, 'orbit')).toBe('orbit');
    expect(dragModeFor(0, 'zoom')).toBe('zoom');
  });
});

describe('navigation', () => {
  it('orbit keeps the distance to the pivot and never rolls the camera', () => {
    const { camera, nav } = cameraAt([100, -200, 150], [0, 0, 0]);
    const pivot = new THREE.Vector3(10, 20, 5);
    const before = camera.position.distanceTo(pivot);
    nav.orbit(120, -45, pivot);
    nav.orbit(-300, 80, pivot);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(before, 6);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(right.z).toBeCloseTo(0, 9);
  });

  it('orbit keeps the pivot at the same place on screen', () => {
    const { camera, nav } = cameraAt([100, -200, 150], [0, 0, 0]);
    const pivot = new THREE.Vector3(30, 10, 0);
    const before = pivot.clone().project(camera);
    // Orbit is a rigid rotation of the camera about the pivot, so the pivot's view position is fixed.
    nav.orbit(50, 30, pivot);
    nav.orbit(-20, -70, pivot);
    const after = pivot.clone().project(camera);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('orbiting over the top stops short of flipping', () => {
    const { nav } = cameraAt([0, -100, 50], [0, 0, 0]);
    nav.orbit(0, 5000, new THREE.Vector3());
    expect(nav.forward().z).toBeGreaterThan(-1);
    expect(nav.forward().z).toBeGreaterThanOrEqual(-0.9991);
    nav.orbit(0, -10000, new THREE.Vector3());
    expect(nav.forward().z).toBeLessThanOrEqual(0.9991);
  });

  it('zooming toward a point keeps that point under the cursor and gets closer', () => {
    const { camera, nav } = cameraAt([100, -200, 150], [0, 0, 0]);
    const focus = new THREE.Vector3(40, 30, 0);
    const ndcBefore = focus.clone().project(camera);
    const dBefore = camera.position.distanceTo(focus);
    nav.zoomToward(focus, 2);
    const ndcAfter = focus.clone().project(camera);
    expect(ndcAfter.x).toBeCloseTo(ndcBefore.x, 9);
    expect(ndcAfter.y).toBeCloseTo(ndcBefore.y, 9);
    expect(camera.position.distanceTo(focus)).toBeCloseTo(dBefore * 0.64, 6);
    nav.zoomToward(focus, -2);
    expect(camera.position.distanceTo(focus)).toBeGreaterThan(dBefore * 0.64);
  });

  it('pan moves a point at the grab depth by exactly the dragged pixels', () => {
    const { camera, nav } = cameraAt([0, -100, 0], [0, 0, 0]);
    const p = new THREE.Vector3(0, 0, 0);
    const toPx = () => {
      const v = p.clone().project(camera);
      return [((v.x + 1) / 2) * VIEWPORT.width, ((1 - v.y) / 2) * VIEWPORT.height];
    };
    const [x0, y0] = toPx();
    nav.pan(40, -25, 100, VIEWPORT.height);
    const [x1, y1] = toPx();
    expect(x1 - x0).toBeCloseTo(40, 6);
    expect(y1 - y0).toBeCloseTo(-25, 6);
  });

  it('re-centring slides the camera so the point is mid-screen, same angle and depth', () => {
    const { camera, nav } = cameraAt([100, -200, 150], [0, 0, 0]);
    const q = camera.quaternion.clone();
    const point = new THREE.Vector3(60, 40, 10);
    const depthBefore = point.clone().sub(camera.position).dot(nav.forward());
    nav.recenterOn(point);
    const ndc = point.clone().project(camera);
    expect(ndc.x).toBeCloseTo(0, 9);
    expect(ndc.y).toBeCloseTo(0, 9);
    expect(camera.quaternion.angleTo(q)).toBeLessThan(1e-12);
    expect(point.clone().sub(camera.position).dot(nav.forward())).toBeCloseTo(depthBefore, 9);
  });

  it('zoom extents fits the whole sphere on screen', () => {
    const { camera, nav } = cameraAt([3, -5, 4], [0, 0, 0]);
    const sphere = new THREE.Sphere(new THREE.Vector3(100, 50, 20), 80);
    nav.zoomExtents(sphere);
    camera.updateMatrixWorld();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    for (const dir of [right, right.clone().negate(), up, up.clone().negate()]) {
      const p = sphere.center.clone().addScaledVector(dir, sphere.radius).project(camera);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });

  it('standard views look along the expected axes', () => {
    const { nav } = cameraAt([1, 1, 1], [0, 0, 0]);
    const sphere = new THREE.Sphere(new THREE.Vector3(), 10);
    nav.setView('top', sphere);
    expect(nav.forward().toArray().map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0, 0, -1]);
    nav.setView('front', sphere);
    expect(nav.forward().y).toBeCloseTo(1);
    nav.setView('right', sphere);
    expect(nav.forward().x).toBeCloseTo(-1);
    nav.setView('iso', sphere);
    expect(nav.forward().z).toBeLessThan(0);
  });

  it('near/far planes bracket the scene', () => {
    const { camera, nav } = cameraAt([0, -500, 0], [0, 0, 0]);
    nav.fitClipping(new THREE.Sphere(new THREE.Vector3(), 100));
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.near).toBeLessThan(400);
    expect(camera.far).toBeGreaterThan(600);
  });
});

describe('scene queries', () => {
  it('findFaceAt finds the face containing a point and skips holes', () => {
    const m = box(40, 40, 10);
    const top = findFaceAt(m, [5, 5, 10])!;
    expect(m.face(top).normal).toEqual([0, 0, 1]);
    pushPull(m, drawCircle(m, m.facePlane(top), [20, 20, 10], 5, 16, top).inner!, -10);
    expect(findFaceAt(m, [20, 20, 10])).toBeUndefined();
    expect(findFaceAt(m, [5, 5, 10])).toBe(top);
    expect(findFaceAt(m, [5, 5, 0], [0, 0, -1])).toBeDefined();
    expect(findFaceAt(m, [5, 5, 0], [0, 0, 1])).toBeUndefined();
  });

  it('the demo model is a valid watertight solid', () => {
    const m = buildDemoModel();
    m.validate();
    const r = checkWatertight(m);
    expect(r.watertight).toBe(true);
    expect(r.genus).toBe(1);
  });
});

describe('parallel projection', () => {
  /** Where a world point lands on an 800 × 600 screen through the orthographic camera. */
  function screenOf(ortho: THREE.OrthographicCamera, p: THREE.Vector3): [number, number] {
    const v = p.clone().project(ortho);
    return [((v.x + 1) / 2) * 800, ((1 - v.y) / 2) * 600];
  }

  it('zooming toward a point keeps it under the cursor and shrinks the view height', () => {
    const { camera, nav } = cameraAt([0, -2000, 1000], [0, 0, 0]);
    camera.aspect = 800 / 600;
    nav.projection = 'parallel';
    nav.height = 1500;
    const ortho = new THREE.OrthographicCamera();
    const sphere = new THREE.Sphere(new THREE.Vector3(), 1000);
    nav.syncParallel(ortho, sphere);
    const focus = new THREE.Vector3(300, 200, 50);
    const before = screenOf(ortho, focus);
    nav.zoomToward(focus, 2);
    nav.syncParallel(ortho, sphere);
    const after = screenOf(ortho, focus);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(nav.height).toBeCloseTo(1500 * 0.64, 6);
  });

  it('the orthographic camera sits behind everything in view, looking the same way', () => {
    const { camera, nav } = cameraAt([0, 0, 100], [0, 0, 0]); // the eye is inside the scene
    nav.projection = 'parallel';
    const ortho = new THREE.OrthographicCamera();
    nav.syncParallel(ortho, new THREE.Sphere(new THREE.Vector3(), 1000));
    expect(ortho.position.z).toBeGreaterThan(1000);
    expect(ortho.quaternion.angleTo(camera.quaternion)).toBeCloseTo(0, 9);
    // Panning moves a fixed amount per pixel, whatever the depth.
    expect(nav.unitsPerPixel(10, 500)).toBeCloseTo(nav.unitsPerPixel(5000, 500), 9);
  });
});
