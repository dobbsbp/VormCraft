import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, drawRectangle, extractGeometry, findFaceAt, GROUND_PLANE, initBooleanKernel, mergeGeometry, Model, pushPull, volume } from '../src/core';
import { Document } from '../src/doc/Document';
import { exportStl } from '../src/io/export';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { polygonSelectGroups } from '../src/tools/boxSelect';
import { infer } from '../src/tools/inference';
import { buildDisplayData } from '../src/view/displayData';
import { ev, harness, topDown, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A box above the ground: its bottom on z = 0, top at z = h. */
function solid(m: Model, x: number, y: number, w = 100, d = 100, h = 100): void {
  const f = drawRectangle(m, GROUND_PLANE, [x, y, 0], w, d).inner!;
  pushPull(m, f, m.face(f).normal[2] > 0 ? h : -h);
}

const all = (m: Model) => ({ faces: [...m.faces.keys()], edges: [...m.edges()] });

describe('taking geometry into a group and back', () => {
  it('a whole box moves into its own model, closed, leaving nothing behind', () => {
    const m = new Model();
    solid(m, 0, 0);
    const { faces, edges } = all(m);
    const g = extractGeometry(m, faces, edges);
    expect(m.faces.size).toBe(0);
    expect(m.vertices.size).toBe(0);
    expect(g.faces.size).toBe(6);
    expect(checkWatertight(g).watertight).toBe(true);
    expect(Math.abs(volume(g))).toBeCloseTo(1e6, 3);
  });

  it('grouping one face of a box leaves the rest of the box with all its edges', () => {
    const m = new Model();
    solid(m, 0, 0);
    const top = findFaceAt(m, [50, 50, 100])!;
    const g = extractGeometry(m, [top], []);
    expect(g.faces.size).toBe(1);
    expect([...g.edges()]).toHaveLength(4);
    expect(m.faces.size).toBe(5);
    expect([...m.edges()]).toHaveLength(12);
    m.validate();
  });

  it('exploding joins the geometry up: shared corners and edges are welded', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100);
    const g = new Model();
    drawRectangle(g, GROUND_PLANE, [100, 0, 0], 100, 100); // shares the x = 100 side
    mergeGeometry(m, g, 'm1');
    expect(m.vertices.size).toBe(6); // 4 + 4 - 2 shared
    expect([...m.edges()]).toHaveLength(7);
    expect([...m.faces.values()].filter((f) => f.material === 'm1')).toHaveLength(1);
    m.validate();
  });

  it('solids touching face to face cannot share edges: they are merged side by side', () => {
    const m = new Model();
    solid(m, 0, 0);
    const g = new Model();
    solid(g, 100, 0); // touches the first box along its x = 100 side
    mergeGeometry(m, g);
    expect(m.faces.size).toBe(12);
    expect(checkWatertight(m).shells).toBe(2);
    m.validate();
  });
});

describe('groups in the document', () => {
  /** A harness with a box made into a group (and selected). */
  function grouped() {
    const h = harness();
    solid(h.model, 0, 0);
    const { faces, edges } = all(h.model);
    h.controller.selection.set(faces, edges);
    h.controller.makeGroup();
    const id = [...h.doc.groups.items.keys()][0];
    return { ...h, id };
  }

  it('Ctrl+G makes a group of the selection, selected, as one undo step', () => {
    const h = grouped();
    expect(h.doc.groups.items.size).toBe(1);
    expect(h.doc.root.faces.size).toBe(0);
    expect(h.doc.groups.get(h.id)!.model.faces.size).toBe(6);
    expect([...h.controller.selection.groups]).toEqual([h.id]);
    expect(h.controller.history.undoLabel).toBe('Make group');
    h.controller.undo();
    expect(h.doc.groups.items.size).toBe(0);
    expect(h.doc.root.faces.size).toBe(6);
  });

  it('nothing selected: Ctrl+G says what to do', () => {
    const h = harness();
    h.controller.makeGroup();
    expect(h.controller.error).toMatch(/Select what to group/);
  });

  it('geometry drawn over a group does not stick to it', () => {
    const h = grouped();
    // A rectangle on the ground right under the group, and pushed up through it.
    const f = drawRectangle(h.doc.root, GROUND_PLANE, [20, 20, 0], 60, 60).inner!;
    expect(h.doc.groups.get(h.id)!.model.faces.size).toBe(6);
    h.ctx.apply(() => pushPull(h.doc.root, f, h.doc.root.face(f).normal[2] > 0 ? 50 : -50));
    expect(h.doc.groups.get(h.id)!.model.faces.size).toBe(6);
    expect(checkWatertight(h.doc.groups.get(h.id)!.model).watertight).toBe(true);
  });

  it('editing a group: tools work on its geometry; closing selects it; undo works across', () => {
    const h = grouped();
    h.controller.enterGroup(h.id);
    expect(h.doc.editing).toBe(h.id);
    expect(h.doc.model).toBe(h.doc.groups.get(h.id)!.model);
    expect(h.controller.editingName).toBe('Group 1');
    const top = findFaceAt(h.doc.model, [50, 50, 100])!;
    h.ctx.apply(() => pushPull(h.doc.model, top, 50), undefined, 'Push/Pull');
    expect(Math.abs(volume(h.doc.groups.get(h.id)!.model))).toBeCloseTo(1.5e6, 3);
    expect(h.doc.root.faces.size).toBe(0);
    // Esc with nothing selected closes the group, leaving it selected.
    h.controller.escape();
    expect(h.doc.editing).toBeNull();
    expect([...h.controller.selection.groups]).toEqual([h.id]);
    h.controller.undo();
    expect(Math.abs(volume(h.doc.groups.get(h.id)!.model))).toBeCloseTo(1e6, 3);
  });

  it('undoing the group away while editing it closes it', () => {
    const h = grouped();
    h.controller.enterGroup(h.id);
    h.controller.undo(); // undoes Make group
    expect(h.doc.groups.items.size).toBe(0);
    expect(h.doc.editing).toBeNull();
    expect(h.doc.model).toBe(h.doc.root);
  });

  it('groups inside groups: grouping a group nests it; only the outer one is selectable at the top', () => {
    const h = grouped();
    h.controller.makeGroup(); // the selected group goes inside a new one
    const outer = [...h.doc.groups.items.keys()].find((g) => g !== h.id)!;
    expect(h.doc.groups.get(h.id)!.parent).toBe(outer);
    expect(h.doc.groups.childOf(null, h.id)).toBe(outer);
    h.controller.enterGroup(h.id); // not directly inside the top level: ignored
    expect(h.doc.editing).toBeNull();
    h.controller.enterGroup(outer);
    h.controller.enterGroup(h.id);
    expect(h.doc.editing).toBe(h.id);
    h.controller.exitGroup();
    expect(h.doc.editing).toBe(outer);
  });

  it('explode: the geometry comes back out, group paint baked in', () => {
    const h = grouped();
    const red = h.doc.materials.add({ name: 'Red', color: '#cc2200', opacity: 1 });
    h.doc.groups.get(h.id)!.material = red;
    h.controller.explodeSelection();
    expect(h.doc.groups.items.size).toBe(0);
    expect(h.doc.root.faces.size).toBe(6);
    expect([...h.doc.root.faces.values()].every((f) => f.material === red)).toBe(true);
    expect(h.controller.history.undoLabel).toBe('Explode');
  });

  it('Delete erases a selected group; deleting a material clears it from groups', () => {
    const h = grouped();
    const red = h.doc.materials.add({ name: 'Red', color: '#cc2200', opacity: 1 });
    h.doc.groups.get(h.id)!.material = red;
    h.controller.deleteMaterial(red);
    expect(h.doc.groups.get(h.id)!.material).toBeUndefined();
    h.controller.selection.set([], [], [], [h.id]);
    h.controller.deleteSelection();
    expect(h.doc.groups.items.size).toBe(0);
  });
});

describe('tools on groups', () => {
  function grouped() {
    const h = harness();
    solid(h.model, 0, 0);
    const { faces, edges } = all(h.model);
    h.controller.selection.set(faces, edges);
    h.controller.makeGroup();
    h.controller.selection.clear();
    const id = [...h.doc.groups.items.keys()][0];
    return { ...h, id };
  }
  const groupEvent = (h: ReturnType<typeof grouped>, p: [number, number, number]) => ev(h.doc, p, { face: null, group: h.id });

  it('Select: click selects the group, double-click opens it, a click outside closes it', () => {
    const h = grouped();
    const tool = use(h.controller, 'select');
    const e = groupEvent(h, [50, 50, 100]);
    tool.pointerDown(e);
    tool.pointerUp!(e, false);
    expect([...h.controller.selection.groups]).toEqual([h.id]);
    tool.doubleClick!(e);
    expect(h.doc.editing).toBe(h.id);
    const outside = { ...ev(h.doc, [500, 500, 0], { face: null }), outside: true };
    tool.pointerDown(outside);
    tool.pointerUp!(outside, false);
    expect(h.doc.editing).toBeNull();
  });

  it('Move: clicking a group moves it whole; copy mode copies it', () => {
    const h = grouped();
    const tool = use(h.controller, 'move');
    tool.pointerDown(groupEvent(h, [0, 0, 0]));
    tool.pointerDown(ev(h.doc, [200, 0, 0], { face: null }));
    const xs = [...h.doc.groups.get(h.id)!.model.vertices.values()].map((v) => v.pos[0]);
    expect(Math.min(...xs)).toBeCloseTo(200, 6);
    tool.toggleCopy!();
    tool.pointerDown(groupEvent(h, [200, 0, 0]));
    tool.pointerDown(ev(h.doc, [400, 0, 0], { face: null }));
    expect(h.doc.groups.items.size).toBe(2);
    for (const g of h.doc.groups.items.values()) expect(checkWatertight(g.model).watertight).toBe(true);
  });

  it('Scale: a group scales as a whole about the base point', () => {
    const h = grouped();
    h.controller.selection.set([], [], [], [h.id]);
    const tool = use(h.controller, 'scale');
    tool.pointerDown(ev(h.doc, [0, 0, 0], { face: null }));
    h.controller.typed('2');
    expect(Math.abs(volume(h.doc.groups.get(h.id)!.model))).toBeCloseTo(8e6, 2);
  });

  it('Eraser and Paint Bucket act on the whole group', () => {
    const h = grouped();
    const red = h.doc.materials.add({ name: 'Red', color: '#cc2200', opacity: 1 });
    use(h.controller, 'paint');
    h.controller.setPaintMaterial(red);
    h.controller.tool.pointerDown(groupEvent(h, [50, 50, 100]));
    expect(h.doc.groups.get(h.id)!.material).toBe(red);
    // Unpainted faces of the group show the group's paint.
    const data = buildDisplayData(h.doc.groups.get(h.id)!.model, red);
    expect(data.groups.map((g) => g.material)).toEqual([red]);
    const eraser = use(h.controller, 'eraser');
    eraser.pointerDown(groupEvent(h, [50, 50, 100]));
    eraser.pointerUp!(groupEvent(h, [50, 50, 100]), false);
    expect(h.doc.groups.items.size).toBe(0);
  });

  it('box selection takes groups fully inside (window) or touched (crossing)', () => {
    const h = grouped();
    const groups = [{ id: h.id, models: [h.doc.groups.get(h.id)!.model] }];
    // Top-down projector: screen = (x, -y).
    const around: [number, number][] = [[-10, 10], [110, 10], [110, -110], [-10, -110]];
    const half: [number, number][] = [[50, 10], [150, 10], [150, -110], [50, -110]];
    expect(polygonSelectGroups(groups, topDown, around, false)).toEqual([h.id]);
    expect(polygonSelectGroups(groups, topDown, half, false)).toEqual([]);
    expect(polygonSelectGroups(groups, topDown, half, true)).toEqual([h.id]);
  });

  it('drawing tools snap to a group’s corners', () => {
    const h = grouped();
    const snap = infer({
      model: h.doc.model,
      guides: h.doc.guides,
      projector: topDown,
      cursor: [101, -99],
      ray: { origin: [101, 99, 1000], dir: [0, 0, -1] },
      faceHit: null,
      others: [h.doc.groups.get(h.id)!.model],
    });
    expect(snap?.kind).toBe('endpoint');
    expect(snap?.point[0]).toBeCloseTo(100, 6);
    expect(snap?.edge).toBeUndefined();
  });
});

describe('saving and exporting groups', () => {
  it('groups (nested, painted) are saved and opened again', () => {
    const doc = new Document();
    const red = doc.materials.add({ name: 'Red', color: '#cc2200', opacity: 1 });
    const a = new Model();
    solid(a, 0, 0);
    const outer = doc.groups.add(a, null, { name: 'Table', material: red });
    const b = new Model();
    solid(b, 300, 0);
    const inner = doc.groups.add(b, outer);
    solid(doc.root, 600, 0);
    const back = parseDocument(serializeDocument(doc));
    expect(back.groups.items.size).toBe(2);
    expect(back.groups.get(outer)!.name).toBe('Table');
    expect(back.groups.get(outer)!.material).toBe(red);
    expect(back.groups.get(inner)!.parent).toBe(outer);
    expect(back.groups.get(inner)!.model.faces.size).toBe(6);
    expect(back.root.faces.size).toBe(6);
    // New groups do not reuse a loaded id.
    expect(back.groups.add(new Model(), null)).toBeGreaterThan(inner);
  });

  it('saving while a group is open still saves the whole model', () => {
    const h = harness();
    solid(h.model, 0, 0);
    h.controller.selection.set(all(h.model).faces, all(h.model).edges);
    h.controller.makeGroup();
    solid(h.doc.root, 300, 0);
    h.controller.enterGroup([...h.doc.groups.items.keys()][0]);
    const back = parseDocument(serializeDocument(h.doc));
    expect(back.root.faces.size).toBe(6);
    expect(back.groups.items.size).toBe(1);
  });

  it('STL export includes every group', () => {
    const doc = new Document();
    solid(doc.root, 0, 0);
    const g = new Model();
    solid(g, 300, 0);
    doc.groups.add(g, null);
    const { triangles, report } = exportStl(doc.allModels());
    expect(triangles).toBe(24);
    expect(report.shells).toBe(2);
    expect(report.watertight).toBe(true);
  });
});
