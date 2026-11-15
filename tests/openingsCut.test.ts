import { beforeAll, describe, expect, it } from 'vitest';
import { buildWalls, checkWatertight, cutOpening, findFaceAt, initBooleanKernel, modelBounds, solidReport, volume, wallThickness, type Vec3 } from '../src/core';
import { LIBRARY, PAINTS } from '../src/library';
import type { Placeable } from '../src/tools/PlaceTool';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A straight wall 3000 long along red, 200 thick (y from -100 to 100), 2700 high. */
function wall(z = 0) {
  return buildWalls([[0, 0, z], [3000, 0, z]], 200, 2700, 'centre', false).model;
}

describe('doors and windows cutting their opening', () => {
  it('measures the wall thickness behind a point', () => {
    const m = wall();
    const front = findFaceAt(m, [1500, -100, 1000])!;
    expect(wallThickness(m, front, [1500, -100, 1000])).toBeCloseTo(200, 9);
  });

  it('a door at floor level notches a closed wall, which stays a closed solid', () => {
    const m = wall();
    const front = findFaceAt(m, [1500, -100, 1000])!;
    const before = volume(m);
    const t = cutOpening(m, front, { width: 900, height: 2100, bottom: [1500, -100, 0] });
    expect(t).toBeCloseTo(200, 9);
    expect(checkWatertight(m).watertight).toBe(true);
    expect(solidReport(m)).toMatchObject({ solids: 1, insideOut: 0 });
    expect(volume(m)).toBeCloseTo(before - 900 * 2100 * 200, 0);
    expect(findFaceAt(m, [1500, -100, 1000])).toBeUndefined(); // the doorway is open
    m.validate();
  });

  it('a window above the floor makes a hole through a closed wall', () => {
    const m = wall(150);
    const back = findFaceAt(m, [700, 100, 1500])!;
    const before = volume(m);
    cutOpening(m, back, { width: 1200, height: 1200, bottom: [700, 100, 150 + 900] });
    expect(checkWatertight(m).watertight).toBe(true);
    expect(volume(m)).toBeCloseTo(before - 1200 * 1200 * 200, 0);
    // One wall with a hole in each side: a ring round the hole.
    expect(solidReport(m)).toMatchObject({ solids: 1, insideOut: 0 });
  });

  it('an open wall (no bottom) is punched through', () => {
    const m = wall();
    const bottom = [...m.faces.values()].find((f) => f.normal[2] < -0.99)!;
    m.removeFace(bottom.id);
    const front = findFaceAt(m, [1500, -100, 1000])!;
    cutOpening(m, front, { width: 1000, height: 1000, bottom: [1500, -100, 900] });
    expect(findFaceAt(m, [1500, -100, 1400])).toBeUndefined();
    expect(findFaceAt(m, [1500, 100, 1400])).toBeUndefined();
    m.validate();
  });

  it('refuses an opening that does not fit, or one on a floor', () => {
    const m = wall();
    const front = findFaceAt(m, [1500, -100, 1000])!;
    expect(() => cutOpening(m, front, { width: 900, height: 3000, bottom: [1500, -100, 0] })).toThrow(/does not fit/);
    expect(() => cutOpening(m, front, { width: 900, height: 2100, bottom: [100, -100, 0] })).toThrow(/does not fit/);
    const top = findFaceAt(m, [1500, 0, 2700])!;
    expect(() => cutOpening(m, top, { width: 100, height: 100, bottom: [1500, 0, 2700] as Vec3 })).toThrow(/upright walls/);
  });
});

describe('placing doors and windows from the Library on walls', () => {
  function walls() {
    const h = harness();
    use(h.controller, 'wall');
    h.controller.typed('200, 2700');
    for (const p of [[0, 0, 0], [4000, 0, 0], [4000, 3000, 0], [0, 3000, 0], [0, 0, 0]] as Vec3[]) {
      h.controller.tool.pointerMove(ev(h.doc, p, { face: null }));
      h.controller.tool.pointerDown(ev(h.doc, p, { face: null }));
    }
    const wallsId = [...h.doc.groups.items.keys()][0];
    return { ...h, wallsId };
  }

  function placeable(id: string, variant: string): Placeable {
    const item = LIBRARY.find((i) => i.id === id)!;
    return {
      name: item.name,
      source: `library:${id}:${variant}`,
      opening: item.opening!(variant),
      parts: item.build(variant).map((p) => ({ name: p.name, model: p.model, paint: { name: PAINTS[p.paint].name, color: PAINTS[p.paint].color, opacity: 1 } })),
    };
  }

  /** Point at the outside of the front wall (y = -100) at x, as the cursor would over the walls group. */
  function overFront(h: ReturnType<typeof walls>, x: number, z = 1000) {
    const m = h.doc.groups.get(h.wallsId)!.model;
    const p: Vec3 = [x, -100, z];
    const face = findFaceAt(m, p)!;
    expect(face).toBeDefined();
    return { ...ev(h.doc, p, { face: null, group: h.wallsId, snap: { normal: [0, -1, 0] } }), otherFace: { owner: h.wallsId, face, point: p } };
  }

  it('a door clicked on a wall cuts a doorway at the floor and stands in the middle of the wall, facing out', () => {
    const h = walls();
    const before = volume(h.doc.groups.get(h.wallsId)!.model);
    h.controller.place(placeable('door', '900'));
    const tool = h.controller.tool;
    tool.pointerMove(overFront(h, 2000));
    expect(h.controller.hint()).toMatch(/put the door in this wall/);
    tool.pointerDown(overFront(h, 2000));
    const wallModel = h.doc.groups.get(h.wallsId)!.model;
    expect(volume(wallModel)).toBeCloseTo(before - 900 * 2100 * 200, 0);
    expect(solidReport(wallModel)).toMatchObject({ solids: 1, insideOut: 0 });
    const door = h.doc.groups.children(null).find((g) => g.name === 'Door')!;
    const b = modelBounds(h.doc.groups.subtree(door.id).map((g) => g.model))!;
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(2000, 6);
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(0, 6); // the wall's middle
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[0] - b.min[0]).toBeCloseTo(900, 6);
    expect(h.controller.history.undoLabel).toBe('Place Door');
    h.controller.undo();
    expect(volume(h.doc.groups.get(h.wallsId)!.model)).toBeCloseTo(before, 0);
  });

  it('a window sits at its sill height; a second one is a copy of the same component', () => {
    const h = walls();
    for (const x of [1000, 3000]) {
      h.controller.place(placeable('window', '1200x1200'));
      h.controller.tool.pointerDown(overFront(h, x, 1500));
    }
    const windows = h.doc.groups.children(null).filter((g) => g.name === 'Window');
    expect(windows).toHaveLength(2);
    expect(windows[0].component!.id).toBe(windows[1].component!.id);
    const b = modelBounds(h.doc.groups.subtree(windows[1].id).map((g) => g.model))!;
    expect(b.min[2]).toBeCloseTo(900, 6);
    expect(b.max[2]).toBeCloseTo(2100, 6);
    const wallModel = h.doc.groups.get(h.wallsId)!.model;
    expect(findFaceAt(wallModel, [3000, -100, 1500])).toBeUndefined();
    expect(solidReport(wallModel)).toMatchObject({ solids: 1, insideOut: 0 });
  });

  it('a door too big for the wall there is refused and nothing changes', () => {
    const h = walls();
    h.controller.place(placeable('door', '1600'));
    expect(() => h.controller.tool.pointerDown(overFront(h, 300))).toThrow(/does not fit/);
    expect(h.doc.groups.items.size).toBe(1);
  });
});
