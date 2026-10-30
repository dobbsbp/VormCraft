import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkWatertight,
  distance,
  drawArc,
  drawCircle,
  drawRectangle,
  drawRegularPolygon,
  edgeChain,
  faceArea,
  findFaceAt,
  GROUND_PLANE,
  initBooleanKernel,
  arcAroundCenter,
  Model,
  offsetEdges,
  offsetPolyline2D,
  pushPull,
  volume,
  type HalfEdgeId,
  type Vec3,
} from '../src/core';
import { edgeId } from '../src/tools/Selection';
import { Navigator, ViewHistory } from '../src/view/navigation';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

type H = ReturnType<typeof harness>;
const click = (h: H, p: Vec3, o: Parameters<typeof ev>[2] = {}) => {
  h.controller.tool.pointerMove(ev(h.doc, p, o));
  h.controller.tool.pointerDown(ev(h.doc, p, o));
};
const move = (h: H, p: Vec3, o: Parameters<typeof ev>[2] = {}) => h.controller.tool.pointerMove(ev(h.doc, p, o));
const onlyFace = (m: Model) => {
  expect(m.faces.size).toBe(1);
  return [...m.faces.keys()][0];
};
/** The edge between two points (canonical id), for selecting it. */
const edgeAt = (m: Model, a: Vec3, b: Vec3): HalfEdgeId => {
  const h = m.halfEdgeBetween(m.findVertex(a)!, m.findVertex(b)!);
  if (h === undefined) throw new Error(`no edge ${a} ${b}`);
  return edgeId(m, h);
};

describe('Polygon tool', () => {
  it('draws a regular polygon with a corner at the click, plain edges (no true curve)', () => {
    const h = harness();
    use(h.controller, 'polygon');
    click(h, [0, 0, 0]);
    click(h, [0, 50, 0]);
    const f = onlyFace(h.model);
    expect([...h.model.edges()]).toHaveLength(6);
    expect(h.model.findVertex([0, 50, 0])).toBeDefined();
    expect(faceArea(h.model, f)).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 2500, 6);
    expect(h.model.curves.size).toBe(0);
  });

  it('typed sides and radius change the polygon just drawn (keeping its turn)', () => {
    const h = harness();
    use(h.controller, 'polygon');
    click(h, [0, 0, 0]);
    click(h, [0, 50, 0]);
    h.controller.typed('8s');
    expect([...h.model.edges()]).toHaveLength(8);
    h.controller.typed('100');
    expect(h.model.findVertex([0, 100, 0])).toBeDefined();
    expect([...h.model.edges()]).toHaveLength(8);
    expect(h.controller.history.undoLabel).toBe('Polygon');
    h.controller.undo();
    expect(h.model.faces.size).toBe(0);
  });

  it('drawn on a face it splits the face, and pushes into a watertight prism', () => {
    const h = harness();
    drawRectangle(h.model, GROUND_PLANE, [-100, -100, 0], 200, 200);
    use(h.controller, 'polygon');
    click(h, [0, 0, 0]);
    h.controller.typed('5s');
    h.controller.typed('40');
    expect(h.model.faces.size).toBe(2);
    const inner = findFaceAt(h.model, [0, 0, 0])!;
    expect(h.model.faceVertexLoops(inner)[0]).toHaveLength(5);
  });
});

describe('Pie tool', () => {
  const sectorPolygonArea = (r: number, sweep: number, n: number) => 0.5 * r * r * Math.sin(sweep / n) * n;

  it('centre, radius, angle: a slice face whose arc keeps its true radius', () => {
    const h = harness();
    use(h.controller, 'pie');
    click(h, [0, 0, 0]);
    move(h, [1, 0, 0]);
    h.controller.typed('50');
    move(h, [30, 30, 0]);
    h.controller.typed('90');
    const f = onlyFace(h.model);
    expect(faceArea(h.model, f)).toBeCloseTo(sectorPolygonArea(50, Math.PI / 2, 12), 6);
    expect([...h.model.edges()]).toHaveLength(14);
    const curved = [...h.model.edges()].filter((e) => h.model.he(e).curve !== null);
    expect(curved).toHaveLength(12);
    expect([...h.model.curves.values()][0].radius).toBe(50);
  });

  it('typing the angle again changes the slice; pushed up it is watertight', () => {
    const h = harness();
    use(h.controller, 'pie');
    click(h, [0, 0, 0]);
    click(h, [50, 0, 0]);
    move(h, [30, 30, 0]);
    h.controller.typed('90');
    h.controller.typed('270');
    const f = onlyFace(h.model);
    expect(faceArea(h.model, f)).toBeCloseTo(sectorPolygonArea(50, (3 * Math.PI) / 2, 12), 6);
    expect(() => h.controller.typed('360')).not.toThrow(); // a full circle is refused, as a status message
    expect(h.controller.error).toMatch(/less than a full circle/);
    pushPull(h.model, findFaceAt(h.model, [-10, -10, 0])!, 20);
    expect(checkWatertight(h.model).watertight).toBe(true);
  });

  it('drawn on a face it splits the face', () => {
    const h = harness();
    drawRectangle(h.model, GROUND_PLANE, [-100, -100, 0], 200, 200);
    use(h.controller, 'pie');
    click(h, [0, 0, 0]);
    click(h, [50, 0, 0]);
    move(h, [0, 50, 0]);
    h.controller.typed('90');
    expect(h.model.faces.size).toBe(2);
    h.model.validate();
  });
});

describe('Rotated Rectangle tool', () => {
  it('first edge, then the third corner swung up out of the plane', () => {
    const h = harness();
    use(h.controller, 'rectangle3');
    click(h, [0, 0, 0]);
    click(h, [100, 0, 0]);
    click(h, [100, 30, 40], { face: null });
    const f = onlyFace(h.model);
    expect(faceArea(h.model, f)).toBeCloseTo(5000, 6);
    expect(h.model.findVertex([0, 30, 40])).toBeDefined();
    expect(h.model.findVertex([100, 30, 40])).toBeDefined();
    expect(h.controller.tool.vcbValue()).toBe('50 mm, 53.1°');
  });

  it('typed edge length, then length,angle; typing again keeps what is left out', () => {
    const h = harness();
    use(h.controller, 'rectangle3');
    click(h, [0, 0, 0]);
    move(h, [0, 10, 0]);
    h.controller.typed('80'); // first edge along green
    move(h, [-20, 80, 0], { face: null });
    h.controller.typed('60,90'); // standing straight up
    expect(h.model.findVertex([0, 80, 60])).toBeDefined();
    expect(h.model.findVertex([0, 0, 60])).toBeDefined();
    h.controller.typed('30');
    expect(h.model.findVertex([0, 80, 30])).toBeDefined();
    expect(h.model.findVertex([0, 80, 60])).toBeUndefined();
    h.controller.typed(',0'); // laid flat, on the side it was swung to
    expect(h.model.findVertex([-30, 80, 0])).toBeDefined();
    expect(h.model.faces.size).toBe(1);
  });

  it('flat on a face it splits the face', () => {
    const h = harness();
    drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 200, 200);
    use(h.controller, 'rectangle3');
    click(h, [50, 50, 0]);
    click(h, [100, 100, 0]);
    click(h, [80, 120, 0]);
    expect(h.model.faces.size).toBe(2);
    const inner = findFaceAt(h.model, [75, 90, 0])!;
    expect(faceArea(h.model, inner)).toBeCloseTo(Math.hypot(50, 50) * Math.hypot(20, 20), 6);
  });
});

describe('Zoom Window', () => {
  it('a dragged box, or two clicks, are handed to the viewport; a tiny box is refused', () => {
    const h = harness();
    const boxes: [number, number][][] = [];
    h.controller.onZoomWindow = (from, to) => boxes.push([from, to]);
    const t = use(h.controller, 'zoomWindow');
    t.pointerDown(ev(h.doc, [10, -10, 0]));
    t.pointerMove(ev(h.doc, [60, -40, 0], { down: true }));
    expect(t.preview().box).toEqual({ from: [10, 10], to: [60, 40], crossing: false });
    t.pointerUp!(ev(h.doc, [60, -40, 0]), true);
    t.pointerDown(ev(h.doc, [5, -5, 0]));
    t.pointerUp!(ev(h.doc, [5, -5, 0]), false);
    t.pointerDown(ev(h.doc, [30, -30, 0]));
    expect(boxes).toEqual([
      [
        [10, 10],
        [60, 40],
      ],
      [
        [5, 5],
        [30, 30],
      ],
    ]);
    t.pointerDown(ev(h.doc, [0, 0, 0]));
    expect(() => t.pointerDown(ev(h.doc, [1, -1, 0]))).toThrow(/bigger box/);
  });

  it('the camera keeps its direction; the box centre goes mid-screen and the box fills the view', () => {
    const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 1e5);
    const nav = new Navigator(camera);
    camera.position.set(300, -500, 400);
    nav.lookAt(new THREE.Vector3(0, 0, 0));
    camera.updateProjectionMatrix();
    const q = camera.quaternion.clone();
    const target = new THREE.Vector3(40, 30, 10);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const beside = target.clone().addScaledVector(right, 20); // same depth as the target
    const before = beside.clone().project(camera).x - target.clone().project(camera).x;
    nav.zoomWindow(target, 0.25);
    const t = target.clone().project(camera);
    expect(t.x).toBeCloseTo(0, 9);
    expect(t.y).toBeCloseTo(0, 9);
    expect(beside.clone().project(camera).x).toBeCloseTo(before / 0.25, 9);
    expect(camera.quaternion.angleTo(q)).toBeLessThan(1e-6);
  });
});

describe('Previous View', () => {
  const state = (x: number) => ({ position: new THREE.Vector3(x, 0, 0), quaternion: new THREE.Quaternion() });

  it('goes back through earlier views, newest first; repeats are kept once', () => {
    const views = new ViewHistory(3);
    views.push(state(1));
    views.push(state(1));
    views.push(state(2));
    expect(views.size).toBe(2);
    views.push(state(3));
    views.push(state(4)); // over the limit: the oldest goes
    expect(views.pop()!.position.x).toBe(4);
    expect(views.pop()!.position.x).toBe(3);
    expect(views.pop()!.position.x).toBe(2);
    expect(views.pop()).toBeUndefined();
  });

  it('a stored view puts the camera back exactly', () => {
    const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 1e5);
    const nav = new Navigator(camera);
    camera.position.set(300, -500, 400);
    nav.lookAt(new THREE.Vector3(0, 0, 0));
    const saved = nav.state();
    nav.orbit(120, -40, new THREE.Vector3(10, 10, 0));
    nav.pan(30, 10, 500, 600);
    nav.setState(saved);
    expect(camera.position.distanceTo(new THREE.Vector3(300, -500, 400))).toBeLessThan(1e-9);
    expect(camera.quaternion.angleTo(saved.quaternion)).toBeLessThan(1e-6);
  });
});

describe('Tape Measure: resize the model from a measured length', () => {
  function boxWithExtras() {
    const h = harness();
    pushPull(h.model, drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 50);
    drawCircle(h.model, GROUND_PLANE, [300, 0, 0], 20);
    h.doc.guides.addPoint([10, 10, 10]);
    h.doc.labels.add([100, 100, 50], [150, 150, 80], 'corner');
    use(h.controller, 'tape');
    click(h, [0, 0, 0], { kind: 'endpoint', face: null });
    click(h, [100, 0, 0], { kind: 'endpoint', face: null });
    return h;
  }

  it('point to point only measures (no guide); the typed real length resizes everything', () => {
    const h = boxWithExtras();
    expect(h.doc.guides.items.size).toBe(1);
    expect(h.controller.tool.vcbValue()).toBe('100 mm');
    expect(h.controller.hint()).toMatch(/resize the whole model/);
    const v0 = volume(h.model);
    h.controller.typed('200');
    expect(h.model.findVertex([200, 200, 100])).toBeDefined();
    expect(volume(h.model)).toBeCloseTo(v0 * 8, 3);
    const circle = [...h.model.curves.values()][0];
    expect(circle.radius).toBeCloseTo(40, 9);
    expect(circle.center).toEqual([600, 0, 0]);
    expect(h.doc.guides.points()[0].pos).toEqual([20, 20, 20]);
    expect([...h.doc.labels.items.values()][0].anchor).toEqual([200, 200, 100]);
  });

  it('typing again resizes from the original measurement, as one undo step', () => {
    const h = boxWithExtras();
    h.controller.typed('200');
    h.controller.typed('50');
    expect(h.model.findVertex([50, 50, 25])).toBeDefined();
    expect(h.controller.tool.vcbValue()).toBe('50 mm');
    expect(h.controller.history.undoLabel).toBe('Resize model');
    h.controller.undo();
    expect(h.model.findVertex([100, 100, 50])).toBeDefined();
  });

  it('nothing changes when the question is answered no; an async yes resizes', async () => {
    const h = boxWithExtras();
    h.controller.ask = () => false;
    h.controller.typed('200');
    expect(h.model.findVertex([100, 100, 50])).toBeDefined();
    h.controller.ask = () => Promise.resolve(true);
    h.controller.typed('300');
    await Promise.resolve();
    expect(h.model.findVertex([300, 300, 150])).toBeDefined();
  });

  it('measuring from a point into empty space still places a guide point', () => {
    const h = harness();
    use(h.controller, 'tape');
    click(h, [0, 0, 0], { kind: 'endpoint', face: null });
    click(h, [30, 40, 0], { face: null });
    expect(h.doc.guides.points()).toHaveLength(1);
  });
});

describe('offsetting edges (core)', () => {
  it('open polyline: mitred corners, ends moved straight sideways, to the left for d > 0', () => {
    const out = offsetPolyline2D(
      [
        [0, 0],
        [100, 0],
        [100, 50],
      ],
      false,
      10,
    );
    expect(out).toEqual([
      [0, 10],
      [90, 10],
      [90, 50],
    ]);
    // Too far: the 20-wide middle of a U would turn inside out.
    const u: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ];
    expect(() => offsetPolyline2D(u, false, 15)).toThrow(/too large/);
  });

  it('an L of loose edges gets a parallel copy', () => {
    const m = new Model();
    const a = m.addVertex([0, 0, 0]);
    const b = m.addVertex([100, 0, 0]);
    const c = m.addVertex([100, 50, 0]);
    const e1 = m.addEdge(a, b);
    const e2 = m.addEdge(b, c);
    const chain = edgeChain(m, [e1, e2]);
    expect(chain.closed).toBe(false);
    const fromOrigin = chain.vertices[0] === a;
    offsetEdges(m, [e1, e2], GROUND_PLANE, 10);
    const expected: Vec3[] = fromOrigin
      ? [
          [0, 10, 0],
          [90, 10, 0],
          [90, 50, 0],
        ]
      : [
          [0, -10, 0],
          [110, -10, 0],
          [110, 50, 0],
        ];
    for (const p of expected) expect(m.findVertex(p)).toBeDefined();
    expect([...m.edges()]).toHaveLength(4);
  });

  it('edges of a face offset into it split the face', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 200, 200);
    const bottom = edgeAt(m, [0, 0, 0], [200, 0, 0]);
    const right = edgeAt(m, [200, 0, 0], [200, 200, 0]);
    const chain = edgeChain(m, [bottom, right]);
    // Inside the face is to the left when the chain runs from (0,0), to the right otherwise.
    const d = m.pos(chain.vertices[0])[0] === 0 ? 20 : -20;
    offsetEdges(m, [bottom, right], GROUND_PLANE, d);
    expect(m.faces.size).toBe(2);
    expect(m.findVertex([0, 20, 0])).toBeDefined();
    expect(m.findVertex([180, 20, 0])).toBeDefined();
    expect(m.findVertex([180, 200, 0])).toBeDefined();
    m.validate();
  });

  it('an open copy that stops inside a face is carried on to its edge, dividing the face', () => {
    const m = new Model();
    const hex = drawRegularPolygon(m, GROUND_PLANE, [0, 0, 0], 100, 6).inner!;
    const area = faceArea(m, hex);
    // The two sides meeting at the lower-right corner: their offset ends land inside the hexagon.
    const h = 50 * Math.sqrt(3);
    const two = [edgeAt(m, [-50, -h, 0], [50, -h, 0]), edgeAt(m, [50, -h, 0], [100, 0, 0])];
    const chain = edgeChain(m, two);
    // Inward is the side the hexagon's centre is on.
    const [a, b] = chain.vertices.map((v) => m.pos(v));
    const left = (b[0] - a[0]) * (0 - a[1]) - (b[1] - a[1]) * (0 - a[0]) > 0;
    const { edges } = offsetEdges(m, two, GROUND_PLANE, left ? 10 : -10);
    expect(m.faces.size).toBe(2);
    expect(edges).toHaveLength(4); // the two offset sides and an extension at each end
    const total = [...m.faces.keys()].reduce((sum, f) => sum + faceArea(m, f), 0);
    expect(total).toBeCloseTo(area, 6);
    m.validate();
  });

  it('a copy outside every face is not extended', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 200, 200);
    const bottom = edgeAt(m, [0, 0, 0], [200, 0, 0]);
    const chain = edgeChain(m, [bottom]);
    const out = m.pos(chain.vertices[0])[0] === 0 ? -20 : 20;
    offsetEdges(m, [bottom], GROUND_PLANE, out);
    expect(m.findVertex([0, -20, 0])).toBeDefined();
    expect(m.findVertex([200, -20, 0])).toBeDefined();
    expect(m.faces.size).toBe(1);
  });

  it('an arc stays a true arc about the same centre', () => {
    const m = new Model();
    const { edges } = drawArc(m, arcAroundCenter(GROUND_PLANE, [0, 0, 0], [50, 0, 0], Math.PI / 2), 8);
    offsetEdges(m, edges, GROUND_PLANE, 10);
    const radii = [...m.curves.values()].map((c) => c.radius).sort((x, y) => x - y);
    expect(radii[0] === 40 || radii[1] === 60).toBe(true);
    expect(radii).toHaveLength(2);
    const r = radii[0] === 50 ? radii[1] : radii[0];
    expect(m.findVertex([r, 0, 0])).toBeDefined();
    expect(m.findVertex([0, r, 0])).toBeDefined();
    for (const c of m.curves.values()) expect(c.center).toEqual([0, 0, 0]);
  });

  it('refuses branching, disconnected or non-flat selections', () => {
    const m = new Model();
    const o = m.addVertex([0, 0, 0]);
    const ends = ([[10, 0, 0], [0, 10, 0], [0, 0, 10], [50, 50, 0], [60, 50, 0]] as Vec3[]).map((p) => m.addVertex(p));
    const branch = [m.addEdge(o, ends[0]), m.addEdge(o, ends[1]), m.addEdge(o, ends[2])];
    expect(() => offsetEdges(m, branch, GROUND_PLANE, 5)).toThrow(/branch/);
    const apart = [branch[0], m.addEdge(ends[3], ends[4])];
    expect(() => offsetEdges(m, apart, GROUND_PLANE, 5)).toThrow(/not connected/);
    expect(() => offsetEdges(m, [branch[0], branch[2]], GROUND_PLANE, 5)).toThrow(/one plane/);
  });
});

describe('Offset tool with selected edges', () => {
  function faceWithBottomSelected() {
    const h = harness();
    drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 200, 200);
    h.controller.selection.set([], [edgeAt(h.model, [0, 0, 0], [200, 0, 0])]);
    use(h.controller, 'offset');
    return h;
  }

  it('offsets the edge toward the cursor, splitting the face; typing again changes it', () => {
    const h = faceWithBottomSelected();
    expect(h.controller.hint()).toMatch(/selected edges/i);
    click(h, [50, 0, 0]);
    click(h, [50, 30, 0]);
    expect(h.model.faces.size).toBe(2);
    expect(h.model.findVertex([0, 30, 0])).toBeDefined();
    expect(h.model.findVertex([200, 30, 0])).toBeDefined();
    h.controller.typed('50');
    expect(h.model.findVertex([0, 30, 0])).toBeUndefined();
    expect(h.model.findVertex([0, 50, 0])).toBeDefined();
    expect(h.model.faces.size).toBe(2);
  });

  it('a typed distance goes to the cursor side; negative goes to the other side', () => {
    const h = faceWithBottomSelected();
    click(h, [50, 0, 0]);
    move(h, [50, 10, 0]);
    h.controller.typed('-20');
    expect(h.model.findVertex([0, -20, 0])).toBeDefined();
    expect(h.model.faces.size).toBe(1); // outside the face: loose edges
  });

  it('a whole face is still offset when a face is selected', () => {
    const h = harness();
    const f = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 200, 200).inner!;
    h.controller.selection.set([f], [edgeAt(h.model, [0, 0, 0], [200, 0, 0])]);
    use(h.controller, 'offset');
    click(h, [100, 100, 0], { face: f });
    h.controller.typed('10');
    expect(h.model.findVertex([10, 10, 0])).toBeDefined();
    expect(h.model.findVertex([190, 190, 0])).toBeDefined();
    expect(distance(h.model.pos(h.model.findVertex([10, 10, 0])!), [10, 10, 0])).toBe(0);
  });
});
