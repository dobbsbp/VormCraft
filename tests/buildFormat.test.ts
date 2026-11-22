import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, initBooleanKernel, modelBounds, type Model } from '../src/core';
import { pointInSolid } from '../src/core/check/solid';
import { aiTemplate, BUILD_EXAMPLES, BuildError, buildItem, itemSource, paintFields, paramValues, problemsForAi, readBuild, type LibraryPart } from '../src/library';
import { parseFormula } from '../src/library/buildFormat';
import type { Placeable } from '../src/tools/PlaceTool';
import { ev, harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

function size(parts: readonly { model: Model }[]) {
  const b = modelBounds(parts.map((p) => p.model))!;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { w: r(b.max[0] - b.min[0]), d: r(b.max[1] - b.min[1]), h: r(b.max[2] - b.min[2]), min: b.min, max: b.max };
}

/** A build file around some parts (and settings). */
const file = (parts: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'vormcraft-build', version: 1, name: 'Test', parts, ...extra });
const make = (f: unknown, values: Record<string, number> = {}): LibraryPart[] => {
  const item = buildItem(readBuild(f));
  return item.build(undefined, values);
};
/** The problems a file is refused with. */
function problems(f: unknown, values: Record<string, number> = {}): string[] {
  try {
    make(f, values);
  } catch (err) {
    if (err instanceof BuildError) return err.problems;
    throw err;
  }
  return [];
}

describe('build files: formulas', () => {
  const calc = (text: string, env: Record<string, number> = {}) => {
    const names = new Set(Object.keys(env));
    // Through a one-box design, so the formula is worked out the way files use them.
    const parts = make(file([{ name: 'P', shapes: [{ type: 'box', from: [0, 0, 0], to: [10, 10, text] }] }], { settings: Object.entries(env).map(([id, value]) => ({ id, kind: 'count', value, min: -1e6, max: 1e6 })) }));
    expect(names.size).toBe(Object.keys(env).length);
    return size(parts).h;
  };

  it('work out arithmetic, functions and settings in the usual order', () => {
    expect(calc('2 + 3 * 4')).toBe(14);
    expect(calc('(2 + 3) * 4')).toBe(20);
    expect(calc('2 ^ 3 ^ 2 / 64')).toBe(8);
    expect(calc('-5 + 15')).toBe(10);
    expect(calc('width / 2 - 30', { width: 200 })).toBe(70);
    expect(calc('max(10, min(50, 30))')).toBe(30);
    expect(calc('if(on, 40, 20)', { on: 1 })).toBe(40);
    expect(calc('if(on, 40, 20)', { on: 0 })).toBe(20);
    expect(calc('round(100 * sin(30))')).toBe(50);
    expect(calc('10 + 10 * (a >= 3)', { a: 3 })).toBe(20);
  });

  it('refuse anything that is not a formula, saying what is wrong', () => {
    const names = new Set(['width']);
    expect(() => parseFormula('width +', names)).toThrow(/ends too soon/);
    expect(() => parseFormula('depth / 2', names)).toThrow(/"depth", which is not one of the settings \(width\)/);
    expect(() => parseFormula('alert(1)', names)).toThrow(/not a function it knows/);
    expect(() => parseFormula('max()', names)).toThrow(/gives max 0 values/);
    expect(() => parseFormula('(width', names)).toThrow(/missing a "\)"/);
    expect(() => parseFormula('width; 3', names)).toThrow(/has ";"/);
    expect(() => parseFormula('constructor', names)).toThrow(/not one of the settings/);
    expect(() => parseFormula('constructor(1)', names)).toThrow(/not a function it knows/);
    expect(() => parseFormula('toString', names)).toThrow(/not one of the settings/);
    expect(() => parseFormula('1 toString 2', names)).toThrow(/"toString" left over/);
    expect(() => parseFormula('width constructor 2', names)).toThrow(/"constructor" left over/);
    expect(problems({ ...file([{ name: 'P', colour: 'toString', shapes: [{ type: 'box', from: [0, 0, 0], to: [1, 1, 1] }] }]), units: 'constructor' })).toEqual([
      'units: must be one of "mm", "cm", "m", "in", "ft"',
      expect.stringMatching(/^parts\[0\] \(P\)\.colour: must be a colour/),
    ]);
  });
});

describe('build files: shapes', () => {
  const one = (shape: object, extra: Record<string, unknown> = {}) => make(file([{ name: 'P', shapes: [shape] }], extra));

  it('make each kind of shape as a closed solid of the right size', () => {
    expect(size(one({ type: 'box', from: [100, 50, 0], to: [-100, -50, 30] }))).toMatchObject({ w: 200, d: 100, h: 30 });
    expect(size(one({ type: 'cylinder', base: [0, 0, 0], axis: 'x', radius: 20, length: 300 }))).toMatchObject({ w: 300, d: 40, h: 40 });
    expect(size(one({ type: 'sphere', centre: [0, 0, 50], radius: 50 }))).toMatchObject({ w: 100, h: 100 });
    expect(size(one({ type: 'taper', base: [0, 0, 0], bottom: [300, 200], top: [100, 50], height: 150 }))).toMatchObject({ w: 300, d: 200, h: 150 });
    expect(size(one({ type: 'extrude', plane: 'xz', at: 10, outline: [[0, 0], [100, 0], [0, 80]], depth: 25 }))).toMatchObject({ w: 100, d: 25, h: 80 });
    // A profile written clockwise is turned round.
    const vase = one({ type: 'lathe', centre: [0, 0, 0], profile: [[0, 0], [0, 200], [40, 200], [60, 0]] });
    expect(size(vase)).toMatchObject({ h: 200 });
    for (const shape of [
      { type: 'box', from: [0, 0, 0], to: [1, 2, 3] },
      { type: 'sphere', centre: [0, 0, 0], radius: 5 },
      { type: 'lathe', center: [0, 0, 0], profile: [[0, 0], [10, 0], [10, 10], [0, 10]] },
    ])
      expect(checkWatertight(one(shape)[0].model).watertight).toBe(true);
  });

  it('take lengths in the file\'s units', () => {
    expect(size(one({ type: 'box', from: [0, 0, 0], to: [120, 60, 70] }, { units: 'cm' }))).toMatchObject({ w: 1200, d: 600, h: 700 });
    expect(size(one({ type: 'box', from: [0, 0, 0], to: [1, 1, 1] }, { units: 'in' })).w).toBeCloseTo(25.4, 6);
  });

  it('turn, move, repeat in a row or round a centre, and switch shapes on and off', () => {
    const turned = one({ type: 'box', from: [0, 0, 0], to: [100, 10, 10], rotate: { axis: 'z', degrees: 90 }, move: [0, 0, 50] });
    expect(size(turned)).toMatchObject({ w: 10, d: 100 });
    expect(turned[0] && size(turned).min[2]).toBeCloseTo(50, 6);
    const row = one({ type: 'box', from: [0, 0, 0], to: [10, 10, 10], repeat: { count: 4, step: [30, 0, 0] } });
    expect(size(row).w).toBe(100);
    expect(row[0].model.faces.size).toBe(24);
    const ring = one({ type: 'box', from: [90, -5, 0], to: [110, 5, 10], repeat: { count: 4, rotate: { axis: 'z', degrees: 90 } } });
    expect(size(ring)).toMatchObject({ w: 220, d: 220 });
    const settings = [{ id: 'lid', kind: 'toggle', value: 1 }];
    const lidded = file([{ name: 'Box', shapes: [{ type: 'box', from: [0, 0, 0], to: [50, 50, 50] }, { type: 'box', from: [0, 0, 49], to: [50, 50, 60], when: 'lid' }] }], { settings });
    expect(size(make(lidded)).h).toBe(60);
    expect(size(make(lidded, { lid: 0 })).h).toBe(50);
  });

  it('join shapes in a part, take its cuts away, and keep colours', () => {
    const parts = make(
      file([
        { name: 'Frame', colour: '#336699', shapes: [{ type: 'box', from: [-50, -50, 0], to: [50, 50, 20] }, { type: 'box', from: [-10, -10, 19], to: [10, 10, 80] }], cuts: [{ type: 'cylinder', base: [0, 0, -1], radius: 5, length: 100 }] },
        { name: 'Glass', colour: '#a0d0f0', opacity: 0.4, shapes: [{ type: 'box', from: [-40, -40, 20], to: [40, 40, 22] }] },
        { name: 'Top', colour: 'walnut', shapes: [{ type: 'box', from: [-20, -20, 80], to: [20, 20, 90] }] },
      ]),
    );
    const frame = parts[0].model;
    expect(checkWatertight(frame).watertight).toBe(true);
    expect(pointInSolid(frame, [...frame.faces.keys()], [0, 0, 50])).toBe(false);
    expect(pointInSolid(frame, [...frame.faces.keys()], [8, 0, 50])).toBe(true);
    expect(paintFields(parts[0])).toEqual({ name: 'Colour #336699', color: '#336699', opacity: 1 });
    expect(paintFields(parts[1]).opacity).toBe(0.4);
    expect(paintFields(parts[2])).toMatchObject({ name: 'Walnut' });
  });
});

describe('build files: problems are found and explained, saying where', () => {
  it('in the file itself, all at once', () => {
    const found = problems({
      format: 'something',
      version: 1,
      colour: 'red',
      settings: [{ id: '2wide', value: 1 }, { id: 'width', kind: 'length', value: 50, min: 100, max: 200 }],
      parts: [
        { name: 'Top', colour: 'purple-ish', shapes: [{ type: 'box', from: [0, 0], to: [1, 1, 'height'] }, { type: 'cube', size: 3 }], extra: 1 },
        { name: 'Empty', shapes: [] },
      ],
    });
    expect(found).toEqual([
      'format: must be "vormcraft-build"',
      'colour: is not part of the format (leave it out)',
      'settings[0] (2wide).id: must be a name of letters, digits and _, starting with a letter, like "legHeight"',
      'settings[1] (width): "value" must be between "min" and "max"',
      'parts[0] (Top): has "extra", which a part does not use',
      expect.stringMatching(/^parts\[0\] \(Top\)\.colour: must be a colour like "#8b5a2b", or one of "oak"/),
      'parts[0] (Top).shapes[0] (box).from: needs 3 numbers, like [0, 0, 0]',
      'parts[0] (Top).shapes[0] (box).to[2]: the formula "height" uses "height", which is not one of the settings (width)',
      'parts[0] (Top).shapes[1] (cube): "type" must be one of "box", "cylinder", "extrude", "taper", "lathe", "sphere"',
      'parts[1] (Empty).shapes: is missing: a part needs at least one shape',
    ]);
  });

  it('when it is not JSON, or is for a newer version', () => {
    expect(problems('Sure! Here it is: { "format": "vormcraft-build", version: 1 }')[0]).toMatch(/not valid JSON/);
    expect(problems('I cannot do that.')[0]).toMatch(/no design in this text/);
    expect(problems({ ...file([]), version: 7 })[0]).toMatch(/newer VormCraft/);
  });

  it('when shapes do not make a solid: cut away entirely, crossing outlines, sizes of 0', () => {
    // Shapes touching only along an edge stay two solids in the part, which is fine.
    const edge = make(file([{ name: 'Blocks', shapes: [{ type: 'box', from: [0, 0, 0], to: [10, 10, 10] }, { type: 'box', from: [10, 10, 0], to: [20, 20, 10] }] }]));
    expect(checkWatertight(edge[0].model).watertight).toBe(true);
    const gone = problems(file([{ name: 'Gone', shapes: [{ type: 'box', from: [0, 0, 0], to: [10, 10, 10] }], cuts: [{ type: 'box', from: [-1, -1, -1], to: [11, 11, 11] }] }]));
    expect(gone).toEqual(['parts[0] (Gone): nothing is left once the cuts are taken away']);
    const bow = problems(file([{ name: 'Bow', shapes: [{ type: 'extrude', plane: 'xy', outline: [[0, 0], [10, 10], [10, 0], [0, 10]], depth: 5 }] }]));
    expect(bow).toEqual(['parts[0] (Bow).shapes[0] (extrude).outline: the outline crosses itself (between points 0–1 and 2–3)']);
    const settings = [{ id: 'w', kind: 'length', value: 100, min: 0, max: 200 }];
    const flat = file([{ name: 'Slab', shapes: [{ type: 'box', from: [0, 0, 0], to: ['w', 10, 10] }] }], { settings });
    expect(problems(flat, { w: 0 })).toEqual(['parts[0] (Slab).shapes[0] (box): its x size ("to" − "from") must be more than 0 (it works out to 0 mm)']);
    expect(problems(file([{ name: 'Big', shapes: [{ type: 'box', from: [0, 0, 0], to: [10, 10, 10], repeat: { count: 500, step: [20, 0, 0] } }] }]))[0]).toMatch(/repeat.count: must be from 1 to 100/);
  });

  it('are worded for pasting back to the AI', () => {
    expect(problemsForAi(['parts[0] (Top): x', 'y'])).toBe('VormCraft could not build the design. Please fix these problems and reply with the whole corrected file:\n- parts[0] (Top): x\n- y');
  });
});

describe('the AI template', () => {
  it('has examples that all build into closed solids, at their default settings and at their limits', () => {
    for (const { title, file: f } of BUILD_EXAMPLES) {
      const design = readBuild(f);
      const item = buildItem(design);
      const runs: Record<string, number>[] = [{}];
      for (const p of design.params) if (p.min !== undefined && p.max !== undefined) runs.push({ [p.id]: p.min }, { [p.id]: p.max });
      for (const values of runs) {
        const parts = item.build(undefined, values);
        for (const p of parts) expect(checkWatertight(p.model).watertight, `${title} ${JSON.stringify(values)} ${p.name}`).toBe(true);
        expect(size(parts).min[2], title).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });

  it('the phone stand example fits the phone thickness asked for', () => {
    const stand = buildItem(readBuild(BUILD_EXAMPLES[1].file));
    const m = stand.build(undefined, { thickness: 12 })[0].model;
    const faces = [...m.faces.keys()];
    // The slot runs from the lip (y = -34) to the support: 12 mm phone + 2 mm room; empty above the ledge.
    expect(pointInSolid(m, faces, [20, -34 + 13.5, 8.5])).toBe(false);
    expect(pointInSolid(m, faces, [20, -34 + 14.5, 8.5])).toBe(true);
  });

  it('is the full instructions, with the examples and the request at the end', () => {
    const text = aiTemplate('A bird box, 15 cm wide');
    expect(text).toContain('"format": "vormcraft-build"');
    expect(text.trim().endsWith('A bird box, 15 cm wide')).toBe(true);
    for (const e of BUILD_EXAMPLES) expect(text).toContain(e.title);
    // Every example in the text reads back as a design.
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBe(BUILD_EXAMPLES.length);
    for (const b of blocks) expect(() => readBuild(b)).not.toThrow();
    expect(aiTemplate()).toContain('[Describe what you want here');
  });
});

describe('placing a build file', () => {
  it('places it like a Library item: customised settings, linked copies, its own colours', () => {
    const { doc, controller } = harness();
    const design = readBuild(BUILD_EXAMPLES[0].file);
    const item = buildItem(design);
    const placeable = (values: Record<string, number>): Placeable => {
      const v = paramValues(item, undefined, values);
      return { name: item.name, source: itemSource(item, undefined, v), parts: item.build(undefined, v).map((p) => ({ name: p.name, model: p.model, paint: paintFields(p) })) };
    };
    for (const x of [0, 2000]) {
      controller.place(placeable({ width: 900, shelf: 0 }));
      controller.tool.pointerDown(ev(doc, [x, 0, 0]));
    }
    expect(doc.groups.components.size).toBe(1);
    const [id] = [...controller.selection.groups];
    const children = doc.groups.children(id);
    expect(children.map((c) => c.name)).toEqual(['Top', 'Legs']);
    expect(size(children).w).toBe(900);
    expect(children.map((c) => doc.materials.get(c.material!)?.name)).toEqual(['Oak', 'Black']);
    expect(controller.history.undoLabel).toBe('Place Simple table');
  });

  it('the same file gives the same id; a changed file another', () => {
    const a = readBuild(BUILD_EXAMPLES[0].file);
    expect(readBuild(JSON.stringify(BUILD_EXAMPLES[0].file)).id).toBe(a.id);
    expect(readBuild({ ...BUILD_EXAMPLES[0].file, name: 'Other table' }).id).not.toBe(a.id);
  });
});
