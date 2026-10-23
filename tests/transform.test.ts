import { beforeAll, describe, expect, it } from 'vitest';
import {
  BendError,
  checkWatertight,
  connectedVertices,
  distance,
  drawCircle,
  drawEdges,
  drawRectangle,
  duplicateVertices,
  findFaceAt,
  GROUND_PLANE,
  initBooleanKernel,
  Model,
  pushPull,
  rotation,
  selectionVertices,
  transformVertices,
  translation,
  volume,
} from '../src/core';

beforeAll(async () => {
  await initBooleanKernel();
});

function box(w = 10, d = 20, h = 30) {
  const m = new Model();
  pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], w, d).inner!, h);
  return m;
}

const all = (m: Model) => connectedVertices(m, m.faces.keys(), []);

describe('move (translate)', () => {
  it('moves a whole solid', () => {
    const m = box();
    transformVertices(m, all(m), translation([100, 50, 5]));
    m.validate();
    expect(volume(m)).toBeCloseTo(6000);
    expect(m.findVertex([110, 70, 35])).toBeDefined();
    expect(checkWatertight(m).watertight).toBe(true);
  });

  it('moving the top face up stretches the box (faces stay flat)', () => {
    const m = box();
    const top = findFaceAt(m, [5, 10, 30])!;
    transformVertices(m, selectionVertices(m, [top], []), translation([0, 0, 10]));
    m.validate();
    expect(volume(m)).toBeCloseTo(10 * 20 * 40);
  });

  it('moving one top edge up makes a wedge (the top tilts but stays flat)', () => {
    const m = box();
    const a = m.findVertex([0, 0, 30])!;
    const b = m.findVertex([10, 0, 30])!;
    transformVertices(m, new Set([a, b]), translation([0, 0, 10]));
    m.validate();
    expect(volume(m)).toBeCloseTo(6000 + (10 * 20 * 10) / 2);
    // The front edge is now higher than the back: the top face leans back (normal toward +Y).
    const top = [...m.faces.values()].find((f) => f.normal[2] > 0.5)!;
    expect(top.normal[1]).toBeGreaterThan(0);
  });

  it('sliding the top face sideways shears the box (side faces become parallelograms)', () => {
    const m = box();
    const top = findFaceAt(m, [5, 10, 30])!;
    transformVertices(m, selectionVertices(m, [top], []), translation([5, 0, 0]));
    m.validate();
    expect(volume(m)).toBeCloseTo(6000);
  });

  it('lifting one corner would warp the top face: refused, nothing changes', () => {
    const m = box();
    const before = [...m.vertices.values()].map((v) => v.pos);
    const corner = m.findVertex([10, 20, 30])!;
    expect(() => transformVertices(m, new Set([corner]), translation([0, 0, 5]))).toThrow(/bend a face/);
    expect([...m.vertices.values()].map((v) => v.pos)).toEqual(before);
    m.validate();
  });

  it('moving the top face down onto the bottom would collapse the box: refused', () => {
    const m = box();
    const top = findFaceAt(m, [5, 10, 30])!;
    expect(() => transformVertices(m, selectionVertices(m, [top], []), translation([0, 0, -30]))).toThrow(BendError);
  });

  it('a circle moved with its solid keeps its true radius at the new centre', () => {
    const m = new Model();
    pushPull(m, drawCircle(m, GROUND_PLANE, [0, 0, 0], 5, 16).inner!, 10);
    transformVertices(m, all(m), translation([20, 0, 0]));
    expect([...m.curves.values()].map((c) => c.center)).toEqual([
      [20, 0, 0],
      [20, 0, 10],
    ]);
  });
});

describe('rotate', () => {
  it('rotates a solid 90° about the blue axis', () => {
    const m = box();
    transformVertices(m, all(m), rotation([0, 0, 0], [0, 0, 1], Math.PI / 2));
    m.validate();
    expect(volume(m)).toBeCloseTo(6000);
    expect(checkWatertight(m).watertight).toBe(true);
    // (10, 0, 0) → (0, 10, 0)
    const v = [...m.vertices.values()].find((x) => distance(x.pos, [0, 10, 0]) < 1e-9);
    expect(v).toBeDefined();
    for (const f of m.faces.values()) expect(Math.hypot(...f.normal)).toBeCloseTo(1);
  });

  it('rotating a cylinder turns its circles with it', () => {
    const m = new Model();
    pushPull(m, drawCircle(m, GROUND_PLANE, [0, 0, 0], 5, 16).inner!, 10);
    transformVertices(m, all(m), rotation([0, 0, 0], [1, 0, 0], Math.PI / 2));
    const normals = [...m.curves.values()].map((c) => c.normal.map((x) => Math.round(x * 1e9) / 1e9 + 0));
    expect(normals).toEqual([
      [0, -1, 0],
      [0, -1, 0],
    ]);
    expect([...m.curves.values()].map((c) => c.radius)).toEqual([5, 5]);
  });

  it('rotating just the top face of a box (a twist) is refused', () => {
    const m = box();
    const top = findFaceAt(m, [5, 10, 30])!;
    expect(() => transformVertices(m, selectionVertices(m, [top], []), rotation([5, 10, 30], [0, 0, 1], 0.3))).toThrow(BendError);
    m.validate();
  });
});

describe('copy (duplicate)', () => {
  it('duplicates a solid, which can then be moved', () => {
    const m = box();
    const map = duplicateVertices(m, all(m));
    transformVertices(m, new Set(map.values()), translation([50, 0, 0]));
    m.validate();
    expect(m.faces.size).toBe(12);
    expect(volume(m)).toBeCloseTo(12000);
    const r = checkWatertight(m);
    expect(r.watertight).toBe(true);
    expect(r.shells).toBe(2);
  });

  it('copies loose edges and true circles too', () => {
    const m = new Model();
    drawEdges(m, [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
    ]);
    drawCircle(m, GROUND_PLANE, [50, 0, 0], 5, 12);
    const map = duplicateVertices(m, new Set(m.vertices.keys()));
    transformVertices(m, new Set(map.values()), translation([0, 100, 0]));
    m.validate();
    expect([...m.edges()]).toHaveLength(2 * (2 + 12));
    expect(m.faces.size).toBe(2);
    const centers = [...m.curves.values()].map((c) => c.center);
    expect(centers).toContainEqual([50, 100, 0]);
    expect(centers).toContainEqual([50, 0, 0]);
  });
});
