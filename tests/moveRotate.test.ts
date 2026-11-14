import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, distance, drawEdges, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, pushPull, volume, type Vec3 } from '../src/core';
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
  it('snaps to the centre of faces, before and after the first click; drawing tools do not', () => {
    const H = boxH();
    expect(use(H.controller, 'move').inference().centres).toBe(true);
    click(H, [5, 10, 30], { kind: 'centre' });
    expect(H.controller.tool.inference()).toMatchObject({ centres: true, reference: [5, 10, 30] });
    expect(use(H.controller, 'rotate').inference().centres).toBe(true);
    expect(use(H.controller, 'scale').inference().centres).toBe(true);
    expect(use(H.controller, 'circle').inference().centres).toBe(true);
    expect(use(H.controller, 'line').inference().centres).toBeUndefined();
  });

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

  it('moving one edge of a box sideways folds the faces next to it', () => {
    const H = boxH();
    const corner = [...H.model.vertices.values()].find((v) => distance(v.pos, [10, 20, 30]) < 1e-9)!.id;
    const e = [...H.model.outgoing(corner)][0];
    H.controller.selection.set([], []);
    // Select just one corner's edge going down: moving it sideways would warp two faces.
    H.controller.selection.set([], [Math.min(e, H.model.he(e).twin)]);
    use(H.controller, 'move');
    click(H, [10, 20, 30], { kind: 'endpoint' });
    move(H, [10, 25, 30], { face: null });
    H.controller.typed('0,0,5');
    expect(H.controller.error).toBeNull();
    H.model.validate();
    expect(checkWatertight(H.model).watertight).toBe(true);
    expect(H.model.faces.size).toBeGreaterThan(6);
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

  it('copy mode ends with the copy; the next move moves', () => {
    const H = boxH();
    const t = use(H.controller, 'move');
    H.controller.toggleCopy();
    expect(t.copying!()).toBe(true);
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 0], [0, 0, -1])! });
    move(H, [5, 0, 0], { face: null });
    H.controller.typed('50');
    expect(shells(H)).toBe(2);
    expect(t.copying!()).toBe(false);
    H.controller.toggleCopy(true); // a shortcut took it back: no message
    H.controller.toggleCopy(true);
    expect(H.controller.notice).toBeNull();
  });

  it('a copy at no distance is refused (it would sit on the original)', () => {
    const H = boxH();
    use(H.controller, 'move');
    H.controller.toggleCopy();
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 0], [0, 0, -1])! });
    move(H, [5, 0, 0], { face: null });
    H.controller.typed('0');
    expect(H.controller.error).toMatch(/other than 0/);
    H.controller.typed('0,0,0');
    expect(H.controller.error).toMatch(/other than 0/);
    expect(shells(H)).toBe(1);
    // After a copy, typing 0 to change it is refused too: the copy stays where it was.
    expect(H.controller.tool.copying!()).toBe(true);
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 0], [0, 0, -1])! });
    move(H, [5, 0, 0], { face: null });
    H.controller.typed('50');
    expect(shells(H)).toBe(2);
    H.controller.typed('0');
    expect(H.controller.error).toMatch(/other than 0/);
    expect(shells(H)).toBe(2);
    expect(checkWatertight(H.model).watertight).toBe(true);
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

  it('↓ rotates about the last line pointed at, at any angle; the protractor shows ticks and the angle', () => {
    const H = boxH();
    // A line sloping up at 45° in the green-blue plane, away from the box.
    const [line] = drawEdges(H.model, [[100, 0, 0], [100, 20, 20]]).edges;
    H.controller.pointerMove({ screen: [0, 0], ray: { origin: [100, 10, 1000], dir: [0, 0, -1] }, faceHit: null, edge: line, shift: false, ctrl: false, down: false });
    H.controller.selection.set([...H.model.faces.keys()].filter((f) => H.model.isClosed(H.model.connectedFaces(f, false))), []);
    use(H.controller, 'rotate');
    H.controller.toggleLock('parallel');
    expect(H.controller.notice).toMatch(/about the line you pointed at/);
    click(H, [0, 0, 0], { kind: 'endpoint', face: null });
    click(H, [10, 0, 0], { kind: 'endpoint', face: null });
    move(H, [-10, 0, 0], { face: null });
    expect(H.controller.tool.vcbValue()).toBe('180°');
    const p = H.controller.tool.preview();
    // Ring, ticks every 15°, the 0° and current lines, the angle's arc and its value.
    expect(p.lines!.find((l) => l.points.length === 24 * 2)).toBeDefined();
    expect(p.labels).toEqual([{ at: expect.anything(), text: '180°' }]);
    click(H, [-10, 0, 0], { face: null });
    // Half a turn about (0, 1, 1): (x, y, z) → (-x, z, y).
    expect(hasVertex(H, [-10, 0, 0])).toBe(true);
    expect(hasVertex(H, [0, 0, 20])).toBe(true);
    expect(hasVertex(H, [0, 30, 0])).toBe(true);
    expect(volume(H.model, [...H.model.faces.keys()].filter((f) => H.model.isClosed(H.model.connectedFaces(f, false))))).toBeCloseTo(6000);
  });

  it('the protractor before the 0° is set: ring, ticks and a line to the cursor, no angle yet', () => {
    const H = boxH();
    use(H.controller, 'rotate');
    H.controller.toggleLock('z');
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 10, 0], [0, 0, -1])! });
    move(H, [10, 0, 0], { face: null });
    const p = H.controller.tool.preview();
    expect(p.lines).toHaveLength(3);
    expect(p.labels).toBeUndefined();
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
