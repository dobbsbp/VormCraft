import { beforeAll, describe, expect, it } from 'vitest';
import {
  arcAroundCenter,
  arcPoints,
  checkWatertight,
  drawArc,
  drawCircle,
  drawEdges,
  drawRectangle,
  facesWithCurveEdges,
  findFaceAt,
  GROUND_PLANE,
  initBooleanKernel,
  isEdgeShown,
  makePlane,
  pushPull,
  solidReport,
  type FaceId,
  type HalfEdgeId,
  type Vec3,
} from '../src/core';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { openMeshEdges, tessellate } from '../src/io/tessellate';
import { ev, harness, use } from './helpers/tools';

/**
 * Useful Follow Me shapes, each made through the tool as a person would (select the path, click
 * the profile), with every change checked by the test harness (no solid may be broken). Each must
 * come out as one closed solid facing outward, of the right volume (circles are 24-sided, so a
 * little under the formula for true circles), smooth where it is round, and survive export,
 * saving and undo.
 */

beforeAll(async () => {
  await initBooleanKernel();
});

type H = ReturnType<typeof harness>;

function sweep(h: H, path: { faces?: FaceId[]; edges?: HalfEdgeId[] }, profile: FaceId): void {
  use(h.controller, 'followMe');
  h.controller.selection.set(path.faces ?? [], path.edges ?? []);
  h.controller.tool.pointerDown(ev(h.doc, h.model.pos(h.model.faceVertexLoops(profile)[0][0]), { face: profile }));
}

const edgesOf = (h: H, f: FaceId) => h.model.faceHalfEdges(f).map((e) => Math.min(e, h.model.he(e).twin));
/** The profile: the new upright face (the one facing along `axis`). */
const facing = (h: H, faces: FaceId[], axis: 0 | 1 | 2) => faces.find((f) => Math.abs(h.model.face(f).normal[axis]) > 0.99)!;

/**
 * One closed solid facing outward, of about `expected` volume (within `within`, as a fraction),
 * with `shown` edges drawn (the rest smooth), `flat` loose flat faces left, closed when exported,
 * the same after saving and opening again, and undone and redone as one step.
 */
function expectSolid(h: H, o: { expected: number; within: number; shown?: number; flat?: number; label?: string }): void {
  const m = h.model;
  const r = solidReport(m);
  expect(r).toMatchObject({ solids: 1, insideOut: 0, open: 0, pressed: 0, flat: o.flat ?? 0 });
  const solid: FaceId[] = [];
  const seen = new Set<FaceId>();
  for (const f of m.faces.keys()) {
    if (seen.has(f)) continue;
    const part = m.connectedFaces(f, false);
    for (const g of part) seen.add(g);
    if (m.isClosed(part)) solid.push(...part);
  }
  expect(checkWatertight(m, solid)).toMatchObject({ watertight: true, shells: 1 });
  expect(Math.abs(r.volumes[0] / o.expected - 1)).toBeLessThan(o.within);
  if (o.shown !== undefined) {
    const shown = new Set<number>();
    const curved = facesWithCurveEdges(m);
    for (const f of solid) for (const e of m.faceHalfEdges(f)) if (isEdgeShown(m, e, curved)) shown.add(Math.min(e, m.he(e).twin));
    expect(shown.size).toBe(o.shown);
  }
  expect(openMeshEdges(tessellate(m, solid, { maxDeviation: 0.05 }))).toBe(0);
  expect(solidReport(parseDocument(serializeDocument(h.doc)).root).volumes[0]).toBeCloseTo(r.volumes[0], 3);
  expect(h.controller.history.undoLabel).toBe(o.label ?? 'Follow Me');
  h.controller.undo();
  expect(h.controller.history.redoLabel).toBe(o.label ?? 'Follow Me');
  h.controller.redo();
  expect(solidReport(m).volumes[0]).toBeCloseTo(r.volumes[0], 3);
}

describe('Follow Me shapes', () => {
  const R = 500;
  const r = 50;
  const ring = (centre: number) => Math.PI * r * r * 2 * Math.PI * centre;

  it('a ring: a small circle drawn upright (arrow key) on a big circle’s edge, swept round it', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], R).inner!;
    // Circle tool, ← (faces green): upright across the path at (R, 0, 0).
    use(h.controller, 'circle');
    expect(h.controller.tool.lockAxis!('y')).toMatch(/upright/);
    const centre = ev(h.doc, [R, 0, r], { kind: 'endpoint', face: null });
    h.controller.tool.pointerMove(centre);
    h.controller.tool.pointerDown(centre);
    h.controller.enter();
    h.controller.typed('50');
    const profile = [...h.model.faces.values()].find((f) => Math.abs(f.normal[1]) > 0.99)!.id;
    sweep(h, { faces: [disc] }, profile);
    // The disc stays (it is outside the ring); the ring is smooth all over.
    expectSolid(h, { expected: ring(R), within: 0.03, shown: 0, flat: 1 });
  });

  it.each([
    ['centred on the edge', [R, 0, 0], 'face'],
    ['sitting on the ground', [R, 0, r], 'edges'],
    ['outside the circle', [R + 100, 0, r], 'face'],
  ] as [string, Vec3, 'face' | 'edges'][])('a ring with the profile %s (path: the circle’s %s)', (_, centre, pathAs) => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], R).inner!;
    const edges = edgesOf(h, disc);
    if (pathAs === 'edges') h.model.removeFace(disc);
    const p = drawCircle(h.model, makePlane(centre, [0, 1, 0]), centre, r).inner!;
    sweep(h, pathAs === 'face' ? { faces: [disc] } : { edges }, p);
    expectSolid(h, { expected: ring(Math.hypot(centre[0], centre[1])), within: 0.03, shown: 0, flat: pathAs === 'face' ? 1 : 0 });
  });

  it('a sphere: a half circle on the axis, round a circle (the circle inside it goes)', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    drawArc(h.model, arcAroundCenter(makePlane([0, 0, 0], [0, -1, 0]), [0, 0, 0], [0, 0, -100], Math.PI), 12);
    const { faces } = drawEdges(h.model, [[0, 0, 100], [0, 0, -100]]);
    sweep(h, { faces: [disc] }, facing(h, faces, 1));
    expectSolid(h, { expected: (4 / 3) * Math.PI * 100 ** 3, within: 0.035, shown: 0 });
  });

  it('a sphere the usual way: a whole circle standing on the centre of a flat one (only its near half is turned)', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    const upright = drawCircle(h.model, makePlane([0, 0, 0], [0, -1, 0]), [0, 0, 0], 100).inner!;
    sweep(h, { faces: [disc] }, upright);
    expectSolid(h, { expected: (4 / 3) * Math.PI * 100 ** 3, within: 0.035, shown: 0 });
    // Its poles are the circle's own top and bottom, not flattened.
    const zs = [...h.model.vertices.values()].map((v) => v.pos[2]);
    expect(Math.max(...zs)).toBeCloseTo(100, 6);
    expect(Math.min(...zs)).toBeCloseTo(-100, 6);
  });

  it('a sphere drawn with the Circle tool: the upright circle centred on the flat one (the centre snap), then Follow Me', () => {
    const h = harness();
    use(h.controller, 'circle');
    const origin = ev(h.doc, [0, 0, 0], { kind: 'origin', face: null });
    h.controller.tool.pointerMove(origin);
    h.controller.tool.pointerDown(origin);
    h.controller.enter();
    h.controller.typed('100');
    const disc = findFaceAt(h.model, [10, 10, 0])!;
    // → (faces red): upright, its centre clicked on the flat circle's centre snap.
    expect(h.controller.tool.lockAxis!('x')).toMatch(/upright/);
    const centre = ev(h.doc, [0, 0, 0], { kind: 'centre', face: disc });
    h.controller.tool.pointerMove(centre);
    h.controller.tool.pointerDown(centre);
    h.controller.enter();
    h.controller.typed('100');
    const upright = [...h.model.faces.values()].find((f) => Math.abs(f.normal[0]) > 0.99)!.id;
    sweep(h, { faces: [disc] }, upright);
    expectSolid(h, { expected: (4 / 3) * Math.PI * 100 ** 3, within: 0.035, shown: 0 });
  });

  it('the Circle tool says while it is locked upright, and unlocks once another tool changes the model', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    const circle = use(h.controller, 'circle');
    circle.lockAxis!('y');
    expect(circle.hint()).toMatch(/^Upright, facing the green axis \(press the same arrow again to unlock\)/);
    const at = ev(h.doc, [100, 0, 10], { kind: 'endpoint', face: null });
    circle.pointerMove(at);
    circle.pointerDown(at);
    h.controller.typed('10mm');
    // Still locked for the next circle...
    expect(circle.hint()).toMatch(/^Upright/);
    const profile = [...h.model.faces.values()].find((f) => Math.abs(f.normal[1]) > 0.99)!.id;
    sweep(h, { faces: [disc] }, profile);
    // ...but not after Follow Me: the next circle lies on the face clicked again.
    expect(circle.hint()).toMatch(/^Click the centre/);
  });

  it('a smaller circle, or one higher up the centre line, makes a sphere of its own size', () => {
    for (const [r, z] of [[60, 0], [50, 40]]) {
      const h = harness();
      const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
      const upright = drawCircle(h.model, makePlane([0, 0, z], [0, -1, 0]), [0, 0, z], r).inner!;
      sweep(h, { faces: [disc] }, upright);
      const solid = solidReport(h.model);
      expect(solid).toMatchObject({ solids: 1, insideOut: 0, open: 0 });
      expect(Math.abs(solid.volumes[0] / ((4 / 3) * Math.PI * r ** 3) - 1)).toBeLessThan(0.035);
    }
  });

  it('an upright rectangle across the centre line turns into a cylinder', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    const { faces } = drawEdges(h.model, [[-40, 0, 0], [40, 0, 0], [40, 0, 70], [-40, 0, 70], [-40, 0, 0]]);
    sweep(h, { faces: [disc] }, facing(h, faces, 1));
    const solid = solidReport(h.model);
    expect(solid).toMatchObject({ solids: 1, insideOut: 0, open: 0 });
    expect(Math.abs(solid.volumes[0] / (Math.PI * 40 ** 2 * 70) - 1)).toBeLessThan(0.035);
  });

  it('a dome: a quarter circle round a circle (the circle under it goes)', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    drawArc(h.model, arcAroundCenter(makePlane([0, 0, 0], [0, -1, 0]), [0, 0, 0], [100, 0, 0], Math.PI / 2), 6);
    const { faces } = drawEdges(h.model, [[0, 0, 100], [0, 0, 0], [100, 0, 0]]);
    sweep(h, { faces: [disc] }, facing(h, faces, 1));
    // Only the rim where the dome meets its flat base shows.
    expectSolid(h, { expected: (2 / 3) * Math.PI * 100 ** 3, within: 0.035, shown: 24 });
  });

  it('a bowl: a thick quarter ring drawn with arcs, round a circle (the plate under it stays)', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    const plane = makePlane([0, 0, 100], [0, -1, 0]);
    for (const rad of [100, 90]) {
      const arc = [Math.PI / 2, -Math.PI / 2].map((sw) => arcAroundCenter(plane, [0, 0, 100], [rad, 0, 100], sw)).find((a) => arcPoints(a, 6).at(-1)![2] < 50)!;
      drawArc(h.model, arc, 6);
    }
    drawEdges(h.model, [[0, 0, 10], [0, 0, 0]]);
    const { faces } = drawEdges(h.model, [[90, 0, 100], [100, 0, 100]]);
    sweep(h, { faces: [disc] }, facing(h, faces, 1));
    expectSolid(h, { expected: (2 / 3) * Math.PI * (100 ** 3 - 90 ** 3), within: 0.035, flat: 1 });
  });

  it('a cylinder: a rectangle on the axis, round a circle', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    const { faces } = drawEdges(h.model, [[0, 0, 0], [0, 0, 200], [100, 0, 200], [100, 0, 0], [0, 0, 0]]);
    sweep(h, { faces: [disc] }, facing(h, faces, 1));
    expectSolid(h, { expected: Math.PI * 100 ** 2 * 200, within: 0.015 });
  });

  const pipe = (h: H) => drawCircle(h.model, makePlane([0, 0, 50], [0, 1, 0]), [0, 0, 50], 10).inner!;

  it('a straight pipe: a circle along a line', () => {
    const h = harness();
    const p = pipe(h);
    sweep(h, { edges: drawEdges(h.model, [[0, 0, 50], [0, 400, 50]]).edges }, p);
    expectSolid(h, { expected: Math.PI * 100 * 400, within: 0.015, shown: 48 });
  });

  it('an elbow: a circle along a line, an arc and a line, smooth all along (only its two rims show)', () => {
    const h = harness();
    const p = pipe(h);
    const flat = makePlane([0, 0, 50], [0, 0, 1]);
    const path = [
      ...drawEdges(h.model, [[0, 0, 50], [0, 300, 50]]).edges,
      ...drawArc(h.model, arcAroundCenter(flat, [100, 300, 50], [0, 300, 50], -Math.PI / 2), 12).edges,
      ...drawEdges(h.model, [[100, 400, 50], [400, 400, 50]]).edges,
    ];
    sweep(h, { edges: path }, p);
    expectSolid(h, { expected: Math.PI * 100 * (600 + (Math.PI / 2) * 100), within: 0.015, shown: 48 });
  });

  it('a pipe with sharp corners: a circle along a zigzag, mitred at each corner', () => {
    const h = harness();
    const p = pipe(h);
    const pts: Vec3[] = [[0, 0, 50], [0, 300, 50], [200, 400, 50], [200, 700, 50]];
    sweep(h, { edges: drawEdges(h.model, pts).edges }, p);
    const length = pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
    expectSolid(h, { expected: Math.PI * 100 * length, within: 0.015, shown: 96 });
  });

  it('a picture frame: a moulding profile round a rectangle, mitred corners', () => {
    const h = harness();
    const outline = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 400, 300).inner!;
    const { faces } = drawEdges(h.model, [[200, 0, 0], [200, 0, 20], [200, 30, 20], [200, 30, 0], [200, 0, 0]]);
    sweep(h, { faces: [outline] }, facing(h, faces, 0));
    expectSolid(h, { expected: (400 * 300 - 340 * 240) * 20, within: 1e-9, flat: 1 });
  });

  it('a rounded edge: a quarter circle drawn on a box’s corner, round its top outline', () => {
    const h = harness();
    const base = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 200, 200).inner!;
    pushPull(h.model, base, h.model.face(base).normal[2] > 0 ? 100 : -100);
    const front = makePlane([0, 0, 100], [0, -1, 0]);
    const arc = [Math.PI / 2, -Math.PI / 2].map((sw) => arcAroundCenter(front, [20, 0, 80], [20, 0, 100], sw)).find((a) => arcPoints(a, 6).at(-1)![0] < 1)!;
    drawArc(h.model, arc, 6);
    sweep(h, { faces: [findFaceAt(h.model, [100, 100, 100])!] }, findFaceAt(h.model, [2, 0, 98])!);
    // The rounding is smooth along each side; its mitres at the corners show.
    expectSolid(h, { expected: 200 * 200 * 100 - 20 * 20 * (1 - Math.PI / 4) * 4 * 180, within: 0.005, shown: 51 });
  });

  it('a groove: a square drawn into a cylinder, round its top circle (cut out of it)', () => {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    pushPull(h.model, disc, h.model.face(disc).normal[2] > 0 ? 200 : -200);
    const { faces } = drawEdges(h.model, [[100, 0, 190], [90, 0, 190], [90, 0, 180], [100, 0, 180]]);
    sweep(h, { faces: [findFaceAt(h.model, [0, 0, 200])!] }, faces[0] ?? findFaceAt(h.model, [95, 0, 185])!);
    expectSolid(h, { expected: Math.PI * 100 ** 2 * 200 - 100 * 2 * Math.PI * 95, within: 0.015 });
  });
});

describe('Follow Me along connected lines', () => {
  // Up a slope, along, then round a corner: lines drawn one after another (not in one plane).
  const pts: Vec3[] = [[0, 0, 0], [0, 300, 150], [0, 600, 150], [300, 600, 150]];
  const length = pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1], q[2] - pts[i][2]), 0);

  /** The lines, and a 20 mm circle stood square across the sloping first line with ↓. */
  function setUp(): { h: H; first: HalfEdgeId; profile: FaceId } {
    const h = harness();
    const lines = drawEdges(h.model, pts).edges;
    const first = lines.find((e) => [h.model.pos(h.model.he(e).origin), h.model.pos(h.model.dest(e))].some((p) => p[2] === 0))!;
    // Point at the sloping line, then ↓ in the Circle tool.
    h.controller.pointerMove({ screen: [0, 0], ray: { origin: [0, 150, 1000], dir: [0, 0, -1] }, faceHit: null, edge: first, shift: false, ctrl: false, down: false });
    use(h.controller, 'circle');
    h.controller.toggleLock('parallel');
    expect(h.controller.notice).toMatch(/square across the line/);
    const centre = ev(h.doc, pts[0], { kind: 'endpoint', face: null });
    h.controller.tool.pointerMove(centre);
    h.controller.tool.pointerDown(centre);
    h.controller.enter();
    h.controller.typed('20');
    const profile = [...h.model.faces.values()][0];
    // It faces along the slope.
    expect(Math.abs(profile.normal[1] * 2 + profile.normal[2]) / Math.sqrt(5)).toBeCloseTo(1, 9);
    return { h, first, profile: profile.id };
  }

  it('selecting one line follows every line joined to it (and says so)', () => {
    const { h, first, profile } = setUp();
    sweep(h, { edges: [first] }, profile);
    expect(h.controller.tool.notice!()).toMatch(/Followed the 3 lines/);
    expectSolid(h, { expected: Math.PI * 400 * length, within: 0.015 });
  });

  it('with Shift, only the selected line', () => {
    const { h, first, profile } = setUp();
    use(h.controller, 'followMe');
    h.controller.selection.set([], [first]);
    h.controller.tool.pointerDown(ev(h.doc, pts[0], { face: profile, shift: true }));
    expect(solidReport(h.model).volumes[0] / (Math.PI * 400 * Math.hypot(300, 150))).toBeCloseTo(1, 1);
  });

  it('↓ in the Circle tool needs a line pointed at first, and a second ↓ unlocks', () => {
    const h = harness();
    const t = use(h.controller, 'circle');
    expect(t.lockAxis!('parallel', null)).toMatch(/point at a line first/);
    expect(t.lockAxis!('parallel', [0, 1, 0])).toMatch(/square across/);
    expect(t.lockAxis!('parallel', [0, 1, 0])).toMatch(/unlocked/);
  });
});

describe('Follow Me mistakes say what to do', () => {
  const R = 500;
  const r = 50;

  it('path and profile picked the wrong way round (the big circle swept round the small one)', () => {
    const h = harness();
    const big = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], R).inner!;
    const small = drawCircle(h.model, makePlane([R, 0, 0], [0, 1, 0]), [R, 0, 0], r).inner!;
    expect(() => sweep(h, { faces: [small] }, big)).toThrow(/wrong way round/);
    expect(h.model.faces.size).toBe(2);
  });

  it('a profile lying flat, or facing the middle of the path', () => {
    const h = harness();
    const big = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], R).inner!;
    const flat = drawCircle(h.model, GROUND_PLANE, [R + 100, 0, 0], r).inner!;
    expect(() => sweep(h, { faces: [big] }, flat)).toThrow(/instead of across it.*press → or ←/);
    const turned = drawCircle(h.model, makePlane([R, 0, r], [1, 0, 0]), [R, 0, r], r).inner!;
    expect(() => sweep(h, { faces: [big] }, turned)).toThrow(/instead of across it/);
  });

  it('the Circle tool’s arrow keys stand it upright, lay it flat, and unlock', () => {
    const h = harness();
    const t = use(h.controller, 'circle');
    expect(t.lockAxis!('x')).toMatch(/upright, facing the red axis/);
    expect(t.lockAxis!('x')).toMatch(/unlocked/);
    expect(t.lockAxis!('z')).toMatch(/flat/);
    expect(t.lockAxis!('perpendicular')).toBeNull();
    expect(t.hint()).toMatch(/Arrow keys/);
  });
});

describe('Follow Me spirals: sweep round a circle, then type the turns and the rise', () => {
  /** A ring of a 10 mm circle round a 100 mm circle, made through the tool; returns the harness. */
  function ringH(profile: 'circle' | 'square' = 'circle') {
    const h = harness();
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 100).inner!;
    const plane = makePlane([100, 0, 10], [0, 1, 0]);
    const face =
      profile === 'circle'
        ? drawCircle(h.model, plane, [100, 0, 10], 10).inner!
        : facing(h, drawEdges(h.model, [[90, 0, 0], [110, 0, 0], [110, 0, 20], [90, 0, 20], [90, 0, 0]]).faces, 1);
    sweep(h, { faces: [disc] }, face);
    return h;
  }
  /** A coil's volume: the profile's area times the length its centre travels (24-sided, so a little under). */
  const coil = (area: number, turns: number, rise: number, radius = 100) => area * turns * Math.hypot(2 * Math.PI * radius, rise);

  it('a spring: 5 turns climbing 30 mm each, one smooth closed solid', () => {
    const h = ringH();
    expect(h.controller.tool.vcbLabel()).toBe('Spiral');
    expect(h.controller.tool.hint()).toMatch(/type the turns and the rise/);
    h.controller.typed('5, 30');
    expect(h.controller.tool.vcbValue()).toBe('5, 30 mm');
    // Only the two end circles show; the disc it went round stays.
    expectSolid(h, { expected: coil(Math.PI * 100, 5, 30), within: 0.035, shown: 48, flat: 1, label: 'Spiral' });
    const zs = [...h.model.vertices.values()].map((v) => v.pos[2]);
    expect(Math.max(...zs)).toBeCloseTo(150 + 20, 6);
  });

  it('typing again changes the spiral; undo goes back to before the sweep', () => {
    const h = ringH();
    h.controller.typed('2, 25mm');
    h.controller.typed('3, 40mm');
    expect(solidReport(h.model)).toMatchObject({ solids: 1, open: 0, insideOut: 0 });
    expect(Math.max(...[...h.model.vertices.values()].map((v) => v.pos[2]))).toBeCloseTo(120 + 20, 6);
    h.controller.undo();
    expect(solidReport(h.model).solids).toBe(0);
  });

  it('a flat coil (no rise, wider each turn) and a cone-shaped spring', () => {
    for (const typed of ['3, 0, 25mm', '4, 30mm, -15mm', '0.5, 50mm']) {
      const h = ringH();
      h.controller.typed(typed);
      expect(solidReport(h.model)).toMatchObject({ solids: 1, open: 0, insideOut: 0, pressed: 0 });
    }
  });

  it('a square profile gives a square-section spring, its corners shown', () => {
    const h = ringH('square');
    h.controller.typed('2, 40');
    expectSolid(h, { expected: coil(400, 2, 40), within: 0.035, flat: 1, label: 'Spiral' });
  });

  it('Follow Me offers Spiral tips (the steps and what to type); drawing tools have none', () => {
    const h = harness();
    const tips = use(h.controller, 'followMe').tips?.();
    expect(tips?.label).toBe('Spiral tips');
    expect(tips?.text).toMatch(/starts as a ring/);
    expect(tips?.text).toMatch(/5, 30cm/);
    expect(use(h.controller, 'circle').tips).toBeUndefined();
  });

  it('refuses coils that would run into each other or reach the centre, and typing with no sweep', () => {
    const h = ringH();
    h.controller.typed('5, 10');
    expect(h.controller.error).toMatch(/run into each other.*at least 20 mm, or widen at least 20 mm/);
    h.controller.typed('3, 30, -40');
    expect(h.controller.error).toMatch(/reach the centre line/);
    h.controller.typed('5');
    expect(h.controller.error).toMatch(/turns and the rise/);
    // The ring is left as it was.
    expect(solidReport(h.model).solids).toBe(1);
    expect(Math.max(...[...h.model.vertices.values()].map((v) => v.pos[2]))).toBeCloseTo(20, 6);
    const fresh = harness();
    use(fresh.controller, 'followMe');
    fresh.controller.typed('5, 30');
    expect(fresh.controller.error).toMatch(/sweep a profile round a circle first/);
  });
});
