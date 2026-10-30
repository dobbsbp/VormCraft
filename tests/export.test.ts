import { beforeAll, describe, expect, it } from 'vitest';
import { buildDemoModel } from '../src/app/demoModel';
import { drawCircle, drawPolygon, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, makePlane, Model, pushPull } from '../src/core';
import { exportObj, exportStl, NotWatertightError } from '../src/io/export';
import { meshVolume, openMeshEdges, tessellate } from '../src/io/tessellate';

beforeAll(async () => {
  await initBooleanKernel();
});

const ngonArea = (r: number, n: number) => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);

function cylinder(r = 10, h = 20, segments = 24) {
  const m = new Model();
  pushPull(m, drawCircle(m, GROUND_PLANE, [0, 0, 0], r, segments).inner!, h);
  return m;
}

function boxWithHole(r = 10) {
  const m = new Model();
  pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 20);
  const top = findFaceAt(m, [1, 1, 20])!;
  pushPull(m, drawCircle(m, m.facePlane(top), [50, 50, 20], r, 24, top).inner!, -20);
  return m;
}

/** Read a binary STL back: triangle count and whether its positions form a closed mesh. */
function readStl(buf: ArrayBuffer) {
  const view = new DataView(buf);
  const n = view.getUint32(80, true);
  const key = new Map<string, number>();
  const triangles: number[] = [];
  const positions: number[] = [];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const o = 84 + t * 50 + 12 + k * 12;
      const p = [view.getFloat32(o, true), view.getFloat32(o + 4, true), view.getFloat32(o + 8, true)];
      const s = p.join(',');
      if (!key.has(s)) {
        key.set(s, positions.length / 3);
        positions.push(...p);
      }
      triangles.push(key.get(s)!);
    }
  }
  return { n, mesh: { positions, triangles } };
}

describe('tessellation for export', () => {
  it('as modelled: a box is 12 triangles and closed', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 20).inner!, 30);
    const mesh = tessellate(m);
    expect(mesh.triangles.length / 3).toBe(12);
    expect(openMeshEdges(mesh)).toBe(0);
    expect(meshVolume(mesh)).toBeCloseTo(6000);
  });

  it('refines a cylinder to the true radius and stays closed', () => {
    const m = cylinder(10, 20, 24);
    const coarse = tessellate(m);
    expect(meshVolume(coarse)).toBeCloseTo(ngonArea(10, 24) * 20);
    const fine = tessellate(m, m.faces.keys(), { maxDeviation: 0.01 });
    expect(openMeshEdges(fine)).toBe(0);
    expect(fine.triangles.length).toBeGreaterThan(coarse.triangles.length * 3);
    // 0.01 mm on r = 10 needs 3 sub-segments per modelled segment: exactly a 72-gon prism, so no
    // facet may cut across the arc (regression: slivers along the rims lost volume).
    expect(meshVolume(fine)).toBeCloseTo(ngonArea(10, 72) * 20, 6);
    const exact = Math.PI * 100 * 20;
    expect(Math.abs(meshVolume(fine) - exact) / exact).toBeLessThan(0.0015);
    // Every vertex lies on the true cylinder (or on an axis cap plane).
    for (let i = 0; i < fine.positions.length; i += 3) {
      const r = Math.hypot(fine.positions[i], fine.positions[i + 1]);
      expect(r).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('a coarser deviation gives fewer triangles', () => {
    const m = cylinder(10, 20, 24);
    const a = tessellate(m, m.faces.keys(), { maxDeviation: 0.1 }).triangles.length;
    const b = tessellate(m, m.faces.keys(), { maxDeviation: 0.001 }).triangles.length;
    expect(b).toBeGreaterThan(a);
  });

  it('a refined through-hole stays watertight and approaches the true volume', () => {
    const m = boxWithHole(10);
    const mesh = tessellate(m, m.faces.keys(), { maxDeviation: 0.005 });
    expect(openMeshEdges(mesh)).toBe(0);
    const exact = 100 * 100 * 20 - Math.PI * 100 * 20;
    expect(Math.abs(meshVolume(mesh) - exact) / exact).toBeLessThan(1e-4);
  });

  it('a hole leaving through a sloped face is refined on both rims and stays closed', () => {
    const m = new Model();
    const xz = makePlane([0, 0, 0], [0, 1, 0], [1, 0, 0]);
    const profile = drawPolygon(m, xz, [
      [0, 0, 0],
      [100, 0, 20],
      [100, 0, 40],
      [0, 0, 40],
    ]).inner!;
    pushPull(m, profile, 50);
    const top = findFaceAt(m, [1, 1, 40])!;
    pushPull(m, drawCircle(m, m.facePlane(top), [50, 25, 40], 8, 24, top).inner!, -40);
    const mesh = tessellate(m, m.faces.keys(), { maxDeviation: 0.005 });
    expect(openMeshEdges(mesh)).toBe(0);
    // Wedge minus a true cylinder whose bottom follows the slope (mean depth 30 at the axis).
    const exact = 50 * 3000 - Math.PI * 64 * 30;
    expect(Math.abs(meshVolume(mesh) - exact) / exact).toBeLessThan(1e-4);
  });

  it('the demo part (hole, pocket, boss) refines to a closed mesh', () => {
    const m = buildDemoModel();
    expect(openMeshEdges(tessellate(m, m.faces.keys(), { maxDeviation: 0.01 }))).toBe(0);
  });
});

describe('STL export', () => {
  it('writes binary STL that reads back closed', () => {
    const m = boxWithHole();
    const { data, triangles, report } = exportStl(m, { maxDeviation: 0.05 });
    expect(report.watertight).toBe(true);
    expect(data.byteLength).toBe(84 + triangles * 50);
    const back = readStl(data);
    expect(back.n).toBe(triangles);
    expect(openMeshEdges(back.mesh)).toBe(0);
    expect(new TextDecoder().decode(data.slice(0, 30))).toBe('VormCraft binary STL, units: m');
  });

  it('refuses a model that is not watertight, unless told to export anyway', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 10, 10);
    expect(() => exportStl(m)).toThrow(NotWatertightError);
    expect(() => exportStl(m)).toThrow(/4 open edges/);
    expect(exportStl(m, { allowOpen: true }).triangles).toBe(2);
  });

  it('refuses an empty model', () => {
    expect(() => exportStl(new Model())).toThrow(/empty/);
  });
});

describe('OBJ export', () => {
  it('writes vertices and 1-based triangle faces', () => {
    const m = cylinder(5, 10, 12);
    const text = exportObj(m, { maxDeviation: 0.05 }, 'my part');
    const lines = text.trim().split('\n');
    expect(lines).toContain('o my_part');
    const v = lines.filter((l) => l.startsWith('v '));
    const f = lines.filter((l) => l.startsWith('f '));
    const mesh = tessellate(m, m.faces.keys(), { maxDeviation: 0.05 });
    expect(v).toHaveLength(mesh.positions.length / 3);
    expect(f).toHaveLength(mesh.triangles.length / 3);
    const indices = f.flatMap((l) => l.slice(2).split(' ').map(Number));
    expect(Math.min(...indices)).toBe(1);
    expect(Math.max(...indices)).toBe(v.length);
  });
});
