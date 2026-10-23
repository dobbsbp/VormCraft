import { pointInPolygon, signedArea, type Vec2 } from '../math/polygon2d';
import type { VertexId } from './Model';

export interface FaceRings {
  outer: VertexId[];
  holes: VertexId[][];
}

/**
 * Chain directed edges into closed loops, using each edge once. The successor of a→b is the
 * outgoing edge b→w that comes first clockwise from b→a (the standard planar face walk), so with
 * the region on the left of every edge each loop is the tightest boundary, even at pinch vertices.
 */
export function traceLoops(edges: readonly (readonly [VertexId, VertexId])[], pos2: (v: VertexId) => Vec2): VertexId[][] {
  const out = new Map<VertexId, VertexId[]>();
  for (const [a, b] of edges) {
    if (!out.has(a)) out.set(a, []);
    out.get(a)!.push(b);
  }
  const key = (a: VertexId, b: VertexId) => `${a}>${b}`;
  const angle = (from: VertexId, to: VertexId) => {
    const p = pos2(from);
    const q = pos2(to);
    return Math.atan2(q[1] - p[1], q[0] - p[0]);
  };
  const successor = (a: VertexId, b: VertexId): VertexId => {
    const candidates = out.get(b);
    if (!candidates?.length) throw new Error(`Open chain at vertex ${b}`);
    const back = angle(b, a);
    let best = candidates[0];
    let bestTurn = Infinity;
    for (const w of candidates) {
      let turn = w === a ? 2 * Math.PI : back - angle(b, w);
      while (turn <= 1e-12) turn += 2 * Math.PI;
      while (turn > 2 * Math.PI) turn -= 2 * Math.PI;
      if (turn < bestTurn) {
        bestTurn = turn;
        best = w;
      }
    }
    return best;
  };
  const used = new Set<string>();
  const loops: VertexId[][] = [];
  for (const [a0, b0] of edges) {
    if (used.has(key(a0, b0))) continue;
    const ring: VertexId[] = [];
    let a = a0;
    let b = b0;
    do {
      if (used.has(key(a, b))) throw new Error(`Edge ${a}>${b} reached twice while tracing loops`);
      used.add(key(a, b));
      ring.push(a);
      const w = successor(a, b);
      a = b;
      b = w;
    } while (a !== a0 || b !== b0);
    loops.push(ring);
  }
  return loops;
}

/**
 * Turn traced loops into faces: CCW loops (positive area) are outer boundaries and CW loops are
 * holes, each hole going to the smallest outer loop that contains it. Holes contained by no outer
 * loop are returned as `orphans`.
 */
export function assembleFaces(loops: readonly VertexId[][], pos2: (v: VertexId) => Vec2): { faces: FaceRings[]; orphans: VertexId[][] } {
  const outers: { ring: VertexId[]; poly: Vec2[]; area: number; holes: VertexId[][] }[] = [];
  const holes: VertexId[][] = [];
  for (const ring of loops) {
    if (ring.length < 3) continue;
    const poly = ring.map(pos2);
    const area = signedArea(poly);
    if (area > 0) outers.push({ ring, poly, area, holes: [] });
    else if (area < 0) holes.push(ring);
  }
  const orphans: VertexId[][] = [];
  for (const hole of holes) {
    const pts = hole.map(pos2);
    let best: (typeof outers)[number] | undefined;
    for (const o of outers) {
      if (best && o.area >= best.area) continue;
      let inside = false;
      let outside = false;
      for (const p of pts) {
        const c = pointInPolygon(p, o.poly);
        if (c === 'inside') inside = true;
        else if (c === 'outside') outside = true;
      }
      if (inside && !outside) best = o;
    }
    if (best) best.holes.push(hole);
    else orphans.push(hole);
  }
  return { faces: outers.map((o) => ({ outer: o.ring, holes: o.holes })), orphans };
}
