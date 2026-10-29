import { add, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import type { Guide, GuideId } from '../doc/Guides';
import { guideFirst } from './SelectTool';
import type { VertexId } from '../core/model/Model';
import { connectedVertices } from '../core/ops/scale';
import { applyAffine, duplicateVertices, transformVertices, type Affine } from '../core/ops/transform';
import type { Document } from '../doc/Document';
import type { LabelId } from '../doc/Labels';
import type { ToolContext, ToolEvent, Vec3Pair } from './types';

/** What Move / Rotate act on. */
export interface Targets {
  vertices: Set<VertexId>;
  labels: LabelId[];
  guides: GuideId[];
}

/**
 * The selection (its own vertices and labels), or with nothing selected the whole object under
 * the cursor.
 */
export function targetsAt(ctx: ToolContext, e: ToolEvent): Targets {
  const { selection, doc } = ctx;
  if (selection.size > 0) {
    const vertices = new Set<VertexId>();
    for (const f of selection.faces) if (doc.model.faces.has(f)) doc.model.faceVertexLoops(f).flat().forEach((v) => vertices.add(v));
    for (const ed of selection.edges) {
      if (!doc.model.halfEdges.has(ed)) continue;
      vertices.add(doc.model.he(ed).origin);
      vertices.add(doc.model.dest(ed));
    }
    return { vertices, labels: [...selection.labels], guides: [...selection.guides] };
  }
  // Nothing selected: the guide under the cursor (it sits on top), else the object.
  const guide = guideFirst(e);
  if (guide !== null) return { vertices: new Set(), labels: [], guides: [guide] };
  if (e.face !== null) return { vertices: connectedVertices(doc.model, [e.face], []), labels: [], guides: [] };
  if (e.edge !== null) return { vertices: connectedVertices(doc.model, [], [e.edge]), labels: [], guides: [] };
  throw new Error('Select something first, or click on the object');
}

/**
 * Apply `steps` transforms: with `copy`, each step makes a new copy (arrays); otherwise the
 * targets themselves are transformed once by the first transform.
 */
export function applyToTargets(doc: Document, t: Targets, steps: Affine[], copy: boolean): void {
  if (!copy) {
    if (t.vertices.size) transformVertices(doc.model, t.vertices, steps[0]);
    moveLabels(doc, t.labels, steps[0]);
    for (const id of t.guides) {
      const g = doc.guides.items.get(id);
      if (g) doc.guides.update(transformGuide(g, steps[0]));
    }
    return;
  }
  for (const a of steps) {
    if (t.vertices.size) {
      const map = duplicateVertices(doc.model, t.vertices);
      transformVertices(doc.model, new Set(map.values()), a);
    }
    for (const id of t.labels) {
      const l = doc.labels.items.get(id);
      if (l) doc.labels.add(applyAffine(a, l.anchor), applyAffine(a, l.position), l.text);
    }
    for (const id of t.guides) {
      const g = doc.guides.items.get(id);
      if (g) doc.guides.addLike(transformGuide(g, a));
    }
  }
}

/** A guide moved by an affine map (its line direction turns with it). */
function transformGuide(g: Guide, a: Affine): Guide {
  if (g.kind === 'point') return { ...g, pos: applyAffine(a, g.pos) };
  return { ...g, point: applyAffine(a, g.point), dir: normalize(sub(applyAffine(a, add(g.point, g.dir)), applyAffine(a, g.point))) };
}

function moveLabels(doc: Document, ids: LabelId[], a: Affine): void {
  for (const id of ids) {
    const l = doc.labels.items.get(id);
    if (!l) continue;
    l.anchor = applyAffine(a, l.anchor);
    l.position = applyAffine(a, l.position);
  }
}

/** Edges among the targets (and edges they stretch), as segment pairs after a transform. */
export function previewEdges(doc: Document, t: Targets, a: Affine): Vec3Pair[] {
  const m = doc.model;
  const out: Vec3Pair[] = [];
  const at = (v: VertexId): Vec3 => (t.vertices.has(v) ? applyAffine(a, m.pos(v)) : m.pos(v));
  for (const e of m.edges()) {
    const p = m.he(e).origin;
    const q = m.dest(e);
    if (t.vertices.has(p) || t.vertices.has(q)) out.push([at(p), at(q)]);
  }
  // Moved guides: a long stretch of each line, and a small cross for each point.
  for (const id of t.guides) {
    const g = doc.guides.items.get(id);
    if (!g) continue;
    const moved = transformGuide(g, a);
    if (moved.kind === 'line') out.push([add(moved.point, scale(moved.dir, -2000)), add(moved.point, scale(moved.dir, 2000))]);
    else for (const d of [[5, 0, 0], [0, 5, 0], [0, 0, 5]] as Vec3[]) out.push([sub(moved.pos, d), add(moved.pos, d)]);
  }
  return out;
}

/** "3x" (copies) or "/3" (divide) after a copy; undefined otherwise. */
export function parseArray(text: string): { count: number; divide: boolean } | undefined {
  const m = /^\s*(?:(\d+)\s*[x*]|[x*]\s*(\d+)|\/\s*(\d+))\s*$/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1] ?? m[2] ?? m[3]);
  if (!(n >= 1 && n <= 500)) throw new Error('Use between 1 and 500 copies');
  return { count: n, divide: m[3] !== undefined };
}
