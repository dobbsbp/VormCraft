import { beforeAll, describe, expect, it } from 'vitest';
import {
  arcThroughPoints,
  checkWatertight,
  drawArc,
  drawCircle,
  drawRectangle,
  faceArea,
  findFaceAt,
  GROUND_PLANE,
  initBooleanKernel,
  normalize,
  pushPull,
  sub,
  volume,
  type Model,
  type Vec3,
} from '../src/core';
import { Document } from '../src/doc/Document';
import { parseLength, parseLengths, parseSegments } from '../src/tools/units';
import { ev, harness, sideRay, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A 100 x 100 x 20 box (top at z = 20) in a fresh harness. */
function boxHarness(w = 100, d = 100, h = 20) {
  const H = harness();
  pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], w, d).inner!, h);
  return H;
}

const edgeBetween = (m: Model, a: [number, number, number], b: [number, number, number]) => {
  const va = m.findVertex(a)!;
  const vb = m.findVertex(b)!;
  const h = m.halfEdgeBetween(va, vb)!;
  return Math.min(h, m.he(h).twin);
};

describe('typed input parsing', () => {
  it('parses lengths with units (mm by default)', () => {
    expect(parseLength('120')).toBe(120);
    expect(parseLength('12.5mm')).toBe(12.5);
    expect(parseLength('3cm')).toBe(30);
    expect(parseLength('1.2 m')).toBe(1200);
    expect(parseLength('2in')).toBeCloseTo(50.8);
    expect(parseLength('2"')).toBeCloseTo(50.8);
    expect(parseLength("3'")).toBeCloseTo(914.4);
    expect(parseLength('3\' 6"')).toBeCloseTo(1066.8);
    expect(parseLength('-20')).toBe(-20);
    expect(parseLength('abc')).toBeUndefined();
    expect(parseLength('')).toBeUndefined();
  });

  it('parses lists and segment counts', () => {
    expect(parseLengths('300,200')).toEqual([300, 200]);
    expect(parseLengths('30cm; 2m')).toEqual([300, 2000]);
    expect(parseLengths(',50')).toEqual([undefined, 50]);
    expect(parseLengths('1,x')).toBeUndefined();
    expect(parseSegments('32s')).toBe(32);
    expect(parseSegments('32')).toBeUndefined();
  });
});

describe('Select tool', () => {
  it('click selects a face, shift-click adds and removes, empty click clears', () => {
    const { doc, controller } = boxHarness();
    const sel = controller.selection;
    const t = use(controller, 'select');
    const top = findFaceAt(doc.model, [50, 50, 20])!;
    const side = findFaceAt(doc.model, [50, 0, 10])!;
    t.pointerDown(ev(doc, [50, 50, 20]));
    t.pointerUp!(ev(doc, [50, 50, 20]), false);
    expect([...sel.faces]).toEqual([top]);
    t.pointerDown(ev(doc, [50, 0, 10], { shift: true }));
    t.pointerUp!(ev(doc, [50, 0, 10], { shift: true }), false);
    expect([...sel.faces].sort()).toEqual([top, side].sort());
    t.pointerDown(ev(doc, [50, 50, 20], { shift: true }));
    t.pointerUp!(ev(doc, [50, 50, 20], { shift: true }), false);
    expect([...sel.faces]).toEqual([side]);
    t.pointerDown(ev(doc, [500, 500, 0]));
    t.pointerUp!(ev(doc, [500, 500, 0]), false);
    expect(sel.size).toBe(0);
  });

  it('clicking an edge selects the edge, not the face', () => {
    const { doc, controller } = boxHarness();
    const e = edgeBetween(doc.model, [0, 0, 20], [100, 0, 20]);
    const t = use(controller, 'select');
    t.pointerDown(ev(doc, [50, 0, 20], { edge: e }));
    t.pointerUp!(ev(doc, [50, 0, 20], { edge: e }), false);
    expect([...controller.selection.edges]).toEqual([e]);
    expect(controller.selection.faces.size).toBe(0);
  });

  it('double-click a face selects it with its bounding edges', () => {
    const { doc, controller } = boxHarness();
    const top = findFaceAt(doc.model, [50, 50, 20])!;
    controller.tools.select.doubleClick!(ev(doc, [50, 50, 20]));
    expect([...controller.selection.faces]).toEqual([top]);
    expect(controller.selection.edges.size).toBe(4);
  });

  it('box selects: window takes what is fully inside, crossing what it touches', () => {
    const { doc, model, controller } = harness();
    drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10);
    drawRectangle(model, GROUND_PLANE, [100, 0, 0], 10, 10);
    const t = use(controller, 'select');
    // Window (left to right) around the first square only (screen y = -world y).
    t.pointerDown(ev(doc, [-5, 15, 0]));
    t.pointerMove(ev(doc, [20, -5, 0], { down: true }));
    t.pointerUp!(ev(doc, [20, -5, 0]), true);
    expect(controller.selection.faces.size).toBe(1);
    expect(controller.selection.edges.size).toBe(4);
    // Crossing (right to left) touching both squares partly.
    t.pointerDown(ev(doc, [105, 5, 0]));
    t.pointerMove(ev(doc, [5, -5, 0], { down: true }));
    t.pointerUp!(ev(doc, [5, -5, 0]), true);
    expect(controller.selection.faces.size).toBe(2);
    // The same box as a window selects nothing.
    t.pointerDown(ev(doc, [5, 5, 0]));
    t.pointerMove(ev(doc, [105, -5, 0], { down: true }));
    t.pointerUp!(ev(doc, [105, -5, 0]), true);
    expect(controller.selection.size).toBe(0);
  });

  it('Delete erases the selection (an erased edge takes its faces with it)', () => {
    const { doc, model, controller } = harness();
    drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const e = edgeBetween(model, [0, 0, 0], [10, 0, 0]);
    controller.selection.set([], [e]);
    controller.deleteSelection();
    model.validate();
    expect(model.faces.size).toBe(0);
    expect([...model.edges()]).toHaveLength(3);
    expect(controller.selection.size).toBe(0);
    expect(doc.model).toBe(model);
  });
});

describe('Rectangle tool', () => {
  it('two clicks on the ground draw a rectangle', () => {
    const { doc, model, controller } = harness();
    const t = use(controller, 'rectangle');
    t.pointerDown(ev(doc, [0, 0, 0]));
    t.pointerMove(ev(doc, [40, 30, 0]));
    expect(t.vcbValue()).toBe('40 mm, 30 mm');
    t.pointerDown(ev(doc, [40, 30, 0]));
    expect(model.faces.size).toBe(1);
    expect(faceArea(model, [...model.faces.keys()][0])).toBeCloseTo(1200);
  });

  it('typed width,length gives an exact size in the direction of the mouse', () => {
    const { doc, model, controller } = harness();
    const t = use(controller, 'rectangle');
    t.pointerDown(ev(doc, [0, 0, 0]));
    t.pointerMove(ev(doc, [-7, 3, 0]));
    controller.typed('300,200');
    const f = [...model.faces.keys()][0];
    expect(faceArea(model, f)).toBeCloseTo(60000);
    expect(model.findVertex([-300, 200, 0])).toBeDefined();
  });

  it('typing after finishing resizes the last rectangle', () => {
    const { doc, model, controller } = harness();
    const t = use(controller, 'rectangle');
    t.pointerDown(ev(doc, [0, 0, 0]));
    t.pointerDown(ev(doc, [40, 30, 0]));
    controller.typed('10cm,5cm');
    expect(model.faces.size).toBe(1);
    expect(faceArea(model, [...model.faces.keys()][0])).toBeCloseTo(5000);
    controller.typed(',80');
    expect(faceArea(model, [...model.faces.keys()][0])).toBeCloseTo(8000);
  });

  it('drawing on a face splits it', () => {
    const { doc, model, controller } = boxHarness();
    const t = use(controller, 'rectangle');
    t.pointerDown(ev(doc, [20, 20, 20]));
    controller.typed('30,30');
    expect(model.faces.size).toBe(7);
    expect(faceArea(model, findFaceAt(model, [30, 30, 20])!)).toBeCloseTo(900);
    expect(checkWatertight(model).watertight).toBe(true);
  });

  it('draws on a vertical face in that face plane', () => {
    const { doc, model, controller } = boxHarness();
    const t = use(controller, 'rectangle');
    const front = findFaceAt(model, [50, 0, 10])!;
    t.pointerDown(ev(doc, [10, 0, 5], { face: front }));
    controller.typed('20,10');
    const inner = findFaceAt(model, [20, 0, 10])!;
    expect(inner).toBeDefined();
    expect(model.face(inner).normal[1]).toBeCloseTo(-1);
    expect(faceArea(model, inner)).toBeCloseTo(200);
  });

  it('a second click on the same spot does not make a degenerate face; Escape cancels', () => {
    const { doc, model, controller } = harness();
    const t = use(controller, 'rectangle');
    t.pointerDown(ev(doc, [0, 0, 0]));
    t.pointerDown(ev(doc, [0, 0, 0]));
    expect(model.faces.size).toBe(0);
    controller.escape();
    t.pointerMove(ev(doc, [10, 10, 0]));
    expect(t.preview()).toEqual({});
  });

  it('bad typed input reports an error and changes nothing', () => {
    const { doc, model, controller } = harness();
    controller.setTool('rectangle');
    controller.tools.rectangle.pointerDown(ev(doc, [0, 0, 0]));
    controller.typed('wide');
    expect(controller.error).toMatch(/width,length/);
    expect(model.faces.size).toBe(0);
  });

  it('press-drag-release through the controller draws like two clicks', () => {
    const { doc, model, controller } = harness();
    controller.setTool('rectangle');
    const sample = (p: [number, number, number], down: boolean) => {
      const e = ev(doc, p);
      return { screen: e.screen, ray: e.ray, faceHit: null, edge: null, shift: false, ctrl: false, down };
    };
    controller.pointerDown(sample([0, 0, 0], true));
    controller.pointerMove(sample([25, 25, 0], true));
    controller.pointerUp(sample([50, 40, 0], false));
    expect(model.faces.size).toBe(1);
    expect(faceArea(model, [...model.faces.keys()][0])).toBeCloseTo(2000);
  });
});

describe('Circle tool', () => {
  it('centre click, radius click', () => {
    const { doc, model, controller } = harness();
    const t = use(controller, 'circle');
    t.pointerDown(ev(doc, [0, 0, 0]));
    t.pointerDown(ev(doc, [0, 10, 0]));
    expect(model.faces.size).toBe(1);
    const c = [...model.curves.values()][0];
    expect(c.radius).toBeCloseTo(10);
    expect(c.segments).toBe(24);
  });

  it('typed radius and segment count; typing after finishing redraws', () => {
    const { doc, model, controller } = harness();
    const t = use(controller, 'circle');
    controller.setTool('circle');
    controller.typed('12s');
    expect(t.vcbValue()).toBe('12');
    t.pointerDown(ev(doc, [0, 0, 0]));
    controller.enter(); // keep 12 sides
    controller.typed('25');
    expect([...model.curves.values()].map((c) => [c.radius, c.segments])).toEqual([[25, 12]]);
    controller.typed('40');
    expect(model.faces.size).toBe(1);
    expect([...model.curves.values()].map((c) => c.radius)).toEqual([40]);
    controller.typed('48s');
    expect(model.faceVertexLoops([...model.faces.keys()][0])[0]).toHaveLength(48);
  });

  it('after the centre click, asks for the sides (default 24), then the radius', () => {
    const { doc, model, controller } = harness();
    const t = use(controller, 'circle');
    t.pointerDown(ev(doc, [0, 0, 0]));
    expect([t.vcbLabel(), t.vcbValue()]).toEqual(['Sides', '24']);
    controller.typed('8');
    expect(model.faces.size).toBe(0);
    expect(t.vcbLabel()).toBe('Radius');
    controller.typed('30');
    expect([...model.curves.values()].map((c) => [c.radius, c.segments])).toEqual([[30, 8]]);
    // A bad count is refused (and, as in every tool, the step is abandoned).
    t.pointerDown(ev(doc, [200, 0, 0]));
    controller.typed('2.5');
    expect(controller.error).toMatch(/number of sides/);
    t.pointerDown(ev(doc, [200, 0, 0]));
    controller.typed('2');
    expect(controller.error).toMatch(/between 3 and 999/);
    // Next circle: the count shown is the last one used; Enter keeps it.
    t.pointerDown(ev(doc, [200, 0, 0]));
    expect([t.vcbLabel(), t.vcbValue()]).toEqual(['Sides', '8']);
    controller.enter();
    controller.typed('10');
    expect([...model.curves.values()].map((c) => [c.radius, c.segments])).toContainEqual([10, 8]);
    // Clicking still sets the radius straight away, while it asks for the sides.
    t.pointerDown(ev(doc, [0, 300, 0]));
    t.pointerDown(ev(doc, [0, 320, 0]));
    expect(model.curves.size).toBe(3);
  });

  it('a circle on a face splits it into a face with a hole and a disc', () => {
    const { doc, model, controller } = boxHarness();
    const t = use(controller, 'circle');
    t.pointerDown(ev(doc, [50, 50, 20]));
    controller.enter();
    controller.typed('10');
    const top = findFaceAt(model, [5, 5, 20])!;
    expect(model.face(top).holes).toHaveLength(1);
    expect(findFaceAt(model, [50, 50, 20])).not.toBe(top);
  });
});

describe('Push/Pull tool', () => {
  it('click a face, move, click: extrudes by the distance along the normal', () => {
    const { doc, model, controller } = harness();
    const f = drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    const t = use(controller, 'pushpull');
    t.pointerDown(ev(doc, [5, 5, 0], { face: f }));
    t.pointerMove(ev(doc, [5, 5, 30], { ray: sideRay([5, 5, 30]), snap: null }));
    expect(t.vcbValue()).toBe('30 mm');
    t.pointerDown(ev(doc, [5, 5, 30], { ray: sideRay([5, 5, 30]), snap: null }));
    expect(volume(model)).toBeCloseTo(3000);
  });

  it('typed distance, then typing again changes the last push', () => {
    const { doc, model, controller } = boxHarness();
    const t = use(controller, 'pushpull');
    const top = findFaceAt(model, [50, 50, 20])!;
    t.pointerDown(ev(doc, [50, 50, 20], { face: top }));
    controller.typed('10');
    expect(volume(model)).toBeCloseTo(100 * 100 * 30);
    controller.typed('-5');
    expect(volume(model)).toBeCloseTo(100 * 100 * 15);
    expect(checkWatertight(model).watertight).toBe(true);
  });

  it('snapping to the far side pushes exactly flush through (through-hole)', () => {
    const { doc, model, controller } = boxHarness();
    drawCircle(model, model.facePlane(findFaceAt(model, [5, 5, 20])!), [50, 50, 20], 10, 24, findFaceAt(model, [5, 5, 20])!);
    const disc = findFaceAt(model, [50, 50, 20])!;
    const t = use(controller, 'pushpull');
    t.pointerDown(ev(doc, [50, 50, 20], { face: disc }));
    // Cursor over a bottom corner (endpoint snap at z = 0).
    t.pointerMove(ev(doc, [0, 0, 0], { kind: 'endpoint', face: null }));
    expect(t.vcbValue()).toBe('-20 mm');
    t.pointerDown(ev(doc, [0, 0, 0], { kind: 'endpoint', face: null }));
    const r = checkWatertight(model);
    expect(r.watertight).toBe(true);
    expect(r.genus).toBe(1);
  });

  it('moving over the rest of the same face does not snap the distance to zero (regression)', () => {
    const { doc, model, controller } = harness();
    pushPull(model, drawRectangle(model, GROUND_PLANE, [0, 0, 0], 200, 200).inner!, -200);
    // A curved bite out of the top's front edge: the pushed face touches the edge of the top.
    drawArc(model, arcThroughPoints([50, 0, 0], [100, 50, 0], [150, 0, 0]), 12);
    const bite = findFaceAt(model, [100, 20, 0])!;
    const rest = findFaceAt(model, [100, 150, 0])!;
    expect(bite).not.toBe(rest);
    const t = use(controller, 'pushpull');
    t.pointerDown(ev(doc, [100, 20, 0], { face: bite }));
    // The cursor passes over the rest of the top (an on-face snap in the start plane).
    const ray = { origin: [100, -1000, 300] as Vec3, dir: normalize(sub([100, 80, 0], [100, -1000, 300])) };
    t.pointerMove(ev(doc, [100, 80, 0], { face: rest, ray }));
    expect(t.vcbValue()).not.toBe('0 mm');
    const v = volume(model);
    t.pointerDown(ev(doc, [100, 80, 0], { face: rest, ray }));
    expect(volume(model)).not.toBeCloseTo(v, 0);
    expect(checkWatertight(model).watertight).toBe(true);
  });

  it('looking straight along the push, moving the cursor keeps the distance', () => {
    const { doc, model, controller } = harness();
    const f = drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    const t = use(controller, 'pushpull');
    t.pointerDown(ev(doc, [5, 5, 0], { face: f }));
    t.pointerMove(ev(doc, [5, 5, 30], { ray: sideRay([5, 5, 30]), snap: null }));
    // Now from (almost) straight above: a ray 1° off the face normal.
    const tilt = (Math.PI / 180) * 1;
    t.pointerMove(ev(doc, [7, 5, 0], { snap: null, ray: { origin: [7, 5, 1000], dir: [Math.sin(tilt), 0, -Math.cos(tilt)] } }));
    expect(t.vcbValue()).toBe('30 mm');
  });

  it('double-click repeats the last distance on another face', () => {
    const { doc, model, controller } = harness();
    const a = drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    const b = drawRectangle(model, GROUND_PLANE, [50, 0, 0], 10, 10).inner!;
    const t = use(controller, 'pushpull');
    t.pointerDown(ev(doc, [5, 5, 0], { face: a }));
    controller.typed('7');
    t.doubleClick!(ev(doc, [55, 5, 0], { face: b }));
    expect(volume(model)).toBeCloseTo(2 * 700);
  });

  it('a failing operation reports the error and leaves the model exactly as it was', () => {
    const { doc, model, controller } = harness();
    pushPull(model, drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!, 10);
    const before = model.clone();
    use(controller, 'offset');
    controller.tools.offset.pointerDown(ev(doc, [5, 5, 10]));
    controller.typed('50'); // larger than the face
    expect(controller.error).toMatch(/too large/);
    expect(model.faces.size).toBe(before.faces.size);
    expect(model.vertices.size).toBe(before.vertices.size);
    model.validate();
  });
});

describe('Offset tool', () => {
  it('click a face and move inside: the loop passes through the cursor', () => {
    const { doc, model, controller } = harness();
    const f = drawRectangle(model, GROUND_PLANE, [0, 0, 0], 100, 60).inner!;
    const t = use(controller, 'offset');
    t.pointerDown(ev(doc, [50, 30, 0], { face: f }));
    t.pointerMove(ev(doc, [50, 8, 0], { face: f }));
    expect(t.vcbValue()).toBe('8 mm');
    t.pointerDown(ev(doc, [50, 8, 0], { face: f }));
    expect(model.faces.size).toBe(2);
    expect(faceArea(model, findFaceAt(model, [50, 30, 0])!)).toBeCloseTo(84 * 44);
  });

  it('typed distance and re-dimension; outward on a lone face', () => {
    const { doc, model, controller } = harness();
    const f = drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    const t = use(controller, 'offset');
    t.pointerDown(ev(doc, [5, 5, 0], { face: f }));
    controller.typed('2');
    expect(faceArea(model, findFaceAt(model, [5, 5, 0])!)).toBeCloseTo(36);
    controller.typed('-3');
    expect(model.faces.size).toBe(2);
    expect(faceArea(model, findFaceAt(model, [-1, 5, 0])!)).toBeCloseTo(16 * 16 - 100);
  });

  it('too large an offset is refused with a message', () => {
    const { doc, model, controller } = harness();
    const f = drawRectangle(model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    controller.setTool('offset');
    controller.tools.offset.pointerDown(ev(doc, [5, 5, 0], { face: f }));
    controller.typed('20');
    expect(controller.error).toMatch(/too large/);
    expect(model.faces.size).toBe(1);
  });
});

describe('Tape Measure tool (guides)', () => {
  it('from an edge: a parallel guide line through the cursor, or at a typed distance', () => {
    const { doc, model, controller } = boxHarness();
    const e = edgeBetween(model, [0, 0, 20], [100, 0, 20]);
    const t = use(controller, 'tape');
    t.pointerDown(ev(doc, [30, 0, 20], { kind: 'onEdge', snap: { edge: e } }));
    t.pointerMove(ev(doc, [40, 12, 20]));
    expect(t.vcbValue()).toBe('12 mm');
    controller.typed('25');
    const lines = doc.guides.lines();
    expect(lines).toHaveLength(1);
    expect(Math.abs(lines[0].dir[0])).toBeCloseTo(1);
    expect(lines[0].point[1]).toBeCloseTo(25);
    expect(lines[0].point[2]).toBeCloseTo(20);
    controller.typed('40');
    expect(doc.guides.lines()).toHaveLength(1);
    expect(doc.guides.lines()[0].point[1]).toBeCloseTo(40);
  });

  it('from a point: a guide point along the direction moved', () => {
    const { doc, model, controller } = boxHarness();
    const t = use(controller, 'tape');
    t.pointerDown(ev(doc, [0, 0, 20], { kind: 'endpoint' }));
    t.pointerMove(ev(doc, [10, 10, 20]));
    controller.typed('50');
    const pts = doc.guides.points();
    expect(pts).toHaveLength(1);
    expect(pts[0].pos[0]).toBeCloseTo(50 / Math.SQRT2);
    expect(pts[0].pos[1]).toBeCloseTo(50 / Math.SQRT2);
    expect(model.faces.size).toBe(6);
  });

  it('guides can be hidden and deleted in bulk', () => {
    const { doc, controller } = harness();
    doc.guides.addLine([0, 10, 0], [1, 0, 0]);
    doc.guides.addPoint([5, 5, 5]);
    controller.toggleGuides();
    expect(doc.guides.visible).toBe(false);
    controller.deleteGuides();
    expect(doc.guides.items.size).toBe(0);
  });
});

describe('document snapshots', () => {
  it('restore puts back both the model and the guides, in place', () => {
    const doc = new Document();
    drawRectangle(doc.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const snap = doc.snapshot();
    const model = doc.model;
    drawRectangle(doc.model, GROUND_PLANE, [50, 0, 0], 10, 10);
    doc.guides.addPoint([1, 2, 3]);
    doc.restore(snap);
    expect(doc.model).toBe(model);
    expect(doc.model.faces.size).toBe(1);
    expect(doc.guides.items.size).toBe(0);
    doc.model.validate();
  });
});
