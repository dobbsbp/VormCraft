import { fromPlane2D, planesCoincide, toPlane2D, type Plane } from '../math/plane';
import { interiorPoint, pointInRegion, type Vec2 } from '../math/polygon2d';
import type { FaceId, MaterialId, Model } from '../model/Model';

/** Paint faces with a material, or back to the default material with `undefined`. */
export function paintFaces(model: Model, faces: Iterable<FaceId>, material: MaterialId | undefined): void {
  for (const id of faces) {
    const f = model.face(id);
    if (material === undefined) delete f.material;
    else f.material = material;
  }
}

/** Remove a material from every face that uses it (they go back to the default material). */
export function unpaintMaterial(model: Model, material: MaterialId): void {
  for (const f of model.faces.values()) if (f.material === material) delete f.material;
}

/**
 * After an operation, give new faces the paint of the face they came from, so paint survives
 * splitting, push/pull, offsets and booleans: a face that kept its id but was rebuilt (moved,
 * flipped, reshaped) keeps its paint, and a new
 * face lying inside a painted face of `before` (same plane, either side) takes that face's paint.
 * Faces that are new surfaces (e.g. the walls of a push/pull) stay unpainted.
 */
export function inheritMaterials(before: Model, after: Model): void {
  const painted = [...before.faces.values()].filter((f) => f.material !== undefined);
  if (!painted.length) return;
  const regions = new Map<FaceId, { plane: Plane; rings: Vec2[][] }>();
  const regionOf = (id: FaceId) => {
    if (!regions.has(id)) {
      const plane = before.facePlane(id);
      regions.set(id, { plane, rings: before.faceVertexLoops(id).map((r) => r.map((v) => toPlane2D(plane, before.pos(v)))) });
    }
    return regions.get(id)!;
  };
  for (const f of after.faces.values()) {
    if (f.material !== undefined) continue;
    if (before.faces.has(f.id)) {
      // Unchanged outline: the operation decided its paint (e.g. painting it back to the default).
      const was = before.face(f.id).material;
      if (was !== undefined && !sameLoops(before, after, f.id)) f.material = was;
      continue;
    }
    const plane = after.facePlane(f.id);
    const rings = after.faceVertexLoops(f.id).map((r) => r.map((v) => toPlane2D(plane, after.pos(v))));
    const inside = fromPlane2D(plane, interiorPoint(rings[0], rings.slice(1)));
    for (const g of painted) {
      const region = regionOf(g.id);
      if (!planesCoincide(region.plane, plane)) continue;
      if (pointInRegion(toPlane2D(region.plane, inside), region.rings[0], region.rings.slice(1)) !== 'inside') continue;
      f.material = g.material;
      break;
    }
  }
}

function sameLoops(a: Model, b: Model, face: FaceId): boolean {
  const x = a.faceVertexLoops(face);
  const y = b.faceVertexLoops(face);
  return x.length === y.length && x.every((r, i) => r.length === y[i].length && r.every((v, k) => v === y[i][k]));
}
