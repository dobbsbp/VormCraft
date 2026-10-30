import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkWatertight,
  drawCircle,
  drawEdges,
  drawRectangle,
  followMe,
  GROUND_PLANE,
  initBooleanKernel,
  isSoftEdge,
  makePlane,
  Model,
  pushPull,
  volume,
  type FaceId,
  type HalfEdgeId,
  type Vec3,
} from '../src/core';
import { tessellate, openMeshEdges } from '../src/io/tessellate';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A closed outline drawn as a new face. */
function face(m: Model, pts: Vec3[]): FaceId {
  const { faces } = drawEdges(m, [...pts, pts[0]]);
  expect(faces).toHaveLength(1);
  return faces[0];
}

/** A path of loose edges through the points. */
function path(m: Model, pts: Vec3[]): HalfEdgeId[] {
  return drawEdges(m, pts).edges;
}

const ngonArea = (n: number, r: number) => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);

describe('Follow Me', () => {
  it('sweeps a square along an L path into a mitred solid (volume by Pappus)', () => {
    const m = new Model();
    // 20 x 20 profile across the start of the path, centred on it sideways.
    const p = face(m, [
      [-10, 0, 0],
      [10, 0, 0],
      [10, 0, 20],
      [-10, 0, 20],
    ]);
    const edges = path(m, [
      [0, 0, 0],
      [0, 500, 0],
      [400, 500, 0],
    ]);
    const r = followMe(m, p, edges);
    expect(r.mode).toBe('solid');
    const report = checkWatertight(m, [...m.faces.keys()]);
    expect(report.watertight).toBe(true);
    // Base, cap and a wall per profile edge per leg (the path start splits the profile's bottom edge).
    expect(m.faces.size).toBe(2 + 2 * m.faceVertexLoops(r.faces[0])[0].length);
    expect(volume(m)).toBeCloseTo(400 * 900, 3);
    // The end cap is the profile turned to face along the second leg.
    expect(m.findVertex([400, 510, 20])).toBeDefined();
    expect(m.findVertex([400, 490, 0])).toBeDefined();
    m.validate();
  });

  it('starts at the end of the path nearest the profile', () => {
    const m = new Model();
    const p = face(m, [
      [490, 0, 0],
      [510, 0, 0],
      [510, 0, 20],
      [490, 0, 20],
    ]);
    // The path is listed from its far end; the sweep still starts at the profile.
    const edges = path(m, [
      [0, 300, 0],
      [500, 300, 0],
      [500, 0, 0],
    ]);
    followMe(m, p, edges);
    expect(checkWatertight(m).watertight).toBe(true);
    expect(volume(m)).toBeCloseTo(400 * (300 + 500), 3);
  });

  it('a profile facing away from the path is turned round first', () => {
    const m = new Model();
    const p = face(m, [
      [-10, 0, 0],
      [-10, 0, 20],
      [10, 0, 20],
      [10, 0, 0],
    ]);
    expect(m.face(p).normal[1]).toBeLessThan(0);
    followMe(m, p, path(m, [[0, 0, 0], [0, 300, 0]]));
    expect(checkWatertight(m).watertight).toBe(true);
    expect(volume(m)).toBeCloseTo(400 * 300, 3);
  });

  it('a closed circular path turns a profile into a ring (lathe), with true curves', () => {
    const m = new Model();
    const circle = drawCircle(m, GROUND_PLANE, [0, 0, 0], 100, 24).inner!;
    const ring = m.faceHalfEdges(circle).map((h) => Math.min(h, m.he(h).twin));
    // A 50 x 40 profile standing on the circle, in the plane through its axis.
    const p = face(m, [
      [50, 0, 0],
      [100, 0, 0],
      [100, 0, 40],
      [50, 0, 40],
    ]);
    m.removeFace(circle); // keep just the circle's edges as the path
    const r = followMe(m, p, ring);
    expect(r.mode).toBe('solid');
    expect(m.faces.has(p)).toBe(false); // the profile is used up
    const faces = r.faces;
    expect(checkWatertight(m, faces).watertight).toBe(true);
    expect(volume(m, faces)).toBeCloseTo(40 * (ngonArea(24, 100) - ngonArea(24, 50)), 3);
    const radii = new Set([...m.curves.values()].map((c) => Math.round(c.radius)));
    expect(radii.has(50)).toBe(true);
    expect(radii.has(100)).toBe(true);
    // Refined for export, it is still closed.
    expect(openMeshEdges(tessellate(m, faces, { maxDeviation: 0.05 }))).toBe(0);
  });

  it('a profile touching the axis makes a closed cone (points on the axis stay put)', () => {
    const m = new Model();
    const circle = drawCircle(m, GROUND_PLANE, [0, 0, 0], 100, 24).inner!;
    const ring = m.faceHalfEdges(circle).map((h) => Math.min(h, m.he(h).twin));
    m.removeFace(circle);
    const p = face(m, [
      [0, 0, 0],
      [100, 0, 0],
      [0, 0, 100],
    ]);
    const r = followMe(m, p, ring);
    expect(checkWatertight(m, r.faces).watertight).toBe(true);
    expect(volume(m, r.faces)).toBeCloseTo((ngonArea(24, 100) * 100) / 3, 3);
    m.validate();
  });

  it('a round profile swept along a path gives a smooth pipe', () => {
    const m = new Model();
    const vertical = makePlane([0, 0, 50], [0, 1, 0]);
    const p = drawCircle(m, vertical, [0, 0, 50], 10, 12).inner!;
    const r = followMe(m, p, path(m, [[0, 0, 50], [0, 400, 50], [300, 400, 50]]));
    expect(checkWatertight(m).watertight).toBe(true);
    // The seams along the pipe are soft; the mitre and the rims are not.
    const soft = [...m.edges()].filter((e) => isSoftEdge(m, e));
    expect(soft).toHaveLength(12 * 2);
    // The end cap keeps a true circle.
    const capCurves = [...m.curves.values()].filter((c) => Math.abs(c.normal[0]) > 0.99);
    expect(capCurves).toHaveLength(1);
    expect(capCurves[0].radius).toBeCloseTo(10, 9);
    expect(r.faces).toHaveLength(2 + 24);
  });

  it('a profile drawn on a solid cuts a chamfer along the path', () => {
    const m = new Model();
    const base = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 200, 200).inner!;
    pushPull(m, base, 100);
    const box = volume(m);
    expect(box).toBeCloseTo(200 * 200 * 100, 3);
    // Cut the corner of the end face (x = 0) where it meets the top front edge.
    const top = 100;
    const { faces } = drawEdges(m, [
      [0, 0, 80],
      [0, 20, top],
    ]);
    const tri = faces.find((f) => m.faceVertexLoops(f)[0].length === 3)!;
    expect(tri).toBeDefined();
    const along = m.halfEdgeBetween(m.findVertex([0, 0, top])!, m.findVertex([200, 0, top])!)!;
    const r = followMe(m, tri, [Math.min(along, m.he(along).twin)]);
    expect(r.mode).toBe('boolean');
    expect(checkWatertight(m).watertight).toBe(true);
    expect(volume(m)).toBeCloseTo(box - 0.5 * 20 * 20 * 200, 0);
    expect(m.findVertex([200, 20, top])).toBeDefined();
  });

  it('a profile that is part of a sheet is swept out of it, like push/pull', () => {
    const m = new Model();
    const sheet = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 200, 200).inner!;
    const inner = drawRectangle(m, GROUND_PLANE, [50, 50, 0], 100, 100, sheet).inner!;
    const edges = path(m, [[150, 150, 0], [150, 150, 100], [150, 300, 100]]);
    const r = followMe(m, inner, edges);
    expect(r.mode).toBe('attached');
    // The sheet with its hole, 4 + 4 walls (the side walls of both legs are coplanar and merge),
    // and the end facing along the second leg.
    expect(m.faces.size).toBe(1 + 4 + 4 + 1 - 2);
    const atEnd = (f: FaceId) => m.faceVertexLoops(f)[0].every((v) => Math.abs(m.pos(v)[1] - 300) < 1e-9);
    const ends = [...m.faces.keys()].filter(atEnd);
    expect(ends).toHaveLength(1);
    expect(m.face(ends[0]).normal[1]).toBeCloseTo(1, 9);
    expect(m.findVertex([150, 300, 200])).toBeDefined();
    m.validate();
  });

  it('refuses a path through the profile, or a profile lying along the path', () => {
    const m = new Model();
    const p = face(m, [
      [0, 0, 0],
      [100, 0, 0],
      [100, 100, 0],
      [0, 100, 0],
    ]);
    const own = Math.min(m.halfEdgeBetween(m.findVertex([0, 0, 0])!, m.findVertex([100, 0, 0])!)!);
    expect(() => followMe(m, p, [own])).toThrow(/own edges/);
    const flat = path(m, [[100, 0, 0], [300, 0, 0]]);
    expect(() => followMe(m, p, flat)).toThrow(/along the path/);
  });
});

describe('Follow Me tool', () => {
  it('sweeps the clicked profile along the selected face outline (lathe), as one undo step', () => {
    const h = harness();
    const m = h.model;
    const circle = drawCircle(m, GROUND_PLANE, [0, 0, 0], 100, 24).inner!;
    const p = face(m, [
      [60, 0, 0],
      [100, 0, 0],
      [100, 0, 30],
    ]);
    use(h.controller, 'followMe');
    expect(h.controller.hint()).toMatch(/Select the path first/);
    const tool = h.controller.tool;
    expect(() => tool.pointerDown(ev(h.doc, [90, 0, 10], { face: p }))).toThrow(/Select the path first/);
    h.controller.selection.set([circle], []);
    expect(h.controller.hint()).toMatch(/profile face/);
    tool.pointerDown(ev(h.doc, [90, 0, 10], { face: p }));
    expect(m.faces.has(p)).toBe(false);
    expect(m.faces.has(circle)).toBe(true); // the path face stays
    expect(h.controller.history.undoLabel).toBe('Follow Me');
    h.controller.undo();
    expect(m.faces.has(p)).toBe(true);
  });

  it('typing a value explains there is none to type', () => {
    const h = harness();
    use(h.controller, 'followMe');
    h.controller.typed('10');
    expect(h.controller.error).toMatch(/no typed value/);
  });
});
