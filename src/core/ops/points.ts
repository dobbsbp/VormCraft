import { distance } from '../math/vec3';
import { TOL } from '../math/tolerance';
import type { Model, VertexId } from '../model/Model';

/**
 * The vertices at the same spot as `v` (itself included). Parts touching at a point or along an
 * edge keep vertices of their own there (copies at the same spot), and a point moves them together.
 */
export function pointCopies(model: Model, v: VertexId): VertexId[] {
  const p = model.pos(v);
  return [...model.vertices.values()].filter((w) => w.id === v || distance(w.pos, p) <= TOL).map((w) => w.id);
}

/**
 * Whether `v` is a point: an end where two or more lines meet (counting the lines of every copy
 * at that spot). The loose end of a single line is not one; select the line instead.
 */
export function isPoint(model: Model, v: VertexId): boolean {
  if (!model.vertices.has(v)) return false;
  if (model.outgoing(v).size >= 2) return true;
  let lines = 0;
  for (const w of pointCopies(model, v)) lines += model.outgoing(w).size;
  return lines >= 2;
}

/** The selected points with their copies: the vertices that move with them. */
export function pointVertices(model: Model, points: Iterable<VertexId>): Set<VertexId> {
  const out = new Set<VertexId>();
  for (const v of points) if (model.vertices.has(v)) pointCopies(model, v).forEach((w) => out.add(w));
  return out;
}
