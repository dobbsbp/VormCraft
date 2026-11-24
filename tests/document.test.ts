import { beforeAll, describe, expect, it } from 'vitest';
import { buildDemoModel } from '../src/app/demoModel';
import { checkWatertight, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, modelKey, pushPull, volume } from '../src/core';
import { inheritMaterials, paintFaces, unpaintMaterial } from '../src/core/ops/materials';
import { transformVertices, translation } from '../src/core/ops/transform';
import { Document } from '../src/doc/Document';
import { FileFormatError, parseDocument, serializeDocument, WRITE_VERSION } from '../src/io/fileFormat';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** Draw a rectangle with the Rectangle tool (two clicks). */
function rect(H: ReturnType<typeof harness>, x: number, y: number, w: number, l: number) {
  const t = use(H.controller, 'rectangle');
  t.pointerDown(ev(H.doc, [x, y, 0]));
  t.pointerDown(ev(H.doc, [x + w, y + l, 0]));
}

describe('undo / redo', () => {
  it('undoes and redoes tool operations', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    rect(H, 50, 0, 10, 10);
    expect(H.model.faces.size).toBe(2);
    expect(H.controller.history.undoLabel).toBe('Rectangle');
    H.controller.undo();
    expect(H.model.faces.size).toBe(1);
    H.controller.undo();
    expect(H.model.faces.size).toBe(0);
    H.controller.undo();
    expect(H.controller.error).toBe('Nothing to undo');
    H.controller.redo();
    H.controller.redo();
    expect(H.model.faces.size).toBe(2);
    H.model.validate();
  });

  it('a new change clears the redo stack', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    H.controller.undo();
    rect(H, 20, 0, 5, 5);
    expect(H.controller.history.redoLabel).toBeNull();
  });

  it('re-dimensioning by typing is one undo step', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    H.controller.typed('30,30');
    H.controller.typed('40,40');
    expect(H.model.faces.size).toBe(1);
    H.controller.undo();
    expect(H.model.faces.size).toBe(0);
  });

  it('a failed operation adds no undo step', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    const t = use(H.controller, 'offset');
    t.pointerDown(ev(H.doc, [5, 5, 0]));
    H.controller.typed('50');
    expect(H.controller.error).toMatch(/too large/);
    expect(H.controller.history.undoLabel).toBe('Rectangle');
  });

  it('typing after another tool changed the model does not re-dimension (regression)', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    const pp = use(H.controller, 'pushpull');
    pp.pointerDown(ev(H.doc, [5, 5, 0]));
    H.controller.typed('10');
    expect(volume(H.model)).toBeCloseTo(1000);
    use(H.controller, 'rectangle');
    H.controller.typed('20,20');
    // Previously this restored the document from before the rectangle, losing the push.
    expect(H.controller.error).toMatch(/first corner/);
    expect(volume(H.model)).toBeCloseTo(1000);
  });

  it('typing after undo does not resurrect the undone operation', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    H.controller.undo();
    H.controller.typed('20,20');
    expect(H.model.faces.size).toBe(0);
  });

  it('erase and guide deletion are undoable', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    H.doc.guides.addPoint([1, 1, 1]);
    H.controller.setTool('select');
    H.controller.selection.set([...H.model.faces.keys()], []);
    H.controller.deleteSelection();
    expect(H.model.faces.size).toBe(0);
    H.controller.deleteGuides();
    expect(H.doc.guides.items.size).toBe(0);
    H.controller.undo();
    expect(H.doc.guides.items.size).toBe(1);
    H.controller.undo();
    expect(H.model.faces.size).toBe(1);
  });

  it('tracks unsaved changes', () => {
    const H = harness();
    expect(H.controller.dirty).toBe(false);
    rect(H, 0, 0, 10, 10);
    expect(H.controller.dirty).toBe(true);
    H.controller.markSaved();
    expect(H.controller.dirty).toBe(false);
  });
});

describe('model versions (skipping what did not change)', () => {
  const slab = () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10).inner!, 5);
    return m;
  };

  it('move with every kind of change, and not when only read', () => {
    const m = slab();
    const changed = (f: () => void) => {
      const v = m.version;
      f();
      return m.version !== v;
    };
    const face = [...m.faces.keys()][0];
    const e = [...m.edges()][0];
    expect(changed(() => m.validate())).toBe(false);
    expect(changed(() => modelKey(m))).toBe(false);
    expect(changed(() => transformVertices(m, new Set(m.vertices.keys()), translation([1, 0, 0])))).toBe(true);
    expect(changed(() => paintFaces(m, [face], 'oak'))).toBe(true);
    expect(changed(() => unpaintMaterial(m, 'oak'))).toBe(true);
    expect(changed(() => m.setEdgeSoft(m.he(e).origin, m.dest(e), true))).toBe(true);
    expect(changed(() => m.setEdgeHidden(m.he(e).origin, m.dest(e), true))).toBe(true);
    expect(changed(() => m.copyFrom(slab()))).toBe(true);
    const lone = new Model();
    drawRectangle(lone, GROUND_PLANE, [0, 0, 0], 10, 10);
    const v = lone.version;
    lone.flipFace([...lone.faces.keys()][0]);
    expect(lone.version).not.toBe(v);
    const painted = slab();
    paintFaces(painted, painted.faces.keys(), 'oak');
    const after = slab();
    const w = after.version;
    inheritMaterials(painted, after);
    expect(after.version).not.toBe(w);
  });

  it('let undo snapshots share copies of groups that did not change', () => {
    const doc = new Document();
    const a = doc.groups.add(slab(), null);
    const b = doc.groups.add(slab(), null);
    const first = doc.snapshot();
    const second = doc.snapshot();
    expect(second.groups.get(a)!.model).toBe(first.groups.get(a)!.model);
    expect(second.model).toBe(first.model);

    const painted = doc.groups.get(a)!.model;
    paintFaces(painted, painted.faces.keys(), 'oak');
    const third = doc.snapshot();
    expect(third.groups.get(a)!.model).not.toBe(first.groups.get(a)!.model);
    expect(third.groups.get(b)!.model).toBe(first.groups.get(b)!.model);

    // Restoring gives the document its own copies: changing them leaves the snapshots alone.
    doc.restore(first);
    expect([...doc.groups.get(a)!.model.faces.values()].every((f) => f.material === undefined)).toBe(true);
    const keyBefore = modelKey(first.groups.get(b)!.model);
    const live = doc.groups.get(b)!.model;
    paintFaces(live, live.faces.keys(), 'oak');
    expect(modelKey(first.groups.get(b)!.model)).toBe(keyBefore);
    expect(modelKey(third.groups.get(b)!.model)).toBe(keyBefore);
  });
});

describe('file format', () => {
  it('opens a model with more ids than a function call can take as arguments', () => {
    const file = JSON.parse(serializeDocument(new Document()));
    file.vertices = Array.from({ length: 300_000 }, (_, i) => [i + 1, i, 0, 0]);
    const back = parseDocument(JSON.stringify(file));
    expect(back.model.vertices.size).toBe(300_000);
  });

  it('round-trips a model with holes, curves and guides exactly', () => {
    const doc = new Document(buildDemoModel());
    doc.guides.addLine([0, 30, 40], [1, 0, 0]);
    doc.guides.addPoint([5, 6, 7]);
    const back = parseDocument(serializeDocument(doc));
    back.model.validate();
    expect([...back.model.faces.keys()].sort()).toEqual([...doc.model.faces.keys()].sort());
    for (const f of doc.model.faces.keys()) {
      expect(back.model.faceVertexLoops(f)).toEqual(doc.model.faceVertexLoops(f));
      // JSON has no -0, so compare numerically.
      back.model.face(f).normal.forEach((x, i) => expect(x).toBeCloseTo(doc.model.face(f).normal[i], 12));
    }
    expect([...back.model.curves.values()]).toEqual([...doc.model.curves.values()]);
    for (const e of doc.model.edges()) {
      const h = doc.model.he(e);
      const e2 = back.model.halfEdgeBetween(h.origin, doc.model.dest(e))!;
      expect(back.model.he(e2).curve).toBe(h.curve);
    }
    // Positions are saved to 0.000001 mm: the volume to a few parts in a billion.
    expect(Math.abs(volume(back.model) / volume(doc.model) - 1)).toBeLessThan(1e-8);
    expect(checkWatertight(back.model).genus).toBe(1);
    expect(back.guides.lines()).toHaveLength(1);
    expect(back.guides.points()[0].pos).toEqual([5, 6, 7]);
    // New ids after loading never collide with saved ones.
    const fresh = back.model.newId();
    expect(fresh).toBeGreaterThan(Math.max(...back.model.vertices.keys(), ...back.model.faces.keys()));
  });

  it('keeps loose edges', () => {
    const doc = new Document();
    const a = doc.model.addVertex([0, 0, 0]);
    const b = doc.model.addVertex([10, 0, 0]);
    doc.model.addEdge(a, b);
    const back = parseDocument(serializeDocument(doc));
    expect([...back.model.edges()]).toHaveLength(1);
  });

  it('keeps edge smoothing (soft, always shown, automatic), and still opens version 1 files', () => {
    const doc = new Document();
    const [a, b, c, d] = ([[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0]] as const).map((p) => doc.model.addVertex([...p]));
    doc.model.addEdge(a, b);
    doc.model.addEdge(b, c);
    doc.model.addEdge(c, d);
    doc.model.setEdgeSoft(a, b, true);
    doc.model.setEdgeSoft(b, c, false);
    const text = serializeDocument(doc);
    expect(JSON.parse(text).version).toBe(WRITE_VERSION);
    const back = parseDocument(text).model;
    const soft = (p: number, q: number) => back.he(back.halfEdgeBetween(p, q)!).soft;
    expect([soft(a, b), soft(b, c), soft(c, d)]).toEqual([true, false, undefined]);
    const v1 = { format: 'benup', version: 1, units: 'mm', vertices: [[1, 0, 0, 0], [2, 5, 0, 0]], curves: [], faces: [], edges: [[1, 2, null]], guides: { visible: true, lines: [], points: [] } };
    expect([...parseDocument(JSON.stringify(v1)).model.edges()]).toHaveLength(1);
    // Files saved before the rename (format tag 'benup') still open; new files carry the new tag.
    expect(JSON.parse(text).format).toBe('vormcraft');
  });

  it('rejects files that are not ours, newer, or damaged with clear messages', () => {
    expect(() => parseDocument('not json')).toThrow(FileFormatError);
    expect(() => parseDocument('{"format":"other"}')).toThrow(/not a VormCraft file/);
    expect(() => parseDocument('{"format":"vormcraft","version":99,"units":"mm"}')).toThrow(/newer version/);
    const doc = new Document();
    drawRectangle(doc.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const bad = JSON.parse(serializeDocument(doc));
    bad.faces[0].loops[0][0] = 9999;
    expect(() => parseDocument(JSON.stringify(bad))).toThrow(/damaged/);
  });

  it('opening a file replaces the document in place and clears history', () => {
    const H = harness();
    rect(H, 0, 0, 10, 10);
    const other = new Document(buildDemoModel());
    const model = H.model;
    H.controller.replaceDocument(parseDocument(serializeDocument(other)));
    expect(H.doc.model).toBe(model);
    expect(H.model.faces.size).toBe(other.model.faces.size);
    expect(H.controller.history.undoLabel).toBeNull();
    expect(H.controller.dirty).toBe(false);
    expect(findFaceAt(H.model, [150, 60, 25])).toBeDefined();
  });
});
