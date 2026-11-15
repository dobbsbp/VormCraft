import { beforeAll, describe, expect, it } from 'vitest';
import { drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, pushPull, rotation, scaling, solidReport, translation, volume, type Vec3 } from '../src/core';
import { modelBounds } from '../src/core/ops/group';
import { applyToTargets } from '../src/tools/targets';
import { insertPlaceable, placement, type Placeable } from '../src/tools/PlaceTool';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A 100 mm box on the ground at (x, y). */
function box(m: Model, x = 0, y = 0): void {
  const f = drawRectangle(m, GROUND_PLANE, [x, y, 0], 100, 100).inner!;
  pushPull(m, f, m.face(f).normal[2] > 0 ? 100 : -100);
}

/** A harness with a box made into a component (and selected). */
function component() {
  const h = harness();
  box(h.model);
  h.controller.selection.set([...h.model.faces.keys()], [...h.model.edges()]);
  h.controller.makeComponent();
  const id = [...h.doc.groups.items.keys()][0];
  return { ...h, id };
}

const groupOf = (h: ReturnType<typeof harness>, id: number) => h.doc.groups.get(id)!;
const boundsOf = (h: ReturnType<typeof harness>, id: number) => modelBounds(h.doc.groups.subtree(id).map((g) => g.model))!;

/** Copies of the component, moved by each offset (as Move with copy does). */
function copies(h: ReturnType<typeof component>, ...offsets: Vec3[]): number[] {
  const before = new Set(h.doc.groups.items.keys());
  h.controller.editDocument('Move', () => applyToTargets(h.doc, { vertices: new Set(), labels: [], guides: [], groups: [h.id], sections: [] }, offsets.map(translation), true));
  return [...h.doc.groups.items.keys()].filter((k) => !before.has(k));
}

/** Push the top face of the open component up by `d`. */
function raiseTop(h: ReturnType<typeof harness>, at: Vec3, d: number): void {
  const top = findFaceAt(h.doc.model, at)!;
  expect(top).toBeDefined();
  h.ctx.apply(() => pushPull(h.doc.model, top, d), undefined, 'Push/Pull');
}

describe('components (linked copies)', () => {
  it('Make Component turns the selection into a component with one instance, as one undo step', () => {
    const h = component();
    const g = groupOf(h, h.id);
    expect(g.component).toBeDefined();
    expect(g.name).toBe('Component 1');
    expect(h.doc.groups.components.size).toBe(1);
    expect(h.doc.root.faces.size).toBe(0);
    expect([...h.controller.selection.groups]).toEqual([h.id]);
    expect(h.controller.history.undoLabel).toBe('Make component');
    h.controller.makeComponent();
    expect(h.controller.notice).toMatch(/already a component/);
    h.controller.undo();
    expect(h.doc.groups.items.size).toBe(0);
    expect(h.doc.groups.components.size).toBe(0);
  });

  it('a selected group becomes a component, keeping its name', () => {
    const h = harness();
    box(h.model);
    h.controller.selection.set([...h.model.faces.keys()], [...h.model.edges()]);
    h.controller.makeGroup();
    const id = [...h.doc.groups.items.keys()][0];
    h.controller.renameGroup(id, 'Chair');
    h.controller.selection.set([], [], [], [id]);
    h.controller.makeComponent();
    expect(groupOf(h, id).component).toBeDefined();
    expect(groupOf(h, id).name).toBe('Chair');
    expect(h.doc.groups.components.get(groupOf(h, id).component!.id)!.name).toBe('Chair');
  });

  it('copies stay linked: editing inside one changes every copy, each where it is', () => {
    const h = component();
    const [a, b] = copies(h, [300, 0, 0], [600, 0, 0]);
    expect(h.doc.groups.instances(groupOf(h, h.id).component!.id)).toHaveLength(3);
    h.controller.enterGroup(a);
    raiseTop(h, [350, 50, 100], 50);
    h.controller.exitGroup();
    for (const [id, x] of [[h.id, 0], [a, 300], [b, 600]] as const) {
      expect(Math.abs(volume(groupOf(h, id).model))).toBeCloseTo(1.5e6, 3);
      expect(boundsOf(h, id).min).toEqual([x, 0, 0].map((v) => expect.closeTo(v, 9)));
      expect(boundsOf(h, id).max[2]).toBeCloseTo(150, 9);
    }
    // One undo takes the change back from every copy.
    h.controller.undo();
    for (const id of [h.id, a, b]) expect(Math.abs(volume(groupOf(h, id).model))).toBeCloseTo(1e6, 3);
  });

  it('turned, scaled and mirrored copies follow an edit the way they were placed', () => {
    const h = component();
    const [turned] = copies(h, [500, 0, 0]);
    h.controller.editDocument('Rotate', () => h.doc.groups.transform(turned, rotation([500, 0, 0], [0, 1, 0], Math.PI / 2)));
    const [big] = copies(h, [0, 500, 0]);
    h.controller.editDocument('Scale', () => h.doc.groups.transform(big, scaling([0, 500, 0], [2, 2, 2])));
    const [mirrored] = copies(h, [0, -500, 0]);
    h.controller.selection.set([], [], [], [mirrored]);
    h.controller.flipSelection(0);
    // Make the original taller: 100 → 150 along its own up.
    h.controller.enterGroup(h.id);
    raiseTop(h, [50, 50, 100], 50);
    h.controller.exitGroup();
    expect(Math.abs(volume(groupOf(h, big).model))).toBeCloseTo(8 * 1.5e6, 2);
    // The turned copy (a quarter turn about green) grows along red instead of up.
    const t = boundsOf(h, turned);
    expect(t.max[0] - t.min[0]).toBeCloseTo(150, 6);
    expect(t.max[2] - t.min[2]).toBeCloseTo(100, 6);
    // Every copy is still a closed solid facing outward.
    for (const id of [h.id, turned, big, mirrored]) expect(solidReport(groupOf(h, id).model)).toMatchObject({ solids: 1, insideOut: 0, open: 0 });
  });

  it('a component with groups inside it: an edit inside an inner group reaches every copy', () => {
    const h = harness();
    box(h.model);
    box(h.model, 200, 0);
    const right = [...h.model.faces.keys()].filter((f) => h.model.faceVertexLoops(f)[0].every((v) => h.model.pos(v)[0] >= 200 - 1e-9));
    h.controller.selection.set(right, []);
    h.controller.makeGroup();
    const inner = [...h.doc.groups.items.keys()][0];
    h.controller.selection.set([...h.model.faces.keys()], [], [], [inner]);
    h.controller.makeComponent();
    const outer = [...h.doc.groups.items.keys()].find((k) => k !== inner)!;
    const before = new Set(h.doc.groups.items.keys());
    h.controller.editDocument('Move', () => applyToTargets(h.doc, { vertices: new Set(), labels: [], guides: [], groups: [outer], sections: [] }, [translation([0, 1000, 0])], true));
    const copy = [...h.doc.groups.items.keys()].find((k) => !before.has(k) && h.doc.groups.get(k)!.parent === null)!;
    h.controller.enterGroup(outer);
    h.controller.enterGroup(inner);
    raiseTop(h, [250, 50, 100], 100);
    h.controller.exitGroup();
    h.controller.exitGroup();
    const copyInner = h.doc.groups.children(copy)[0];
    expect(Math.abs(volume(copyInner.model))).toBeCloseTo(2e6, 3);
    expect(modelBounds([copyInner.model])!.min[1]).toBeCloseTo(1000, 9);
  });

  it('Make Unique unlinks a copy; the others stay linked', () => {
    const h = component();
    const [a, b] = copies(h, [300, 0, 0], [600, 0, 0]);
    h.controller.selection.set([], [], [], [b]);
    expect(h.controller.canMakeUnique()).toBe(true);
    h.controller.makeUnique();
    expect(groupOf(h, b).name).toBe('Component 2');
    expect(h.doc.groups.components.size).toBe(2);
    h.controller.enterGroup(a);
    raiseTop(h, [350, 50, 100], 50);
    h.controller.exitGroup();
    expect(Math.abs(volume(groupOf(h, h.id).model))).toBeCloseTo(1.5e6, 3);
    expect(Math.abs(volume(groupOf(h, b).model))).toBeCloseTo(1e6, 3);
  });

  it('renaming one copy renames the component; erasing every copy forgets it', () => {
    const h = component();
    const [a] = copies(h, [300, 0, 0]);
    h.controller.renameGroup(a, 'Stool');
    expect(groupOf(h, h.id).name).toBe('Stool');
    h.controller.selection.set([], [], [], [h.id, a]);
    h.controller.deleteSelection();
    expect(h.doc.groups.components.size).toBe(0);
  });

  it('a component cannot be made inside a component', () => {
    const h = component();
    h.controller.enterGroup(h.id);
    h.controller.selection.set([...h.doc.model.faces.keys()], []);
    h.controller.makeComponent();
    expect(h.controller.error).toMatch(/cannot be made inside another component/);
  });

  it('Move with copy (the tool) keeps the copy linked', () => {
    const h = component();
    h.controller.selection.clear();
    const tool = use(h.controller, 'move');
    tool.toggleCopy!();
    tool.pointerDown(ev(h.doc, [0, 0, 0], { face: null, group: h.id }));
    tool.pointerDown(ev(h.doc, [300, 0, 0], { face: null }));
    const all = [...h.doc.groups.items.values()];
    expect(all).toHaveLength(2);
    expect(all[0].component!.id).toBe(all[1].component!.id);
  });

  it('saved once: copies keep only their placement in the file, and come back linked', () => {
    const h = component();
    copies(h, ...Array.from({ length: 9 }, (_, i) => [300 * (i + 1), 0, 0] as Vec3));
    const text = serializeDocument(h.doc);
    const file = JSON.parse(text);
    expect(file.version).toBe(8);
    expect(file.components).toHaveLength(1);
    expect(file.groups.filter((g: { faces: unknown[] }) => g.faces.length)).toHaveLength(0);
    const again = parseDocument(text);
    expect(again.groups.items.size).toBe(10);
    for (const g of again.groups.items.values()) {
      expect(Math.abs(volume(g.model))).toBeCloseTo(1e6, 3);
      expect(g.model.faces.size).toBe(6);
    }
    expect(modelBounds([[...again.groups.items.values()][9].model])!.min[0]).toBeCloseTo(2700, 9);
    const second = serializeDocument(again);
    expect(serializeDocument(parseDocument(second))).toBe(second);
  });

  it('a component with groups inside is saved and read back with its parts', () => {
    const h = harness();
    box(h.model);
    h.controller.selection.set([...h.model.faces.keys()], [...h.model.edges()]);
    h.controller.makeGroup();
    const inner = [...h.doc.groups.items.keys()][0];
    h.controller.selection.set([], [], [], [inner]);
    h.controller.makeGroup();
    const outer = [...h.doc.groups.items.keys()].find((k) => k !== inner)!;
    h.controller.selection.set([], [], [], [outer]);
    h.controller.makeComponent();
    const again = parseDocument(serializeDocument(h.doc));
    const top = again.groups.children(null);
    expect(top).toHaveLength(1);
    expect(top[0].component).toBeDefined();
    expect(again.groups.children(top[0].id)).toHaveLength(1);
    expect(again.groups.children(top[0].id)[0].model.faces.size).toBe(6);
  });

  it('Library items are placed as components: the same item again is another copy of it', () => {
    const h = harness();
    const seat = new Model();
    box(seat, -50, -50);
    const legs = new Model();
    box(legs, 100, 100);
    const item: Placeable = { name: 'Stool', source: 'library:stool', parts: [{ name: 'Seat', model: seat, paint: { name: 'Oak', color: '#aa7744', opacity: 1 } }, { name: 'Legs', model: legs }] };
    const place = (at: Vec3, angle: number) => h.ctx.apply(() => void insertPlaceable(h.doc, item, placement(item, at, angle)), undefined, 'Place');
    place([1000, 0, 0], 0);
    place([3000, 0, 0], Math.PI / 2);
    const tops = h.doc.groups.children(null);
    expect(tops).toHaveLength(2);
    expect(h.doc.groups.components.size).toBe(1);
    expect(tops[0].component!.id).toBe(tops[1].component!.id);
    expect(tops.map((g) => g.name)).toEqual(['Stool', 'Stool']);
    // Placed the same way as before components: the base's middle on the point clicked.
    const first = boundsOf(h, tops[0].id);
    expect((first.min[0] + first.max[0]) / 2).toBeCloseTo(1000, 9);
    const second = boundsOf(h, tops[1].id);
    expect((second.min[0] + second.max[0]) / 2).toBeCloseTo(3000, 9);
    expect(second.min[2]).toBeCloseTo(0, 9);
    for (const g of tops) expect(h.doc.groups.children(g.id).map((x) => x.name)).toEqual(['Seat', 'Legs']);
    expect(h.doc.materials.items.size).toBe(1);
    // A single-part item keeps its paint on the outer group: the second copy has it too.
    const plain: Placeable = { name: 'Block', source: 'library:block', parts: [{ name: 'Block', model: seat, paint: { name: 'Oak', color: '#aa7744', opacity: 1 } }] };
    for (const x of [0, 500]) h.ctx.apply(() => void insertPlaceable(h.doc, plain, placement(plain, [x, 2000, 0], 0)), undefined, 'Place');
    const blocks = h.doc.groups.children(null).filter((g) => g.name === 'Block');
    expect(blocks.map((g) => g.material)).toEqual([blocks[0].material, blocks[0].material]);
    expect(blocks[0].material).toBeDefined();
  });
});
