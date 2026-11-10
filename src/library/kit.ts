import { booleanInPlace } from '../core/boolean/manifold';
import { makePlane } from '../core/math/plane';
import { add, cross, dot, newellNormal, scale, type Vec3 } from '../core/math/vec3';
import { Model, type FaceId, type VertexId } from '../core/model/Model';
import { mergeCoplanarFaces, removeCollinearVertices } from '../core/ops/cleanup';
import { drawCircle } from '../core/ops/draw';
import { drawEdges } from '../core/ops/edges';
import { followMe } from '../core/ops/followMe';
import { extractGeometry } from '../core/ops/group';
import { pushPull, retagCurves, type CurveCandidate } from '../core/ops/pushPull';

/**
 * Building blocks for library items: parts made of boxes, prisms, cylinders and lathed shapes,
 * joined into one solid per part (a boolean union), with holes cut out of them. Sizes are in
 * millimetres; items stand on the ground (z = 0), centred on the origin, front facing -Y.
 */

/** The paints library items use (plain colours, so items stay light). */
export const PAINTS = {
  oak: { name: 'Oak', color: '#b98d5f' },
  walnut: { name: 'Walnut', color: '#6e4b33' },
  white: { name: 'White', color: '#f1f1ee' },
  offWhite: { name: 'Off-white', color: '#e6e1d6' },
  lightGrey: { name: 'Light grey', color: '#c8c9c9' },
  darkGrey: { name: 'Dark grey', color: '#55585c' },
  black: { name: 'Black', color: '#222325' },
  steel: { name: 'Steel', color: '#a9afb5' },
  fabric: { name: 'Fabric grey', color: '#8b9096' },
  fabricBlue: { name: 'Fabric blue', color: '#536f8f' },
  linen: { name: 'Linen', color: '#ece6da' },
  worktop: { name: 'Worktop stone', color: '#d9d4cc' },
  ceramic: { name: 'Ceramic', color: '#f7f7f4' },
  screen: { name: 'Screen', color: '#121519' },
  glass: { name: 'Glass', color: '#bfe1ee', opacity: 0.35 },
  mirror: { name: 'Mirror', color: '#d7e6ec' },
  shade: { name: 'Lampshade', color: '#efe5cf' },
  terracotta: { name: 'Terracotta', color: '#b8653f' },
  leaf: { name: 'Leaf green', color: '#5d8a4a' },
  rug: { name: 'Rug', color: '#9c7b64' },
} as const;

export type Paint = keyof typeof PAINTS;

/** One piece of an item: a closed solid (or several apart) with one paint. */
export interface LibraryPart {
  name: string;
  paint: Paint;
  model: Model;
}

export type Axis = 'x' | 'y' | 'z';
const DIR: Record<Axis, Vec3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/** A box between two corners. */
function boxModel(a: Vec3, b: Vec3): Model {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const [z0, z1] = [Math.min(a[2], b[2]), Math.max(a[2], b[2])];
  return prismModel(
    [
      [x0, y0, z0],
      [x1, y0, z0],
      [x1, y1, z0],
      [x0, y1, z0],
    ],
    [0, 0, z1 - z0],
  );
}

/** A flat outline swept straight along `along` (which must not lie in its plane). */
function prismModel(ring: readonly Vec3[], along: Vec3): Model {
  const m = new Model();
  const pts = dot(newellNormal(ring), along) < 0 ? [...ring].reverse() : [...ring];
  const bottom = pts.map((p) => m.addVertex(p));
  const top = pts.map((p) => m.addVertex(add(p, along)));
  const n = newellNormal(pts);
  const up = scale(n, 1 / Math.hypot(...n));
  m.addFace([...bottom].reverse(), [], { normal: scale(up, -1) });
  m.addFace(top, [], { normal: up });
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const side = cross(sub3(pts[j], pts[i]), along);
    m.addFace([bottom[i], bottom[j], top[j], top[i]], [], { normal: scale(side, 1 / Math.hypot(...side)) });
  }
  return m;
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** A round bar: a true circle of radius `r` at `base`, pushed `length` along the axis. */
function cylinderModel(axis: Axis, base: Vec3, r: number, length: number, sides: number): Model {
  const m = new Model();
  const dir = DIR[axis];
  const face = drawCircle(m, makePlane(base, dir), base, r, sides).inner!;
  pushPull(m, face, dot(m.face(face).normal, dir) > 0 ? length : -length);
  return m;
}

/**
 * A shape turned about a vertical axis through `center`: `profile` is a closed outline of
 * (radius, height) points, radius ≥ 0. Points at radius 0 stay on the axis (a closed top or base).
 */
function latheModel(center: Vec3, profile: readonly (readonly [number, number])[], sides: number): Model {
  const m = new Model();
  let widest = 0;
  for (let i = 1; i < profile.length; i++) if (profile[i][0] > profile[widest][0]) widest = i;
  const [r, h] = profile[widest];
  const c: Vec3 = [center[0], center[1], center[2] + h];
  const circle = drawCircle(m, makePlane(c, [0, 0, 1], [1, 0, 0]), c, r, sides).inner!;
  const ring = m.faceHalfEdges(circle).map((e) => Math.min(e, m.he(e).twin));
  m.removeFace(circle);
  const pts = profile.map(([pr, ph]): Vec3 => [center[0] + pr, center[1], center[2] + ph]);
  const { faces } = drawEdges(m, [...pts, pts[0]]);
  const result = followMe(m, faces[0], ring);
  // Only the solid: the path's edges are left behind.
  return extractGeometry(m, result.faces, []);
}

/**
 * A part of an item. Shapes added to it are joined into one solid where they overlap (so they
 * should overlap, not just touch); `cut*` shapes are taken away from it at the end.
 */
export class Part {
  private shapes: Model[] = [];
  private cuts: Model[] = [];

  constructor(
    readonly name: string,
    readonly paint: Paint,
  ) {}

  box(a: Vec3, b: Vec3): this {
    this.shapes.push(boxModel(a, b));
    return this;
  }

  prism(ring: readonly Vec3[], along: Vec3): this {
    this.shapes.push(prismModel(ring, along));
    return this;
  }

  cylinder(axis: Axis, base: Vec3, r: number, length: number, sides = 24): this {
    this.shapes.push(cylinderModel(axis, base, r, length, sides));
    return this;
  }

  lathe(center: Vec3, profile: readonly (readonly [number, number])[], sides = 24): this {
    this.shapes.push(latheModel(center, profile, sides));
    return this;
  }

  cutBox(a: Vec3, b: Vec3): this {
    this.cuts.push(boxModel(a, b));
    return this;
  }

  cutCylinder(axis: Axis, base: Vec3, r: number, length: number, sides = 24): this {
    this.cuts.push(cylinderModel(axis, base, r, length, sides));
    return this;
  }

  /** Join the shapes and make the cuts. */
  build(): LibraryPart {
    if (!this.shapes.length) throw new Error(`${this.name} has no shapes`);
    const curves: CurveCandidate[] = [];
    for (const s of [...this.shapes, ...this.cuts]) for (const c of s.curves.values()) curves.push({ ...c, scratch: true });
    const model = this.shapes[0].clone();
    for (const c of [...model.curves.values()]) curves.push({ ...c });
    const steps: [Model, 'union' | 'subtract'][] = [...this.shapes.slice(1).map((s): [Model, 'union'] => [s, 'union']), ...this.cuts.map((s): [Model, 'subtract'] => [s, 'subtract'])];
    for (const [tool, op] of steps) {
      const target = new Set<FaceId>(model.faces.keys());
      const result = booleanInPlace(model, target, { model: tool, faces: [...tool.faces.keys()] }, op);
      const touched = new Set<VertexId>(result.newVertices);
      mergeCoplanarFaces(model, [...model.faces.keys()], touched);
      removeCollinearVertices(model, touched);
    }
    // A lathed shape's flat ends come as wedges: join them up.
    const touched = new Set<VertexId>();
    mergeCoplanarFaces(model, [...model.faces.keys()], touched);
    removeCollinearVertices(model, touched);
    retagCurves(model, new Set(model.faces.keys()), curves);
    return { name: this.name, paint: this.paint, model };
  }
}

/** A new part. */
export const part = (name: string, paint: Paint): Part => new Part(name, paint);
