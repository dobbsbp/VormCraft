import { beforeAll, describe, expect, it } from 'vitest';
import { bindingFor, KEY_BINDINGS } from '../src/app/keymap';
import { drawRectangle, GROUND_PLANE, initBooleanKernel, pushPull, type Vec3 } from '../src/core';
import { Guides } from '../src/doc/Guides';
import { infer } from '../src/tools/inference';
import { ev, harness, topDown, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

describe('keyboard map', () => {
  // The requested map: [key, shift, name, what it should do].
  const expected: [string, boolean, string, string][] = [
    ['l', false, 'Line', 'tool:line'],
    ['r', false, 'Rectangle', 'tool:rectangle'],
    ['c', false, 'Circle', 'tool:circle'],
    ['a', false, '2-Point Arc', 'tool:arc2'],
    ['p', false, 'Push/Pull', 'tool:pushpull'],
    ['m', false, 'Move', 'tool:move'],
    ['q', false, 'Rotate', 'tool:rotate'],
    ['s', false, 'Scale', 'tool:scale'],
    ['f', false, 'Offset', 'tool:offset'],
    ['e', false, 'Eraser', 'tool:eraser'],
    ['b', false, 'Paint Bucket', 'unavailable'],
    ['t', false, 'Tape Measure', 'tool:tape'],
    [' ', false, 'Select', 'tool:select'],
    [' ', true, 'Lasso Select', 'unavailable'],
    ['g', false, 'Make Component', 'unavailable'],
    ['s', true, 'Search', 'unavailable'],
    ['o', false, 'Orbit', 'tool:orbit'],
    ['h', false, 'Pan', 'tool:pan'],
    ['z', false, 'Zoom', 'tool:zoom'],
    ['z', true, 'Zoom Extents', 'zoomExtents'],
    ['k', false, 'Back Edges', 'backEdges'],
    ['i', false, 'Photo Matching', 'unavailable'],
    ['ArrowRight', false, 'Lock to red axis', 'lock:x'],
    ['ArrowLeft', false, 'Lock to green axis', 'lock:y'],
    ['ArrowUp', false, 'Lock to blue axis', 'lock:z'],
    ['ArrowDown', false, 'Lock parallel, then perpendicular, to the last edge', 'lock:parallel'],
  ];

  it.each(expected)('%s (shift %s) → %s', (key, shift, name, what) => {
    const b = bindingFor(key, shift);
    expect(b?.name).toBe(name);
    const a = b!.action;
    const got = a.type === 'tool' ? `tool:${a.tool}` : a.type === 'lock' ? `lock:${a.lock}` : a.type;
    expect(got).toBe(what);
  });

  it('has no duplicate keys and nothing beyond the requested map', () => {
    const keys = KEY_BINDINGS.map((b) => `${b.key}|${b.shift}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(KEY_BINDINGS).toHaveLength(expected.length);
  });

  it('upper-case letters (Caps Lock) still match', () => {
    expect(bindingFor('R', false)?.name).toBe('Rectangle');
  });
});

describe('Eraser tool', () => {
  it('click an edge: it goes, with the face it bounded; one undo brings both back', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const t = use(H.controller, 'eraser');
    const e = [...H.model.edges()][0];
    t.pointerDown(ev(H.doc, [5, 0, 0], { edge: e }));
    t.pointerUp!(ev(H.doc, [5, 0, 0], { edge: e }), false);
    expect(H.model.faces.size).toBe(0);
    expect([...H.model.edges()]).toHaveLength(3);
    H.controller.undo();
    expect(H.model.faces.size).toBe(1);
    expect([...H.model.edges()]).toHaveLength(4);
  });

  it('drag across several edges erases them together on release', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const [e1, e2] = [...H.model.edges()];
    const t = use(H.controller, 'eraser');
    t.pointerDown(ev(H.doc, [0, 0, 0], { edge: e1 }));
    t.pointerMove(ev(H.doc, [0, 0, 0], { edge: e2, down: true }));
    expect(t.preview().edges).toEqual(expect.arrayContaining([e1, e2]));
    expect([...H.model.edges()]).toHaveLength(4);
    t.pointerUp!(ev(H.doc, [0, 0, 0]), true);
    expect([...H.model.edges()]).toHaveLength(2);
    H.controller.undo();
    expect([...H.model.edges()]).toHaveLength(4);
  });

  it('clicking empty space or a face erases nothing', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const t = use(H.controller, 'eraser');
    t.pointerDown(ev(H.doc, [5, 5, 0]));
    t.pointerUp!(ev(H.doc, [5, 5, 0]), false);
    expect(H.model.faces.size).toBe(1);
    expect(H.controller.history.undoLabel).toBeNull();
  });
});

describe('navigation tools', () => {
  it('Orbit, Pan and Zoom are tools that never change the model', () => {
    const H = harness();
    for (const id of ['orbit', 'pan', 'zoom'] as const) {
      const t = use(H.controller, id);
      t.pointerDown(ev(H.doc, [0, 0, 0]));
      expect(t.hint()).toMatch(/Drag/);
      H.controller.typed('10');
      expect(H.controller.error).toMatch(/no typed input/);
    }
    expect(H.model.faces.size).toBe(0);
  });
});

describe('axis locking (arrow keys)', () => {
  it('the locked point stays on the axis through the start point', () => {
    const s = infer({
      model: harness().model,
      guides: new Guides(),
      projector: topDown,
      cursor: [40, -25],
      ray: { origin: [40, 25, 100], dir: [0, 0, -1] },
      faceHit: null,
      hints: { reference: [0, 0, 0], lock: { dir: [1, 0, 0], axis: 0 } },
    });
    expect(s?.kind).toBe('axis');
    expect(s?.locked).toBe(true);
    expect(s?.point[0]).toBeCloseTo(40);
    expect(s?.point[1]).toBeCloseTo(0);
  });

  it('hovering a point while locked gives that point projected onto the locked line', () => {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 30, 20).inner!, 10);
    const s = infer({
      model: H.model,
      guides: new Guides(),
      projector: topDown,
      cursor: [30, -20],
      ray: { origin: [30, 20, 100], dir: [0, 0, -1] },
      faceHit: null,
      hints: { reference: [0, 50, 0], lock: { dir: [1, 0, 0], axis: 0 } },
    });
    // The corner (30, 20, z) is snapped, then held on the red line through (0, 50, 0).
    expect(s?.point).toEqual([30, 50, 0]);
  });

  it('the controller locks only once a tool has a start point; pressing again unlocks', () => {
    const H = harness();
    use(H.controller, 'tape');
    H.controller.toggleLock('x');
    expect(H.controller.lock).toBeNull();
    expect(H.controller.notice).toMatch(/start point/);
    H.controller.tools.tape.pointerDown(ev(H.doc, [0, 0, 0], { kind: 'endpoint' }));
    H.controller.toggleLock('z');
    expect(H.controller.lock).toBe('z');
    H.controller.toggleLock('z');
    expect(H.controller.lock).toBeNull();
  });

  it('a locked tape measure places the guide point on the blue axis', () => {
    const H = harness();
    use(H.controller, 'tape');
    H.controller.tools.tape.pointerDown(ev(H.doc, [0, 0, 0], { kind: 'endpoint' }));
    H.controller.toggleLock('z');
    // Cursor somewhere off-axis; a ray from the side passing near the blue axis at z = 30.
    H.controller.pointerMove({ screen: [5, 5], ray: { origin: [5, -100, 30], dir: [0, 1, 0] }, faceHit: null, edge: null, shift: false, ctrl: false, down: false });
    expect(H.controller.snap?.kind).toBe('axis');
    H.controller.typed('25');
    expect(H.doc.guides.points()[0].pos).toEqual([0, 0, 25]);
  });

  it('↓ needs an edge to have been hovered', () => {
    const H = harness();
    use(H.controller, 'tape');
    H.controller.tools.tape.pointerDown(ev(H.doc, [0, 0, 0], { kind: 'endpoint' }));
    H.controller.toggleLock('parallel');
    expect(H.controller.lock).toBeNull();
    expect(H.controller.notice).toMatch(/Hover an edge/);
  });

  it('↓ cycles parallel → perpendicular → off', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    use(H.controller, 'line');
    const edge = [...H.model.edges()][0];
    // Hover an edge (records its direction), then start the line.
    H.controller.pointerMove({ screen: [0, 0], ray: { origin: [5, 0, 100], dir: [0, 0, -1] }, faceHit: null, edge, shift: false, ctrl: false, down: false });
    H.controller.tools.line.pointerDown(ev(H.doc, [50, 50, 0], { kind: 'endpoint', face: null }));
    H.controller.toggleLock('parallel');
    expect(H.controller.lock).toBe('parallel');
    H.controller.toggleLock('parallel');
    expect(H.controller.lock).toBe('perpendicular');
    expect(H.controller.notice).toMatch(/perpendicular/);
    H.controller.toggleLock('parallel');
    expect(H.controller.lock).toBeNull();
  });

  it('a line locked perpendicular to an edge stays at right angles to it, whatever is hovered next', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const along = [...H.model.edges()].find((e) => {
      const a = H.model.pos(H.model.he(e).origin);
      const b = H.model.pos(H.model.dest(e));
      return a[1] === 0 && b[1] === 0; // the edge along red
    })!;
    const across = [...H.model.edges()].find((e) => H.model.pos(H.model.he(e).origin)[0] === H.model.pos(H.model.dest(e))[0])!;
    use(H.controller, 'line');
    // Cursor far from everything (no point snaps): only the lock decides the point.
    const sample = (origin: Vec3, dir: Vec3, edge: number | null) => ({ screen: [900, 900] as [number, number], ray: { origin, dir }, faceHit: null, edge, shift: false, ctrl: false, down: false });
    H.controller.pointerMove(sample([5, 0, 100], [0, 0, -1], along));
    H.controller.tools.line.pointerDown(ev(H.doc, [50, 50, 0], { kind: 'endpoint', face: null }));
    H.controller.toggleLock('parallel');
    H.controller.toggleLock('parallel'); // perpendicular to red: the plane x = 50
    // Hover the other edge on the way: the lock must keep the first edge's direction.
    H.controller.pointerMove(sample([10, 5, 100], [0, 0, -1], across));
    // A ray crossing the plane x = 50 at (50, 80, 30).
    H.controller.pointerMove(sample([90, 80, 30], [-1, 0, 0], null));
    expect(H.controller.snap?.kind).toBe('perpendicular');
    expect(H.controller.snap?.point).toEqual([50, 80, 30]);
    H.controller.typed('30');
    const ends = [...H.model.vertices.values()].filter((v) => v.pos[2] > 1);
    expect(ends).toHaveLength(1);
    expect(ends[0].pos[0]).toBeCloseTo(50);
    expect(Math.hypot(ends[0].pos[1] - 50, ends[0].pos[2])).toBeCloseTo(30);
  });
});
