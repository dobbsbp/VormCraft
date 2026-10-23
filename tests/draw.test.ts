import { describe, expect, it } from 'vitest';
import { faceArea } from '../src/core/check/measure';
import { GROUND_PLANE, makePlane } from '../src/core/math/plane';
import { Model } from '../src/core/model/Model';
import { drawCircle, drawPolygon, drawRectangle } from '../src/core/ops/draw';
import { imprintSegments } from '../src/core/ops/imprint';

describe('drawing on the ground plane', () => {
  it('a rectangle becomes one face with 4 edges, normal +Z', () => {
    const m = new Model();
    const { faces, inner } = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 50);
    m.validate();
    expect(faces).toHaveLength(1);
    expect(inner).toBe(faces[0]);
    expect(m.faces.size).toBe(1);
    expect([...m.edges()]).toHaveLength(4);
    expect(m.face(faces[0]).normal).toEqual([0, 0, 1]);
    expect(faceArea(m, faces[0])).toBeCloseTo(5000);
  });

  it('negative width/length still gives a +Z face', () => {
    const m = new Model();
    const { faces } = drawRectangle(m, GROUND_PLANE, [0, 0, 0], -10, 20);
    expect(m.face(faces[0]).normal).toEqual([0, 0, 1]);
    expect(faceArea(m, faces[0])).toBeCloseTo(200);
  });

  it('a circle stores its true radius on every edge', () => {
    const m = new Model();
    const { faces } = drawCircle(m, GROUND_PLANE, [5, 5, 0], 10, 24);
    m.validate();
    expect(m.faceVertexLoops(faces[0])[0]).toHaveLength(24);
    const curves = new Set([...m.edges()].map((e) => m.he(e).curve));
    expect(curves.size).toBe(1);
    const curve = m.curves.get([...curves][0]!)!;
    expect(curve.radius).toBe(10);
    expect(curve.center).toEqual([5, 5, 0]);
  });
});

describe('splitting faces', () => {
  it('a rectangle inside a face splits it into an outer face with a hole and an inner face', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const { faces, inner } = drawRectangle(m, GROUND_PLANE, [20, 20, 0], 30, 40, host);
    m.validate();
    expect(faces).toHaveLength(2);
    expect(m.faces.size).toBe(2);
    expect(inner).toBeDefined();
    const outer = faces.find((f) => f !== inner)!;
    expect(m.face(outer).holes).toHaveLength(1);
    expect(faceArea(m, outer)).toBeCloseTo(10000 - 1200);
    expect(faceArea(m, inner!)).toBeCloseTo(1200);
    expect(m.face(inner!).normal).toEqual([0, 0, 1]);
  });

  it('a circle inside a face gives an outer face with a hole plus an inner circle face', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const { faces, inner } = drawCircle(m, GROUND_PLANE, [50, 50, 0], 10, 24, host);
    m.validate();
    expect(faces).toHaveLength(2);
    const outer = faces.find((f) => f !== inner)!;
    expect(m.face(outer).holes).toHaveLength(1);
    const polyArea = 0.5 * 24 * 100 * Math.sin((2 * Math.PI) / 24);
    expect(faceArea(m, inner!)).toBeCloseTo(polyArea);
    expect(faceArea(m, outer)).toBeCloseTo(10000 - polyArea);
  });

  it('a line across a face splits it in two and splits the boundary edges', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const faces = imprintSegments(m, host, [{ a: [40, -10, 0], b: [40, 110, 0] }]);
    m.validate();
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => faceArea(m, f)).sort((a, b) => a - b)).toEqual([expect.closeTo(4000), expect.closeTo(6000)]);
    expect([...m.edges()]).toHaveLength(7);
  });

  it('a rectangle sharing an edge with the host splits it into two faces (no hole)', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const { faces, inner } = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 30, 100, host);
    m.validate();
    expect(faces).toHaveLength(2);
    expect(faces.every((f) => m.face(f).holes.length === 0)).toBe(true);
    expect(faceArea(m, inner!)).toBeCloseTo(3000);
  });

  it('a rectangle overhanging the face is clipped to it', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const { faces } = drawRectangle(m, GROUND_PLANE, [80, 20, 0], 50, 30, host);
    m.validate();
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => faceArea(m, f)).sort((a, b) => a - b)).toEqual([expect.closeTo(600), expect.closeTo(9400)]);
  });

  it('a dangling line does not split the face', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    expect(imprintSegments(m, host, [{ a: [10, 10, 0], b: [50, 50, 0] }])).toEqual([host]);
    expect([...m.edges()]).toHaveLength(4);
    m.validate();
  });

  it('drawing inside an inner face of a face with a hole keeps the hole', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    drawRectangle(m, GROUND_PLANE, [40, 40, 0], 20, 20, host);
    const outer = [...m.faces.values()].find((f) => f.holes.length === 1)!.id;
    const r = drawCircle(m, GROUND_PLANE, [15, 15, 0], 5, 12, outer);
    m.validate();
    expect(r.faces).toHaveLength(2);
    const ring = r.faces.find((f) => f !== r.inner)!;
    expect(m.face(ring).holes).toHaveLength(2);
  });

  it('works on a tilted face plane', () => {
    const m = new Model();
    const plane = makePlane([0, 0, 0], [1, 1, 1]);
    const p = (x: number, y: number) => [0, 0, 0].map((_, i) => x * plane.u[i] + y * plane.v[i]) as unknown as [number, number, number];
    const host = drawPolygon(m, plane, [p(0, 0), p(10, 0), p(10, 10), p(0, 10)]).inner!;
    const r = drawCircle(m, plane, p(5, 5), 2, 16, host);
    m.validate();
    expect(r.faces).toHaveLength(2);
    expect(m.face(r.inner!).normal[0]).toBeCloseTo(1 / Math.sqrt(3));
  });

  it('a shape drawn around an existing hole makes a ring face around the hole (regression)', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    const hole = drawRectangle(m, GROUND_PLANE, [40, 40, 0], 20, 20, host).inner!;
    m.removeFace(hole);
    m.purgeFree();
    const outer = [...m.faces.keys()][0];
    const r = drawRectangle(m, GROUND_PLANE, [30, 30, 0], 40, 40, outer);
    m.validate();
    expect(r.faces).toHaveLength(2);
    expect(faceArea(m, r.inner!)).toBeCloseTo(1600 - 400);
    expect(m.face(r.inner!).holes).toHaveLength(1);
  });
});
