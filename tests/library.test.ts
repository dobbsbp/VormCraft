import { beforeAll, describe, expect, it } from 'vitest';
import { booleanInPlace, checkWatertight, initBooleanKernel, Model, modelBounds, type Vec3 } from '../src/core';
import { triangulate2D } from '../src/core/math/polygon2d';
import { LIBRARY, PAINTS, ROOMS, searchLibrary, type LibraryItem, type LibraryPart } from '../src/library';
import { part } from '../src/library/kit';
import type { Placeable } from '../src/tools/PlaceTool';
import { ev, harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const byId = (id: string): LibraryItem => {
  const item = LIBRARY.find((i) => i.id === id);
  if (!item) throw new Error(`No item ${id}`);
  return item;
};

/** Width (x), depth (y), height (z) and lowest point of some parts, rounded to 0.1 mm. */
function size(parts: readonly LibraryPart[]): { w: number; d: number; h: number; z0: number; min: Vec3; max: Vec3 } {
  const b = modelBounds(parts.map((p) => p.model))!;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { w: r(b.max[0] - b.min[0]), d: r(b.max[1] - b.min[1]), h: r(b.max[2] - b.min[2]), z0: r(b.min[2]), min: b.min, max: b.max };
}

const partNamed = (parts: readonly LibraryPart[], name: string): LibraryPart => parts.find((p) => p.name === name)!;

function placeable(item: LibraryItem, variant?: string): Placeable {
  return {
    name: item.name,
    hangs: item.hangs,
    parts: item.build(variant).map((p) => ({ name: p.name, model: p.model, paint: { name: PAINTS[p.paint].name, color: PAINTS[p.paint].color, opacity: 1 } })),
  };
}

describe('triangulation with holes in a row', () => {
  it('uses every point, so a face with holes lined up stays closed', () => {
    const outer: [number, number][] = [
      [-600, -400],
      [600, -400],
      [600, 400],
      [-600, 400],
    ];
    const hole = (x: number): [number, number][] => [
      [x, -385],
      [x, -335],
      [x + 50, -335],
      [x + 50, -385],
    ];
    // 12 points, 2 holes: a full triangulation has 12 + 4 - 2 triangles.
    expect(triangulate2D(outer, [hole(-585), hole(535)])).toHaveLength(14);
  });

  it('a table top with four legs unions into one closed solid', () => {
    const t = part('Table', 'oak').box([-600, -400, 720], [600, 400, 750]);
    for (const [x, y] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ])
      t.box([x * 560 - 25, y * 360 - 25, 0], [x * 560 + 25, y * 360 + 25, 735]);
    const { model } = t.build();
    expect(checkWatertight(model).watertight).toBe(true);
    // A further boolean on the result still works (its faces with holes convert cleanly).
    const tool = new Model();
    expect(() => booleanInPlace(model, new Set(model.faces.keys()), { model: tool, faces: [] }, 'union')).not.toThrow();
  });
});

describe('library items', () => {
  it('have unique ids, rooms from the list, tags and unique variant ids', () => {
    const ids = LIBRARY.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of LIBRARY) {
      expect(item.tags.length, item.id).toBeGreaterThan(0);
      expect(item.rooms.length, item.id).toBeGreaterThan(0);
      for (const r of item.rooms) expect(ROOMS, item.id).toContain(r);
      const v = (item.variants ?? []).map((x) => x.id);
      expect(new Set(v).size, item.id).toBe(v.length);
    }
    expect(LIBRARY.length).toBeGreaterThanOrEqual(45);
  });

  it('every item and size builds into closed solids standing on (or above) the ground, centred', () => {
    for (const item of LIBRARY) {
      for (const v of item.variants ?? [undefined]) {
        const what = `${item.id} ${v?.id ?? ''}`;
        const parts = item.build(v?.id);
        expect(parts.length, what).toBeGreaterThan(0);
        for (const p of parts) {
          expect(checkWatertight(p.model).watertight, `${what} ${p.name}`).toBe(true);
          expect(PAINTS[p.paint], `${what} ${p.name}`).toBeDefined();
        }
        const s = size(parts);
        expect(s.z0, what).toBeGreaterThanOrEqual(0);
        expect(Math.max(s.w, s.d, s.h), what).toBeLessThanOrEqual(3100);
        expect(Math.min(s.w, s.d, s.h), what).toBeGreaterThanOrEqual(5);
        expect(Math.abs((s.min[0] + s.max[0]) / 2), what).toBeLessThan(1);
      }
    }
  });

  it('are made at real-world sizes', () => {
    const table = size(byId('dining-table').build('1800'));
    expect([table.w, table.d, table.h]).toEqual([1800, 900, 750]);
    expect(size(byId('dining-chair').build()).h).toBe(900);
    const seat = partNamed(byId('bar-stool').build('650'), 'Seat');
    expect(size([seat]).max[2]).toBe(650);
    // Kitchen: worktops at 900 mm, units as wide as their size, wall units hung from 1400 mm.
    for (const w of ['300', '600', '900']) {
      const unit = size(byId('base-cabinet').build(w));
      expect(unit.w).toBe(Number(w));
      expect(unit.h).toBe(900);
    }
    expect(size(byId('wall-cabinet').build('600')).z0).toBe(1400);
    // Beds: the mattress is the named size.
    const mattress = size([partNamed(byId('bed').build('1600'), 'Mattress')]);
    expect([mattress.w, mattress.d]).toEqual([1600, 2000]);
    expect(size([partNamed(byId('bed').build('900'), 'Mattress')]).w).toBe(900);
    expect(size(byId('sofa').build('2100')).w).toBe(2100);
    expect(size(byId('refrigerator').build()).h).toBe(1850);
    const bath = size(byId('bathtub').build('1700'));
    expect([bath.w, bath.d]).toEqual([1700, 750]);
    const washer = size(byId('washing-machine').build());
    expect([washer.w, washer.h]).toEqual([600, 850]);
    // A 55" TV's screen is 55 inches across.
    const tv = size([partNamed(byId('tv').build('55'), 'Body')]);
    expect(Math.hypot(tv.w - 20, tv.h - 20) / 25.4).toBeCloseTo(55, 0);
  });

  it('stay light: no item has more than 600 faces', () => {
    for (const item of LIBRARY) {
      const faces = item.build(item.variants?.at(-1)?.id).reduce((n, p) => n + p.model.faces.size, 0);
      expect(faces, item.id).toBeLessThanOrEqual(600);
    }
  });
});

describe('library search', () => {
  const first = (q: string, filter = {}) => searchLibrary(LIBRARY, q, filter)[0]?.item.id;

  it('finds items by name, other names and plurals', () => {
    expect(first('sofa')).toBe('sofa');
    expect(first('couch')).toBe('sofa');
    expect(first('fridge')).toBe('refrigerator');
    expect(first('telly')).toBe('tv');
    expect(first('Chairs')).toBe('dining-chair');
    expect(searchLibrary(LIBRARY, 'chair').map((h) => h.item.id)).toEqual(expect.arrayContaining(['dining-chair', 'armchair', 'office-chair']));
  });

  it('allows typos and unfinished words', () => {
    expect(first('sofaa')).toBe('sofa');
    expect(first('wardrboe')).toBe('wardrobe');
    expect(first('dishw')).toBe('dishwasher');
  });

  it('needs every word to match, and matches sizes and rooms', () => {
    expect(first('queen bed')).toBe('bed');
    expect(first('bathroom mirror')).toBe('bathroom-mirror');
    expect(searchLibrary(LIBRARY, 'sofa xylophone')).toEqual([]);
  });

  it('narrows by room and kind; an empty search lists everything in order', () => {
    expect(searchLibrary(LIBRARY, '').map((h) => h.item)).toEqual(LIBRARY);
    const kitchen = searchLibrary(LIBRARY, '', { room: 'Kitchen' }).map((h) => h.item);
    expect(kitchen.length).toBeGreaterThan(5);
    expect(kitchen.every((i) => i.rooms.includes('Kitchen'))).toBe(true);
    const lights = searchLibrary(LIBRARY, 'lamp', { subcategory: 'Lighting' }).map((h) => h.item.id);
    expect(lights).toEqual(expect.arrayContaining(['floor-lamp', 'table-lamp']));
    expect(lights.every((id) => byId(id).subcategory === 'Lighting')).toBe(true);
  });
});

describe('placing an item', () => {
  it('follows the cursor and is placed as a group with a group per part, base centred on the click', () => {
    const { doc, controller } = harness();
    const bed = byId('bed');
    controller.place(placeable(bed, '1600'));
    expect(controller.tool.id).toBe('place');
    controller.tool.pointerMove(ev(doc, [1000, 2000, 0]));
    expect(controller.tool.preview().lines?.[0].points.length).toBeGreaterThan(0);
    controller.tool.pointerDown(ev(doc, [1000, 2000, 0]));
    // Back to Select with the new group selected.
    expect(controller.tool.id).toBe('select');
    const [id] = [...controller.selection.groups];
    const group = doc.groups.get(id)!;
    expect(group.name).toBe('Bed');
    const children = doc.groups.children(id);
    expect(children.map((c) => c.name)).toEqual(['Frame', 'Mattress', 'Bedding', 'Pillows']);
    const b = modelBounds(children.map((c) => c.model))!;
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(1000, 6);
    expect((b.min[1] + b.max[1]) / 2).toBeCloseTo(2000, 6);
    expect(b.min[2]).toBeCloseTo(0, 6);
    // Each part is painted through its group, with the library's paints.
    expect(children.map((c) => doc.materials.get(c.material!)?.name)).toEqual(['Walnut', 'White', 'Fabric blue', 'Linen']);
    expect(controller.history.undoLabel).toBe('Place Bed');
  });

  it('turns 90° with an arrow key, or to a typed angle', () => {
    const { doc, controller } = harness();
    controller.place(placeable(byId('dining-table'), '1800'));
    controller.toggleLock('x');
    controller.tool.pointerDown(ev(doc, [0, 0, 0]));
    const [id] = [...controller.selection.groups];
    const b = modelBounds([doc.groups.get(id)!.model])!;
    expect(b.max[0] - b.min[0]).toBeCloseTo(900, 6);
    expect(b.max[1] - b.min[1]).toBeCloseTo(1800, 6);

    controller.place(placeable(byId('dining-table'), '1800'));
    controller.tool.typed('180');
    expect(controller.tool.vcbValue()).toBe('180°');
  });

  it('hangs a hanging item from the point clicked, and reuses paints already in the model', () => {
    const { doc, controller } = harness();
    const pendant = byId('pendant-light');
    controller.place(placeable(pendant));
    controller.tool.pointerDown(ev(doc, [0, 0, 2400]));
    const [first] = [...controller.selection.groups];
    const b = modelBounds(doc.groups.children(first).map((c) => c.model))!;
    expect(b.max[2]).toBeCloseTo(2400, 6);
    const materials = doc.materials.items.size;
    controller.place(placeable(pendant));
    controller.tool.pointerDown(ev(doc, [1000, 0, 2400]));
    expect(doc.materials.items.size).toBe(materials);
  });

  it('Esc cancels without changing anything; undo takes a placed item away in one step', () => {
    const { doc, controller } = harness();
    controller.place(placeable(byId('sofa')));
    controller.escape();
    expect(controller.tool.id).toBe('select');
    expect(doc.groups.items.size).toBe(0);
    controller.place(placeable(byId('sofa')));
    controller.tool.pointerDown(ev(doc, [0, 0, 0]));
    expect(doc.groups.items.size).toBe(4);
    controller.undo();
    expect(doc.groups.items.size).toBe(0);
  });
});
