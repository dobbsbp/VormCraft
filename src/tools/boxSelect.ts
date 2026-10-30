import { add, scale, type Vec3 } from '../core/math/vec3';
import type { FaceId, HalfEdgeId, Model } from '../core/model/Model';
import type { GuideId, Guides } from '../doc/Guides';
import type { Projector } from './types';

type P2 = [number, number];

export interface ScreenRect {
  from: P2;
  to: P2;
}

export interface PolygonHit {
  faces: FaceId[];
  edges: HalfEdgeId[];
  guides: GuideId[];
}

/**
 * Box selection in screen space. Window mode (drag left → right) takes entities entirely inside
 * the box; crossing mode (right → left) also takes anything the box touches.
 */
export function boxSelect(model: Model, projector: Projector, rect: ScreenRect, crossing: boolean, guides?: Guides): PolygonHit {
  return polygonSelect(model, projector, rectPolygon(rect), crossing, guides);
}

/**
 * Selection by a screen polygon (box or lasso). Window mode takes entities whose projected
 * vertices are all inside; crossing mode also takes anything the outline touches, and a face the
 * whole polygon sits inside. Guide points count when inside; guide lines (infinite) only in
 * crossing mode, when the outline crosses them.
 */
export function polygonSelect(model: Model, projector: Projector, polygon: P2[], crossing: boolean, guides?: Guides): PolygonHit {
  const inside = (p: P2 | null) => !!p && pointInScreenPolygon(p, polygon);
  const screen = new Map<number, P2 | null>();
  const at = (v: number) => {
    if (!screen.has(v)) screen.set(v, projector.toScreen(model.pos(v)));
    return screen.get(v)!;
  };
  const segmentTouches = (a: P2 | null, b: P2 | null) => {
    if (!a || !b) return false;
    if (inside(a) || inside(b)) return true;
    return polygon.some((c, i) => segmentsCross(a, b, c, polygon[(i + 1) % polygon.length]));
  };

  const edges: HalfEdgeId[] = [];
  for (const e of model.edges()) {
    const a = at(model.he(e).origin);
    const b = at(model.dest(e));
    if (crossing ? segmentTouches(a, b) : inside(a) && inside(b)) edges.push(e);
  }
  const faces: FaceId[] = [];
  for (const f of model.faces.keys()) {
    const rings = model.faceVertexLoops(f);
    const pts = rings.flat().map(at);
    if (!crossing) {
      if (pts.every(inside)) faces.push(f);
      continue;
    }
    const touches =
      rings.some((r) => r.some((v, i) => segmentTouches(at(v), at(r[(i + 1) % r.length])))) ||
      // The whole selection outline can sit inside a large face.
      pointInScreenPolygon(polygon[0], rings[0].map(at));
    if (touches) faces.push(f);
  }
  const guideIds: GuideId[] = [];
  if (guides?.visible) {
    for (const g of guides.points()) if (inside(projector.toScreen(g.pos))) guideIds.push(g.id);
    if (crossing) {
      for (const g of guides.lines()) {
        const screenLine = guideScreenPolyline(projector, g.point, g.dir);
        if (screenLine.some((p, i) => i > 0 && segmentTouches(screenLine[i - 1], p))) guideIds.push(g.id);
      }
    }
  }
  return { faces, edges, guides: guideIds };
}

/** An (infinite) guide line on screen, as a polyline through points sampled far along it. */
function guideScreenPolyline(projector: Projector, point: Vec3, dir: Vec3): P2[] {
  const ts = [0, ...[1, 10, 100, 1e3, 1e4, 1e5, 1e6].flatMap((t) => [t, -t])].sort((a, b) => a - b);
  const out: P2[] = [];
  for (const t of ts) {
    const s = projector.toScreen(add(point, scale(dir, t)));
    if (s) out.push(s);
  }
  return out;
}

/** Signed area of a screen polygon (y down): positive when drawn clockwise on screen. */
export function screenArea(poly: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function segmentsCross(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

function pointInScreenPolygon(p: P2, poly: (P2 | null)[]): boolean {
  if (poly.some((q) => !q)) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Groups taken by a screen polygon: in window mode every vertex of the group (and the groups inside
 * it) must be inside; in crossing mode anything of it touching the outline is enough.
 */
export function polygonSelectGroups<G>(groups: readonly { id: G; models: readonly Model[] }[], projector: Projector, polygon: P2[], crossing: boolean): G[] {
  const out: G[] = [];
  for (const g of groups) {
    const models = g.models.filter((m) => m.vertices.size > 0);
    if (!models.length) continue;
    const hit = crossing
      ? models.some((m) => {
          const h = polygonSelect(m, projector, polygon, true);
          return h.faces.length > 0 || h.edges.length > 0;
        })
      : models.every((m) => [...m.vertices.values()].every((v) => {
          const p = projector.toScreen(v.pos);
          return !!p && pointInScreenPolygon(p, polygon);
        }));
    if (hit) out.push(g.id);
  }
  return out;
}

/** The box as a screen polygon. */
export function rectPolygon(rect: ScreenRect): P2[] {
  const x0 = Math.min(rect.from[0], rect.to[0]);
  const x1 = Math.max(rect.from[0], rect.to[0]);
  const y0 = Math.min(rect.from[1], rect.to[1]);
  const y1 = Math.max(rect.from[1], rect.to[1]);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}
