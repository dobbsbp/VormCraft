import { fromPlane2D, projectToPlane, toPlane2D } from '../math/plane';
import { closestOnSegment, dist2, interiorPoint, intersectSegments, pointInRegion, signedArea, type Vec2 } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { lerp, type Vec3 } from '../math/vec3';
import type { CurveId, FaceId, HalfEdgeId, Model, VertexId } from '../model/Model';
import { assembleFaces, traceLoops } from '../model/region';

export interface ImprintSegment {
  a: Vec3;
  b: Vec3;
  curve?: CurveId | null;
}

interface Node {
  p: Vec2;
  v?: VertexId;
}

interface Seg {
  a: number;
  b: number;
  curve: CurveId | null;
}

/**
 * Draw segments onto a face and split it along them. Segments are projected onto the face plane
 * and clipped to the face; pieces that do not help enclose a region (dangling lines) are dropped.
 * Boundary edges are split where new segments meet them, which also updates the neighbouring face.
 * Returns the faces that now cover the original face's area (just `[faceId]` if nothing changed).
 */
export function imprintSegments(model: Model, faceId: FaceId, segments: readonly ImprintSegment[]): FaceId[] {
  const face = model.face(faceId);
  const plane = model.facePlane(faceId);
  const to2 = (p: Vec3) => toPlane2D(plane, p);

  const nodes: Node[] = [];
  const nodeAt = (p: Vec2, v?: VertexId): number => {
    const i = nodes.findIndex((n) => dist2(n.p, p) <= TOL);
    if (i >= 0) return i;
    nodes.push({ p, v });
    return nodes.length - 1;
  };

  // Boundary of the face, as node segments that remember their half-edge.
  const rings = model.faceVertexLoops(faceId);
  const rings2 = rings.map((r) => r.map((v) => to2(model.pos(v))));
  const boundary: { a: number; b: number; he: HalfEdgeId }[] = [];
  for (const ring of rings) {
    ring.forEach((v, i) => {
      const w = ring[(i + 1) % ring.length];
      boundary.push({ a: nodeAt(to2(model.pos(v)), v), b: nodeAt(to2(model.pos(w)), w), he: model.halfEdgeBetween(v, w)! });
    });
  }
  const inFace = (p: Vec2) => pointInRegion(p, rings2[0], rings2.slice(1));

  // New segments, split wherever they touch the boundary or each other.
  const raw: Seg[] = [];
  for (const s of segments) {
    const a = nodeAt(to2(projectToPlane(plane, s.a)));
    const b = nodeAt(to2(projectToPlane(plane, s.b)));
    if (a !== b) raw.push({ a, b, curve: s.curve ?? null });
  }
  const splitsOnNew = raw.map((s) => new Set([s.a, s.b]));
  const splitsOnBoundary = boundary.map(() => new Set<number>());
  raw.forEach((s, i) => {
    const pa = nodes[s.a].p;
    const pb = nodes[s.b].p;
    boundary.forEach((t, j) => {
      for (const p of intersectSegments(pa, pb, nodes[t.a].p, nodes[t.b].p)) {
        const n = nodeAt(p);
        splitsOnNew[i].add(n);
        if (n !== t.a && n !== t.b) splitsOnBoundary[j].add(n);
      }
    });
    raw.forEach((t, j) => {
      if (j <= i) return;
      for (const p of intersectSegments(pa, pb, nodes[t.a].p, nodes[t.b].p)) {
        const n = nodeAt(p);
        splitsOnNew[i].add(n);
        splitsOnNew[j].add(n);
      }
    });
  });

  const sortAlong = (a: Vec2, b: Vec2, ids: Iterable<number>) =>
    [...ids].sort((x, y) => closestOnSegment(nodes[x].p, a, b).t - closestOnSegment(nodes[y].p, a, b).t);

  const boundaryPairs = new Set(boundary.map((s) => pairKey(s.a, s.b)));
  const kept = new Map<string, Seg>();
  raw.forEach((s, i) => {
    const order = sortAlong(nodes[s.a].p, nodes[s.b].p, splitsOnNew[i]);
    for (let k = 0; k + 1 < order.length; k++) {
      const a = order[k];
      const b = order[k + 1];
      const key = pairKey(a, b);
      if (a === b || kept.has(key) || boundaryPairs.has(key)) continue;
      const mid: Vec2 = [(nodes[a].p[0] + nodes[b].p[0]) / 2, (nodes[a].p[1] + nodes[b].p[1]) / 2];
      if (inFace(mid) === 'inside') kept.set(key, { a, b, curve: s.curve });
    }
  });

  // Drop dangling segments: every node must touch at least two edges.
  const degree = new Map<number, number>();
  const bump = (n: number, d: number) => degree.set(n, (degree.get(n) ?? 0) + d);
  for (const s of boundary) {
    bump(s.a, 1);
    bump(s.b, 1);
  }
  // Boundary splits count only if a kept segment uses them; they get degree 2 from the edge they split.
  boundary.forEach((_, j) => splitsOnBoundary[j].forEach((n) => bump(n, 2)));
  for (const s of kept.values()) {
    bump(s.a, 1);
    bump(s.b, 1);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [key, s] of kept) {
      if ((degree.get(s.a) ?? 0) < 2 || (degree.get(s.b) ?? 0) < 2) {
        kept.delete(key);
        bump(s.a, -1);
        bump(s.b, -1);
        changed = true;
      }
    }
  }
  const used = new Set<number>();
  for (const s of kept.values()) {
    used.add(s.a);
    used.add(s.b);
  }
  if (kept.size === 0) return [faceId];

  // Mutate: split boundary edges at used nodes, then create interior vertices.
  boundary.forEach((s, j) => {
    const pa = model.pos(nodes[s.a].v!);
    const pb = model.pos(nodes[s.b].v!);
    const order = sortAlong(nodes[s.a].p, nodes[s.b].p, [...splitsOnBoundary[j]].filter((n) => used.has(n) && nodes[n].v === undefined));
    let he = s.he;
    for (const n of order) {
      const t = closestOnSegment(nodes[n].p, nodes[s.a].p, nodes[s.b].p).t;
      const v = model.addVertex(lerp(pa, pb, t));
      nodes[n].v = v;
      model.splitEdge(he, v);
      he = model.halfEdgeBetween(v, nodes[s.b].v!)!;
    }
  });
  for (const n of used) {
    // Reuse a vertex already at this point (e.g. the end of a loose line drawn on the face).
    if (nodes[n].v === undefined) {
      const p = fromPlane2D(plane, nodes[n].p);
      nodes[n].v = model.findVertex(p) ?? model.addVertex(p);
    }
  }

  // Walk the planar graph of (split) boundary edges plus new edges in both directions.
  const pos2 = (v: VertexId) => to2(model.pos(v));
  const directed: [VertexId, VertexId][] = [];
  for (const ring of model.faceVertexLoops(faceId)) {
    ring.forEach((v, i) => {
      const w = ring[(i + 1) % ring.length];
      directed.push([v, w], [w, v]);
    });
  }
  for (const s of kept.values()) {
    const a = nodes[s.a].v!;
    const b = nodes[s.b].v!;
    directed.push([a, b], [b, a]);
  }
  // Assemble regions with their holes first, then drop regions outside the original face (e.g.
  // inside its holes). The test point must avoid the region's own holes, or a ring around an
  // existing hole would be judged by a point inside that hole.
  const assembled = assembleFaces(traceLoops(directed, pos2), pos2).faces;
  const faces = assembled.filter((f) => inFace(interiorPoint(f.outer.map(pos2), f.holes.map((h) => h.map(pos2)))) === 'inside');
  faces.sort((x, y) => signedArea(y.outer.map(pos2)) - signedArea(x.outer.map(pos2)));

  const { normal, material } = face;
  model.removeFace(faceId);
  const result = faces.map((f, i) => model.addFace(f.outer, f.holes, { normal, id: i === 0 ? faceId : undefined, material }));
  const newEdges: HalfEdgeId[] = [];
  for (const s of kept.values()) {
    const a = nodes[s.a].v!;
    const b = nodes[s.b].v!;
    if (s.curve !== null) model.setEdgeCurve(a, b, s.curve);
    newEdges.push(model.halfEdgeBetween(a, b)!);
  }
  model.purgeFree(newEdges);
  return result;
}

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Closed polyline → imprint segments. */
export function loopSegments(points: readonly Vec3[], curve: CurveId | null = null): ImprintSegment[] {
  return points.map((a, i) => ({ a, b: points[(i + 1) % points.length], curve }));
}
