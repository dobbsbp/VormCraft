import { beforeAll, describe, expect, it } from 'vitest';
import { buildWalls, checkWatertight, initBooleanKernel, solidReport, volume, wallFootprint, type Vec3 } from '../src/core';
import { infer } from '../src/tools/inference';
import { ev, harness, topDown, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const area = (p: readonly (readonly [number, number])[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);

describe('wall outlines and solids', () => {
  it('a straight wall centred on its line', () => {
    const fp = wallFootprint([[0, 0], [1000, 0]], 200, 'centre', false);
    expect(fp.inner).toBeUndefined();
    expect(area(fp.outer)).toBeCloseTo(1000 * 200, 6);
    expect(Math.min(...fp.outer.map((p) => p[1]))).toBeCloseTo(-100, 9);
  });

  it('an L of walls to the left of the line meets in a mitred corner', () => {
    const fp = wallFootprint([[0, 0], [1000, 0], [1000, 1000]], 100, 'left', false);
    expect(area(fp.outer)).toBeCloseTo(1000 * 100 + 100 * 1000 - 100 * 100, 6);
    // The inside corner of the L.
    expect(fp.outer.some((p) => Math.abs(p[0] - 900) < 1e-9 && Math.abs(p[1] - 100) < 1e-9)).toBe(true);
  });

  it('a closed room: an outside and an inside outline, whichever way it is drawn', () => {
    for (const pts of [
      [[0, 0], [4000, 0], [4000, 3000], [0, 3000]],
      [[0, 0], [0, 3000], [4000, 3000], [4000, 0]],
    ] as [number, number][][]) {
      const fp = wallFootprint(pts, 200, 'centre', true);
      expect(area(fp.outer)).toBeCloseTo(4200 * 3200, 3);
      expect(area(fp.inner!)).toBeCloseTo(3800 * 2800, 3);
    }
    // Drawn round the inside of the room, walls to the outside: the room keeps its inside size.
    const fp = wallFootprint([[0, 0], [4000, 0], [4000, 3000], [0, 3000]], 200, 'right', true);
    expect(area(fp.inner!)).toBeCloseTo(4000 * 3000, 3);
    expect(area(fp.outer)).toBeCloseTo(4400 * 3400, 3);
  });

  it('refuses walls that fold back, corners too sharp, and walls that cross', () => {
    expect(() => wallFootprint([[0, 0], [1000, 0], [0, 0]], 100, 'centre', false)).toThrow(/straight back/);
    expect(() => wallFootprint([[0, 0], [1000, 0], [0, 50]], 100, 'centre', false)).toThrow(/too sharp/);
    expect(() => wallFootprint([[0, 0], [1000, 0], [1000, 1000], [500, 1000], [500, -500]], 100, 'centre', false)).toThrow(/run into each other/);
    expect(() => wallFootprint([[0, 0], [1000, 0]], 0, 'centre', false)).toThrow(/thickness/);
    expect(() => wallFootprint([[0, 0]], 100, 'centre', false)).toThrow(/at least one wall/);
  });

  it('builds a closed solid room standing on the height it was drawn at', () => {
    const pts: Vec3[] = [[0, 0, 150], [4000, 0, 150], [4000, 3000, 150], [0, 3000, 150]];
    const { model } = buildWalls(pts, 200, 2700, 'centre', true);
    expect(checkWatertight(model).watertight).toBe(true);
    expect(solidReport(model)).toMatchObject({ solids: 1, insideOut: 0 });
    expect(volume(model)).toBeCloseTo((4200 * 3200 - 3800 * 2800) * 2700, 0);
    const zs = [...model.vertices.values()].map((v) => v.pos[2]);
    expect(Math.min(...zs)).toBeCloseTo(150, 9);
    expect(Math.max(...zs)).toBeCloseTo(2850, 9);
    // Floor ring, top ring, 4 outside and 4 inside walls.
    expect(model.faces.size).toBe(10);
    model.validate();
  });

  it('builds an open run as one closed solid too', () => {
    const { model } = buildWalls([[0, 0, 0], [1000, 0, 0], [1000, 1000, 0]], 100, 2400, 'left', false);
    expect(solidReport(model)).toMatchObject({ solids: 1, insideOut: 0, open: 0 });
    expect(volume(model)).toBeCloseTo(190000 * 2400, 0);
  });
});

describe('the Wall tool', () => {
  const click = (h: ReturnType<typeof harness>, p: Vec3) => {
    const tool = h.controller.tool;
    tool.pointerMove(ev(h.doc, p, { face: null }));
    tool.pointerDown(ev(h.doc, p, { face: null }));
  };

  it('clicking round a room and back to the start makes closed walls in a group, as one undo step', () => {
    const h = harness();
    use(h.controller, 'wall');
    expect(h.controller.hint()).toMatch(/Click to start the walls/);
    h.controller.typed('200, 2400');
    for (const p of [[0, 0, 0], [4000, 0, 0], [4000, 3000, 0], [0, 3000, 0]] as Vec3[]) click(h, p);
    // The corners drawn so far snap like endpoints, so the first one can be clicked to close the room.
    expect(h.controller.tool.inference().points).toHaveLength(4);
    const snap = infer({ model: h.doc.model, guides: h.doc.guides, projector: topDown, cursor: [3, 2], ray: { origin: [3, -2, 1000], dir: [0, 0, -1] }, faceHit: null, hints: h.controller.tool.inference() });
    expect(snap).toMatchObject({ kind: 'endpoint', point: [0, 0, 0] });
    click(h, [0, 0, 0]);
    const groups = [...h.doc.groups.items.values()];
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Walls');
    expect(volume(groups[0].model)).toBeCloseTo((4200 * 3200 - 3800 * 2800) * 2400, 0);
    expect([...h.controller.selection.groups]).toEqual([groups[0].id]);
    expect(h.controller.history.undoLabel).toBe('Walls');
    h.controller.undo();
    expect(h.doc.groups.items.size).toBe(0);
  });

  it('typed lengths, Ctrl for the side, and a double-click to end an open run', () => {
    const h = harness();
    const tool = use(h.controller, 'wall');
    h.controller.typed('100, 2000');
    click(h, [0, 0, 0]);
    tool.pointerMove(ev(h.doc, [500, 0, 0], { face: null }));
    h.controller.typed('1000');
    tool.pointerMove(ev(h.doc, [1000, 300, 0], { face: null }));
    expect(tool.preview().lines!.length).toBe(2);
    h.controller.typed('1000');
    h.controller.toggleCopy();
    expect(h.controller.notice).toMatch(/to the left of the line/);
    tool.doubleClick!(ev(h.doc, [1000, 1000, 0], { face: null }));
    const g = [...h.doc.groups.items.values()][0];
    expect(volume(g.model)).toBeCloseTo(190000 * 2000, 0);
    expect(solidReport(g.model)).toMatchObject({ solids: 1, insideOut: 0 });
  });

  it('walls start at the height of the first click; Esc cancels; a corner too sharp is refused', () => {
    const h = harness();
    const tool = use(h.controller, 'wall');
    click(h, [0, 0, 150]);
    click(h, [1000, 0, 400]); // kept on the floor of the run
    click(h, [1000, 1000, 0]);
    tool.enter!();
    const g = [...h.doc.groups.items.values()][0];
    expect(Math.min(...[...g.model.vertices.values()].map((v) => v.pos[2]))).toBeCloseTo(150, 9);
    click(h, [0, 0, 0]);
    click(h, [1000, 0, 0]);
    h.controller.escape();
    tool.enter!();
    expect(h.doc.groups.items.size).toBe(1);
    click(h, [0, 0, 0]);
    click(h, [1000, 0, 0]);
    tool.pointerMove(ev(h.doc, [0, 20, 0], { face: null }));
    expect(() => tool.pointerDown(ev(h.doc, [0, 20, 0], { face: null }))).toThrow(/too sharp/);
    expect(() => tool.typed('-5')).toThrow(/length/);
  });
});
