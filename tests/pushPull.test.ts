import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkWatertight,
  drawCircle,
  drawPolygon,
  drawRectangle,
  faceArea,
  GROUND_PLANE,
  initBooleanKernel,
  makePlane,
  newellNormal,
  signedDistance,
  Model,
  pushPull,
  volume,
  type FaceId,
} from '../src/core';

beforeAll(async () => {
  await initBooleanKernel();
});

/** Area of a regular n-gon inscribed in a circle of radius r. */
const ngonArea = (r: number, n: number) => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);

function box(w: number, d: number, h: number) {
  const m = new Model();
  const base = drawRectangle(m, GROUND_PLANE, [0, 0, 0], w, d).inner!;
  pushPull(m, base, h);
  const top = findFace(m, [0, 0, 1], h);
  return { m, top };
}

/** The face with this outward normal whose plane is at `offset` along it. */
function findFace(m: Model, normal: [number, number, number], offset: number): FaceId {
  const f = [...m.faces.values()].find((f) => {
    const p = m.facePlane(f.id);
    const dotN = f.normal[0] * normal[0] + f.normal[1] * normal[1] + f.normal[2] * normal[2];
    const at = p.origin[0] * normal[0] + p.origin[1] * normal[1] + p.origin[2] * normal[2];
    return dotN > 0.999999 && Math.abs(at - offset) < 1e-6;
  });
  if (!f) throw new Error(`No face facing ${normal} at ${offset}`);
  return f.id;
}

function expectSolid(m: Model, genus = 0) {
  m.validate();
  const report = checkWatertight(m);
  expect(report.openEdges).toEqual([]);
  expect(report.degenerateFaces).toEqual([]);
  expect(report.watertight).toBe(true);
  expect(report.genus).toBe(genus);
  // Exact planarity: Manifold works in float32, so this catches any unrefined vertex.
  let worst = 0;
  for (const f of m.faces.keys()) {
    const plane = m.facePlane(f);
    for (const v of m.faceVertexLoops(f).flat()) worst = Math.max(worst, Math.abs(signedDistance(plane, m.pos(v))));
  }
  expect(worst).toBeLessThan(1e-9);
  // Outward orientation: positive volume, and stored normals agree with the loop winding.
  expect(volume(m)).toBeGreaterThan(0);
  for (const f of m.faces.values()) {
    const ring = m.loopVertices(f.outer).map((v) => m.pos(v));
    const n = newellNormal(ring);
    expect(n[0] * f.normal[0] + n[1] * f.normal[1] + n[2] * f.normal[2]).toBeGreaterThan(0.999999);
  }
}

describe('extruding a free face', () => {
  it('a rectangle extruded to a box gives 6 faces', () => {
    const m = new Model();
    const rect = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 50).inner!;
    const r = pushPull(m, rect, 30);
    expect(r.mode).toBe('extrude');
    expect(r.face).toBe(rect);
    expect(m.faces.size).toBe(6);
    expect([...m.edges()]).toHaveLength(12);
    expect(m.vertices.size).toBe(8);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(150000);
    expect(m.face(rect).normal).toEqual([0, 0, 1]);
  });

  it('pushing a free face backwards extrudes behind it and keeps the original as the top', () => {
    const m = new Model();
    const rect = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10).inner!;
    pushPull(m, rect, -5);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(500);
    expect(findFace(m, [0, 0, 1], 0)).toBeDefined();
    expect(findFace(m, [0, 0, -1], 5)).toBeDefined();
  });

  it('a circle extrudes to a cylinder with true-radius edges on both ends', () => {
    const m = new Model();
    const disc = drawCircle(m, GROUND_PLANE, [0, 0, 0], 10, 24).inner!;
    pushPull(m, disc, 20);
    expectSolid(m);
    expect(m.faces.size).toBe(26);
    expect(volume(m)).toBeCloseTo(ngonArea(10, 24) * 20);
    const centers = [...m.curves.values()].map((c) => c.center[2]).sort();
    expect(centers).toEqual([0, 20]);
    for (const c of m.curves.values()) expect(c.radius).toBe(10);
  });

  it('a face with a hole extrudes to a tube', () => {
    const m = new Model();
    const host = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 40, 40).inner!;
    const hole = drawRectangle(m, GROUND_PLANE, [10, 10, 0], 20, 20, host).inner!;
    m.removeFace(hole);
    m.purgeFree();
    const ring = [...m.faces.keys()][0];
    pushPull(m, ring, 10);
    expectSolid(m, 1);
    expect(volume(m)).toBeCloseTo((1600 - 400) * 10);
  });
});

describe('push/pull on a solid', () => {
  it('pulling the top face of a box up just makes it taller (still 6 faces)', () => {
    const { m, top } = box(10, 20, 30);
    const r = pushPull(m, top, 15);
    expect(r.mode).toBe('boolean');
    expect(r.face).toBe(top);
    expectSolid(m);
    expect(m.faces.size).toBe(6);
    expect(m.vertices.size).toBe(8);
    expect(volume(m)).toBeCloseTo(10 * 20 * 45);
    expect(findFace(m, [0, 0, 1], 45)).toBe(top);
  });

  it('pushing the top face of a box down part-way makes it shorter (still 6 faces)', () => {
    const { m, top } = box(10, 20, 30);
    pushPull(m, top, -12);
    expectSolid(m);
    expect(m.faces.size).toBe(6);
    expect(m.vertices.size).toBe(8);
    expect(volume(m)).toBeCloseTo(10 * 20 * 18);
  });

  it('pushing the top face all the way down removes the solid', () => {
    const { m, top } = box(10, 20, 30);
    pushPull(m, top, -30);
    expect(m.faces.size).toBe(0);
  });

  it('pulling a rectangle drawn on top adds a boss', () => {
    const { m, top } = box(100, 100, 20);
    const rect = drawRectangle(m, m.facePlane(top), [20, 20, 20], 30, 30, top).inner!;
    const r = pushPull(m, rect, 10);
    expect(r.face).toBe(rect);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(100 * 100 * 20 + 30 * 30 * 10);
    expect(m.faces.size).toBe(6 + 5);
  });

  it('pushing a rectangle drawn on top makes a pocket', () => {
    const { m, top } = box(100, 100, 20);
    const rect = drawRectangle(m, m.facePlane(top), [20, 20, 20], 30, 30, top).inner!;
    const r = pushPull(m, rect, -8);
    expect(r.mode).toBe('boolean');
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(100 * 100 * 20 - 30 * 30 * 8);
    expect(m.faces.size).toBe(6 + 5);
    expect(faceArea(m, findFace(m, [0, 0, 1], 12))).toBeCloseTo(900);
    expect(m.face(findFace(m, [0, 0, 1], 20)).holes).toHaveLength(1);
  });
});

describe('push-through', () => {
  it('a circle pushed flush through a box gives a through-hole and a watertight solid', () => {
    const { m, top } = box(100, 100, 20);
    const disc = drawCircle(m, m.facePlane(top), [50, 50, 20], 10, 24, top).inner!;
    const r = pushPull(m, disc, -20);
    expect(r.mode).toBe('flush-through');
    expectSolid(m, 1);
    expect(volume(m)).toBeCloseTo(100 * 100 * 20 - ngonArea(10, 24) * 20);
    expect(m.faces.size).toBe(6 + 24);
    expect(m.face(findFace(m, [0, 0, 1], 20)).holes).toHaveLength(1);
    expect(m.face(findFace(m, [0, 0, -1], 0)).holes).toHaveLength(1);
    // Both rims keep their true circle for STEP export.
    const rimCenters = new Set<number>();
    for (const e of m.edges()) {
      const c = m.he(e).curve;
      if (c !== null) rimCenters.add(m.curves.get(c)!.center[2]);
    }
    expect([...rimCenters].sort()).toEqual([0, 20]);
  });

  it('a rectangle pushed flush through gives a rectangular through-hole', () => {
    const { m, top } = box(60, 40, 10);
    const rect = drawRectangle(m, m.facePlane(top), [10, 10, 10], 20, 10, top).inner!;
    expect(pushPull(m, rect, -10).mode).toBe('flush-through');
    expectSolid(m, 1);
    expect(volume(m)).toBeCloseTo(60 * 40 * 10 - 200 * 10);
  });

  it('pushing past the far face also cuts through', () => {
    const { m, top } = box(60, 40, 10);
    const disc = drawCircle(m, m.facePlane(top), [30, 20, 10], 5, 16, top).inner!;
    expect(pushPull(m, disc, -25).mode).toBe('boolean');
    expectSolid(m, 1);
    expect(volume(m)).toBeCloseTo(60 * 40 * 10 - ngonArea(5, 16) * 10, 2);
  });

  it('an angled cut-through (sloped far side) gives a watertight solid', () => {
    // A wedge: profile in the XZ plane (bottom slopes from z=0 to z=20), extruded 50 along +Y.
    const m = new Model();
    const xz = makePlane([0, 0, 0], [0, 1, 0], [1, 0, 0]);
    const profile = drawPolygon(m, xz, [
      [0, 0, 0],
      [100, 0, 20],
      [100, 0, 40],
      [0, 0, 40],
    ]).inner!;
    pushPull(m, profile, 50);
    expectSolid(m);
    const top = findFace(m, [0, 0, 1], 40);
    const disc = drawCircle(m, m.facePlane(top), [50, 25, 40], 8, 24, top).inner!;
    const r = pushPull(m, disc, -40);
    expect(r.mode).toBe('boolean');
    expectSolid(m, 1);
    // The hole goes through the slope: bottom face now has an (elliptical) hole.
    const sloped = [...m.faces.values()].find((f) => f.normal[2] < -0.1 && Math.abs(f.normal[0]) > 0.1)!;
    expect(sloped.holes).toHaveLength(1);
    // Volume: wedge minus a cylinder whose bottom follows the slope (mean depth at the axis).
    const wedge = 50 * (4000 - 1000); // profile area: integral of (40 - 0.2x) over x in [0, 100]
    const depthAtAxis = 40 - 0.2 * 50;
    expect(volume(m)).toBeCloseTo(wedge - ngonArea(8, 24) * depthAtAxis, 1);
  });

  it('a push that stops inside the solid does not make a hole', () => {
    const { m, top } = box(60, 40, 10);
    const disc = drawCircle(m, m.facePlane(top), [30, 20, 10], 5, 16, top).inner!;
    pushPull(m, disc, -9);
    expectSolid(m, 0);
  });
});

describe('watertight check', () => {
  it('reports the open edges of a lone face', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10);
    const r = checkWatertight(m);
    expect(r.watertight).toBe(false);
    expect(r.openEdges).toHaveLength(4);
  });

  it('reports an open box (one face deleted)', () => {
    const { m, top } = box(10, 10, 10);
    m.removeFace(top);
    const r = checkWatertight(m);
    expect(r.watertight).toBe(false);
    expect(r.openEdges).toHaveLength(4);
  });
});

describe('operations touching face boundaries', () => {
  it('a strip drawn edge-to-edge on top splits the neighbouring side faces too', () => {
    const { m, top } = box(100, 50, 20);
    const strip = drawRectangle(m, m.facePlane(top), [40, 0, 20], 20, 50, top).inner!;
    expectSolid(m);
    expect(m.faces.size).toBe(8);
    const front = findFace(m, [0, -1, 0], 0);
    expect(m.loopVertices(m.face(front).outer)).toHaveLength(6);
    // Pushing the strip down makes a slot across the top.
    pushPull(m, strip, -5);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(100 * 50 * 20 - 20 * 50 * 5);
    // Pulling it back up flush restores the box; the strip's drawn edges stay, as in SketchUp.
    const floor = findFace(m, [0, 0, 1], 15);
    expect(pushPull(m, floor, 5).face).toBe(floor);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(100 * 50 * 20);
    expect(m.faces.size).toBe(8);
    expect(m.vertices.size).toBe(12);
  });

  it('a circle on a side face pushes flush through horizontally', () => {
    const { m } = box(40, 30, 20);
    const side = findFace(m, [1, 0, 0], 40);
    const disc = drawCircle(m, m.facePlane(side), [40, 15, 10], 4, 20, side).inner!;
    expect(pushPull(m, disc, -40).mode).toBe('flush-through');
    expectSolid(m, 1);
  });

  it('two holes in a row give genus 2', () => {
    const { m, top } = box(100, 40, 10);
    const a = drawCircle(m, m.facePlane(top), [25, 20, 10], 5, 16, top);
    pushPull(m, a.inner!, -10);
    const top2 = findFace(m, [0, 0, 1], 10);
    const b = drawCircle(m, m.facePlane(top2), [75, 20, 10], 5, 16, top2);
    pushPull(m, b.inner!, -10);
    expectSolid(m, 2);
  });

  it('a boss pulled up from a pocket floor keeps the solid valid', () => {
    const { m, top } = box(100, 100, 30);
    const pocket = drawRectangle(m, m.facePlane(top), [10, 10, 30], 80, 80, top).inner!;
    pushPull(m, pocket, -20);
    const floor = findFace(m, [0, 0, 1], 10);
    const post = drawCircle(m, m.facePlane(floor), [50, 50, 10], 10, 24, floor).inner!;
    pushPull(m, post, 40);
    expectSolid(m);
    expect(volume(m)).toBeCloseTo(100 * 100 * 30 - 80 * 80 * 20 + ngonArea(10, 24) * 40, 1);
  });
});

describe('model', () => {
  it('clone is independent of the original', () => {
    const { m, top } = box(10, 10, 10);
    const copy = m.clone();
    pushPull(m, top, 5);
    copy.validate();
    expect(volume(copy)).toBeCloseTo(1000);
    expect(volume(m)).toBeCloseTo(1500);
  });

  it('refuses a face that would reuse a directed edge', () => {
    const m = new Model();
    const a = m.addVertex([0, 0, 0]);
    const b = m.addVertex([1, 0, 0]);
    const c = m.addVertex([0, 1, 0]);
    const d = m.addVertex([1, 1, 0]);
    m.addFace([a, b, c]);
    expect(() => m.addFace([a, b, d])).toThrow(/already bounds/);
    m.validate();
  });
});
