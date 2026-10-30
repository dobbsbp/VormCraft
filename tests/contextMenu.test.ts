import { beforeAll, describe, expect, it } from 'vitest';
import { drawPolygon, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, pushPull, reverseFaces, volume, type Vec3 } from '../src/core';
import { contextMenuItems, type MenuEntry } from '../src/tools/contextMenu';
import type { PointerSample } from '../src/tools/ToolController';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

function solid(m: Model, x: number, y: number, size = 100): void {
  const f = drawRectangle(m, GROUND_PLANE, [x, y, 0], size, size).inner!;
  pushPull(m, f, m.face(f).normal[2] > 0 ? size : -size);
}

/** A right-click sample over a point, looking straight down. */
function sample(p: Vec3, hit: Partial<PointerSample> = {}): PointerSample {
  return { screen: [p[0], -p[1]], ray: { origin: [p[0], p[1], p[2] + 1000], dir: [0, 0, -1] }, faceHit: null, edge: null, shift: false, ctrl: false, down: false, ...hit };
}

/** The menu as label → enabled (submenus as "Parent/Child"). */
function menu(entries: MenuEntry[], prefix = ''): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const e of entries) {
    if (e === 'separator') continue;
    out.set(prefix + e.label, !e.disabled);
    if (e.items) for (const [k, v] of menu(e.items, `${e.label}/`)) out.set(k, v);
  }
  return out;
}

const host = { entityInfo: () => {} };

describe('right-click', () => {
  it('selects what is under the cursor, unless it is already part of the selection', () => {
    const h = harness();
    solid(h.model, 0, 0);
    const top = findFaceAt(h.model, [50, 50, 100])!;
    const side = findFaceAt(h.model, [50, 0, 50])!;
    h.controller.contextPick(sample([50, 50, 100], { faceHit: { face: top, point: [50, 50, 100], distance: 900 } }));
    expect([...h.controller.selection.faces]).toEqual([top]);
    h.controller.selection.set([top, side], []);
    h.controller.contextPick(sample([50, 50, 100], { faceHit: { face: top, point: [50, 50, 100], distance: 900 } }));
    expect(h.controller.selection.faces.size).toBe(2);
    // Empty space keeps the selection.
    h.controller.contextPick(sample([900, 900, 0]));
    expect(h.controller.selection.faces.size).toBe(2);
  });

  it('a group under the cursor gets selected, and the menu offers group commands', () => {
    const h = harness();
    const m = new Model();
    solid(m, 0, 0);
    const id = h.doc.groups.add(m, null);
    const face = findFaceAt(m, [50, 50, 100])!;
    h.controller.contextPick(sample([50, 50, 100], { otherHit: { owner: id, face, point: [50, 50, 100], distance: 900 } }));
    expect([...h.controller.selection.groups]).toEqual([id]);
    const items = menu(contextMenuItems(h.controller, host));
    expect(items.get('Edit Group')).toBe(true);
    expect(items.get('Explode')).toBe(true);
    expect(items.get('Hide')).toBe(true);
    expect(items.get('Reverse Faces')).toBe(false);
    expect(items.get('Flip Along')).toBe(true);
    expect(items.has('Unhide All')).toBe(false);
    expect(items.has('Close Group')).toBe(false);
  });

  it('for faces: no group commands, face commands on; empty selection greys out most things', () => {
    const h = harness();
    solid(h.model, 0, 0);
    let items = menu(contextMenuItems(h.controller, host));
    expect(items.get('Erase')).toBe(false);
    expect(items.get('Zoom Selection')).toBe(false);
    expect(items.get('Select/Select All')).toBe(true);
    h.controller.selection.set([findFaceAt(h.model, [50, 50, 100])!], []);
    items = menu(contextMenuItems(h.controller, host));
    expect(items.has('Edit Group')).toBe(false);
    expect(items.get('Hide')).toBe(false);
    expect(items.get('Reverse Faces')).toBe(true);
    expect(items.get('Select/Bounding Edges')).toBe(true);
    expect(items.get('Make Group')).toBe(true);
  });
});

describe('menu commands', () => {
  it('Reverse Faces turns a whole solid inside out; part of a closed solid is refused, unchanged', () => {
    const m = new Model();
    solid(m, 0, 0);
    expect(volume(m)).toBeCloseTo(1e6, 3);
    reverseFaces(m, [...m.faces.keys()]);
    expect(volume(m)).toBeCloseTo(-1e6, 3);
    m.validate();
    const before = m.faces.size;
    expect(() => reverseFaces(m, [findFaceAt(m, [50, 50, 100])!])).toThrow(/closed solid/);
    expect(m.faces.size).toBe(before);
    expect(volume(m)).toBeCloseTo(-1e6, 3);
    m.validate();
  });

  it('Reverse Faces on a loose face, as an undo step', () => {
    const h = harness();
    const f = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const nz = h.model.face(f).normal[2];
    h.controller.selection.set([f], []);
    h.controller.reverseSelectedFaces();
    expect(h.model.face(f).normal[2]).toBeCloseTo(-nz, 9);
    expect(h.controller.history.undoLabel).toBe('Reverse faces');
  });

  it('Soften and Unsoften the edge between two selected faces', () => {
    const h = harness();
    solid(h.model, 0, 0);
    const top = findFaceAt(h.model, [50, 50, 100])!;
    const side = findFaceAt(h.model, [50, 0, 50])!;
    h.controller.selection.set([top, side], []);
    expect(h.controller.canSoften()).toBe(true);
    h.controller.softenSelection(true);
    const shared = h.model.faceHalfEdges(top).find((e) => h.model.faceOf(h.model.he(e).twin) === side)!;
    expect(h.model.he(shared).soft).toBe(true);
    h.controller.softenSelection(false);
    expect(h.model.he(shared).soft).toBe(false);
    h.controller.selection.set([top], []);
    expect(h.controller.canSoften()).toBe(false);
  });

  it('Flip Along mirrors the selection across its own centre', () => {
    const h = harness();
    const tri = drawPolygon(h.model, GROUND_PLANE, [
      [0, 0, 0],
      [100, 0, 0],
      [0, 50, 0],
    ]).inner!;
    h.controller.selection.set([tri], h.model.faceHalfEdges(tri).map((e) => Math.min(e, h.model.he(e).twin)));
    h.controller.flipSelection(0);
    const pts = [...h.model.vertices.values()].map((v) => v.pos.map((x) => Math.round(x)).join(','));
    expect(pts.sort()).toEqual(['0,0,0', '100,0,0', '100,50,0']);
    h.model.validate();
  });

  it('Flip Along works on groups too (a whole group mirrored, still a closed solid)', () => {
    const h = harness();
    const m = new Model();
    solid(m, 100, 0);
    const id = h.doc.groups.add(m, null);
    h.controller.selection.set([], [], [], [id]);
    h.controller.flipSelection(2);
    expect(volume(m)).toBeCloseTo(1e6, 3);
    const zs = [...m.vertices.values()].map((v) => v.pos[2]);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(100, 6);
  });

  it('select helpers: bounding edges, all connected, same material', () => {
    const h = harness();
    solid(h.model, 0, 0);
    solid(h.model, 300, 0);
    const red = h.doc.materials.add({ name: 'Red', color: '#cc2200', opacity: 1 });
    const top = findFaceAt(h.model, [50, 50, 100])!;
    const otherTop = findFaceAt(h.model, [350, 50, 100])!;
    h.model.face(top).material = red;
    h.model.face(otherTop).material = red;
    h.controller.selection.set([top], []);
    h.controller.selectBoundingEdges();
    expect(h.controller.selection.edges.size).toBe(4);
    expect(h.controller.selection.faces.size).toBe(0);
    h.controller.selection.set([top], []);
    h.controller.selectAllConnected();
    expect(h.controller.selection.faces.size).toBe(6);
    expect(h.controller.selection.edges.size).toBe(12);
    h.controller.selection.set([top], []);
    h.controller.selectSameMaterial();
    expect([...h.controller.selection.faces].sort()).toEqual([top, otherTop].sort());
  });

  it('Zoom Selection zooms to the selection’s box; groups can be renamed', () => {
    const h = harness();
    const m = new Model();
    solid(m, 200, 0);
    const id = h.doc.groups.add(m, null);
    let zoomed: [Vec3, Vec3] | null = null;
    h.controller.onZoomTo = (min, max) => (zoomed = [min, max]);
    h.controller.selection.set([], [], [], [id]);
    h.controller.zoomSelection();
    expect(zoomed).toEqual([
      [200, 0, 0],
      [300, 100, 100],
    ]);
    h.controller.renameGroup(id, '  Shelf  ');
    expect(h.doc.groups.get(id)!.name).toBe('Shelf');
    expect(h.controller.history.undoLabel).toBe('Rename group');
    h.controller.renameGroup(id, ' ');
    expect(h.controller.error).toMatch(/name/);
  });
});
