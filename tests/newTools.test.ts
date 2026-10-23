import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, distance, drawRectangle, faceArea, findFaceAt, GROUND_PLANE, initBooleanKernel, pushPull, volume, type Vec3 } from '../src/core';
import { Document } from '../src/doc/Document';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const click = (H: ReturnType<typeof harness>, p: Vec3, o: Parameters<typeof ev>[2] = {}) => {
  H.controller.tool.pointerMove(ev(H.doc, p, o));
  H.controller.tool.pointerDown(ev(H.doc, p, o));
};
const move = (H: ReturnType<typeof harness>, p: Vec3, o: Parameters<typeof ev>[2] = {}) => H.controller.tool.pointerMove(ev(H.doc, p, o));

describe('Line tool', () => {
  it('chains lines and makes a face when the loop closes, ending the chain', () => {
    const H = harness();
    use(H.controller, 'line');
    for (const p of [
      [0, 0, 0],
      [40, 0, 0],
      [40, 30, 0],
      [0, 30, 0],
    ] as Vec3[])
      click(H, p);
    expect(H.model.faces.size).toBe(0);
    click(H, [0, 0, 0], { kind: 'endpoint' });
    expect(H.model.faces.size).toBe(1);
    expect(faceArea(H.model, [...H.model.faces.keys()][0])).toBeCloseTo(1200);
    expect(H.controller.tool.preview()).toEqual({});
    // Each segment is its own undo step.
    H.controller.undo();
    expect(H.model.faces.size).toBe(0);
    expect([...H.model.edges()]).toHaveLength(3);
  });

  it('typed length follows the mouse direction; typing again changes the last segment', () => {
    const H = harness();
    use(H.controller, 'line');
    click(H, [0, 0, 0]);
    move(H, [3, 4, 0]);
    H.controller.typed('50');
    expect(H.model.findVertex([30, 40, 0])).toBeDefined();
    H.controller.typed('10cm');
    expect(H.model.findVertex([30, 40, 0])).toBeUndefined();
    expect(H.model.findVertex([60, 80, 0])).toBeDefined();
    expect([...H.model.edges()]).toHaveLength(1);
  });

  it('a line across a face splits it', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100);
    use(H.controller, 'line');
    click(H, [30, 0, 0], { kind: 'onEdge' });
    click(H, [30, 100, 0], { kind: 'onEdge' });
    expect(H.model.faces.size).toBe(2);
  });

  it('arrow-key lock keeps the line on the blue axis', () => {
    const H = harness();
    use(H.controller, 'line');
    click(H, [10, 10, 0]);
    H.controller.toggleLock('z');
    // A ray from the side passing the vertical line through the start at z = 25.
    H.controller.pointerMove({ screen: [0, 0], ray: { origin: [10, -100, 25], dir: [0, 1, 0] }, faceHit: null, edge: null, shift: false, ctrl: false, down: false });
    H.controller.typed('25');
    expect(H.model.findVertex([10, 10, 25])).toBeDefined();
  });

  it('double-click ends the chain without closing it', () => {
    const H = harness();
    use(H.controller, 'line');
    click(H, [0, 0, 0]);
    click(H, [10, 0, 0]);
    H.controller.tool.doubleClick!(ev(H.doc, [10, 0, 0]));
    move(H, [10, 10, 0]);
    expect(H.controller.tool.preview()).toEqual({});
  });
});

describe('arc tools', () => {
  it('2-point arc: clicks for the ends, typed bulge; typing again changes it', () => {
    const H = harness();
    use(H.controller, 'arc2');
    click(H, [0, 0, 0]);
    click(H, [40, 0, 0]);
    move(H, [20, 10, 0]);
    H.controller.typed('20');
    const curves = [...H.model.curves.values()];
    expect(curves).toHaveLength(1);
    expect(curves[0].radius).toBeCloseTo(20); // bulge = half chord: semicircle
    expect(H.model.findVertex([20, 20, 0])).toBeDefined();
    H.controller.typed('10');
    expect([...H.model.curves.values()][0].radius).toBeCloseTo(25);
    expect(H.model.findVertex([20, 10, 0])).toBeDefined();
    expect([...H.model.edges()]).toHaveLength(12);
  });

  it('2-point arc: typed chord length after the first click', () => {
    const H = harness();
    use(H.controller, 'arc2');
    click(H, [0, 0, 0]);
    move(H, [5, 0, 0]);
    H.controller.typed('30');
    move(H, [15, -4, 0]);
    H.controller.typed('5');
    expect(H.model.findVertex([30, 0, 0])).toBeDefined();
    expect(H.model.findVertex([15, -5, 0])).toBeDefined(); // bulged to the side the mouse was on
  });

  it('segment count can be typed', () => {
    const H = harness();
    use(H.controller, 'arc2');
    H.controller.typed('6s');
    click(H, [0, 0, 0]);
    click(H, [40, 0, 0]);
    H.controller.typed('20');
    expect([...H.model.edges()]).toHaveLength(6);
    H.controller.typed('18s');
    expect([...H.model.edges()]).toHaveLength(18);
  });

  it('3-point arc passes through the middle click', () => {
    const H = harness();
    use(H.controller, 'arc3');
    click(H, [0, 0, 0]);
    click(H, [10, 10, 0]);
    click(H, [20, 0, 0]);
    const c = [...H.model.curves.values()][0];
    expect(c.radius).toBeCloseTo(10);
    expect(distance(c.center, [10, 0, 0])).toBeLessThan(1e-9);
  });

  it('centre arc: typed radius and angle', () => {
    const H = harness();
    use(H.controller, 'arc');
    click(H, [0, 0, 0]);
    move(H, [1, 0, 0]);
    H.controller.typed('50');
    move(H, [30, 30, 0]);
    H.controller.typed('90');
    expect(H.model.findVertex([50, 0, 0])).toBeDefined();
    expect(H.model.findVertex([0, 50, 0])).toBeDefined();
    H.controller.typed('180');
    expect(H.model.findVertex([-50, 0, 0])).toBeDefined();
  });

  it('an arc closing a shape with a line makes a face', () => {
    const H = harness();
    use(H.controller, 'line');
    click(H, [0, 0, 0]);
    click(H, [40, 0, 0]);
    H.controller.escape();
    use(H.controller, 'arc2');
    click(H, [0, 0, 0], { kind: 'endpoint' });
    click(H, [40, 0, 0], { kind: 'endpoint' });
    H.controller.typed('20');
    expect(H.model.faces.size).toBe(1);
  });
});

describe('Scale tool', () => {
  function boxH() {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!, 10);
    return H;
  }

  it('click base, reference, then drag: uniform scale of the clicked object', () => {
    const H = boxH();
    use(H.controller, 'scale');
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 5, 0], [0, 0, -1])! });
    click(H, [10, 0, 0], { kind: 'endpoint' });
    move(H, [20, 0, 0], { kind: 'onEdge' });
    expect(H.controller.tool.vcbValue()).toBe('2');
    click(H, [20, 0, 0], { kind: 'onEdge' });
    expect(volume(H.model)).toBeCloseTo(8000);
    expect(checkWatertight(H.model).watertight).toBe(true);
  });

  it('typed factors: uniform, per axis, length, mirror; re-dimension after', () => {
    const H = boxH();
    H.controller.selection.set([findFaceAt(H.model, [5, 5, 10])!], []);
    use(H.controller, 'scale');
    click(H, [0, 0, 0], { kind: 'endpoint' });
    H.controller.typed('3');
    expect(volume(H.model)).toBeCloseTo(27000);
    H.controller.typed('2,1,1');
    expect(volume(H.model)).toBeCloseTo(2000);
    H.controller.typed('-1,1,1');
    expect(volume(H.model)).toBeCloseTo(1000);
    expect(H.model.findVertex([-10, 10, 10])).toBeDefined();
    expect(checkWatertight(H.model).watertight).toBe(true);
    H.controller.undo();
    expect(volume(H.model)).toBeCloseTo(1000);
    expect(H.model.findVertex([10, 10, 10])).toBeDefined();
  });

  it('a typed length sets the new reference distance', () => {
    const H = boxH();
    use(H.controller, 'scale');
    click(H, [0, 0, 0], { kind: 'endpoint', face: findFaceAt(H.model, [5, 5, 0], [0, 0, -1])! });
    click(H, [10, 0, 0], { kind: 'endpoint' });
    H.controller.typed('25mm');
    expect(H.model.findVertex([25, 25, 25])).toBeDefined();
  });

  it('with nothing selected or clicked it explains what to do', () => {
    const H = boxH();
    use(H.controller, 'scale');
    H.controller.pointerDown({ screen: [0, 0], ray: { origin: [500, 500, 100], dir: [0, 0, -1] }, faceHit: null, edge: null, shift: false, ctrl: false, down: false });
    expect(H.controller.error).toMatch(/Select something/);
  });
});

describe('Text tool (labels)', () => {
  it('labels an edge with its length, a face with its area, a point with coordinates', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 30, 20);
    const edge = [...H.model.edges()].find((e) => {
      const a = H.model.pos(H.model.he(e).origin);
      const b = H.model.pos(H.model.dest(e));
      return a[1] === 0 && b[1] === 0;
    })!;
    use(H.controller, 'text');
    click(H, [10, 0, 0], { kind: 'onEdge', edge, face: null });
    click(H, [10, -20, 10], { face: null });
    click(H, [10, 10, 0]);
    click(H, [10, 10, 20]);
    click(H, [30, 20, 0], { kind: 'endpoint', face: null });
    click(H, [40, 30, 0], { face: null });
    expect([...H.doc.labels.items.values()].map((l) => l.text)).toEqual(['30 mm', '600 mm²', '(30, 20, 0)']);
  });

  it('typing replaces the text of the label just placed; one undo per change', () => {
    const H = harness();
    use(H.controller, 'text');
    click(H, [0, 0, 0]);
    click(H, [0, 0, 10]);
    expect(H.controller.tool.acceptsText!()).toBe(true);
    H.controller.typed('Mounting hole M4');
    expect([...H.doc.labels.items.values()][0].text).toBe('Mounting hole M4');
    H.controller.undo();
    expect([...H.doc.labels.items.values()][0].text).toBe('(0, 0, 0)');
    H.controller.undo();
    expect(H.doc.labels.items.size).toBe(0);
  });

  it('clicking a label with the Text tool edits it; with Select it selects it, and Delete removes it', () => {
    const H = harness();
    const id = H.doc.labels.add([0, 0, 0], [0, 0, 10], 'old');
    use(H.controller, 'text');
    H.controller.labelClicked(id, false);
    H.controller.typed('new');
    expect(H.doc.labels.items.get(id)!.text).toBe('new');
    use(H.controller, 'select');
    H.controller.labelClicked(id, false);
    expect([...H.controller.selection.labels]).toEqual([id]);
    H.controller.deleteSelection();
    expect(H.doc.labels.items.size).toBe(0);
    H.controller.undo();
    expect(H.doc.labels.items.size).toBe(1);
  });

  it('labels are saved and opened', () => {
    const doc = new Document();
    doc.labels.add([1, 2, 3], [4, 5, 6], 'Note');
    const back = parseDocument(serializeDocument(doc));
    expect([...back.labels.items.values()]).toEqual([{ id: 1, anchor: [1, 2, 3], position: [4, 5, 6], text: 'Note' }]);
  });
});
