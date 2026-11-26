import { readFileSync } from 'node:fs';
import { create, parseSkp, type SkpModel } from 'openskp';
import { beforeAll, describe, expect, it } from 'vitest';
import { drawRectangle, GROUND_PLANE, initBooleanKernel, Model, pushPull } from '../src/core';
import { translation } from '../src/core/ops/transform';
import { Document } from '../src/doc/Document';
import { Groups } from '../src/doc/Groups';
import { ALL_PARTS, applyScene, captureScene, DEFAULT_STYLE, type CameraView, type DisplayStyle, type SceneView } from '../src/doc/Scenes';
import { Tags } from '../src/doc/Tags';
import { decodeDxf, parseDxf } from '../src/io/dxfFile';
import { convertDxf, defaultLayers } from '../src/io/dxfImport';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { convertSkp, summarizeSkp, type SkpPart } from '../src/io/skpImport';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A closed box (w × d × h mm) standing on z = 0 at x. */
function box(x = 0, w = 100): Model {
  const m = new Model();
  const f = drawRectangle(m, GROUND_PLANE, [x, 0, 0], w, 100).inner!;
  pushPull(m, f, m.face(f).normal[2] > 0 ? 100 : -100);
  return m;
}

const camera: CameraView = { position: [1000, -1000, 1000], target: [0, 0, 0], fov: 35, projection: 'perspective', height: 1000 };
const view = (): SceneView => {
  let style: DisplayStyle = { ...DEFAULT_STYLE };
  return { cameraView: () => camera, setCameraView: () => {}, displayStyle: () => style, setDisplayStyle: (s) => (style = { ...style, ...s }) };
};

describe('tags', () => {
  it('are listed in order, renamed, and named "Tag n" when no name is given', () => {
    const t = new Tags();
    const walls = t.add('Walls');
    expect(t.add(t.nextName())).toBe(walls + 1);
    expect(t.items.map((x) => x.name)).toEqual(['Walls', 'Tag 1']);
    expect(t.byName(' walls ')?.id).toBe(walls);
    expect(() => t.rename(walls, 'tag 1')).toThrow(/already a tag called Tag 1/);
    t.rename(walls, 'Outer walls');
    expect(t.get(walls)?.name).toBe('Outer walls');
    expect(() => t.add('  ')).toThrow(/needs a name/);
  });

  it('hiding a tag hides the groups carrying it and everything inside them', () => {
    const g = new Groups();
    const walls = g.tags.add('Walls');
    const outer = g.add(box(), null, { tag: walls });
    const inner = g.add(box(200), outer);
    const other = g.add(box(400), null);
    expect([outer, inner, other].map((id) => g.isHidden(id))).toEqual([false, false, false]);
    g.tags.setHidden(walls, true);
    expect([outer, inner, other].map((id) => g.isHidden(id))).toEqual([true, true, false]);
    // The group itself is not marked hidden: showing the tag brings it back as it was.
    expect(g.get(outer)!.hidden).toBeUndefined();
    g.tags.setHidden(walls, false);
    expect(g.isHidden(inner)).toBe(false);
  });

  it('copies keep their tag; deleting a tag leaves its groups untagged and shown', () => {
    const g = new Groups();
    const t = g.tags.add('Furniture', { hidden: true });
    const a = g.add(box(), null, { tag: t });
    const copy = g.duplicate(a, null);
    expect(g.get(copy)!.tag).toBe(t);
    expect(g.isHidden(copy)).toBe(true);
    g.deleteTag(t);
    expect(g.tags.items).toEqual([]);
    expect(g.get(a)!.tag).toBeUndefined();
    expect(g.isHidden(copy)).toBe(false);
  });

  it('a tag on a group inside a component is the same in every copy; each copy has its own tag', () => {
    const g = new Groups();
    const legs = g.tags.add('Legs');
    const tables = g.tags.add('Tables');
    const table = g.add(box(), null, { tag: tables });
    g.add(box(200, 10), table, { tag: legs });
    const cid = g.makeComponent(table);
    const second = g.addInstance(cid, null, translation([1000, 0, 0]));
    expect(g.get(second)!.tag).toBe(tables);
    expect(g.children(second).map((c) => c.tag)).toEqual([legs]);
    g.get(second)!.tag = undefined;
    g.rebuild(table);
    expect(g.get(table)!.tag).toBe(tables);
    g.deleteTag(legs);
    expect(g.components.get(cid)!.parts.map((p) => p.tag)).toEqual([tables, undefined]);
  });

  it('undo snapshots and copies of the groups keep their own tags', () => {
    const g = new Groups();
    const t = g.tags.add('Walls');
    const c = g.clone(true);
    g.tags.setHidden(t, true);
    g.tags.add('Doors');
    expect(c.tags.items).toEqual([{ id: t, name: 'Walls' }]);
    const back = new Groups();
    back.copyFrom(g);
    expect(back.tags.items.map((x) => [x.name, !!x.hidden])).toEqual([
      ['Walls', true],
      ['Doors', false],
    ]);
  });

  it('scenes remember which tags are hidden; scenes from before tags leave them alone', () => {
    const doc = new Document();
    const t = doc.groups.tags.add('Furniture');
    const shot = captureScene(view(), doc.groups, doc.guides);
    expect(shot.hiddenTags).toEqual([]);
    const showAll = { id: 1, name: 'All', parts: { ...ALL_PARTS }, ...shot };
    doc.groups.tags.setHidden(t, true);
    const bare = { id: 2, name: 'Bare', parts: { ...ALL_PARTS }, ...captureScene(view(), doc.groups, doc.guides) };
    expect(bare.hiddenTags).toEqual([t]);
    applyScene(showAll, view(), doc.groups, doc.guides, 0);
    expect(doc.groups.tags.isHidden(t)).toBe(false);
    applyScene(bare, view(), doc.groups, doc.guides, 0);
    expect(doc.groups.tags.isHidden(t)).toBe(true);
    const { hiddenTags: _, ...old } = showAll;
    applyScene(old, view(), doc.groups, doc.guides, 0);
    expect(doc.groups.tags.isHidden(t)).toBe(true);
  });
});

describe('tags in .vorm files', () => {
  it('tags, the groups and component parts carrying them, and scenes hiding them are saved', () => {
    const doc = new Document();
    const walls = doc.groups.tags.add('Walls');
    const legs = doc.groups.tags.add('Legs', { hidden: true });
    const wall = doc.groups.add(box(), null, { name: 'Wall', tag: walls });
    const table = doc.groups.add(box(300), null, { name: 'Table' });
    doc.groups.add(box(500, 10), table, { name: 'Leg', tag: legs });
    doc.groups.makeComponent(table);
    doc.scenes.add({ name: 'Plan', parts: { ...ALL_PARTS }, ...captureScene(view(), doc.groups, doc.guides) });
    const again = parseDocument(serializeDocument(doc));
    expect(again.groups.tags.items).toEqual([
      { id: walls, name: 'Walls' },
      { id: legs, name: 'Legs', hidden: true },
    ]);
    expect(again.groups.get(wall)!.tag).toBe(walls);
    const leg = [...again.groups.items.values()].find((g) => g.name === 'Leg')!;
    expect(leg.tag).toBe(legs);
    expect(again.groups.isHidden(leg.id)).toBe(true);
    expect(again.scenes.items[0].hiddenTags).toEqual([legs]);
  });

  it('a file without tags saves none; tags that cannot be read are left out, not a damaged file', () => {
    const doc = new Document();
    doc.groups.add(box(), null);
    const file = JSON.parse(serializeDocument(doc));
    expect(file.tags).toBeUndefined();
    file.tags = [{ name: 'No id' }, { id: 3, name: 'Kept' }, null];
    file.groups[0].tag = 99;
    const again = parseDocument(JSON.stringify(file));
    expect(again.groups.tags.items.map((t) => t.name)).toEqual(['Kept']);
    expect([...again.groups.items.values()][0].tag).toBeUndefined();
  });

  it('every older fixture still opens, with no tags', () => {
    for (const v of [2, 4, 6, 8]) {
      const doc = parseDocument(readFileSync(`tests/fixtures/format-v${v}.vorm`, 'utf8'));
      expect(doc.groups.tags.items).toEqual([]);
    }
  });
});

describe('tags in the app', () => {
  it('hiding a tag is an undo step, counts as hidden, and Unhide All shows it again', () => {
    const h = harness();
    const id = h.doc.groups.add(box(), null);
    h.controller.selection.set([], [], [], [id]);
    const t = h.controller.addTag('Walls')!;
    h.controller.tagSelection(t);
    expect(h.doc.groups.get(id)!.tag).toBe(t);
    expect(h.controller.tagUse().get(t)).toBe(1);
    h.controller.setTagHidden(t, true);
    expect(h.doc.groups.isHidden(id)).toBe(true);
    expect(h.controller.selection.groups.size).toBe(0);
    expect(h.controller.hiddenCount()).toEqual({ groups: 0, lines: 0, tags: 1 });
    h.controller.selectAll();
    expect(h.controller.selection.groups.size).toBe(0);
    h.controller.undo();
    expect(h.doc.groups.isHidden(id)).toBe(false);
    h.controller.redo();
    h.controller.unhideAll();
    expect(h.doc.groups.tags.isHidden(t)).toBe(false);
    expect(h.controller.addTag('walls')).toBe(t);
  });

  it('tagging needs groups selected; deleting a tag keeps its groups', () => {
    const h = harness();
    const t = h.controller.addTag()!;
    expect(h.doc.groups.tags.get(t)!.name).toBe('Tag 1');
    h.controller.tagSelection(t);
    expect(h.controller.error).toMatch(/Select the groups/);
    const id = h.doc.groups.add(box(), null, { tag: t });
    h.controller.deleteTag(t);
    expect(h.doc.groups.get(id)!.tag).toBeUndefined();
    expect(h.doc.groups.tags.items).toEqual([]);
  });
});

type P3 = [number, number, number];
const square = (x: number): P3[] => [
  [x, 0, 0],
  [x + 10, 0, 0],
  [x + 10, 10, 0],
  [x, 10, 0],
];
function skpFile(build: (b: ReturnType<typeof create>) => void): SkpModel {
  const b = create();
  build(b);
  const bytes = b.toBytes();
  return parseSkp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}
const allParts = (p: SkpPart): SkpPart[] => [p, ...p.children.flatMap(allParts)];

describe('tags from SketchUp files', () => {
  const sample = () =>
    skpFile((b) => {
      const walls = b.addLayer('Walls');
      const furniture = b.addLayer('Furniture', { hidden: true });
      b.addGroup((g) => g.addFace(square(0)), { name: 'Wall', layer: walls });
      b.addGroup((g) => g.addFace(square(20)), { name: 'Sofa', layer: furniture });
      b.addGroup((g) => g.addFace(square(40)), { name: 'Chair', layer: furniture });
      b.addGroup((g) => g.addFace(square(60)), { name: 'Loose' });
      b.addFace(square(80));
    });

  it('every placement comes in whatever its tag, carrying its tag; hidden tags as the file has them', () => {
    const skp = sample();
    const stats = summarizeSkp(skp);
    expect(stats.tags).toEqual([
      { name: 'Walls', hidden: false, placements: 1 },
      { name: 'Furniture', hidden: true, placements: 2 },
    ]);
    expect(stats.missing).toBe(0);
    const r = convertSkp(skp, { name: 'Room' });
    const parts = allParts(r.root);
    expect(parts.map((p) => [p.name, p.tag ?? null, p.model.faces.size])).toEqual([
      ['Room', null, 1],
      ['Wall', 'Walls', 1],
      ['Sofa', 'Furniture', 1],
      ['Chair', 'Furniture', 1],
      ['Loose', null, 1],
    ]);
    expect(r.tags).toEqual([
      { name: 'Walls', hidden: false },
      { name: 'Furniture', hidden: true },
    ]);
    // Chosen in the import window: show what the file hides, hide what it shows.
    expect(convertSkp(skp, { name: 'Room', hiddenTags: ['Walls'] }).tags).toEqual([
      { name: 'Walls', hidden: true },
      { name: 'Furniture', hidden: false },
    ]);
  });

  it('the import makes the tags (using one already in the design of that name) and tags the groups', () => {
    const h = harness();
    const existing = h.controller.addTag('walls')!;
    const top = h.controller.importSkp(convertSkp(sample(), { name: 'Room' }), 'Import Room.skp')!;
    const tags = h.doc.groups.tags;
    expect(tags.items.map((t) => [t.name, !!t.hidden])).toEqual([
      ['walls', false],
      ['Furniture', true],
    ]);
    const byName = new Map(h.doc.groups.subtree(top).map((g) => [g.name, g]));
    expect(byName.get('Wall')!.tag).toBe(existing);
    expect(h.doc.groups.isHidden(byName.get('Sofa')!.id)).toBe(true);
    expect(h.doc.groups.isHidden(byName.get('Loose')!.id)).toBe(false);
    expect(h.controller.hiddenCount().tags).toBe(1);
    h.controller.setTagHidden(tags.byName('Furniture')!.id, false);
    expect(h.doc.groups.isHidden(byName.get('Sofa')!.id)).toBe(false);
  });

  it('a placement whose group is missing from the file is counted, not dropped without a word', () => {
    const skp = sample();
    skp.root.instances.push({ ...skp.root.instances[0], refIdx: 9999 });
    expect(summarizeSkp(skp).missing).toBe(1);
    const r = convertSkp(skp, { name: 'Room' });
    expect(r.missing).toBe(1);
    expect(r.root.children).toHaveLength(4);
  });

  it('scenes that hide tags bring that in; scenes that hide none leave tags alone', () => {
    const skp = sample();
    skp.pages.push({ name: 'Plan', eye: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0], fov: 35, parallel: false, orthoHeight: 0, hiddenLayers: ['Furniture'] });
    skp.pages.push({ name: 'All', eye: [0, -100, 100], target: [0, 0, 0], up: [0, 0, 1], fov: 35, parallel: false, orthoHeight: 0, hiddenLayers: [] });
    const r = convertSkp(skp, { name: 'Room', scenes: true });
    expect(r.scenes.map((s) => [s.name, s.parts.hidden, s.hiddenTagNames])).toEqual([
      ['Plan', true, ['Furniture']],
      ['All', true, []],
    ]);
    const h = harness();
    h.controller.importSkp(r, 'Import');
    const furniture = h.doc.groups.tags.byName('Furniture')!.id;
    expect(h.doc.scenes.items.map((s) => s.hiddenTags)).toEqual([[furniture], []]);
    expect(h.doc.scenes.items.some((s) => 'hiddenTagNames' in s)).toBe(false);
    skp.pages.forEach((p) => (p.hiddenLayers = []));
    const plain = convertSkp(skp, { name: 'Room', scenes: true });
    expect(plain.scenes.every((s) => !s.parts.hidden && s.hiddenTagNames === undefined)).toBe(true);
  });
});

describe('tags from DXF drawings', () => {
  it('each layer group carries a tag of the same name', () => {
    const d = parseDxf(decodeDxf(readFileSync('tests/fixtures/dxf/floor-plan.dxf')));
    const r = convertDxf(d, { unit: d.units ?? 'mm', detail: { circleSegments: 24, tolerance: 0.05, arcs: true }, faces: true, layers: defaultLayers(d) }, 'plan');
    const h = harness();
    const top = h.controller.importDrawing(r.root, r.labels, 'Import plan.dxf')!;
    const layers = h.doc.groups.children(top);
    expect(layers.length).toBeGreaterThan(0);
    for (const g of layers) {
      const name = g.name.replace(/ \(surfaces\)$/, '');
      if (name === '0') expect(g.tag).toBeUndefined();
      else expect(h.doc.groups.tags.get(g.tag)?.name).toBe(name);
    }
  });
});
