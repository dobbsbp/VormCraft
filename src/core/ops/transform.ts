import { signedDistance, makePlane } from '../math/plane';
import { TOL } from '../math/tolerance';
import { cross, dot, length, newellNormal, normalize, scale, sub, type Vec3 } from '../math/vec3';
import type { CurveId, FaceId, Model, VertexId } from '../model/Model';
import { faceArea } from '../check/measure';

/** An affine map p ↦ M·p + t, with M row-major 3×3. */
export interface Affine {
  m: readonly [number, number, number, number, number, number, number, number, number];
  t: Vec3;
}

export function applyAffine(a: Affine, p: Vec3): Vec3 {
  const m = a.m;
  return [m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + a.t[0], m[3] * p[0] + m[4] * p[1] + m[5] * p[2] + a.t[1], m[6] * p[0] + m[7] * p[1] + m[8] * p[2] + a.t[2]];
}

const linear = (a: Affine, v: Vec3): Vec3 => sub(applyAffine(a, v), a.t);

function det(m: Affine['m']): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Direction of a transformed normal (inverse transpose, up to scale): cofactor matrix · n. */
function transformNormal(a: Affine, n: Vec3): Vec3 {
  const m = a.m;
  const c0: Vec3 = cross([m[1], m[4], m[7]], [m[2], m[5], m[8]]);
  const c1: Vec3 = cross([m[2], m[5], m[8]], [m[0], m[3], m[6]]);
  const c2: Vec3 = cross([m[0], m[3], m[6]], [m[1], m[4], m[7]]);
  const v: Vec3 = [c0[0] * n[0] + c1[0] * n[1] + c2[0] * n[2], c0[1] * n[0] + c1[1] * n[1] + c2[1] * n[2], c0[2] * n[0] + c1[2] * n[1] + c2[2] * n[2]];
  return scale(normalize(v), Math.sign(det(m)) || 1);
}

/** Uniform scale factor if M is a rotation times a uniform scale (circles stay circles), else null. */
function similarityScale(a: Affine): number | null {
  const cols: Vec3[] = [
    [a.m[0], a.m[3], a.m[6]],
    [a.m[1], a.m[4], a.m[7]],
    [a.m[2], a.m[5], a.m[8]],
  ];
  const s = length(cols[0]);
  if (cols.some((c) => Math.abs(length(c) - s) > 1e-9 * Math.max(1, s))) return null;
  if (Math.abs(dot(cols[0], cols[1])) > 1e-9 * s * s || Math.abs(dot(cols[0], cols[2])) > 1e-9 * s * s || Math.abs(dot(cols[1], cols[2])) > 1e-9 * s * s) return null;
  return s;
}

export const translation = (v: Vec3): Affine => ({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: v });

export function scaling(base: Vec3, f: Vec3): Affine {
  return { m: [f[0], 0, 0, 0, f[1], 0, 0, 0, f[2]], t: [base[0] * (1 - f[0]), base[1] * (1 - f[1]), base[2] * (1 - f[2])] };
}

/** Rotation by `angle` radians about the axis through `center` along `axis` (right-hand rule). */
export function rotation(center: Vec3, axis: Vec3, angle: number): Affine {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  const m = [c + x * x * k, x * y * k - z * s, x * z * k + y * s, y * x * k + z * s, c + y * y * k, y * z * k - x * s, z * x * k - y * s, z * y * k + x * s, c + z * z * k] as const;
  const a: Affine = { m, t: [0, 0, 0] };
  return { m, t: sub(center, linear(a, center)) };
}

/** Thrown when a move/rotate/scale of part of a solid would bend or collapse a face. */
export class BendError extends Error {}

/**
 * Transform vertices in place. Faces entirely inside the set move rigidly with them (normals and
 * true circles follow). Faces only partly inside (moving one face of a box up, say) must stay
 * flat and keep their facing, otherwise nothing changes and BendError is thrown. A mirror
 * (negative determinant) reverses loop winding so solids stay outward-facing; it needs whole
 * faces.
 */
export function transformVertices(model: Model, vertices: ReadonlySet<VertexId>, a: Affine): void {
  const mirror = det(a.m) < 0;
  if (Math.abs(det(a.m)) < 1e-12) throw new BendError('That would flatten the geometry to nothing');
  const faces = new Set<FaceId>();
  const curves = new Set<CurveId>();
  for (const v of vertices) {
    for (const h of model.outgoing(v)) {
      for (const side of [h, model.he(h).twin]) {
        const f = model.faceOf(side);
        if (f !== null) faces.add(f);
      }
      const c = model.he(h).curve;
      if (c !== null) curves.add(c);
    }
  }
  const whole = new Set([...faces].filter((f) => model.faceVertexLoops(f).flat().every((v) => vertices.has(v))));
  if (mirror && whole.size !== faces.size) throw new BendError('Mirroring needs whole objects: select all of it');

  const oldPos = new Map([...vertices].map((v) => [v, model.pos(v)]));
  const oldNormal = new Map([...faces].map((f) => [f, model.face(f).normal]));
  const undo = () => {
    for (const [v, p] of oldPos) model.vertices.get(v)!.pos = p;
    for (const [f, n] of oldNormal) model.face(f).normal = n;
  };
  for (const v of vertices) model.vertices.get(v)!.pos = applyAffine(a, model.pos(v));

  for (const f of faces) {
    const face = model.face(f);
    if (whole.has(f)) {
      face.normal = transformNormal(a, face.normal);
      continue;
    }
    // Partly moved: it must still be flat, facing the same way, and not collapsed.
    const outer = model.loopVertices(face.outer).map((v) => model.pos(v));
    let n: Vec3;
    try {
      n = newellNormal(outer);
    } catch {
      undo();
      throw new BendError('That would collapse a face');
    }
    const plane = makePlane(outer[0], n);
    const flat = model.faceVertexLoops(f).flat().every((v) => Math.abs(signedDistance(plane, model.pos(v))) <= TOL);
    if (!flat || dot(n, face.normal) <= 0 || faceArea(model, f) <= TOL * TOL) {
      undo();
      throw new BendError(
        !flat
          ? 'That would bend a face out of flat. Move or rotate the whole object, or move along a direction that keeps its faces flat.'
          : 'That would fold a face over or collapse it',
      );
    }
    face.normal = n;
  }

  if (mirror) {
    const rebuilt = [...faces].map((f) => ({ f, normal: model.face(f).normal, rings: model.faceVertexLoops(f).map((r) => [...r].reverse()) }));
    for (const r of rebuilt) model.removeFace(r.f);
    for (const r of rebuilt) model.addFace(r.rings[0], r.rings.slice(1), { normal: r.normal, id: r.f });
  }

  const s = similarityScale(a);
  for (const c of curves) {
    const curve = model.curves.get(c);
    if (!curve) continue;
    const edges = [...model.halfEdges.values()].filter((h) => h.curve === c);
    const allMoved = edges.every((h) => vertices.has(h.origin));
    if (allMoved && s !== null) {
      model.curves.set(c, { ...curve, center: applyAffine(a, curve.center), radius: curve.radius * s, normal: transformNormal(a, curve.normal) });
    } else {
      // The circle was stretched or only partly moved: it is no longer a true circle.
      for (const h of edges) if (vertices.has(h.origin) || vertices.has(model.dest(h.id))) h.curve = null;
      if (![...model.halfEdges.values()].some((h) => h.curve === c)) model.curves.delete(c);
    }
  }
}

/**
 * Copy the geometry spanned by `vertices`: faces whose vertices are all in the set, and loose
 * edges between them, with their curves. Returns the new vertex for each copied vertex.
 */
export function duplicateVertices(model: Model, vertices: ReadonlySet<VertexId>): Map<VertexId, VertexId> {
  const map = new Map<VertexId, VertexId>();
  for (const v of vertices) map.set(v, model.addVertex(model.pos(v)));
  const curveMap = new Map<CurveId, CurveId>();
  const copyCurve = (c: CurveId | null): CurveId | null => {
    if (c === null) return null;
    if (!curveMap.has(c)) {
      const src = model.curves.get(c);
      if (!src) return null;
      curveMap.set(c, model.addCurve({ kind: 'circle', center: src.center, normal: src.normal, radius: src.radius, segments: src.segments }));
    }
    return curveMap.get(c)!;
  };
  const faces = [...model.faces.values()].filter((f) => model.faceVertexLoops(f.id).flat().every((v) => vertices.has(v)));
  for (const f of faces) {
    const rings = model.faceVertexLoops(f.id).map((r) => r.map((v) => map.get(v)!));
    model.addFace(rings[0], rings.slice(1), { normal: f.normal });
  }
  for (const e of [...model.edges()]) {
    const h = model.he(e);
    const a = h.origin;
    const b = model.dest(e);
    if (!vertices.has(a) || !vertices.has(b)) continue;
    const ca = map.get(a)!;
    const cb = map.get(b)!;
    model.addEdge(ca, cb);
    const c = copyCurve(h.curve);
    if (c !== null) model.setEdgeCurve(ca, cb, c);
  }
  // Vertices that ended up without edges (isolated in the source) are not worth copying.
  for (const [v, c] of map) {
    if (model.removeVertexIfIsolated(c)) map.delete(v);
  }
  return map;
}

/** Vertices of selected faces and edges (exactly those; not expanded to whole objects). */
export function selectionVertices(model: Model, faces: Iterable<FaceId>, edges: Iterable<number>): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const f of faces) if (model.faces.has(f)) model.faceVertexLoops(f).flat().forEach((v) => out.add(v));
  for (const e of edges) {
    if (!model.halfEdges.has(e)) continue;
    out.add(model.he(e).origin);
    out.add(model.dest(e));
  }
  return out;
}

