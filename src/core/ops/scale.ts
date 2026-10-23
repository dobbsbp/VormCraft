import type { Vec3 } from '../math/vec3';
import type { FaceId, Model, VertexId } from '../model/Model';
import { scaling, transformVertices } from './transform';

/**
 * Every vertex of the connected pieces containing the given faces and edges. Scaling works on
 * whole pieces, since scaling part of a solid would bend its other faces out of plane.
 */
export function connectedVertices(model: Model, faces: Iterable<FaceId>, edges: Iterable<number>): Set<VertexId> {
  const verts = new Set<VertexId>();
  const stack: VertexId[] = [];
  const push = (v: VertexId) => {
    if (!verts.has(v)) {
      verts.add(v);
      stack.push(v);
    }
  };
  for (const f of faces) if (model.faces.has(f)) model.faceVertexLoops(f).flat().forEach(push);
  for (const e of edges) {
    if (!model.halfEdges.has(e)) continue;
    push(model.he(e).origin);
    push(model.dest(e));
  }
  while (stack.length) {
    for (const h of model.outgoing(stack.pop()!)) push(model.dest(h));
  }
  return verts;
}

/**
 * Scale whole connected pieces about `base` by per-axis factors (x, y, z). Faces stay flat (the
 * map is affine), normals follow, a negative overall factor (a mirror) keeps solids
 * outward-facing, and circles keep their true radius under uniform scaling (they become ellipses
 * otherwise, so their curve tags are dropped).
 */
export function scalePieces(model: Model, vertices: ReadonlySet<VertexId>, base: Vec3, factors: Vec3): void {
  if (factors.some((f) => f === 0 || !Number.isFinite(f))) throw new Error('Scale factors must be non-zero numbers');
  transformVertices(model, vertices, scaling(base, factors));
}
