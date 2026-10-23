import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, distance, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, pushPull, volume, type Vec3 } from '../src/core';
import { parseArray } from '../src/tools/targets';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A 10 x 20 x 30 box. */
function boxH() {
  const H = harness();
  pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 20).inner!, 30);
  return H;
}

type H = ReturnType<typeof harness>;
const click = (H: H, p: Vec3, o: Parameters<typeof ev>[2] = {}) => {
  H.controller.tool.pointerMove(ev(H.doc, p, o));
  H.controller.tool.pointerDown(ev(H.doc, p, o));
};
const move = (H: H, p: Vec3, o: Parameters<typeof ev>[2] = {}) => H.controller.tool.pointerMove(ev(H.doc, p, o));
const shells = (H: H) => checkWatertight(H.model).shells;
const hasVertex = (H: H, p: Vec3) => [...H.model.vertices.values()].some((v) => distance(v.pos, p) < 1e-6);

describe('Move tool', () => {
  it('with nothing selected, moves the whole object clicked', () => {
    const H = boxH();
    use(H.controller, 'move');
    click(H, [10, 0, 30], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 30])! });
    click(H, [60, 0, 30], { kind: 'onEdge', face: null });
    expect(hasVertex(H, [50, 0, 0])).toBe(true);
    expect(hasVertex(H, [0, 0, 0])).toBe(false);
    expect(volume(H.model)).toBeCloseTo(6000);
  });

  it('typed distance follows the mouse; a typed vector works; typing again changes the move', () => {
    const H = boxH();
    use(H.controller, 'move');
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 0], [0, 0, -1])! });
    move(H, [0, 5, 0], { face: null });
    H.controller.typed('100');
    expect(hasVertex(H, [0, 100, 0])).toBe(true);
    H.controller.typed('0,0,50');
    expect(hasVertex(H, [0, 0, 50])).toBe(true);
    expect(hasVertex(H, [0, 100, 0])).toBe(false);
    H.controller.undo();
    expect(hasVertex(H, [0, 0, 0])).toBe(true);
  });

  it('moving a selected face up stretches the box', () => {
    const H = boxH();
    H.controller.selection.set([findFaceAt(H.model, [5, 10, 30])!], []);
    use(H.controller, 'move');
    click(H, [5, 10, 30]);
    move(H, [5, 10, 35], { face: null });
    H.controller.typed('10');
    expect(volume(H.model)).toBeCloseTo(10 * 20 * 40);
  });

  it('a move that would bend a face is refused with a message, model untouched', () => {
    const H = boxH();
    const corner = [...H.model.vertices.values()].find((v) => distance(v.pos, [10, 20, 30]) < 1e-9)!.id;
    const e = [...H.model.outgoing(corner)][0];
    H.controller.selection.set([], []);
    // Select just one corner's edge going down: moving it sideways warps two faces.
    H.controller.selection.set([], [Math.min(e, H.model.he(e).twin)]);
    use(H.controller, 'move');
    click(H, [10, 20, 30], { kind: 'endpoint' });
    move(H, [10, 25, 30], { face: null });
    H.controller.typed('0,0,5');
    expect(H.controller.error).toMatch(/bend a face/);
    expect(volume(H.model)).toBeCloseTo(6000);
    H.model.validate();
  });

  it('Ctrl copy, then 3x makes a row; /2 spreads copies over the distance', () => {
    const H = boxH();
    use(H.controller, 'move');
    H.controller.toggleCopy();
    expect(H.controller.notice).toMatch(/copy mode on/);
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 0], [0, 0, -1])! });
    move(H, [5, 0, 0], { face: null });
    H.controller.typed('50');
    expect(shells(H)).toBe(2);
    H.controller.typed('3x');
    expect(shells(H)).toBe(4);
    expect(hasVertex(H, [150, 0, 0])).toBe(true);
    H.controller.typed('/2');
    expect(shells(H)).toBe(3);
    expect(hasVertex(H, [25, 0, 0])).toBe(true);
    expect(hasVertex(H, [50, 0, 0])).toBe(true);
    expect(checkWatertight(H.model).watertight).toBe(true);
    H.controller.undo();
    expect(shells(H)).toBe(1);
  });

  it('arrays need a copy first', () => {
    const H = boxH();
    use(H.controller, 'move');
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 0], [0, 0, -1])! });
    move(H, [5, 0, 0], { face: null });
    H.controller.typed('50');
    H.controller.typed('3x');
    expect(H.controller.error).toMatch(/copy first/);
  });

  it('selected labels move too', () => {
    const H = boxH();
    const id = H.doc.labels.add([0, 0, 30], [0, -10, 40], 'x');
    H.controller.selection.set([findFaceAt(H.model, [5, 10, 30])!], []);
    H.controller.selection.toggleLabel(id, true);
    use(H.controller, 'move');
    click(H, [5, 10, 30]);
    move(H, [5, 10, 31], { face: null });
    H.controller.typed('5');
    expect(H.doc.labels.items.get(id)!.anchor).toEqual([0, 0, 35]);
  });
});

describe('Rotate tool', () => {
  it('with nothing selected, clicking empty space explains what to do', () => {
    const H = boxH();
    use(H.controller, 'rotate');
    const e = ev(H.doc, [500, 500, 0], { face: null });
    H.controller.pointerDown({ screen: e.screen, ray: e.ray, faceHit: null, edge: null, shift: false, ctrl: false, down: false });
    expect(H.controller.error).toMatch(/Select something first/);
  });

  it('centre on the bottom face, reference along red, 90° → box turned onto the green side', () => {
    const H = boxH();
    const bottom = findFaceAt(H.model, [5, 10, 0], [0, 0, -1])!;
    use(H.controller, 'rotate');
    H.controller.toggleLock('z'); // rotate about blue regardless of the (downward) bottom face
    click(H, [0, 0, 0], { kind: 'endpoint', face: bottom });
    click(H, [10, 0, 0], { kind: 'endpoint', face: null });
    move(H, [0, 10, 0], { face: null });
    expect(H.controller.tool.vcbValue()).toBe('90°');
    click(H, [0, 10, 0], { face: null });
    expect(hasVertex(H, [0, 10, 0])).toBe(true);
    expect(hasVertex(H, [-20, 0, 0])).toBe(true);
    expect(volume(H.model)).toBeCloseTo(6000);
  });

  it('the angle snaps to 15° steps near them', () => {
    const H = boxH();
    const bottom = findFaceAt(H.model, [5, 10, 0], [0, 0, -1])!;
    use(H.controller, 'rotate');
    H.controller.toggleLock('z');
    click(H, [0, 0, 0], { kind: 'endpoint', face: bottom });
    click(H, [10, 0, 0], { kind: 'onEdge', face: null });
    const a = (31 * Math.PI) / 180;
    move(H, [10 * Math.cos(a), 10 * Math.sin(a), 0], { face: null });
    expect(H.controller.tool.vcbValue()).toBe('30°');
    const b = (37 * Math.PI) / 180;
    move(H, [10 * Math.cos(b), 10 * Math.sin(b), 0], { face: null });
    expect(H.controller.tool.vcbValue()).toBe('37°');
  });

  it('typed angle, then typing again changes it; Ctrl copy + 4x makes a polar array', () => {
    const H = boxH();
    const bottom = findFaceAt(H.model, [5, 10, 0], [0, 0, -1])!;
    use(H.controller, 'rotate');
    H.controller.toggleLock('z');
    H.controller.toggleCopy();
    click(H, [-50, 0, 0], { face: bottom });
    click(H, [0, 0, 0], { kind: 'endpoint', face: null });
    H.controller.typed('90');
    expect(shells(H)).toBe(2);
    H.controller.typed('3x');
    expect(shells(H)).toBe(4);
    expect(checkWatertight(H.model).watertight).toBe(true);
    // The copy rotated 180° about (-50, 0, 0) puts the old (0,0,0) corner at (-100, 0, 0).
    expect(hasVertex(H, [-100, 0, 0])).toBe(true);
  });

  it('the face clicked sets the axis: rotating about the front face normal', () => {
    const H = boxH();
    const front = findFaceAt(H.model, [5, 0, 15])!;
    use(H.controller, 'rotate');
    click(H, [0, 0, 0], { kind: 'endpoint', face: front });
    click(H, [10, 0, 0], { kind: 'endpoint', face: null });
    H.controller.typed('90');
    // About -Y through the origin: +X goes to +Z... (right-hand rule about the front normal, -Y).
    expect(hasVertex(H, [0, 0, 10])).toBe(true);
    expect(volume(H.model)).toBeCloseTo(6000);
  });
});

describe('array parsing', () => {
  it('reads 3x, x3, *3 and /3', () => {
    expect(parseArray('3x')).toEqual({ count: 3, divide: false });
    expect(parseArray('x3')).toEqual({ count: 3, divide: false });
    expect(parseArray('*3')).toEqual({ count: 3, divide: false });
    expect(parseArray('/3')).toEqual({ count: 3, divide: true });
    expect(parseArray('30')).toBeUndefined();
  });
});
