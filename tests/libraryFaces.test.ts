import { beforeAll, describe, expect, it } from 'vitest';
import { initBooleanKernel, type Model, type Vec3 } from '../src/core';
import { LIBRARY } from '../src/library';

beforeAll(async () => {
  await initBooleanKernel();
});

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

interface Flat {
  normal: Vec3;
  offset: number;
  /** Outline then holes. */
  loops: Vec3[][];
}

function flats(m: Model): Flat[] {
  return [...m.faces.keys()].map((f) => {
    const normal = m.face(f).normal;
    const loops = m.faceVertexLoops(f).map((l) => l.map((v) => m.pos(v)));
    return { normal, offset: dot(normal, loops[0][0]), loops };
  });
}

function inside(loop: [number, number][], [x, y]: [number, number]): boolean {
  let odd = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
  }
  return odd;
}

/**
 * How much two faces in nearly the same plane cover each other (mm², sampled on a grid), leaving
 * out strips under 2.5 mm wide: those are where a part's side runs a little way into another
 * part, out of sight.
 */
function overlap(a: Flat, b: Flat): number {
  const u = unit(cross(a.normal, Math.abs(a.normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const v = cross(a.normal, u);
  const flat = (f: Flat) => f.loops.map((l) => l.map((p): [number, number] => [dot(p, u), dot(p, v)]));
  const [fa, fb] = [flat(a), flat(b)];
  const range = (f: [number, number][][], k: 0 | 1) => [Math.min(...f[0].map((p) => p[k])), Math.max(...f[0].map((p) => p[k]))];
  const lo = [0, 1].map((k) => Math.max(range(fa, k as 0 | 1)[0], range(fb, k as 0 | 1)[0]));
  const hi = [0, 1].map((k) => Math.min(range(fa, k as 0 | 1)[1], range(fb, k as 0 | 1)[1]));
  if (hi[0] - lo[0] < 2.5 || hi[1] - lo[1] < 2.5) return 0;
  const n = 30;
  const inFace = (f: [number, number][][], p: [number, number]) => inside(f[0], p) && !f.slice(1).some((h) => inside(h, p));
  let hits = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p: [number, number] = [lo[0] + ((i + 0.5) * (hi[0] - lo[0])) / n, lo[1] + ((j + 0.5) * (hi[1] - lo[1])) / n];
      if (inFace(fa, p) && inFace(fb, p)) hits++;
    }
  return (hits / (n * n)) * (hi[0] - lo[0]) * (hi[1] - lo[1]);
}

describe('library items draw cleanly', () => {
  it('no part has a face lying just in front of another part\'s face (they would flicker through each other)', () => {
    const problems: string[] = [];
    for (const item of LIBRARY) {
      for (const v of item.variants ?? [undefined]) {
        const parts = item.build(v?.id).map((p) => ({ name: p.name, faces: flats(p.model) }));
        for (let i = 0; i < parts.length; i++) {
          for (let j = i + 1; j < parts.length; j++) {
            for (const a of parts[i].faces) {
              for (const b of parts[j].faces) {
                const d = dot(a.normal, b.normal);
                if (Math.abs(d) < 0.9999) continue;
                // Facing the same way: one just in front of the other (or in the same plane).
                // Facing each other: one part sunk a little way into the other, its edges just
                // under the other's surface. Touching (back to back, 0 apart) is fine.
                // (For faces facing each other, a positive depth is how far the parts overlap; a
                // negative one is an air gap, which is fine.)
                const gap = d > 0 ? Math.abs(a.offset - b.offset) : a.offset + b.offset;
                if (gap > 2.5 || (d < 0 && gap < 1e-6) || overlap(a, b) < 1) continue;
                problems.push(`${item.id}${v ? ` ${v.id}` : ''}: ${parts[i].name} / ${parts[j].name} ${gap.toFixed(2)} mm apart${d > 0 ? '' : ', sunk in'}`);
              }
            }
          }
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });
});
