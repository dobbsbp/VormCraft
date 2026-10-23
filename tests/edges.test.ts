import { beforeAll, describe, expect, it } from 'vitest';
import {
  arcAroundCenter,
  arcFromBulge,
  arcPoints,
  arcThroughPoints,
  checkWatertight,
  connectedVertices,
  distance,
  drawArc,
  drawCircle,
  drawEdges,
  drawRectangle,
  faceArea,
  findFaceAt,
  GROUND_PLANE,
  initBooleanKernel,
  makePlane,
  Model,
  pushPull,
  scalePieces,
  signedDistance,
  volume,
  type Vec3,
} from '../src/core';

beforeAll(async () => {
  await initBooleanKernel();
});

const square: Vec3[] = [
  [0, 0, 0],
  [10, 0, 0],
  [10, 10, 0],
  [0, 10, 0],
];

describe('drawing edges (Line tool core)', () => {
  it('lines closing a loop on the ground make a face, facing up', () => {
    const m = new Model();
    drawEdges(m, [square[0], square[1]]);
    drawEdges(m, [square[1], square[2]]);
    expect(m.faces.size).toBe(0);
    drawEdges(m, [square[2], square[3]]);
    const r = drawEdges(m, [square[3], square[0]]);
    m.validate();
    expect(r.faces).toHaveLength(1);
    expect(m.face(r.faces[0]).normal.map((x) => x + 0)).toEqual([0, 0, 1]);
    expect(faceArea(m, r.faces[0])).toBeCloseTo(100);
    expect([...m.edges()]).toHaveLength(4);
  });

  it('a diagonal across a face splits it in two', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10);
    const r = drawEdges(m, [square[0], square[2]]);
    m.validate();
    expect(m.faces.size).toBe(2);
    expect(r.faces).toHaveLength(2);
    expect([...m.faces.keys()].map((f) => faceArea(m, f))).toEqual([expect.closeTo(50), expect.closeTo(50)]);
  });

  it('a loose line on a face stays a loose edge until a later line closes a region', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100);
    drawEdges(m, [
      [20, 0, 0],
      [20, 50, 0],
    ]);
    expect(m.faces.size).toBe(1);
    expect([...m.edges()]).toHaveLength(6); // the bottom edge was split where the line starts
    drawEdges(m, [
      [20, 50, 0],
      [0, 50, 0],
    ]);
    m.validate();
    expect(m.faces.size).toBe(2);
    expect(faceArea(m, findFaceAt(m, [10, 25, 0])!)).toBeCloseTo(1000);
  });

  it('crossing lines split each other at the crossing', () => {
    const m = new Model();
    drawEdges(m, [
      [0, 0, 0],
      [10, 10, 0],
    ]);
    drawEdges(m, [
      [0, 10, 0],
      [10, 0, 0],
    ]);
    m.validate();
    expect([...m.edges()]).toHaveLength(4);
    expect(m.findVertex([5, 5, 0])).toBeDefined();
  });

  it('a line across the top of a box splits the top and the side faces it lands on', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 50).inner!, 20);
    drawEdges(m, [
      [40, 0, 20],
      [40, 50, 20],
    ]);
    m.validate();
    expect(m.faces.size).toBe(7);
    expect(checkWatertight(m).watertight).toBe(true);
  });

  it('works in a vertical plane (a triangle on XZ)', () => {
    const m = new Model();
    drawEdges(m, [
      [0, 0, 0],
      [10, 0, 0],
      [5, 0, 8],
      [0, 0, 0],
    ]);
    m.validate();
    expect(m.faces.size).toBe(1);
    expect(faceArea(m, [...m.faces.keys()][0])).toBeCloseTo(40);
  });

  it('a loop drawn around an existing face makes a ring face around it', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [40, 40, 0], 20, 20);
    drawEdges(m, [
      [0, 0, 0],
      [100, 0, 0],
      [100, 100, 0],
      [0, 100, 0],
      [0, 0, 0],
    ]);
    m.validate();
    expect(m.faces.size).toBe(2);
    const ring = [...m.faces.values()].find((f) => f.holes.length === 1)!;
    expect(faceArea(m, ring.id)).toBeCloseTo(10000 - 400);
  });

  it('three lines against an existing face close a neighbouring face', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10);
    drawEdges(m, [
      [10, 0, 0],
      [20, 0, 0],
      [20, 10, 0],
      [10, 10, 0],
    ]);
    m.validate();
    expect(m.faces.size).toBe(2);
    expect(faceArea(m, findFaceAt(m, [15, 5, 0])!)).toBeCloseTo(100);
  });

  it('an open path makes no face', () => {
    const m = new Model();
    drawEdges(m, square);
    expect(m.faces.size).toBe(0);
    expect([...m.edges()]).toHaveLength(3);
  });
});

describe('arcs', () => {
  it('2-point arc: ends exact, bulge at the middle, all points on the true circle', () => {
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [20, 0, 0];
    const arc = arcFromBulge(GROUND_PLANE, a, b, 5);
    const pts = arcPoints(arc, 12);
    expect(pts[0].map((x) => +x.toFixed(9) + 0)).toEqual([0, 0, 0]);
    expect(pts[12].map((x) => +x.toFixed(9) + 0)).toEqual([20, 0, 0]);
    expect(pts[6][1]).toBeCloseTo(5); // positive bulge is to the left of a→b (+Y here)
    expect(arc.radius).toBeCloseTo(12.5);
    for (const p of pts) expect(distance(p, arc.plane.origin)).toBeCloseTo(12.5);
    expect(arcPoints(arcFromBulge(GROUND_PLANE, a, b, -5), 12)[6][1]).toBeCloseTo(-5);
  });

  it('a bulge of half the chord is a semicircle', () => {
    const arc = arcFromBulge(GROUND_PLANE, [0, 0, 0], [20, 0, 0], 10);
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI);
    expect(arc.radius).toBeCloseTo(10);
  });

  it('a bulge bigger than half the chord sweeps more than half a circle', () => {
    const arc = arcFromBulge(GROUND_PLANE, [0, 0, 0], [20, 0, 0], 15);
    expect(Math.abs(arc.sweep)).toBeGreaterThan(Math.PI);
    const pts = arcPoints(arc, 24);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(15, 1);
  });

  it('3-point arc passes through all three points', () => {
    const a: Vec3 = [0, 0, 0];
    const m: Vec3 = [5, 5, 3];
    const b: Vec3 = [10, 0, 0];
    const arc = arcThroughPoints(a, m, b);
    for (const p of [a, m, b]) expect(distance(p, arc.plane.origin)).toBeCloseTo(arc.radius);
    const pts = arcPoints(arc, 48);
    expect(pts[0].map((x) => +x.toFixed(9) + 0)).toEqual([0, 0, 0]);
    expect(distance(pts[48], b)).toBeLessThan(1e-9);
    // The middle point lies on the drawn side of the chord.
    expect(Math.min(...pts.map((p) => distance(p, m)))).toBeLessThan(arc.radius * Math.abs(arc.sweep) / 48);
    expect(() => arcThroughPoints(a, [5, 0, 0], b)).toThrow(/in a line/);
  });

  it('centre arc sweeps the given angle', () => {
    const arc = arcAroundCenter(GROUND_PLANE, [0, 0, 0], [10, 0, 0], Math.PI / 2);
    const pts = arcPoints(arc, 6);
    expect(pts[6][0]).toBeCloseTo(0);
    expect(pts[6][1]).toBeCloseTo(10);
  });

  it('a semicircle closed by its diameter makes a half-disc face with true-curve edges', () => {
    const m = new Model();
    const a: Vec3 = [0, 0, 0];
    const b: Vec3 = [20, 0, 0];
    drawEdges(m, [a, b]);
    const r = drawArc(m, arcFromBulge(GROUND_PLANE, a, b, 10), 12);
    m.validate();
    expect(r.faces).toHaveLength(1);
    expect(faceArea(m, r.faces[0])).toBeCloseTo(0.5 * 12 * 100 * Math.sin(Math.PI / 12));
    const curved = [...m.edges()].filter((e) => m.he(e).curve !== null);
    expect(curved).toHaveLength(12);
    expect(m.curves.get(m.he(curved[0]).curve!)!.radius).toBeCloseTo(10);
  });

  it('an arc drawn across a face splits it', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100);
    drawArc(m, arcFromBulge(GROUND_PLANE, [20, 0, 0], [80, 0, 0], 20), 12);
    m.validate();
    expect(m.faces.size).toBe(2);
  });
});

describe('scale', () => {
  function box() {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 20).inner!, 30);
    return m;
  }

  it('uniform scale about a point scales the volume by the cube', () => {
    const m = box();
    scalePieces(m, connectedVertices(m, m.faces.keys(), []), [0, 0, 0], [2, 2, 2]);
    m.validate();
    expect(volume(m)).toBeCloseTo(6000 * 8);
    expect(checkWatertight(m).watertight).toBe(true);
  });

  it('per-axis scale keeps faces flat', () => {
    const m = box();
    scalePieces(m, connectedVertices(m, [[...m.faces.keys()][0]], []), [5, 5, 0], [3, 1, 0.5]);
    expect(volume(m)).toBeCloseTo(6000 * 1.5);
    for (const f of m.faces.keys()) {
      const plane = m.facePlane(f);
      for (const v of m.faceVertexLoops(f).flat()) expect(Math.abs(signedDistance(plane, m.pos(v)))).toBeLessThan(1e-9);
    }
  });

  it('a mirror (negative factor) keeps the solid outward-facing', () => {
    const m = box();
    scalePieces(m, connectedVertices(m, m.faces.keys(), []), [0, 0, 0], [-1, 1, 1]);
    m.validate();
    expect(volume(m)).toBeCloseTo(6000);
    expect(checkWatertight(m).watertight).toBe(true);
    expect(m.findVertex([-10, 20, 30])).toBeDefined();
  });

  it('circles keep their true radius under uniform scale and lose it under non-uniform', () => {
    const m = new Model();
    pushPull(m, drawCircle(m, GROUND_PLANE, [0, 0, 0], 5, 16).inner!, 10);
    const all = connectedVertices(m, m.faces.keys(), []);
    scalePieces(m, all, [0, 0, 0], [2, 2, 2]);
    expect([...m.curves.values()].map((c) => c.radius)).toEqual([10, 10]);
    scalePieces(m, all, [0, 0, 0], [1, 2, 1]);
    expect(m.curves.size).toBe(0);
    m.validate();
  });

  it('only the connected piece is scaled', () => {
    const m = box();
    drawRectangle(m, GROUND_PLANE, [100, 0, 0], 5, 5);
    const piece = connectedVertices(m, [findFaceAt(m, [5, 10, 30])!], []);
    expect(piece.size).toBe(8);
    scalePieces(m, piece, [0, 0, 0], [2, 2, 2]);
    expect(m.findVertex([105, 5, 0])).toBeDefined();
  });

  it('refuses a zero factor', () => {
    const m = box();
    expect(() => scalePieces(m, connectedVertices(m, m.faces.keys(), []), [0, 0, 0], [0, 1, 1])).toThrow(/non-zero/);
  });
});
