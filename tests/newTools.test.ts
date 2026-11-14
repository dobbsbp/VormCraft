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
    // A length with a unit goes straight to the chord (a plain number would be the sides).
    H.controller.typed('30mm');
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

  it('every arc asks for the sides after the first click: a whole number + Enter, or Enter to keep them', () => {
    for (const [mode, rest] of [
      ['arc2', (H: ReturnType<typeof harness>) => (click(H, [40, 0, 0]), H.controller.typed('10'))],
      ['arc3', (H: ReturnType<typeof harness>) => (click(H, [20, 20, 0]), click(H, [40, 0, 0]))],
      ['arc', (H: ReturnType<typeof harness>) => (click(H, [40, 0, 0]), move(H, [0, 40, 0]), H.controller.typed('90'))],
      ['pie', (H: ReturnType<typeof harness>) => (click(H, [40, 0, 0]), move(H, [0, 40, 0]), H.controller.typed('90'))],
    ] as const) {
      const H = harness();
      use(H.controller, mode);
      click(H, [0, 0, 0]);
      expect([H.controller.tool.vcbLabel(), H.controller.tool.vcbValue()]).toEqual(['Sides', '12']);
      expect(H.controller.tool.hint()).toMatch(/number of sides/);
      H.controller.typed('6');
      expect(H.controller.error).toBeNull();
      rest(H);
      const curved = [...H.model.edges()].filter((e) => H.model.he(e).curve !== null);
      expect(curved).toHaveLength(6);
    }
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
    H.controller.enter(); // keep the sides shown
    move(H, [1, 0, 0]);
    H.controller.typed('50');
    move(H, [30, 30, 0]);
    H.controller.typed('90');
    expect(H.model.findVertex([50, 0, 0])).toBeDefined();
    expect(H.model.findVertex([0, 50, 0])).toBeDefined();
    H.controller.typed('180');
    expect(H.model.findVertex([-50, 0, 0])).toBeDefined();
  });

  it('centre arc: centre, the number of sides, then the radius, then the angle', () => {
    const H = harness();
    use(H.controller, 'arc');
    click(H, [0, 0, 0]);
    expect(H.controller.tool.vcbLabel()).toBe('Sides');
    expect(H.controller.tool.vcbValue()).toBe('12');
    H.controller.typed('40');
    expect(H.controller.tool.vcbLabel()).toBe('Radius');
    click(H, [50, 0, 0]);
    expect(H.controller.tool.vcbLabel()).toBe('Angle');
    move(H, [30, 30, 0]);
    H.controller.typed('360');
    expect([...H.model.edges()]).toHaveLength(40);
    expect(H.model.findVertex([-50, 0, 0])).toBeDefined();
  });

  it('centre arc: a radius with a unit goes straight on past the sides; a click skips the question too', () => {
    const H = harness();
    use(H.controller, 'arc');
    click(H, [0, 0, 0]);
    move(H, [1, 0, 0]);
    H.controller.typed('5cm');
    expect(H.controller.tool.vcbLabel()).toBe('Angle');
    click(H, [0, 50, 0]);
    expect([...H.model.edges()]).toHaveLength(12);
    expect(H.model.findVertex([0, 50, 0])).toBeDefined();
  });

  it('an arc from edge to edge of a box top is drawn on the top and splits it, whichever face the first click reports', () => {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 50);
    const side = findFaceAt(H.model, [0, 50, 25])!;
    const top = findFaceAt(H.model, [50, 50, 50])!;
    const faces = H.model.faces.size;
    use(H.controller, 'arc2');
    click(H, [0, 50, 50], { kind: 'onEdge', face: side }); // the edge is shared with the left side
    click(H, [50, 0, 50], { kind: 'onEdge', face: side });
    move(H, [10, 10, 50], { face: top });
    H.controller.typed('10');
    expect(H.model.faces.size).toBe(faces + 1);
    for (const e of H.model.edges()) {
      const he = H.model.he(e);
      if (he.curve !== null) expect(H.model.pos(he.origin)[2]).toBeCloseTo(50);
    }
    expect(checkWatertight(H.model).watertight).toBe(true);
  });

  it('arrow keys choose the plane: → draws upright, facing the red axis', () => {
    const H = harness();
    use(H.controller, 'arc2');
    H.controller.toggleLock('x');
    expect(H.controller.notice).toMatch(/upright, facing the red axis/);
    click(H, [0, 0, 0]);
    click(H, [0, 40, 0]);
    move(H, [0, 20, 10]);
    H.controller.typed('20');
    expect(H.model.findVertex([0, 20, 20]) ?? H.model.findVertex([0, 20, -20])).toBeDefined();
    H.controller.toggleLock('x');
    expect(H.controller.notice).toMatch(/unlocked/);
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
  /** A 100 mm cube: big enough that points on it can be clicked away from the grips (1 px per mm). */
  function boxH() {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 100);
    return H;
  }

  it('click base, reference, then drag: uniform scale of the clicked object', () => {
    const H = boxH();
    use(H.controller, 'scale');
    click(H, [30, 0, 0], { kind: 'onEdge', face: findFaceAt(H.model, [50, 50, 0], [0, 0, -1])! });
    click(H, [60, 0, 0], { kind: 'onEdge' });
    move(H, [90, 0, 0], { kind: 'onEdge' });
    expect(H.controller.tool.vcbValue()).toBe('2');
    click(H, [90, 0, 0], { kind: 'onEdge' });
    expect(volume(H.model)).toBeCloseTo(8e6);
    expect(checkWatertight(H.model).watertight).toBe(true);
  });

  it('typed factors: uniform, per axis, length, mirror; re-dimension after', () => {
    const H = boxH();
    H.controller.selection.set([findFaceAt(H.model, [50, 50, 100])!], []);
    use(H.controller, 'scale');
    click(H, [30, 0, 0], { kind: 'onEdge' });
    H.controller.typed('3');
    expect(volume(H.model)).toBeCloseTo(27e6);
    H.controller.typed('2,1,1');
    expect(volume(H.model)).toBeCloseTo(2e6);
    H.controller.typed('-1,1,1');
    expect(volume(H.model)).toBeCloseTo(1e6);
    expect(H.model.findVertex([-40, 100, 100])).toBeDefined();
    expect(checkWatertight(H.model).watertight).toBe(true);
    H.controller.undo();
    expect(volume(H.model)).toBeCloseTo(1e6);
    expect(H.model.findVertex([100, 100, 100])).toBeDefined();
  });

  it('a typed length sets the new reference distance', () => {
    const H = boxH();
    use(H.controller, 'scale');
    click(H, [30, 0, 0], { kind: 'onEdge', face: findFaceAt(H.model, [50, 50, 0], [0, 0, -1])! });
    click(H, [60, 0, 0], { kind: 'onEdge' });
    H.controller.typed('75mm');
    expect(H.model.findVertex([205, 250, 250])).toBeDefined();
  });

  it('a yellow box with grips appears round the selection, or the object pointed at', () => {
    const H = boxH();
    use(H.controller, 'scale');
    expect(H.controller.tool.preview()).toEqual({});
    move(H, [50, 50, 100]);
    const p = H.controller.tool.preview();
    expect(p.lines?.[0]).toMatchObject({ color: 'scaleBox' });
    expect(p.lines?.[0].points).toHaveLength(24);
    // 8 corners, 12 edge middles, 6 side middles.
    expect(p.grips).toHaveLength(26);
    // Over empty space it stays on that object; Esc puts it away.
    move(H, [300, 300, 0], { face: null });
    expect(H.controller.tool.preview().grips).toHaveLength(26);
    H.controller.tool.cancel();
    expect(H.controller.tool.preview()).toEqual({});
    // The selection wins, and a flat shape has grips only in its own plane.
    const flat = drawRectangle(H.model, GROUND_PLANE, [300, 0, 0], 100, 50).inner!;
    H.controller.selection.set([flat], []);
    move(H, [500, 500, 0], { face: null });
    expect(H.controller.tool.preview().grips).toHaveLength(8);
  });

  /** A free-standing 100 x 50 rectangle, selected, with the Scale tool. */
  function flatH() {
    const H = harness();
    const f = drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 50).inner!;
    H.controller.selection.set([f], []);
    use(H.controller, 'scale');
    return H;
  }
  const size = (H: ReturnType<typeof harness>) => {
    const xs = [...H.model.vertices.values()].map((v) => v.pos);
    return [0, 1].map((a) => [Math.min(...xs.map((p) => p[a])), Math.max(...xs.map((p) => p[a]))]);
  };

  it('a side grip stretches one way, from the opposite side', () => {
    const H = flatH();
    move(H, [100, 25, 0]);
    expect(H.controller.tool.hint()).toMatch(/stretch one way/);
    expect(H.controller.tool.preview().grips?.filter((g) => g.hot)).toHaveLength(1);
    click(H, [100, 25, 0]);
    move(H, [150, 25, 0], { face: null });
    expect(H.controller.tool.vcbValue()).toBe('1.5');
    click(H, [150, 25, 0], { face: null });
    expect(size(H)).toEqual([[0, 150], [0, 50]]);
    // Typing afterwards changes it, still one way only.
    H.controller.typed('3');
    expect(size(H)).toEqual([[0, 300], [0, 50]]);
  });

  it('a corner grip scales in proportion; Shift frees each way; dragging works as well as clicking', () => {
    const H = flatH();
    move(H, [100, 50, 0]);
    expect(H.controller.tool.hint()).toMatch(/^Corner: drag to scale in proportion/);
    const press = ev(H.doc, [100, 50, 0]);
    H.controller.tool.pointerDown(press);
    move(H, [200, 100, 0], { face: null });
    click(H, [200, 100, 0], { face: null });
    expect(size(H)).toEqual([[0, 200], [0, 100]]);
    H.controller.undo();
    move(H, [100, 50, 0]);
    click(H, [100, 50, 0]);
    move(H, [150, 80, 0], { face: null, shift: true });
    expect(H.controller.tool.vcbValue()).toBe('1.5, 1.6, 1');
    click(H, [150, 80, 0], { face: null, shift: true });
    expect(size(H)[0][1]).toBeCloseTo(150, 6);
    expect(size(H)[1][1]).toBeCloseTo(80, 6);
  });

  it('Ctrl scales about the centre; a typed size while dragging sets the new length', () => {
    const H = flatH();
    move(H, [100, 25, 0]);
    click(H, [100, 25, 0], { ctrl: true });
    click(H, [150, 25, 0], { face: null, ctrl: true });
    expect(size(H)).toEqual([[-50, 150], [0, 50]]);
    H.controller.undo();
    move(H, [50, 50, 0]);
    click(H, [50, 50, 0]);
    H.controller.typed('80mm');
    expect(size(H)).toEqual([[0, 100], [0, 80]]);
  });

  it('scales a solid by a corner grip in proportion, from the opposite corner', () => {
    const H = boxH();
    H.controller.selection.set([findFaceAt(H.model, [50, 50, 100])!], []);
    use(H.controller, 'scale');
    move(H, [100, 100, 100]);
    click(H, [100, 100, 100]);
    click(H, [200, 200, 0], { face: null });
    expect(volume(H.model)).toBeCloseTo(8e6);
    expect(H.model.findVertex([0, 0, 0])).toBeDefined();
    expect(H.model.findVertex([200, 200, 200])).toBeDefined();
    expect(checkWatertight(H.model).watertight).toBe(true);
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
    expect([...H.doc.labels.items.values()].map((l) => l.text)).toEqual(['30 mm', '600 mm²', '(30 mm, 20 mm, 0 mm)']);
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
    expect([...H.doc.labels.items.values()][0].text).toBe('(0 mm, 0 mm, 0 mm)');
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
