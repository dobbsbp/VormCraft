import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDemoModel } from '../src/app/demoModel';
import { checkWatertight, drawCircle, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, pushPull } from '../src/core';
import { buildDisplayData, faceTriangles, type DisplayData } from '../src/view/displayData';
import { dragModeFor, Navigator, SmoothDrag, SmoothZoom } from '../src/view/navigation';
import { useFastRaycast } from '../src/view/fastRaycast';
import { KEYED_FIELDS, modelKey } from '../src/core/model/modelKey';
import { LIBRARY } from '../src/library';
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
  it('middle drag orbits, right drag pans', () => {
    expect(dragModeFor(1, null)).toBe('orbit');
    expect(dragModeFor(2, null)).toBe('pan');
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

describe('smooth wheel zoom', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(35, 1.5, 1, 1e6);
    c.position.set(4000, -6000, 3000);
    new Navigator(c).lookAt(new THREE.Vector3());
    return c;
  };

  it('eases out and ends exactly where one jump would', () => {
    const focus = new THREE.Vector3(200, 100, 0);
    const jump = new Navigator(camera());
    jump.zoomToward(focus, 3);

    const eased = new Navigator(camera());
    const zoom = new SmoothZoom();
    zoom.add(1);
    zoom.add(2);
    const firstFrame = zoom.take(16);
    expect(firstFrame).toBeGreaterThan(0);
    expect(firstFrame).toBeLessThan(1.5); // not a jump
    eased.zoomToward(focus, firstFrame);
    let frames = 1;
    while (zoom.active) {
      eased.zoomToward(focus, zoom.take(16));
      frames++;
    }
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(40); // done in well under a second
    expect(eased.camera.position.distanceTo(jump.camera.position)).toBeLessThan(1e-6);
  });

  it('zooms out as well, and stops when reset', () => {
    const zoom = new SmoothZoom();
    zoom.add(-1);
    expect(zoom.take(16)).toBeLessThan(0);
    zoom.reset();
    expect(zoom.active).toBe(false);
    expect(zoom.take(16)).toBe(0);
  });
});

describe('smooth orbit and pan', () => {
  const camera = () => {
    const c = new THREE.PerspectiveCamera(35, 1.5, 1, 1e6);
    c.position.set(4000, -6000, 3000);
    new Navigator(c).lookAt(new THREE.Vector3());
    return c;
  };

  it('pans in parts to where one move would go', () => {
    const direct = new Navigator(camera());
    direct.pan(30, -12, 5000, 800);
    direct.pan(15, 4, 5000, 800);

    const eased = new Navigator(camera());
    const drag = new SmoothDrag();
    drag.add(30, -12);
    const [fx, fy] = drag.take(16);
    expect(Math.abs(fx)).toBeGreaterThan(0);
    expect(Math.abs(fx)).toBeLessThan(30); // not all at once
    eased.pan(fx, fy, 5000, 800);
    drag.add(15, 4);
    let frames = 1;
    while (drag.active) {
      eased.pan(...drag.take(16), 5000, 800);
      frames++;
    }
    expect(frames).toBeLessThan(20); // settles in about a quarter of a second
    expect(eased.camera.position.distanceTo(direct.camera.position)).toBeLessThan(1e-6);
  });

  it('orbits in parts to where one move would go', () => {
    const pivot = new THREE.Vector3(100, 200, 0);
    const direct = new Navigator(camera());
    direct.orbit(40, 25, pivot);

    const eased = new Navigator(camera());
    const drag = new SmoothDrag();
    drag.add(40, 25);
    while (drag.active) eased.orbit(...drag.take(16), pivot);
    expect(eased.camera.position.distanceTo(direct.camera.position)).toBeLessThan(1e-3);
    expect(eased.camera.quaternion.angleTo(direct.camera.quaternion)).toBeLessThan(1e-6);
  });

  it('moves at once when the smoothing is off', () => {
    const drag = new SmoothDrag(0);
    drag.add(10, -5);
    expect(drag.take(16)).toEqual([10, -5]);
    expect(drag.active).toBe(false);
  });
});

describe('fast picking (bounds tree)', () => {
  /** A busier model: boxes and a cylinder (many triangles), in two draw groups like painted faces. */
  function busy(): Model {
    const m = new Model();
    for (let i = 0; i < 4; i++) pushPull(m, drawRectangle(m, GROUND_PLANE, [i * 30, 0, 0], 20, 15).inner!, 10 + i * 5);
    pushPull(m, drawCircle(m, GROUND_PLANE, [40, 60, 0], 15).inner!, 25);
    return m;
  }

  function meshPair(data: DisplayData, fast: boolean, g = new THREE.BufferGeometry()): THREE.Mesh[] {
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.clearGroups();
    const half = Math.floor(data.indices.length / 6) * 3;
    g.addGroup(0, half, 0);
    g.addGroup(half, data.indices.length - half, 1);
    const side = (s: THREE.Side) => [new THREE.MeshBasicMaterial({ side: s }), new THREE.MeshBasicMaterial({ side: s })];
    const pair = [new THREE.Mesh(g, side(THREE.FrontSide)), new THREE.Mesh(g, side(THREE.BackSide))];
    if (fast) pair.forEach(useFastRaycast);
    return pair;
  }

  function firstHits(objects: THREE.Object3D[], camera: THREE.Camera) {
    const out: (string | null)[] = [];
    const rc = new THREE.Raycaster();
    for (let x = -0.9; x <= 0.9; x += 0.15) {
      for (let y = -0.9; y <= 0.9; y += 0.15) {
        rc.setFromCamera(new THREE.Vector2(x, y), camera);
        const h = rc.intersectObjects(objects, false)[0];
        out.push(h ? `${h.faceIndex} ${h.distance.toFixed(4)}` : null);
      }
    }
    return out;
  }

  it('hits the same triangles at the same distances as testing every triangle', () => {
    const data = buildDisplayData(busy());
    const { camera } = cameraAt([-80, -120, 90], [50, 30, 10]);
    const plain = firstHits(meshPair(data, false), camera);
    expect(plain.filter(Boolean).length).toBeGreaterThan(20);
    expect(firstHits(meshPair(data, true), camera)).toEqual(plain);
  });

  it('follows the geometry when it is replaced', () => {
    const g = new THREE.BufferGeometry();
    const fast = meshPair(buildDisplayData(box()), true, g);
    const { camera } = cameraAt([-80, -120, 90], [50, 30, 10]);
    firstHits(fast, camera); // builds the tree for the small box
    const data = buildDisplayData(busy());
    meshPair(data, true, g); // same geometry, new positions and index (as Viewer.refresh does)
    expect(firstHits(fast, camera)).toEqual(firstHits(meshPair(data, false), camera));
  });

  it('keeps face ids: a picked point lies on the face it names', () => {
    const m = busy();
    const data = buildDisplayData(m);
    const { camera } = cameraAt([5, 5, 200], [5, 5, 0]);
    const hit = pick({ camera, ndc: ndcOf([5, 5, 10], camera), viewport: VIEWPORT, faceObjects: meshPair(data, true), data });
    expect(hit?.kind === 'face' && hit.face).toBe(findFaceAt(m, [5, 5, 10]));
  });
});

describe('model keys (redraw only what changed)', () => {
  it('read every field the records carry (a field it missed would leave stale drawings)', () => {
    const models = [buildDemoModel(), ...LIBRARY.flatMap((item) => item.build().map((p) => p.model))];
    const soft = box();
    const e = [...soft.edges()][0];
    soft.setEdgeSoft(soft.he(e).origin, soft.dest(e), true);
    soft.setEdgeHidden(soft.he(e).origin, soft.dest(e), true);
    [...soft.faces.values()][0].material = 'oak';
    models.push(soft);
    const seen = { vertex: new Set<string>(), halfEdge: new Set<string>(), loop: new Set<string>(), face: new Set<string>(), curve: new Set<string>() };
    for (const m of models) {
      for (const [kind, map] of [['vertex', m.vertices], ['halfEdge', m.halfEdges], ['loop', m.loops], ['face', m.faces], ['curve', m.curves]] as const) {
        for (const r of map.values()) for (const k of Object.keys(r)) seen[kind].add(k);
      }
    }
    for (const kind of Object.keys(seen) as (keyof typeof seen)[]) {
      expect([...seen[kind]].filter((k) => !(KEYED_FIELDS[kind] as readonly string[]).includes(k))).toEqual([]);
    }
    expect(seen.curve.size).toBeGreaterThan(0);
  });

  it('stay the same for an unchanged model or a copy, and change with any edit', () => {
    const m = box();
    const key = modelKey(m);
    expect(modelKey(m)).toBe(key);
    expect(modelKey(m.clone())).toBe(key);

    const moved = m.clone();
    const v = [...moved.vertices.values()][0];
    v.pos = [v.pos[0] + 1e-9, v.pos[1], v.pos[2]]; // even a tiny move
    expect(modelKey(moved)).not.toBe(key);

    const painted = m.clone();
    [...painted.faces.values()][0].material = 'oak';
    expect(modelKey(painted)).not.toBe(key);

    const soft = m.clone();
    const e = [...soft.edges()][0];
    soft.setEdgeSoft(soft.he(e).origin, soft.dest(e), true);
    expect(modelKey(soft)).not.toBe(key);

    const hidden = m.clone();
    const h = [...hidden.edges()][0];
    hidden.setEdgeHidden(hidden.he(h).origin, hidden.dest(h), true);
    expect(modelKey(hidden)).not.toBe(key);

    const face = new Model();
    drawRectangle(face, GROUND_PLANE, [0, 0, 0], 10, 10);
    const flipped = face.clone();
    flipped.flipFace([...flipped.faces.keys()][0]);
    expect(modelKey(flipped)).not.toBe(modelKey(face));

    const bigger = box(10, 10, 11);
    expect(modelKey(bigger)).not.toBe(key);
    expect(new Set([key, modelKey(moved), modelKey(painted), modelKey(soft), modelKey(hidden), modelKey(flipped), modelKey(bigger)]).size).toBe(7);
  });

  it('a ray that misses an object builds no search tree for it', () => {
    const data = buildDisplayData(box());
    const [front] = meshes(data);
    useFastRaycast(front);
    const { camera } = cameraAt([5, 5, 60], [5, 5, 0]);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(0.9, 0.9), camera); // well off to the side
    expect(rc.intersectObject(front, false)).toEqual([]);
    expect(front.geometry.boundsTree).toBeUndefined();
    rc.setFromCamera(ndcOf([5, 5, 10], camera), camera);
    expect(rc.intersectObject(front, false).length).toBeGreaterThan(0);
    expect(front.geometry.boundsTree).toBeDefined();
  });
});
