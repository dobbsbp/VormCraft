import type { FaceId, HalfEdgeId, Model } from '../core/model/Model';
import type { Projector } from './types';

type P2 = [number, number];

export interface ScreenRect {
  from: P2;
  to: P2;
}

/**
 * Box selection in screen space. Window mode (drag left → right) takes entities entirely inside
 * the box; crossing mode (right → left) also takes anything the box touches.
 */
export function boxSelect(model: Model, projector: Projector, rect: ScreenRect, crossing: boolean): { faces: FaceId[]; edges: HalfEdgeId[] } {
  const x0 = Math.min(rect.from[0], rect.to[0]);
  const x1 = Math.max(rect.from[0], rect.to[0]);
  const y0 = Math.min(rect.from[1], rect.to[1]);
  const y1 = Math.max(rect.from[1], rect.to[1]);
  return polygonSelect(
    model,
    projector,
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    crossing,
  );
}

/**
 * Selection by a screen polygon (box or lasso). Window mode takes entities whose projected
 * vertices are all inside; crossing mode also takes anything the outline touches, and a face the
 * whole polygon sits inside.
 */
export function polygonSelect(model: Model, projector: Projector, polygon: P2[], crossing: boolean): { faces: FaceId[]; edges: HalfEdgeId[] } {
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
  return { faces, edges };
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
