import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkWatertight,
  drawCircle,
  drawPolygon,
  drawRectangle,
  faceArea,
  findFaceAt,
  GROUND_PLANE,
  initBooleanKernel,
  Model,
  offsetFace,
  offsetRing2D,
  pushPull,
} from '../src/core';

beforeAll(async () => {
  await initBooleanKernel();
});

const areas = (m: Model, faces: number[]) => faces.map((f) => faceArea(m, f)).sort((a, b) => a - b);

describe('offsetRing2D', () => {
  it('moves a CCW square inward for positive distances', () => {
    const sq: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(offsetRing2D(sq, 2)).toEqual([
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
    ].map((p) => [expect.closeTo(p[0]), expect.closeTo(p[1])]));
    const out = offsetRing2D(sq, -1);
    expect(out[0][0]).toBeCloseTo(-1);
    expect(out[2][1]).toBeCloseTo(11);
  });

  it('handles concave corners with mitres (L shape)', () => {
    const L: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [10, 10],
      [10, 20],
      [0, 20],
    ];
    const off = offsetRing2D(L, 2);
    expect(off[3][0]).toBeCloseTo(8);
    expect(off[3][1]).toBeCloseTo(8);
  });
});

describe('offset tool geometry', () => {
  it('inward offset of a rectangle splits it into a ring and a smaller rectangle', () => {
    const m = new Model();
    const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 60).inner!;
    const faces = offsetFace(m, f, 10);
    m.validate();
    expect(faces).toHaveLength(2);
    expect(areas(m, faces)).toEqual([expect.closeTo(6000 - 3200), expect.closeTo(80 * 40)]);
  });

  it('inward offset of a circle keeps a true circle of radius r - d', () => {
    const m = new Model();
    const f = drawCircle(m, GROUND_PLANE, [0, 0, 0], 20, 24).inner!;
    offsetFace(m, f, 5);
    m.validate();
    const radii = [...new Set([...m.edges()].map((e) => m.curves.get(m.he(e).curve!)!.radius))].sort((a, b) => a - b);
    expect(radii).toEqual([15, 20]);
    const inner = findFaceAt(m, [0, 0, 0])!;
    expect(m.faceVertexLoops(inner)[0]).toHaveLength(24);
  });

  it('inward offset of a face with a hole grows the hole too', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const hole = drawRectangle(m, GROUND_PLANE, [40, 40, 0], 20, 20, host).inner!;
    m.removeFace(hole);
    m.purgeFree();
    const ring = [...m.faces.keys()][0];
    const faces = offsetFace(m, ring, 5);
    m.validate();
    // Middle band: outer 90x90 minus hole 30x30; plus two 5mm bands.
    const band = findFaceAt(m, [20, 20, 0])!;
    expect(faceArea(m, band)).toBeCloseTo(90 * 90 - 30 * 30);
    expect(faces).toHaveLength(3);
  });

  it('works on an L-shaped (concave) face', () => {
    const m = new Model();
    const f = drawPolygon(m, GROUND_PLANE, [
      [0, 0, 0],
      [20, 0, 0],
      [20, 10, 0],
      [10, 10, 0],
      [10, 20, 0],
      [0, 20, 0],
    ]).inner!;
    const faces = offsetFace(m, f, 2);
    m.validate();
    // Inner L: 16x6 + 6x10 strips = 156; the 2mm band is the rest of the 300mm² L.
    expect(areas(m, faces)).toEqual([expect.closeTo(300 - 156), expect.closeTo(156)]);
  });

  it('refuses an offset larger than the face', () => {
    const m = new Model();
    const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    expect(() => offsetFace(m, f, 6)).toThrow(/too large/);
    const c = drawCircle(m, GROUND_PLANE, [50, 50, 0], 5, 12).inner!;
    expect(() => offsetFace(m, c, 5)).toThrow(/larger than the circle/);
  });

  it('outward offset of a lone face adds a ring face around it', () => {
    const m = new Model();
    const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    const faces = offsetFace(m, f, -2);
    m.validate();
    expect(faces).toHaveLength(2);
    expect(areas(m, faces)).toEqual([expect.closeTo(14 * 14 - 100), expect.closeTo(100)]);
  });

  it('outward offset of a rectangle on a box top is drawn on the surrounding face', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 20);
    const top = findFaceAt(m, [1, 1, 20])!;
    const rect = drawRectangle(m, m.facePlane(top), [40, 40, 20], 20, 20, top).inner!;
    offsetFace(m, rect, -5);
    m.validate();
    expect(checkWatertight(m).watertight).toBe(true);
    expect(faceArea(m, findFaceAt(m, [37, 50, 20])!)).toBeCloseTo(30 * 30 - 20 * 20);
    expect(faceArea(m, findFaceAt(m, [50, 50, 20])!)).toBeCloseTo(400);
  });

  it('outward offset past the edge of a solid face is refused', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 20);
    const top = findFaceAt(m, [1, 1, 20])!;
    expect(() => offsetFace(m, top, -5)).toThrow(/past the edge/);
  });

  it('an inward offset on a box top then pushed down makes a shelled tray', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 80).inner!, 30);
    const top = findFaceAt(m, [1, 1, 30])!;
    offsetFace(m, top, 3);
    const inner = findFaceAt(m, [50, 40, 30])!;
    pushPull(m, inner, -27);
    m.validate();
    const r = checkWatertight(m);
    expect(r.watertight).toBe(true);
    expect(r.genus).toBe(0);
  });
});
