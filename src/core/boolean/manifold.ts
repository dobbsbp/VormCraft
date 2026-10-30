import Module, { type Manifold, type ManifoldToplevel, type Mesh } from 'manifold-3d';
import { makePlane, planesCoincide, signedDistance, toPlane2D, type Plane } from '../math/plane';
import { SpatialHash } from '../math/spatialHash';
import { TOL } from '../math/tolerance';
import { add, cross, distance, dot, scale, type Vec3 } from '../math/vec3';
import type { FaceId, HalfEdgeId, MaterialId, Model, VertexId } from '../model/Model';
import { assembleFaces, traceLoops } from '../model/region';
import { triangulateFaces } from '../triangulate';

let kernel: ManifoldToplevel | null = null;

/**
 * Load the Manifold WebAssembly module. Call once at startup (and in test setup). Bundled apps
 * pass the URL their bundler serves `manifold.wasm` from; Node finds it next to the package.
 */
export async function initBooleanKernel(opts: { wasmUrl?: string } = {}): Promise<void> {
  if (kernel) return;
  const { wasmUrl } = opts;
  const wasm = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  wasm.setup();
  kernel = wasm;
}

export const booleanKernelReady = (): boolean => kernel !== null;

function getKernel(): ManifoldToplevel {
  if (!kernel) throw new Error('Boolean kernel is not initialised: call initBooleanKernel() first');
  return kernel;
}

export type BooleanOp = 'union' | 'subtract' | 'intersect';

/** A closed solid given as faces of some model (the target model, or a scratch model for tools). */
export interface SolidRef {
  model: Model;
  faces: Iterable<FaceId>;
}

function toManifold(solid: SolidRef, faceIdOf: (f: FaceId) => number): Manifold {
  const k = getKernel();
  const tri = triangulateFaces(solid.model, solid.faces);
  const mesh = new k.Mesh({
    numProp: 3,
    vertProperties: tri.positions,
    triVerts: tri.indices,
    faceID: Uint32Array.from(tri.faceIds, faceIdOf),
  });
  const m = new k.Manifold(mesh);
  const status = m.status();
  if (status !== 'NoError') {
    m.delete();
    throw new Error(`Solid is not a valid manifold (${status}); run the watertight check`);
  }
  return m;
}

/** Volume of a solid computed by Manifold (used for containment checks). */
export function manifoldVolume(op: BooleanOp | null, a: SolidRef, b?: SolidRef): number {
  const ma = toManifold(a, (f) => f);
  if (!op || !b) {
    const v = ma.volume();
    ma.delete();
    return v;
  }
  const mb = toManifold(b, (f) => f);
  const r = applyOp(ma, mb, op);
  const v = r.volume();
  for (const m of [ma, mb, r]) m.delete();
  return v;
}

function applyOp(a: Manifold, b: Manifold, op: BooleanOp): Manifold {
  if (op === 'union') return a.add(b);
  if (op === 'subtract') return a.subtract(b);
  return a.intersect(b);
}

export interface BooleanResult {
  /** Faces of the result in the target model. */
  faces: FaceId[];
  /** Target-model face id assigned to each tool face (the id is only present if that face survived). */
  toolFaceIds: Map<FaceId, FaceId>;
  /** Vertices created by the boolean (not snapped to existing target vertices). */
  newVertices: VertexId[];
}

/**
 * Replace the closed solid `targetFaces` in `model` by `target op tool`. Faces that survive keep their
 * ids (Manifold carries face ids through), so selection and neighbours stay meaningful. Result
 * vertices are snapped back to the exact original vertices, and new vertices are re-solved from
 * the exact planes they lie on, removing Manifold's float32 rounding.
 */
export function booleanInPlace(model: Model, targetFaces: ReadonlySet<FaceId>, tool: SolidRef, op: BooleanOp): BooleanResult {
  const toolFaces = [...tool.faces];
  const toolFaceIds = new Map(toolFaces.map((f) => [f, model.newId()]));
  const planes = new Map<number, Plane>();
  const normals = new Map<number, Vec3>();
  for (const f of targetFaces) {
    planes.set(f, model.facePlane(f));
    normals.set(f, model.face(f).normal);
  }
  // Subtraction turns the tool inside out, so its faces come back facing the other way.
  const flip = op === 'subtract' ? -1 : 1;
  for (const f of toolFaces) {
    const n = scale(tool.model.face(f).normal, flip);
    planes.set(toolFaceIds.get(f)!, makePlane(tool.model.facePlane(f).origin, n));
    normals.set(toolFaceIds.get(f)!, n);
  }

  const a = toManifold({ model, faces: targetFaces }, (f) => f);
  const b = toManifold({ model: tool.model, faces: toolFaces }, (f) => toolFaceIds.get(f)!);
  const r = applyOp(a, b, op);
  const out = r.getMesh();
  for (const m of [a, b, r]) m.delete();

  const oldEdges: HalfEdgeId[] = [];
  const snap = new SpatialHash<VertexId>();
  for (const f of targetFaces) {
    for (const h of model.faceHalfEdges(f)) {
      oldEdges.push(h);
      const v = model.he(h).origin;
      snap.insert(model.pos(v), v);
    }
  }
  const materials = new Map<number, MaterialId>();
  for (const f of targetFaces) {
    const m = model.face(f).material;
    if (m !== undefined) materials.set(f, m);
  }
  for (const f of targetFaces) model.removeFace(f);
  const result = rebuildFaces(model, out, planes, normals, snap, materials);
  model.purgeFree(oldEdges);
  return { ...result, toolFaceIds };
}

function rebuildFaces(
  model: Model,
  mesh: Mesh,
  planes: Map<number, Plane>,
  normals: Map<number, Vec3>,
  snap: SpatialHash<VertexId>,
  materials: Map<number, MaterialId>,
): { faces: FaceId[]; newVertices: VertexId[] } {
  const np = mesh.numProp;
  const nVerts = mesh.vertProperties.length / np;
  const nTris = mesh.triVerts.length / 3;
  const faceID = mesh.faceID;

  const incident: Set<number>[] = Array.from({ length: nVerts }, () => new Set());
  for (let t = 0; t < nTris; t++) for (let k = 0; k < 3; k++) incident[mesh.triVerts[t * 3 + k]].add(faceID[t]);

  const newVertices: VertexId[] = [];
  const vid: VertexId[] = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const p: Vec3 = [mesh.vertProperties[i * np], mesh.vertProperties[i * np + 1], mesh.vertProperties[i * np + 2]];
    const existing = snap.find(p);
    if (existing !== undefined) {
      vid[i] = existing;
      continue;
    }
    const refined = refinePoint(p, [...incident[i]].map((f) => planes.get(f)).filter((x): x is Plane => !!x));
    const existingRefined = snap.find(refined);
    if (existingRefined !== undefined) {
      vid[i] = existingRefined;
      continue;
    }
    vid[i] = model.addVertex(refined);
    newVertices.push(vid[i]);
    snap.insert(refined, vid[i]);
  }

  // Boundary edges of each face-id group: directed triangle edges whose reverse is not in the group.
  const groups = new Map<number, Map<string, [VertexId, VertexId]>>();
  for (let t = 0; t < nTris; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => vid[mesh.triVerts[t * 3 + k]]);
    if (a === b || b === c || c === a) continue;
    let g = groups.get(faceID[t]);
    if (!g) groups.set(faceID[t], (g = new Map()));
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const rev = `${y}>${x}`;
      if (g.has(rev)) g.delete(rev);
      else g.set(`${x}>${y}`, [x, y]);
    }
  }

  const faces: FaceId[] = [];
  for (const [id, edges] of groups) {
    if (edges.size === 0) continue;
    const plane = planes.get(id);
    if (!plane) throw new Error(`Boolean result has unknown face id ${id}`);
    const pos2 = (v: VertexId) => toPlane2D(plane, model.pos(v));
    const { faces: rings } = assembleFaces(traceLoops([...edges.values()], pos2), pos2);
    rings.forEach((r, i) => {
      const reuse = i === 0 && !model.faces.has(id);
      faces.push(model.addFace(r.outer, r.holes, { normal: normals.get(id), id: reuse ? id : undefined, material: materials.get(id) }));
    });
  }
  return { faces, newVertices };
}

/**
 * Re-solve a float32 point from the exact planes it lies on: three independent planes give a
 * point, two give a line (closest point on it), one gives a projection.
 */
function refinePoint(p: Vec3, planes: Plane[]): Vec3 {
  const distinct: Plane[] = [];
  for (const pl of planes) if (!distinct.some((d) => planesCoincide(d, pl))) distinct.push(pl);
  let best: Vec3 | undefined;
  if (distinct.length >= 3) {
    let bestDet = 1e-6;
    for (let i = 0; i < distinct.length; i++)
      for (let j = i + 1; j < distinct.length; j++)
        for (let k = j + 1; k < distinct.length; k++) {
          const [A, B, C] = [distinct[i], distinct[j], distinct[k]];
          const det = dot(A.normal, cross(B.normal, C.normal));
          if (Math.abs(det) > bestDet) {
            bestDet = Math.abs(det);
            best = intersect3(A, B, C, det);
          }
        }
  }
  if (!best && distinct.length >= 2) {
    const [A, B] = distinct;
    const dir = cross(A.normal, B.normal);
    if (dot(dir, dir) > 1e-12) {
      const C: Plane = { ...A, origin: p, normal: dir };
      best = intersect3(A, B, C, dot(A.normal, cross(B.normal, C.normal)));
    }
  }
  if (!best && distinct.length >= 1) best = add(p, scale(distinct[0].normal, -signedDistance(distinct[0], p)));
  // Float32 rounding is tiny; a large correction means the plane guess was wrong, so keep p.
  return best && distance(best, p) <= Math.max(TOL * 10, 1e-6 * Math.hypot(...p)) ? best : p;
}

function intersect3(A: Plane, B: Plane, C: Plane, det: number): Vec3 {
  const dA = dot(A.normal, A.origin);
  const dB = dot(B.normal, B.origin);
  const dC = dot(C.normal, C.origin);
  return scale(add(add(scale(cross(B.normal, C.normal), dA), scale(cross(C.normal, A.normal), dB)), scale(cross(A.normal, B.normal), dC)), 1 / det);
}
