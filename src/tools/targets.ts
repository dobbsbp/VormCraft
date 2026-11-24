import { add, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import type { Guide, GuideId } from '../doc/Guides';
import { guideFirst } from './SelectTool';
import type { VertexId } from '../core/model/Model';
import { connectedVertices } from '../core/ops/scale';
import { pointVertices } from '../core/ops/points';
import { applyAffine, duplicateVertices, transformVertices, type Affine } from '../core/ops/transform';
import type { Document } from '../doc/Document';
import type { GroupId } from '../doc/Groups';
import { groupModels } from './groupModels';
import type { LabelId } from '../doc/Labels';
import type { SectionId } from '../doc/Sections';
import { sectionFrames } from './sectionPick';
import type { PreviewLines, ToolContext, ToolEvent, Vec3Pair } from './types';

/** What Move / Rotate act on. Groups move whole. */
export interface Targets {
  vertices: Set<VertexId>;
  labels: LabelId[];
  guides: GuideId[];
  groups: GroupId[];
  /** Section planes (moved or turned like guides). */
  sections: SectionId[];
}

/**
 * The selection (its own vertices, with a selected point's copies where parts touch, and labels), or with nothing selected the whole object under
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
    pointVertices(doc.model, selection.points).forEach((v) => vertices.add(v));
    return { vertices, labels: [...selection.labels], guides: [...selection.guides], groups: [...selection.groups], sections: [...selection.sections] };
  }
  // Nothing selected: the guide under the cursor (it sits on top), else the object.
  const guide = guideFirst(e);
  if (guide !== null) return { vertices: new Set(), labels: [], guides: [guide], groups: [], sections: [] };
  if (e.section != null && e.edge === null) return { vertices: new Set(), labels: [], guides: [], groups: [], sections: [e.section] };
  if (e.edge !== null) return { vertices: connectedVertices(doc.model, [], [e.edge]), labels: [], guides: [], groups: [], sections: [] };
  if (e.group !== null) return { vertices: new Set(), labels: [], guides: [], groups: [e.group], sections: [] };
  if (e.face !== null) return { vertices: connectedVertices(doc.model, [e.face], []), labels: [], guides: [], groups: [], sections: [] };
  throw new Error('Select something first, or click on the object');
}

/**
 * Apply `steps` transforms: with `copy`, each step makes a new copy (arrays); otherwise the
 * targets themselves are transformed once by the first transform.
 */
export function applyToTargets(doc: Document, t: Targets, steps: Affine[], copy: boolean): void {
  if (!copy) {
    if (t.vertices.size) transformVertices(doc.model, t.vertices, steps[0]);
    for (const id of t.groups) if (doc.groups.has(id)) doc.groups.transform(id, steps[0]);
    moveLabels(doc, t.labels, steps[0]);
    for (const id of t.guides) {
      const g = doc.guides.items.get(id);
      if (g) doc.guides.update(transformGuide(g, steps[0]));
    }
    for (const id of t.sections) {
      const s = doc.sections.items.get(id);
      if (!s) continue;
      const m = transformSection(s, steps[0]);
      s.point = m.point;
      s.normal = m.normal;
    }
    return;
  }
  for (const a of steps) {
    if (t.vertices.size) {
      const map = duplicateVertices(doc.model, t.vertices);
      transformVertices(doc.model, new Set(map.values()), a);
    }
    for (const id of t.groups) {
      if (!doc.groups.has(id)) continue;
      const copy = doc.groups.duplicate(id, doc.groups.get(id)!.parent);
      doc.groups.transform(copy, a);
    }
    for (const id of t.labels) {
      const l = doc.labels.items.get(id);
      if (l) doc.labels.add(applyAffine(a, l.anchor), applyAffine(a, l.position), l.text, l.end && applyAffine(a, l.end));
    }
    for (const id of t.guides) {
      const g = doc.guides.items.get(id);
      if (g) doc.guides.addLike(transformGuide(g, a));
    }
    for (const id of t.sections) {
      const s = doc.sections.items.get(id);
      if (s) {
        const m = transformSection(s, a);
        doc.sections.add(m.point, m.normal);
      }
    }
  }
}

/** A section plane's point and normal after an affine map (the normal turns with it). */
function transformSection(s: { point: Vec3; normal: Vec3 }, a: Affine): { point: Vec3; normal: Vec3 } {
  const point = applyAffine(a, s.point);
  return { point, normal: normalize(sub(applyAffine(a, add(s.point, s.normal)), point)) };
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
    if (l.end) l.end = applyAffine(a, l.end);
  }
}

/**
 * The preview of the targets moved by `a`: the lines that move whole (groups, guides, section
 * planes, and lines with both ends moving), worked out once per `Targets` and drawn moved by `a`,
 * and the lines the move stretches (one end moving), worked out each time.
 */
export function previewLines(doc: Document, t: Targets, a: Affine): PreviewLines[] {
  let whole = wholeOutlines.get(t);
  if (!whole) {
    whole = outline(doc, t, true).flat();
    wholeOutlines.set(t, whole);
  }
  return [
    { points: whole, transform: a, color: 'select', width: 1.5 },
    { points: outline(doc, t, false, a).flat(), color: 'select', width: 1.5 },
  ];
}

/** Each set of targets' unmoved outline (they do not change while a tool holds them). */
const wholeOutlines = new WeakMap<Targets, Vec3[]>();

/** The whole-moving part of the outline (unmoved), or the stretched lines after `a`. */
function outline(doc: Document, t: Targets, whole: boolean, a?: Affine): Vec3Pair[] {
  const m = doc.model;
  const out: Vec3Pair[] = [];
  for (const e of m.edges()) {
    if (m.he(e).hidden) continue;
    const p = m.he(e).origin;
    const q = m.dest(e);
    const n = (t.vertices.has(p) ? 1 : 0) + (t.vertices.has(q) ? 1 : 0);
    if (whole && n === 2) out.push([m.pos(p), m.pos(q)]);
    else if (!whole && n === 1) out.push([t.vertices.has(p) ? applyAffine(a!, m.pos(p)) : m.pos(p), t.vertices.has(q) ? applyAffine(a!, m.pos(q)) : m.pos(q)]);
  }
  if (!whole) return out;
  for (const id of t.groups) {
    for (const g of groupModels(doc, id)) for (const e of g.edges()) out.push([g.pos(g.he(e).origin), g.pos(g.dest(e))]);
  }
  for (const id of t.guides) {
    const g = doc.guides.items.get(id);
    if (!g) continue;
    if (g.kind === 'line') out.push([add(g.point, scale(g.dir, -2000)), add(g.point, scale(g.dir, 2000))]);
    else for (const d of [[5, 0, 0], [0, 5, 0], [0, 0, 5]] as Vec3[]) out.push([sub(g.pos, d), add(g.pos, d)]);
  }
  if (t.sections.length) {
    const frames = sectionFrames(doc);
    for (const id of t.sections) {
      const c = frames.get(id);
      if (c) for (let i = 0; i < 4; i++) out.push([c[i], c[(i + 1) % 4]]);
    }
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
