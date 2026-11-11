import { describe, expect, it } from 'vitest';
import { checkWatertight, volume } from '../src/core';
import { signedArea } from '../src/core/math/polygon2d';
import { isSoftEdge } from '../src/core/model/surfaces';
import { nestOutlines, simplifyRing, textModel, traceOutlines, type CoverageGrid } from '../src/core/ops/text3d';

/** A bitmap drawn by a coverage function (0..1 per pixel, sampled 4 × 4 for smooth edges). */
function grid(w: number, h: number, ink: (x: number, y: number) => boolean): CoverageGrid {
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (ink(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++;
      data[y * w + x] = Math.round((n / 16) * 255);
    }
  }
  return { width: w, height: h, data };
}

const ring = (cx: number, cy: number, r0: number, r1: number) => (x: number, y: number) => {
  const d = Math.hypot(x - cx, y - cy);
  return d >= r0 && d <= r1;
};

describe('3D text outlines', () => {
  it('traces a ring as one letter with one hole, smooth and the right size', () => {
    const rings = traceOutlines(grid(100, 100, ring(50, 50, 20, 40)));
    expect(rings).toHaveLength(2);
    const regions = nestOutlines(rings.map((r) => simplifyRing(r, 0.3)));
    expect(regions).toHaveLength(1);
    expect(regions[0].holes).toHaveLength(1);
    expect(signedArea(regions[0].outer)).toBeGreaterThan(0);
    expect(signedArea(regions[0].holes[0])).toBeLessThan(0);
    const area = signedArea(regions[0].outer) + signedArea(regions[0].holes[0]);
    expect(area).toBeGreaterThan(Math.PI * (40 ** 2 - 20 ** 2) * 0.97);
    expect(area).toBeLessThan(Math.PI * (40 ** 2 - 20 ** 2) * 1.03);
    // Simplified, but still plenty of points for a smooth curve.
    expect(regions[0].outer.length).toBeGreaterThan(16);
    expect(regions[0].outer.length).toBeLessThan(rings[0].length);
  });

  it('keeps separate letters apart, and a dot inside a hole is a letter again', () => {
    const ink = (x: number, y: number) => ring(30, 30, 15, 25)(x, y) || Math.hypot(x - 30, y - 30) < 5 || (x > 70 && x < 90 && y > 10 && y < 50);
    const regions = nestOutlines(traceOutlines(grid(100, 60, ink)));
    expect(regions).toHaveLength(3);
    expect(regions.map((r) => r.holes.length).sort()).toEqual([0, 0, 1]);
  });

  it('pushes letters into closed solids with softened curved sides', () => {
    const regions = nestOutlines(traceOutlines(grid(100, 100, ring(50, 50, 20, 40))).map((r) => simplifyRing(r, 0.3)));
    const m = textModel(regions, 0.5, 10);
    expect(checkWatertight(m).watertight).toBe(true);
    const flat = (signedArea(regions[0].outer) + signedArea(regions[0].holes[0])) * 0.25;
    expect(volume(m)).toBeCloseTo(flat * 10, 0);
    expect([...m.edges()].some((e) => isSoftEdge(m, e))).toBe(true);
    // Depth 0: flat faces only.
    expect(textModel(regions, 0.5, 0).faces.size).toBe(1);
  });
});
