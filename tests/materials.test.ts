import { beforeAll, describe, expect, it } from 'vitest';
import { drawCircle, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, offsetFace, paintFaces, pushPull, type FaceId, type Model } from '../src/core';
import { Materials } from '../src/doc/Materials';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { buildDisplayData, faceUVAxes } from '../src/view/displayData';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const RED = { name: 'Red', color: '#cc2200', opacity: 1 };
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A harness with one 200 x 200 ground face painted red. */
function paintedSheet() {
  const h = harness();
  const red = h.doc.materials.add(RED);
  const sheet = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 200, 200).inner!;
  paintFaces(h.model, [sheet], red);
  return { ...h, red, sheet };
}

const paintAt = (m: Model, p: [number, number, number]) => m.face(findFaceAt(m, p)!).material;
const painted = (m: Model, id: string) => [...m.faces.values()].filter((f) => f.material === id).length;

describe('paint survives modelling', () => {
  it('both pieces of a split face keep its paint', () => {
    const h = paintedSheet();
    h.ctx.apply(() => drawRectangle(h.model, GROUND_PLANE, [50, 50, 0], 50, 50, h.sheet));
    expect(h.model.faces.size).toBe(2);
    expect(painted(h.model, h.red)).toBe(2);
  });

  it('push/pull: the moved face and the base keep the paint, the new walls do not', () => {
    const h = paintedSheet();
    h.ctx.apply(() => pushPull(h.model, h.sheet, 100));
    expect(h.model.face(h.sheet).material).toBe(h.red);
    expect(painted(h.model, h.red)).toBe(2);
    expect(h.model.faces.size).toBe(6);
  });

  it('a pocket pushed into a painted solid: the cut faces keep the paint', () => {
    const h = paintedSheet();
    h.ctx.apply(() => pushPull(h.model, h.sheet, -100)); // box below the sheet; the sheet is its top
    const top = findFaceAt(h.model, [10, 10, 0])!;
    expect(h.model.face(top).material).toBe(h.red);
    const pocket = drawCircle(h.model, GROUND_PLANE, [100, 100, 0], 30, 12, top).inner!;
    h.ctx.apply(() => pushPull(h.model, pocket, -40));
    expect(paintAt(h.model, [10, 10, 0])).toBe(h.red);
    expect(paintAt(h.model, [100, 100, -40])).toBe(h.red); // the floor is the pushed face
  });

  it('offsetting a painted face: the ring and the inner face are painted', () => {
    const h = paintedSheet();
    h.ctx.apply(() => offsetFace(h.model, h.sheet, 20));
    expect(painted(h.model, h.red)).toBe(2);
  });

  it('flipping keeps the paint; painting back to the default sticks', () => {
    const h = paintedSheet();
    h.ctx.apply(() => h.model.flipFace(h.sheet));
    expect(h.model.face(h.sheet).material).toBe(h.red);
    h.ctx.apply(() => paintFaces(h.model, [h.sheet], undefined));
    expect(h.model.face(h.sheet).material).toBeUndefined();
  });
});

describe('Paint Bucket', () => {
  function box() {
    const h = harness();
    const red = h.doc.materials.add(RED);
    const blue = h.doc.materials.add({ name: 'Blue', color: '#2244cc', opacity: 1 });
    const base = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    pushPull(h.model, base, -100);
    const top = findFaceAt(h.model, [50, 50, 0])!;
    use(h.controller, 'paint');
    return { ...h, red, blue, top };
  }
  const click = (h: ReturnType<typeof harness>, face: FaceId, o: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}) => {
    const e = { ...ev(h.doc, [50, 50, 0], { face, shift: o.shift }), ctrl: !!o.ctrl, alt: !!o.alt };
    h.controller.tool.pointerMove(e);
    h.controller.tool.pointerDown(e);
  };

  it('paints the clicked face with the current material, as one "Paint" undo step', () => {
    const h = box();
    h.controller.setPaintMaterial(h.red);
    click(h, h.top);
    expect(h.model.face(h.top).material).toBe(h.red);
    expect(painted(h.model, h.red)).toBe(1);
    expect(h.controller.history.undoLabel).toBe('Paint');
    h.controller.undo();
    expect(h.model.face(h.top).material).toBeUndefined();
  });

  it('a whole curved surface at once; all selected faces when the clicked one is selected', () => {
    const h = harness();
    const red = h.doc.materials.add(RED);
    const disc = drawCircle(h.model, GROUND_PLANE, [0, 0, 0], 50, 12).inner!;
    pushPull(h.model, disc, 50);
    const wall = [...h.model.faces.keys()].find((f) => Math.abs(h.model.face(f).normal[2]) < 0.5)!;
    use(h.controller, 'paint');
    h.controller.setPaintMaterial(red);
    click(h, wall);
    expect(painted(h.model, red)).toBe(12);
    const ends = [...h.model.faces.keys()].filter((f) => Math.abs(h.model.face(f).normal[2]) > 0.5);
    h.controller.selection.set(ends, []);
    click(h, ends[0]);
    expect(painted(h.model, red)).toBe(14);
  });

  it('Shift paints every face with the same paint, Ctrl the connected ones; Alt picks the paint up', () => {
    const h = box();
    h.controller.setPaintMaterial(h.red);
    click(h, h.top, { shift: true }); // every unpainted face
    expect(painted(h.model, h.red)).toBe(6);
    h.controller.setPaintMaterial(h.blue);
    click(h, h.top, { ctrl: true });
    expect(painted(h.model, h.blue)).toBe(6);
    h.controller.setPaintMaterial(undefined);
    click(h, h.top, { alt: true });
    expect(h.controller.paintMaterial).toBe(h.blue);
    expect(painted(h.model, h.blue)).toBe(6); // picking up changes nothing
  });

  it('the default material removes paint', () => {
    const h = box();
    paintFaces(h.model, [h.top], h.red);
    h.controller.setPaintMaterial(undefined);
    click(h, h.top);
    expect(h.model.face(h.top).material).toBeUndefined();
  });
});

describe('materials', () => {
  it('adds, edits and names materials; bad values are refused', () => {
    const ms = new Materials();
    const a = ms.add(RED);
    expect(ms.uniqueName('Red')).toBe('Red 2');
    ms.update(a, { color: '#00ff00', texture: { image: PIXEL, width: 300, height: 200 } });
    expect(ms.get(a)!.texture!.width).toBe(300);
    ms.update(a, { texture: null });
    expect(ms.get(a)!.texture).toBeUndefined();
    expect(() => ms.add({ ...RED, color: 'red' })).toThrow(/colour/);
    expect(() => ms.add({ ...RED, opacity: 2 })).toThrow(/Opacity/);
    expect(() => ms.update(a, { texture: { image: PIXEL, width: 0, height: 1 } })).toThrow(/size/);
  });

  it('deleting a material unpaints its faces, undoably', () => {
    const h = paintedSheet();
    h.controller.setPaintMaterial(h.red);
    h.controller.deleteMaterial(h.red);
    expect(h.doc.materials.get(h.red)).toBeUndefined();
    expect(h.model.face(h.sheet).material).toBeUndefined();
    expect(h.controller.paintMaterial).toBeUndefined();
    h.controller.undo();
    expect(h.doc.materials.get(h.red)?.name).toBe('Red');
    expect(h.model.face(h.sheet).material).toBe(h.red);
  });

  it('materials and paint are saved and opened again', () => {
    const h = paintedSheet();
    const tex = h.doc.materials.add({ name: 'Brick', color: '#aa5533', opacity: 0.5, texture: { image: PIXEL, width: 240, height: 75 } });
    const back = parseDocument(serializeDocument(h.doc));
    expect(back.model.face(h.sheet).material).toBe(h.red);
    expect(back.materials.get(tex)).toEqual(h.doc.materials.get(tex));
    expect(back.materials.items.size).toBe(2);
    // New materials do not reuse a loaded id.
    expect(back.materials.add(RED)).not.toBe(h.red);
  });
});

describe('display of paint', () => {
  it('draws triangles in one group per material, every triangle still mapped to its face', () => {
    const h = paintedSheet();
    const other = drawRectangle(h.model, GROUND_PLANE, [300, 0, 0], 100, 100).inner!;
    const data = buildDisplayData(h.model);
    expect(data.groups.map((g) => g.material).sort()).toEqual([h.red, null].sort());
    const red = data.groups.find((g) => g.material === h.red)!;
    for (let t = red.start / 3; t < (red.start + red.count) / 3; t++) expect(data.triangleFaces[t]).toBe(h.sheet);
    expect(data.groups.reduce((n, g) => n + g.count, 0)).toBe(data.indices.length);
    expect(data.triangleFaces).toContain(other);
    // Texture coordinates are millimetres along the face: the far corner of the sheet is (200, 200).
    const uv = Array.from({ length: data.uvs.length / 2 }, (_, i) => [data.uvs[i * 2], data.uvs[i * 2 + 1]].join(','));
    expect(uv).toContain('200,200');
  });

  it('textures run level along walls and upright, and along the axes on level faces', () => {
    expect(faceUVAxes([0, 0, 1])).toEqual({ u: [1, 0, 0], v: [0, 1, 0] });
    const wall = faceUVAxes([0, -1, 0]);
    expect(wall.u[2]).toBeCloseTo(0, 12);
    expect(wall.v[2]).toBeCloseTo(1, 12);
    const slope = faceUVAxes([0, -Math.SQRT1_2, Math.SQRT1_2]);
    expect(slope.u[2]).toBeCloseTo(0, 12);
    expect(slope.v[2]).toBeGreaterThan(0);
  });
});
