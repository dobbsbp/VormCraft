import { makePlane } from '../math/plane';
import { pointInPolygon, triangulate2D, type Vec2 } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { Model } from '../model/Model';

/** What a section plane cuts through: the lines it draws on faces and the filled cut of solids. */
export interface SectionCut {
  /** Where the plane crosses faces, as segment pairs. */
  segments: [Vec3, Vec3][];
  /** The cut through closed solids, filled: triangles (three points each), facing along the plane's normal. */
  fill: Vec3[];
  /** How many closed outlines the cut makes, and how many runs of lines do not close (open shapes). */
  loops: number;
  open: number;
}

/**
 * Cut a model with the plane through `point` facing `normal`. Each face crossing the plane gives
 * the stretches of the line where its plane meets the section plane that lie inside it (edges
 * meeting the plane are counted on one side only, so corners on the plane are not counted twice).
 * The segments are joined into outlines; each closed outline (a solid's cut) is filled, with
 * outlines inside others as holes.
 */
export function sectionCut(model: Model, point: Vec3, normal: Vec3): SectionCut {
  const n = normalize(normal);
  const side = (p: Vec3) => dot(sub(p, point), n);
  const segments: [Vec3, Vec3][] = [];
  for (const f of model.faces.values()) {
    const along = cross(n, f.normal);
    if (length(along) < 1e-9) continue; // parallel to the plane (or lying in it)
    const dir = normalize(along);
    const hits: { s: number; p: Vec3 }[] = [];
    for (const loop of model.faceVertexLoops(f.id)) {
      for (let i = 0; i < loop.length; i++) {
        const a = model.pos(loop[i]);
        const b = model.pos(loop[(i + 1) % loop.length]);
        const da = side(a);
        const db = side(b);
        if (da > 0 === db > 0) continue;
        const p = add(a, scale(sub(b, a), da / (da - db)));
        hits.push({ s: dot(p, dir), p });
      }
    }
    hits.sort((x, y) => x.s - y.s);
    for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1].s - hits[i].s > TOL) segments.push([hits[i].p, hits[i + 1].p]);
  }
  const { loops, open } = chain(segments);
  const fill = fillLoops(loops, point, n);
  return { segments, fill, loops: loops.length, open };
}

/** Join segments end to end into closed loops; runs that do not close are counted as open. */
function chain(segments: [Vec3, Vec3][]): { loops: Vec3[][]; open: number } {
  const q = TOL * 10;
  const key = (p: Vec3) => `${Math.round(p[0] / q)},${Math.round(p[1] / q)},${Math.round(p[2] / q)}`;
  const at = new Map<string, number[]>();
  segments.forEach(([a, b], i) => {
    for (const k of [key(a), key(b)]) {
      const list = at.get(k);
      if (list) list.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Array<boolean>(segments.length).fill(false);
  const loops: Vec3[][] = [];
  let open = 0;
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = true;
    const first = segments[start][0];
    const loop: Vec3[] = [first];
    let end = segments[start][1];
    let closed = false;
    for (;;) {
      if (key(end) === key(first)) {
        closed = true;
        break;
      }
      loop.push(end);
      const next = (at.get(key(end)) ?? []).find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = true;
      const [a, b] = segments[next];
      end = key(a) === key(end) ? b : a;
    }
    if (closed && loop.length >= 3) loops.push(loop);
    else open++;
  }
  return { loops, open };
}

/** Fill closed loops lying in the plane: loops inside an odd number of others are holes. */
function fillLoops(loops: Vec3[][], point: Vec3, n: Vec3): Vec3[] {
  const plane = makePlane(point, n);
  const flat = loops.map((l) => l.map((p): Vec2 => [dot(sub(p, point), plane.u), dot(sub(p, point), plane.v)]));
  const inside = (i: number, j: number) => i !== j && flat[i].some((p) => pointInPolygon(p, flat[j]) === 'inside');
  const depth = flat.map((_, i) => flat.reduce((d, _x, j) => d + (inside(i, j) ? 1 : 0), 0));
  /** A loop turned counter-clockwise (or clockwise for a hole), in 2D and 3D alike. */
  const turned = (i: number, hole: boolean): { flat: Vec2[]; pts: Vec3[] } => {
    const flip = hole ? area(flat[i]) > 0 : area(flat[i]) < 0;
    return flip ? { flat: [...flat[i]].reverse(), pts: [...loops[i]].reverse() } : { flat: flat[i], pts: loops[i] };
  };
  const out: Vec3[] = [];
  flat.forEach((_, i) => {
    if (depth[i] % 2) return;
    // Holes: loops directly inside this one (one level deeper and inside it).
    const rings = [turned(i, false), ...flat.map((_x, j) => j).filter((j) => depth[j] === depth[i] + 1 && inside(j, i)).map((j) => turned(j, true))];
    const pts = rings.flatMap((r) => r.pts);
    for (const tri of triangulate2D(rings[0].flat, rings.slice(1).map((r) => r.flat))) for (const k of tri) out.push(pts[k]);
  });
  return out;
}

const area = (p: readonly Vec2[]) => p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2;

/**
 * The four corners of a rectangle on the plane through `point` facing `normal`, big enough to
 * cover the box `min`–`max` seen along the normal (with a margin), centred where the box's centre
 * meets the plane: how a section plane is drawn.
 */
export function planeFrame(point: Vec3, normal: Vec3, min: Vec3, max: Vec3, margin = 0.1): Vec3[] {
  const plane = makePlane(point, normal);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (let i = 0; i < 8; i++) {
    const c: Vec3 = [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]];
    const u = dot(sub(c, point), plane.u);
    const v = dot(sub(c, point), plane.v);
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const pad = Math.max(u1 - u0, v1 - v0, 500) * margin;
  const at = (u: number, v: number) => add(point, add(scale(plane.u, u), scale(plane.v, v)));
  return [at(u0 - pad, v0 - pad), at(u1 + pad, v0 - pad), at(u1 + pad, v1 + pad), at(u0 - pad, v1 + pad)];
}
