import { fromPlane2D, toPlane2D, type Plane } from '../math/plane';
import { interiorPoint, pointInPolygon, signedArea } from '../math/polygon2d';
import { TOL } from '../math/tolerance';
import { dot, newellNormal, type Vec3 } from '../math/vec3';
import type { CurveId, FaceId, Model } from '../model/Model';
import { imprintSegments, loopSegments } from './imprint';

export interface DrawResult {
  /** Every face created or reshaped by the drawing. */
  faces: FaceId[];
  /** The face enclosed by the drawn outline, if one was formed. */
  inner: FaceId | undefined;
}

/** Rectangle corners on a plane, from a corner along u (width) and v (length). Either may be negative. */
export function rectanglePoints(plane: Plane, corner: Vec3, width: number, length: number): Vec3[] {
  const [x, y] = toPlane2D(plane, corner);
  const pts = [
    fromPlane2D(plane, [x, y]),
    fromPlane2D(plane, [x + width, y]),
    fromPlane2D(plane, [x + width, y + length]),
    fromPlane2D(plane, [x, y + length]),
  ];
  return width * length < 0 ? pts.reverse() : pts;
}

/** Regular polygon inscribed in a circle, CCW about the plane normal, first vertex along u. */
export function circlePoints(plane: Plane, center: Vec3, radius: number, segments: number): Vec3[] {
  const [cx, cy] = toPlane2D(plane, center);
  const pts: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    pts.push(fromPlane2D(plane, [cx + radius * Math.cos(a), cy + radius * Math.sin(a)]));
  }
  return pts;
}

/**
 * Draw a closed outline. On a host face it is imprinted (splitting the face); otherwise it becomes
 * a new face whose normal is the plane normal.
 */
export function drawPolygon(model: Model, plane: Plane, points: readonly Vec3[], opts: { hostFace?: FaceId; curve?: CurveId } = {}): DrawResult {
  if (points.length < 3) throw new Error('A polygon needs at least 3 points');
  const poly2 = points.map((p) => toPlane2D(plane, p));
  if (Math.abs(signedArea(poly2)) <= TOL * TOL) throw new Error('Polygon has no area');
  if (opts.hostFace !== undefined) {
    const faces = imprintSegments(model, opts.hostFace, loopSegments(points, opts.curve ?? null));
    const inner = faces.find((f) => {
      const fp = model.facePlane(f);
      const rings = model.faceVertexLoops(f).map((r) => r.map((v) => toPlane2D(fp, model.pos(v))));
      const p = fromPlane2D(fp, interiorPoint(rings[0], rings.slice(1)));
      return pointInPolygon(toPlane2D(plane, p), poly2) === 'inside';
    });
    return { faces, inner };
  }
  const ordered = dot(newellNormal(points), plane.normal) < 0 ? [...points].reverse() : [...points];
  const ids = ordered.map((p) => model.vertexAt(p));
  const face = model.addFace(ids, [], { normal: plane.normal });
  if (opts.curve !== undefined) ids.forEach((v, i) => model.setEdgeCurve(v, ids[(i + 1) % ids.length], opts.curve!));
  return { faces: [face], inner: face };
}

export function drawRectangle(model: Model, plane: Plane, corner: Vec3, width: number, length: number, hostFace?: FaceId): DrawResult {
  return drawPolygon(model, plane, rectanglePoints(plane, corner, width, length), { hostFace });
}

export const DEFAULT_CIRCLE_SEGMENTS = 24;

export function drawCircle(model: Model, plane: Plane, center: Vec3, radius: number, segments = DEFAULT_CIRCLE_SEGMENTS, hostFace?: FaceId): DrawResult {
  if (radius <= TOL) throw new Error('Circle radius must be positive');
  if (segments < 3) throw new Error('A circle needs at least 3 segments');
  const curve = model.addCurve({ kind: 'circle', center, normal: plane.normal, radius, segments });
  return drawPolygon(model, plane, circlePoints(plane, center, radius, segments), { hostFace, curve });
}
