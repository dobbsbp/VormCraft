import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, drawRectangle, faceArea, findFaceAt, GROUND_PLANE, initBooleanKernel, pushPull, volume, type Vec3 } from '../src/core';
import { drawEdges } from '../src/core/ops/edges';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A 100 mm cube with the face at `p` (normal `n`) deleted. */
function openBox(p: Vec3, n: Vec3) {
  const H = harness();
  pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 100);
  H.model.removeFace(findFaceAt(H.model, p, n)!);
  return H;
}

const closed = (H: ReturnType<typeof harness>) => {
  H.model.validate();
  expect(checkWatertight(H.model).watertight).toBe(true);
  expect(volume(H.model)).toBeCloseTo(1e6);
};

describe('closing an opening', () => {
  it.each([
    ['top', [50, 50, 100], [0, 0, 1], [0, 0, 100], [100, 0, 100]],
    ['bottom', [50, 50, 0], [0, 0, -1], [0, 0, 0], [100, 0, 0]],
    ['side', [100, 50, 50], [1, 0, 0], [100, 0, 0], [100, 0, 100]],
  ] as [string, Vec3, Vec3, Vec3, Vec3][])('a line traced over one edge of a deleted %s closes it', (_, p, n, a, b) => {
    const H = openBox(p, n);
    expect(checkWatertight(H.model).watertight).toBe(false);
    drawEdges(H.model, [a, b]);
    closed(H);
  });

  it('tracing the edge of a hole in a face fills the hole; a lone face gets no face behind it', () => {
    const H = harness();
    const plate = drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const inner = drawRectangle(H.model, GROUND_PLANE, [40, 40, 0], 20, 20, plate).inner!;
    H.model.removeFace(inner);
    expect(H.model.faces.size).toBe(1);
    drawEdges(H.model, [
      [40, 40, 0],
      [60, 40, 0],
    ]);
    expect(H.model.faces.size).toBe(2);
    drawEdges(H.model, [
      [0, 0, 0],
      [100, 0, 0],
    ]);
    expect(H.model.faces.size).toBe(2);
    H.model.validate();
  });

  it('with the Line tool', () => {
    const H = openBox([50, 50, 100], [0, 0, 1]);
    use(H.controller, 'line');
    H.controller.tool.pointerDown(ev(H.doc, [0, 100, 100], { kind: 'endpoint' }));
    H.controller.tool.pointerDown(ev(H.doc, [100, 100, 100], { kind: 'endpoint' }));
    closed(H);
  });

  it('with the Rectangle tool, corner to corner across the opening', () => {
    const H = openBox([50, 50, 100], [0, 0, 1]);
    const t = use(H.controller, 'rectangle');
    const side = findFaceAt(H.model, [50, 0, 50])!;
    t.pointerDown(ev(H.doc, [0, 0, 100], { kind: 'endpoint', face: side }));
    t.pointerMove(ev(H.doc, [100, 100, 100], { kind: 'endpoint', face: null }));
    t.pointerDown(ev(H.doc, [100, 100, 100], { kind: 'endpoint', face: null }));
    expect(H.controller.error).toBeNull();
    closed(H);
  });

  it('a rectangle over the open bottom fills it too (drawn the other way round)', () => {
    const H = openBox([50, 50, 0], [0, 0, -1]);
    H.controller.ctx.apply(() => drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100));
    closed(H);
  });
});

describe('Rectangle tool planes', () => {
  it('snapping the second corner to a point above turns the rectangle upright', () => {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 100);
    const t = use(H.controller, 'rectangle');
    t.pointerDown(ev(H.doc, [100, -50, 0], { face: null }));
    t.pointerMove(ev(H.doc, [100, 0, 100], { kind: 'endpoint', face: null }));
    t.pointerDown(ev(H.doc, [100, 0, 100], { kind: 'endpoint', face: null }));
    expect(H.model.findVertex([100, -50, 100])).toBeDefined();
    const f = findFaceAt(H.model, [100, -25, 50])!;
    expect(Math.abs(H.model.face(f).normal[0])).toBeCloseTo(1);
  });

  it('arrow keys fix the plane: → draws upright, facing the red axis', () => {
    const H = harness();
    const t = use(H.controller, 'rectangle');
    H.controller.toggleLock('x');
    expect(H.controller.notice).toMatch(/upright, facing the red axis/);
    t.pointerDown(ev(H.doc, [0, 0, 0], { face: null }));
    const ray = { origin: [500, 50, 80] as Vec3, dir: [-1, 0, 0] as Vec3 };
    t.pointerMove(ev(H.doc, [0, 50, 80], { face: null, snap: null, ray }));
    t.pointerDown(ev(H.doc, [0, 50, 80], { face: null, snap: null, ray }));
    expect(H.model.findVertex([0, 50, 80])).toBeDefined();
    expect(H.model.findVertex([0, 0, 80])).toBeDefined();
    H.controller.toggleLock('x');
    expect(H.controller.notice).toMatch(/unlocked/);
  });

  it('on the ground it stays flat as before', () => {
    const H = harness();
    const t = use(H.controller, 'rectangle');
    t.pointerDown(ev(H.doc, [0, 0, 0]));
    t.pointerMove(ev(H.doc, [40, 30, 0]));
    t.pointerDown(ev(H.doc, [40, 30, 0]));
    expect(H.model.findVertex([40, 30, 0])).toBeDefined();
  });
});

describe('lines between solids', () => {
  /** Two 100 mm boxes 100 apart, their fronts (y = 0) and tops (z = 100) flush. */
  const twoBoxes = () => {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 100);
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [200, 0, 0], 100, 100).inner!, 100);
    return H;
  };

  it.each([
    ['in the plane of their flush fronts', [[100, 0, 100], [200, 0, 0]], [[100, 0, 0], [200, 0, 0]], [140, 0, 30], 5000],
    ['across their flush tops', [[100, 100, 100], [200, 0, 100]], [[100, 0, 100], [200, 0, 100]], [140, 30, 100], 5000],
    ['between them, corner to corner (a rectangle)', [[100, 0, 100], [200, 0, 100]], [[100, 0, 0], [200, 0, 0]], [150, 0, 50], 10000],
  ] as [string, Vec3[], Vec3[], Vec3, number][])('lines joining corners close a face %s', (_, first, second, inside, area) => {
    const H = twoBoxes();
    const before = H.model.faces.size;
    drawEdges(H.model, first);
    drawEdges(H.model, second);
    H.model.validate();
    expect(H.model.faces.size).toBe(before + 1);
    const f = findFaceAt(H.model, inside)!;
    expect(f).toBeDefined();
    // The boxes are untouched, and the new face can be pulled into a solid.
    expect(checkWatertight(H.model, [...H.model.faces.keys()].filter((x) => x !== f)).watertight).toBe(true);
    expect(faceArea(H.model, f)).toBeCloseTo(area);
    pushPull(H.model, f, 20);
    H.model.validate();
    expect(checkWatertight(H.model).watertight).toBe(true);
  });
});
