import type { FaceId, HalfEdgeId, Model } from '../model/Model';
import { faceArea } from './measure';

export interface WatertightReport {
  watertight: boolean;
  /** Half-edges of the checked faces with no checked face on the other side. */
  openEdges: HalfEdgeId[];
  /** Faces with (near) zero area. */
  degenerateFaces: FaceId[];
  /** Number of connected shells. */
  shells: number;
  /** V - E + F - (inner loops); equals 2 * (shells - genus) for closed solids. */
  euler: number;
  /** Total number of through-holes (handles) over all shells; only meaningful when watertight. */
  genus: number;
}

/**
 * Check that faces form closed, consistently oriented shells (what STL export and 3D printing need).
 * The half-edge structure already guarantees consistent orientation (each directed edge is used by
 * at most one face), so a shell is closed exactly when every half-edge has a face on its twin.
 */
export function checkWatertight(model: Model, faces: Iterable<FaceId> = model.faces.keys()): WatertightReport {
  const set = new Set(faces);
  const openEdges: HalfEdgeId[] = [];
  const degenerateFaces: FaceId[] = [];
  const verts = new Set<number>();
  const edges = new Set<number>();
  let rings = 0;
  for (const f of set) {
    rings += model.face(f).holes.length;
    if (faceArea(model, f) <= 1e-9) degenerateFaces.push(f);
    for (const h of model.faceHalfEdges(f)) {
      const he = model.he(h);
      verts.add(he.origin);
      edges.add(Math.min(h, he.twin));
      const other = model.faceOf(he.twin);
      if (other === null || !set.has(other)) openEdges.push(h);
    }
  }
  let shells = 0;
  const seen = new Set<FaceId>();
  for (const f of set) {
    if (seen.has(f)) continue;
    shells++;
    for (const g of model.connectedFaces(f)) seen.add(g);
  }
  const euler = verts.size - edges.size + set.size - rings;
  return {
    watertight: set.size > 0 && openEdges.length === 0 && degenerateFaces.length === 0,
    openEdges,
    degenerateFaces,
    shells,
    euler,
    genus: (2 * shells - euler) / 2,
  };
}
