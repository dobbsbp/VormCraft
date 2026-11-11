import { pointInPolygon, signedArea, type Vec2 } from '../math/polygon2d';
import { dot } from '../math/vec3';
import { Model, type FaceId } from '../model/Model';
import { pushPull } from './pushPull';

/**
 * 3D text from the outline of text drawn into a bitmap (the app draws it with the computer's own
 * fonts): the outline is traced, smoothed, split into letters with holes, then made into flat faces
 * and pushed out into solids. Pure geometry, so it can be tested without a browser.
 */

/** Coverage of each pixel, 0 (empty) to 255 (ink), rows top to bottom. */
export interface CoverageGrid {
  width: number;
  height: number;
  data: ArrayLike<number>;
}

/**
 * Closed outlines where coverage crosses half (marching squares between pixel centres, with the
 * crossing placed linearly between samples, so curves come out smooth). Pixel coordinates, y down.
 */
export function traceOutlines(grid: CoverageGrid, level = 128): Vec2[][] {
  const { width: w, height: h, data } = grid;
  // One empty pixel all round, so every outline closes.
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);
  const inside = (x: number, y: number) => at(x, y) >= level;
  const cross = (ax: number, ay: number, bx: number, by: number): Vec2 => {
    const a = at(ax, ay);
    const b = at(bx, by);
    const t = a === b ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
    return [ax + (bx - ax) * t + 0.5, ay + (by - ay) * t + 0.5];
  };
  // Crossing points by edge key; each point joins exactly two segments.
  const points = new Map<string, Vec2>();
  const links = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    (links.get(a) ?? links.set(a, []).get(a)!).push(b);
    (links.get(b) ?? links.set(b, []).get(b)!).push(a);
  };
  const edgeKey = (side: 'top' | 'right' | 'bottom' | 'left', x: number, y: number): string => {
    let key: string;
    let p: Vec2;
    if (side === 'top') [key, p] = [`h${x},${y}`, cross(x, y, x + 1, y)];
    else if (side === 'bottom') [key, p] = [`h${x},${y + 1}`, cross(x, y + 1, x + 1, y + 1)];
    else if (side === 'left') [key, p] = [`v${x},${y}`, cross(x, y, x, y + 1)];
    else [key, p] = [`v${x + 1},${y}`, cross(x + 1, y, x + 1, y + 1)];
    if (!points.has(key)) points.set(key, p);
    return key;
  };
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = inside(x, y);
      const tr = inside(x + 1, y);
      const br = inside(x + 1, y + 1);
      const bl = inside(x, y + 1);
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => edgeKey('top', x, y);
      const R = () => edgeKey('right', x, y);
      const B = () => edgeKey('bottom', x, y);
      const L = () => edgeKey('left', x, y);
      switch (code) {
        case 1:
        case 14:
          link(L(), B());
          break;
        case 2:
        case 13:
          link(B(), R());
          break;
        case 3:
        case 12:
          link(L(), R());
          break;
        case 4:
        case 11:
          link(T(), R());
          break;
        case 6:
        case 9:
          link(T(), B());
          break;
        case 7:
        case 8:
          link(L(), T());
          break;
        case 5:
        case 10: {
          // A saddle: the average of the four decides whether the inside corners join up.
          const joined = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= level;
          // Joined: the outside corners are cut off (top-left and bottom-right when the inside
          // corners are top-right and bottom-left, code 5); else the inside corners are.
          if (joined === (code === 5)) {
            link(L(), T());
            link(B(), R());
          } else {
            link(T(), R());
            link(L(), B());
          }
          break;
        }
      }
    }
  }
  const rings: Vec2[][] = [];
  const used = new Set<string>();
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const ring: Vec2[] = [];
    let prev: string | null = null;
    let cur: string | null = start;
    while (cur !== null && !used.has(cur)) {
      used.add(cur);
      ring.push(points.get(cur)!);
      const next: string | undefined = links.get(cur)!.find((k) => k !== prev && !used.has(k)) ?? undefined;
      prev = cur;
      cur = next ?? null;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

const dist2Seg = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
};

/** Fewer points, none moved more than `tol` (Douglas–Peucker, on a closed ring). */
export function simplifyRing(ring: readonly Vec2[], tol: number): Vec2[] {
  if (ring.length <= 4) return [...ring];
  // Split the ring at its two points furthest apart, simplify each half.
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > best) [best, far] = [d, i];
  }
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[far] = 1;
  const t2 = tol * tol;
  const stack: [number, number][] = [
    [0, far],
    [far, ring.length],
  ];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pb = ring[b % ring.length];
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = dist2Seg(ring[i], ring[a], pb);
      if (d > worst) [worst, at] = [d, i];
    }
    if (worst > t2) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

export interface TextRegion {
  /** Counter-clockwise (y up). */
  outer: Vec2[];
  /** Clockwise. */
  holes: Vec2[][];
}

/**
 * Sort outlines into letters and their holes by how deeply each lies inside the others (the
 * inside of an "o" is a hole, a dot inside that hole would be a letter again). Turns y up, winds
 * outers counter-clockwise and holes clockwise. Outlines smaller than `minArea` are dropped.
 */
export function nestOutlines(rings: readonly Vec2[][], minArea = 1): TextRegion[] {
  const up = rings.map((r) => r.map(([x, y]): Vec2 => [x, -y])).filter((r) => Math.abs(signedArea(r)) >= minArea);
  const area = up.map((r) => Math.abs(signedArea(r)));
  const parents = up.map((r, i) => up.map((_, j) => j).filter((j) => j !== i && area[j] > area[i] && pointInPolygon(r[0], up[j], 0) !== 'outside'));
  const regions = new Map<number, TextRegion>();
  up.forEach((r, i) => {
    if (parents[i].length % 2 !== 0) return;
    regions.set(i, { outer: signedArea(r) > 0 ? r : [...r].reverse(), holes: [] });
  });
  up.forEach((r, i) => {
    if (parents[i].length % 2 === 0) return;
    // The smallest outline around a hole is its letter.
    const owner = parents[i].reduce((a, b) => (area[a] < area[b] ? a : b));
    regions.get(owner)?.holes.push(signedArea(r) < 0 ? r : [...r].reverse());
  });
  return [...regions.values()];
}

/** Seams between side faces turning less than this (radians) are soft, so curved letters look smooth. */
const SMOOTH_ANGLE = (35 * Math.PI) / 180;

/**
 * Letters as faces lying on z = 0 (scaled by `scale`, so one pixel is `scale` mm), facing up, then
 * pushed up by `depth` into solids (depth 0 leaves flat faces). The sides of curves are softened.
 */
export function textModel(regions: readonly TextRegion[], scale: number, depth: number): Model {
  const m = new Model();
  const faces: FaceId[] = [];
  for (const r of regions) {
    const ring = (pts: readonly Vec2[]) => pts.map(([x, y]) => m.addVertex([x * scale, y * scale, 0]));
    faces.push(m.addFace(ring(r.outer), r.holes.map(ring), { normal: [0, 0, 1] }));
  }
  if (depth > 0) {
    for (const f of faces) pushPull(m, f, dot(m.face(f).normal, [0, 0, 1]) > 0 ? depth : -depth);
    const cos = Math.cos(SMOOTH_ANGLE);
    for (const e of m.edges()) {
      const f = m.faceOf(e);
      const g = m.faceOf(m.he(e).twin);
      if (f === null || g === null) continue;
      const c = dot(m.face(f).normal, m.face(g).normal);
      if (c >= cos && c < 1 - 1e-9) m.setEdgeSoft(m.he(e).origin, m.dest(e), true);
    }
  }
  return m;
}
