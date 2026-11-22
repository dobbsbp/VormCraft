import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, initBooleanKernel, modelBounds, volume, type Vec3 } from '../src/core';
import { manifoldVolume } from '../src/core/boolean/manifold';
import { pointInSolid } from '../src/core/check/solid';
import { isCustomised, itemSource, LIBRARY, PAINTS, paramShown, paramValues, presetValues, type LibraryItem, type LibraryPart } from '../src/library';
import { part } from '../src/library/kit';
import type { Placeable } from '../src/tools/PlaceTool';
import { ev, harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const byId = (id: string): LibraryItem => LIBRARY.find((i) => i.id === id)!;

function size(parts: readonly LibraryPart[]) {
  const b = modelBounds(parts.map((p) => p.model))!;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { w: r(b.max[0] - b.min[0]), d: r(b.max[1] - b.min[1]), h: r(b.max[2] - b.min[2]), min: b.min, max: b.max };
}

const customisable = LIBRARY.filter((i) => i.params?.length);

describe('customisable library items: settings', () => {
  it('start from the defaults, then the size, then what was given (put in range)', () => {
    const table = byId('dining-table');
    expect(presetValues(table)).toMatchObject({ width: 1200, depth: 800, height: 750, top: 30 });
    expect(presetValues(table, '1800')).toMatchObject({ width: 1800, depth: 900 });
    const v = paramValues(table, '1800', { depth: 600, height: 99999, leg: Number.NaN, nonsense: 5 } as Record<string, number>);
    expect(v).toMatchObject({ width: 1800, depth: 600, height: 1200, leg: 70 });
    expect('nonsense' in v).toBe(false);
    // Counts are whole numbers, toggles 0 or 1, choices an index in range.
    expect(paramValues(byId('bookshelf'), undefined, { shelves: 3.6 }).shelves).toBe(4);
    expect(paramValues(byId('coffee-table'), undefined, { shelf: 7 }).shelf).toBe(1);
    expect(paramValues(byId('light-fixture'), undefined, { shape: 42 }).shape).toBe(4);
  });

  it('are named so the same item at the same settings links to one component', () => {
    const table = byId('dining-table');
    expect(itemSource(table, '1800', presetValues(table, '1800'))).toBe('library:dining-table:1800');
    const custom = paramValues(table, undefined, { width: 1200, depth: 600, height: 700 });
    expect(isCustomised(table, undefined, custom)).toBe(true);
    expect(itemSource(table, undefined, custom)).toBe('library:dining-table:custom:width=1200,depth=600,height=700,top=30,leg=70,inset=50');
    // Settings that are not shown do not count: a box has no top width.
    const light = byId('light-fixture');
    const box = paramValues(light, undefined, { shape: 0 });
    const top = light.params!.find((p) => p.id === 'topWidth')!;
    expect(paramShown(top, box)).toBe(false);
    expect(itemSource(light, undefined, { ...box, topWidth: 999 })).toBe(itemSource(light, undefined, box));
  });

  it('build the sizes asked for: a table 1.2 m × 60 cm × 70 cm tall', () => {
    const parts = byId('dining-table').build(undefined, { width: 1200, depth: 600, height: 700 });
    expect(size(parts)).toMatchObject({ w: 1200, d: 600, h: 700 });
    expect(checkWatertight(parts[0].model).watertight).toBe(true);
    expect(size(byId('desk').build('1400', { height: 1050 }))).toMatchObject({ w: 1400, d: 700, h: 1050 });
    expect(size(byId('round-table').build(undefined, { diameter: 1100, height: 700 }))).toMatchObject({ w: 1100, h: 700 });
    expect(size(byId('bookshelf').build(undefined, { width: 1200, depth: 250, height: 2000, shelves: 6 }))).toMatchObject({ w: 1200, d: 250, h: 2000 });
    expect(size(byId('coffee-table').build(undefined, { height: 300, shelf: 0 })).h).toBe(300);
  });

  it('every setting, at its smallest and largest, builds closed solids on the ground, or says what to change', () => {
    for (const item of customisable) {
      for (const p of item.params!) {
        const values = p.kind === 'choice' ? (p.choices ?? []).map((_, i) => i) : p.kind === 'toggle' ? [0, 1] : [p.min!, p.max!];
        for (const value of values) {
          const what = `${item.id} ${p.id}=${value}`;
          let parts: LibraryPart[];
          try {
            parts = item.build(undefined, { [p.id]: value });
          } catch (err) {
            // A refusal is a plain sentence saying what to change.
            expect((err as Error).message, what).toMatch(/^[A-Z][^.]*[a-z]$/);
            continue;
          }
          for (const x of parts) expect(checkWatertight(x.model).watertight, `${what} ${x.name}`).toBe(true);
          const s = size(parts);
          expect(s.min[2], what).toBeGreaterThanOrEqual(-1e-6);
          expect(Math.abs((s.min[0] + s.max[0]) / 2), what).toBeLessThan(1);
          expect(parts.reduce((n, x) => n + x.model.faces.size, 0), what).toBeLessThanOrEqual(600);
        }
      }
    }
  });

  it('refuses impossible combinations, saying what to change', () => {
    expect(() => byId('dining-table').build(undefined, { width: 400, depth: 400, leg: 150, inset: 100 })).toThrow(/legs do not fit/);
    expect(() => byId('bookshelf').build(undefined, { height: 500, shelves: 12 })).toThrow(/Too many shelves/);
    expect(() => byId('light-fixture').build(undefined, { shape: 3, topWidth: 20 })).toThrow(/too narrow for the cord/);
    expect(() => byId('phone-stand').build(undefined, { width: 30, cableWidth: 20 })).toThrow(/too narrow for a cable slot/);
  });
});

describe('phone stand', () => {
  /** The phone leaning on the stand, as a solid: its back on the support, its bottom on the ledge (+ `lift`). */
  function phone(values: Record<string, number>, lift: number, shrink = 0) {
    const stand = byId('phone-stand');
    const v = paramValues(stand, undefined, values);
    const parts = stand.build(undefined, values);
    const b = size(parts);
    const a = (v.angle * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    // Where the support's front face meets the ledge: the slot's back, (thickness + gap) / sin behind the lip's back.
    const slot = (v.thickness + v.gap) / s;
    const y = b.min[1] + slot + v.wall;
    const z = v.ledge + lift;
    const t = v.thickness - shrink;
    const corner = (along: number, out: number): Vec3 => [-v.width, y + along * c - out * s, z + along * s + out * c];
    const ph = part('Phone', 'black')
      .prism([corner(0, 0), corner(v.phoneHeight, 0), corner(v.phoneHeight, t), corner(0, t)], [2 * v.width, 0, 0])
      .build().model;
    const overlap = manifoldVolume('intersect', { model: parts[0].model, faces: [...parts[0].model.faces.keys()] }, { model: ph, faces: [...ph.faces.keys()] });
    return { overlap, v, b, middle: y + (v.phoneHeight / 2) * c - (t / 2) * s };
  }

  it('holds a phone of the thickness typed: it fits, rests on the ledge, and the base reaches past its middle', () => {
    for (const values of <Record<string, number>[]>[{}, { thickness: 8, angle: 60 }, { thickness: 14, angle: 80, gap: 0 }, { thickness: 20, angle: 45, ledge: 60, phoneHeight: 300 }]) {
      const fit = phone(values, 0.01);
      expect(fit.overlap, JSON.stringify(values)).toBeLessThan(0.01);
      // Pushed 1 mm further down it would go into the ledge: it sits on it.
      expect(phone(values, -1).overlap, JSON.stringify(values)).toBeGreaterThan(1);
      expect(fit.b.max[1], JSON.stringify(values)).toBeGreaterThan(fit.middle + 15);
    }
  });

  it('has a lip in front of the phone and a slot for the cable going through to the desk', () => {
    const parts = byId('phone-stand').build();
    const m = parts[0].model;
    const b = size(parts);
    const faces = [...m.faces.keys()];
    // Just behind the front, low down: solid at the sides, open in the middle (the cable slot).
    expect(pointInSolid(m, faces, [30, b.min[1] + 2, 5])).toBe(true);
    expect(pointInSolid(m, faces, [0, b.min[1] + 2, 5])).toBe(false);
    const noSlot = byId('phone-stand').build(undefined, { cable: 0 })[0].model;
    expect(pointInSolid(noSlot, [...noSlot.faces.keys()], [0, b.min[1] + 2, 5])).toBe(true);
    expect(volume(noSlot)).toBeGreaterThan(volume(m));
  });
});

describe('light fixture', () => {
  it('makes every shape as a hollow shade open underneath, hanging from its cord', () => {
    const light = byId('light-fixture');
    expect(light.hangs).toBe(true);
    for (let shape = 0; shape < 5; shape++) {
      const parts = light.build(undefined, { shape });
      const shade = parts.find((p) => p.name === 'Shade')!.model;
      expect(checkWatertight(shade).watertight, `shape ${shape}`).toBe(true);
      const b = modelBounds([shade])!;
      // Hollow: the middle, a little above the bottom, is not inside the material.
      expect(pointInSolid(shade, [...shade.faces.keys()], [0, 0, (b.max[2] - b.min[2]) * 0.3]), `shape ${shape}`).toBe(false);
      expect(b.max[0] - b.min[0], `shape ${shape}`).toBeCloseTo(300, 0);
      const cord = size([parts.find((p) => p.name === 'Cord')!]);
      expect(cord.max[2] - b.max[2], `shape ${shape}`).toBeCloseTo(600, 0);
    }
    // No cord: fixed to the ceiling, the shade alone.
    expect(light.build(undefined, { drop: 0 }).map((p) => p.name)).toEqual(['Shade']);
    // A tapered box is narrower at the top; the colour setting paints it.
    const tapered = light.build(undefined, { shape: 1, width: 400, topWidth: 200, height: 300, colour: 2 });
    const shade = tapered.find((p) => p.name === 'Shade')!;
    expect(shade.paint).toBe('black');
    const top = [...shade.model.faces.keys()].filter((f) => shade.model.face(f).normal[2] > 0.99);
    const topBounds = top.flatMap((f) => shade.model.faceVertexLoops(f)[0].map((v) => shade.model.pos(v)[0]));
    expect(Math.max(...topBounds) - Math.min(...topBounds)).toBeCloseTo(200, 3);
  });
});

describe('placing a customised item', () => {
  const placeable = (item: LibraryItem, values: Record<string, number>): Placeable => {
    const v = paramValues(item, undefined, values);
    return {
      name: item.name,
      source: itemSource(item, undefined, v),
      parts: item.build(undefined, v).map((p) => ({ name: p.name, model: p.model, paint: { name: PAINTS[p.paint].name, color: PAINTS[p.paint].color, opacity: 1 } })),
    };
  };

  it('places it at its size; the same settings link to the same component, other settings do not', () => {
    const { doc, controller } = harness();
    const table = byId('dining-table');
    const custom = { width: 1200, depth: 600, height: 700 };
    for (const x of [0, 2000]) {
      controller.place(placeable(table, custom));
      controller.tool.pointerDown(ev(doc, [x, 0, 0]));
    }
    controller.place(placeable(table, {}));
    controller.tool.pointerDown(ev(doc, [4000, 0, 0]));
    expect(doc.groups.components.size).toBe(2);
    const groups = [...doc.groups.items.values()].filter((g) => g.parent === null);
    const sizes = groups.map((g) => {
      const b = modelBounds([g.model])!;
      return [0, 1, 2].map((i) => Math.round(b.max[i] - b.min[i]));
    });
    expect(sizes).toEqual([
      [1200, 600, 700],
      [1200, 600, 700],
      [1200, 800, 750],
    ]);
  });
});

describe('more customisable furniture, and desk devices', () => {
  it('keeps the old sizes by default', () => {
    const dims = (id: string, v?: string) => {
      const s = size(byId(id).build(v));
      return [s.w, s.d, s.h];
    };
    // Depths include the handles.
    expect(dims('chest-of-drawers')).toEqual([800, 477, 850]);
    expect(dims('nightstand')).toEqual([450, 427, 560]);
    expect(dims('side-table')).toEqual([500, 500, 550]);
    expect(dims('wardrobe', '1500')).toEqual([1500, 627, 2000]);
    expect(dims('refrigerator')[2]).toBe(1850);
    expect(dims('floor-lamp')[2]).toBe(1600);
  });

  it('makes drawers, doors and seats to the numbers asked for', () => {
    const named = (parts: LibraryPart[], name: string) => parts.find((p) => p.name === name)!.model;
    // A dresser 1200 wide with three drawers in each of two columns: six fronts, each its own solid.
    const dresser = byId('chest-of-drawers').build(undefined, { width: 1200, height: 900, drawers: 3, columns: 2 });
    expect(size(dresser)).toMatchObject({ w: 1200, h: 900 });
    expect(named(dresser, 'Drawers').faces.size).toBe(6 * 6);
    expect(named(byId('wardrobe').build(undefined, { width: 2400, doors: 4 }), 'Doors').faces.size).toBe(4 * 6);
    expect(named(byId('nightstand').build(undefined, { drawers: 3 }), 'Drawers').faces.size).toBe(3 * 6);
    expect(named(byId('sideboard').build(undefined, { doors: 3 }), 'Doors').faces.size).toBe(3 * 6);
    expect(() => byId('chest-of-drawers').build(undefined, { height: 400, drawers: 10 })).toThrow(/Too many drawers/);
    expect(() => byId('sofa').build(undefined, { width: 1000, seats: 8 })).toThrow(/Too many seats/);
    expect(size(byId('dining-chair').build(undefined, { seat: 650, height: 1100 })).h).toBe(1100);
    expect(size(byId('rug').build(undefined, { round: 1, length: 2000 }))).toMatchObject({ w: 2000, d: 2000, h: 10 });
    expect(size(byId('tv').build(undefined, { size: 85 })).w).toBe(Math.round(85 * 25.4 * 0.8716) + 20);
  });

  it('has a keyboard (full or compact), a mouse, a tablet and a smartphone at real sizes', () => {
    expect(size(byId('keyboard').build()).w).toBe(450);
    expect(size(byId('keyboard').build(undefined, { layout: 1 })).w).toBe(370);
    const mouse = size(byId('mouse').build());
    expect([mouse.w, mouse.d, mouse.h]).toEqual([62, 114, 37]);
    expect(size(byId('tablet').build())).toMatchObject({ w: 250, d: 175 });
    const phone = size(byId('smartphone').build(undefined, { width: 75, depth: 160, thickness: 9 }));
    expect([phone.w, phone.d]).toEqual([75, 160]);
    expect(phone.h).toBe(9);
  });
});

describe('customised doors and windows', () => {
  it('cut an opening the size of the frame chosen, at the sill height chosen', () => {
    const door = byId('door');
    expect(door.opening!('900')).toEqual({ width: 900, height: 2100, sill: 0 });
    expect(door.opening!(undefined, { width: 1000, height: 2400 })).toEqual({ width: 1000, height: 2400, sill: 0 });
    expect(size(door.build(undefined, { width: 1000, height: 2400 }))).toMatchObject({ w: 1000, h: 2400 });
    const window = byId('window');
    expect(window.opening!('1200x2100')).toEqual({ width: 1200, height: 2100, sill: 0 });
    expect(window.opening!(undefined, { width: 2000, height: 1500, sill: 700 })).toEqual({ width: 2000, height: 1500, sill: 700 });
    expect(size(window.build(undefined, { width: 2000, height: 1500, sill: 700 }))).toMatchObject({ w: 2000, h: 1500 });
  });
});
