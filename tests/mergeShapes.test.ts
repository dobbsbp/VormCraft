import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkWatertight,
  faceArea,
  initBooleanKernel,
  mergeFlatFaces,
  Model,
  pushPull,
  shapesOf,
  unifySolids,
  volume,
  type FaceId,
  type Vec3,
} from '../src/core';
import { contextMenuItems, type MenuEntry } from '../src/tools/contextMenu';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A loose rectangle face (no splitting of what it overlaps), facing up or down. */
function rect(m: Model, x: number, y: number, w: number, d: number, z = 0, up = true): FaceId {
  const pts: Vec3[] = [
    [x, y, z],
    [x + w, y, z],
    [x + w, y + d, z],
    [x, y + d, z],
  ];
  const ring = pts.map((p) => m.addVertex(p));
  return m.addFace(up ? ring : [...ring].reverse(), [], { normal: [0, 0, up ? 1 : -1] });
}

/** A loose regular polygon face (a "circle"). */
function ngon(m: Model, cx: number, cy: number, r: number, n: number): FaceId {
  const ring = Array.from({ length: n }, (_, i) => m.addVertex([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), 0]));
  return m.addFace(ring, [], { normal: [0, 0, 1] });
}

/** A loose box (its own vertices, not joined to anything). */
function box(m: Model, x: number, y: number, z: number, w: number, d: number, h: number): Set<FaceId> {
  const base = rect(m, x, y, w, d, z);
  pushPull(m, base, h);
  return m.connectedFaces(base);
}

function expectSolid(m: Model) {
  m.validate();
  const r = checkWatertight(m);
  expect(r.openEdges).toEqual([]);
  expect(r.watertight).toBe(true);
}

describe('merging flat faces', () => {
  it('two overlapping rectangles become one face around both', () => {
    const m = new Model();
    const a = rect(m, 0, 0, 100, 50);
    const b = rect(m, 60, 20, 100, 50);
    const out = mergeFlatFaces(m, [a, b]);
    m.validate();
    expect(out).toHaveLength(1);
    expect(m.faces.size).toBe(1);
    expect(faceArea(m, out[0])).toBeCloseTo(100 * 50 * 2 - 40 * 30);
    expect(m.faceVertexLoops(out[0])[0]).toHaveLength(8);
    expect(m.vertices.size).toBe(8);
  });

  it('a rectangle and a circle overlapping merge into one face', () => {
    const m = new Model();
    const a = rect(m, 0, 0, 100, 100);
    const c = ngon(m, 100, 50, 30, 24);
    const out = mergeFlatFaces(m, [a, c]);
    m.validate();
    expect(out).toHaveLength(1);
    const halfDisc = 0.5 * 0.5 * 24 * 30 * 30 * Math.sin((2 * Math.PI) / 24);
    expect(faceArea(m, out[0])).toBeCloseTo(100 * 100 + halfDisc);
  });

  it('a face lying inside another one is absorbed; faces facing opposite ways still merge', () => {
    const m = new Model();
    const a = rect(m, 0, 0, 100, 100);
    const b = rect(m, 20, 20, 30, 30, 0, false);
    const out = mergeFlatFaces(m, [a, b]);
    m.validate();
    expect(out).toEqual([a]);
    expect(m.face(a).normal[2]).toBe(1);
    expect(faceArea(m, a)).toBeCloseTo(100 * 100);
    expect(m.vertices.size).toBe(4);
  });

  it('a hole stays where nothing covers it', () => {
    const m = new Model();
    const ring = ([
      [0, 0, 0],
      [100, 0, 0],
      [100, 100, 0],
      [0, 100, 0],
    ] as Vec3[]).map((p) => m.addVertex(p));
    const hole = ([
      [20, 20, 0],
      [20, 80, 0],
      [80, 80, 0],
      [80, 20, 0],
    ] as Vec3[]).map((p) => m.addVertex(p));
    const a = m.addFace(ring, [hole], { normal: [0, 0, 1] });
    const b = rect(m, 70, 40, 60, 20); // across the hole's right side and out of the face
    const out = mergeFlatFaces(m, [a, b]);
    m.validate();
    expect(out).toHaveLength(1);
    expect(m.face(out[0]).holes).toHaveLength(1);
    expect(faceArea(m, out[0])).toBeCloseTo(100 * 100 - 60 * 60 + 10 * 20 + 30 * 20);
  });

  it('faces apart stay separate; faces in different planes are refused', () => {
    const m = new Model();
    const a = rect(m, 0, 0, 10, 10);
    const b = rect(m, 50, 0, 10, 10);
    expect(mergeFlatFaces(m, [a, b])).toHaveLength(2);
    const c = rect(m, 0, 0, 10, 10, 5);
    expect(() => mergeFlatFaces(m, [a, c])).toThrow(/one plane/);
  });
});

describe('unifying solids', () => {
  it('two overlapping boxes become one solid with the inside faces gone', () => {
    const m = new Model();
    box(m, 0, 0, 0, 100, 100, 50);
    const b = box(m, 50, 50, 20, 100, 100, 50);
    const { solids } = shapesOf(m, [...b, ...m.faces.keys()]);
    expect(solids).toHaveLength(2);
    unifySolids(m, solids);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(100 * 100 * 50 * 2 - 50 * 50 * 30);
    expect(shapesOf(m, m.faces.keys()).solids).toHaveLength(1);
  });

  it('boxes side by side, touching face to face, become one box', () => {
    const m = new Model();
    box(m, 0, 0, 0, 50, 100, 30);
    box(m, 50, 0, 0, 50, 100, 30);
    unifySolids(m, shapesOf(m, m.faces.keys()).solids);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(100 * 100 * 30);
    expect(m.faces.size).toBe(6);
    expect(m.vertices.size).toBe(8);
  });

  it('a cylinder unified with a box keeps its true circle edges', () => {
    const m = new Model();
    box(m, 0, 0, 0, 100, 100, 20);
    const ring = Array.from({ length: 24 }, (_, i) => m.addVertex([100 + 20 * Math.cos((2 * Math.PI * i) / 24), 50 + 20 * Math.sin((2 * Math.PI * i) / 24), 0]));
    const disc = m.addFace(ring, [], { normal: [0, 0, 1] });
    const curve = m.addCurve({ kind: 'circle', center: [100, 50, 0], normal: [0, 0, 1], radius: 20, segments: 24 });
    ring.forEach((v, i) => m.setEdgeCurve(v, ring[(i + 1) % 24], curve));
    pushPull(m, disc, 40);
    unifySolids(m, shapesOf(m, m.faces.keys()).solids);
    expectSolid(m);
    const curved = [...m.halfEdges.values()].filter((h) => h.curve !== null).length;
    expect(curved).toBeGreaterThan(0);
  });

  it('selected faces of an open surface count as flat faces, not solids', () => {
    const m = new Model();
    const a = rect(m, 0, 0, 10, 10);
    const s = box(m, 50, 0, 0, 10, 10, 10);
    const { solids, flat } = shapesOf(m, [a, [...s][0], [...s][1]]);
    expect(solids).toHaveLength(1);
    expect(flat).toEqual([a]);
  });
});

const menuEnabled = (entries: MenuEntry[], label: string) => entries.some((e) => e !== 'separator' && e.label === label && !e.disabled);

describe('Merge Shapes (right-click)', () => {
  const host = { entityInfo: () => {}, mergeShapes: () => {} };

  it('is offered for two solids, two flat faces in one plane, not for one shape or a mix', () => {
    const h = harness();
    const a = box(h.model, 0, 0, 0, 100, 100, 50);
    const b = box(h.model, 50, 50, 20, 100, 100, 50);
    const sel = h.controller.selection;
    sel.set([[...a][0]], []);
    expect(menuEnabled(contextMenuItems(h.controller, host), 'Merge Shapes…')).toBe(false);
    sel.set([[...a][0], [...b][0]], []);
    expect(h.controller.mergeShapesPlan()).toEqual({ kind: 'solids', count: 2 });
    expect(menuEnabled(contextMenuItems(h.controller, host), 'Merge Shapes…')).toBe(true);
    const f = rect(h.model, 300, 0, 10, 10);
    sel.set([[...a][0], f], []);
    expect('error' in h.controller.mergeShapesPlan()).toBe(true);
    const g = rect(h.model, 305, 5, 10, 10);
    sel.set([f, g], []);
    expect(h.controller.mergeShapesPlan()).toEqual({ kind: 'flat', count: 2 });
  });

  it('unify joins loose solids from one face of each; undo brings them back', () => {
    const h = harness();
    const a = box(h.model, 0, 0, 0, 100, 100, 50);
    const b = box(h.model, 50, 50, 20, 100, 100, 50);
    h.controller.selection.set([[...a][0], [...b][0]], []);
    h.controller.mergeShapes('unify');
    expect(h.controller.error).toBeNull();
    expectSolid(h.doc.model);
    expect(volume(h.doc.model)).toBeCloseTo(100 * 100 * 50 * 2 - 50 * 50 * 30);
    expect(h.controller.selection.faces.size).toBe(h.doc.model.faces.size);
    h.controller.undo();
    expect(shapesOf(h.doc.model, h.doc.model.faces.keys()).solids).toHaveLength(2);
  });

  it('unify of two groups gives one group with one solid; keep shapes puts them in one group untouched', () => {
    for (const mode of ['unify', 'group'] as const) {
      const h = harness();
      const m1 = new Model();
      box(m1, 0, 0, 0, 100, 100, 50);
      const m2 = new Model();
      box(m2, 50, 50, 20, 100, 100, 50);
      const g1 = h.doc.groups.add(m1, null, { name: 'Table' });
      const g2 = h.doc.groups.add(m2, null);
      h.controller.selection.set([], [], [], [g1, g2]);
      h.controller.mergeShapes(mode);
      expect(h.controller.error).toBeNull();
      const [id] = h.controller.selection.groups;
      const top = h.doc.groups.children(null);
      expect(top.map((g) => g.id)).toEqual([id]);
      if (mode === 'unify') {
        const g = h.doc.groups.get(id)!;
        expect(g.name).toBe('Table');
        expectSolid(g.model);
        expect(volume(g.model)).toBeCloseTo(100 * 100 * 50 * 2 - 50 * 50 * 30);
      } else {
        expect(h.doc.groups.children(id).map((g) => g.id).sort()).toEqual([g1, g2].sort());
      }
    }
  });

  it('flat faces merge straight away and the result is selected', () => {
    const h = harness();
    const a = rect(h.model, 0, 0, 100, 50);
    const b = rect(h.model, 60, 20, 100, 50);
    h.controller.selection.set([a, b], []);
    h.controller.mergeShapes('unify');
    expect(h.doc.model.faces.size).toBe(1);
    expect([...h.controller.selection.faces]).toEqual([a]);
  });
});
