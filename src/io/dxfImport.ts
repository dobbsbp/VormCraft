import { curveToPaths, type CurveDetail, type DrawingCurve, type LinePath } from '../core/ops/drawingCurves';
import { importLayers } from '../core/ops/importLines';
import { importMesh } from '../core/ops/importMesh';
import { add, dot, scale, sub, type Vec3 } from '../core/math/vec3';
import { Model } from '../core/model/Model';
import type { DxfDimension, DxfDrawing } from './dxfFile';
import { UNIT_MM, type ImportUnit } from './meshFiles';

/** How to bring a DXF drawing in (asked by the import dialog). */
export interface DxfChoice {
  unit: ImportUnit;
  detail: CurveDetail;
  /** Fill closed flat outlines with faces. */
  faces: boolean;
  /** The layers to bring in. */
  layers: readonly string[];
}

/** A group to add: the file, with a group per layer inside. */
export interface DrawingPart {
  name: string;
  model: Model;
  children: DrawingPart[];
}

/** A text or dimension, as a label (`Labels.add`): a dimension has an `end`. */
export interface DrawingLabel {
  anchor: Vec3;
  position: Vec3;
  text: string;
  end?: Vec3;
}

export interface DxfImport {
  root: DrawingPart;
  labels: DrawingLabel[];
  edges: number;
  faces: number;
  /** True circles kept (arcs and circles, including splines found to be arcs). */
  circles: number;
}

/** Layers on by default: those switched on in the file, and not hidden-line layers (Rhino's Make2D and the like). */
export function defaultLayers(d: DxfDrawing): string[] {
  return d.layers.filter((l) => !l.off && !/hidden/i.test(l.name)).map((l) => l.name);
}

/** The curve scaled by k (into millimetres). */
function scaled(c: DrawingCurve, k: number): DrawingCurve {
  const s = (p: Vec3) => scale(p, k);
  if (c.kind === 'path') return { kind: 'path', points: c.points.map(s) };
  if (c.kind === 'conic') return { ...c, center: s(c.center), u: s(c.u), v: s(c.v) };
  return { ...c, points: c.points.map(s) };
}

/** Paths for the chosen layers, in millimetres. */
function layerPaths(d: DxfDrawing, choice: Pick<DxfChoice, 'unit' | 'detail' | 'layers'>): Map<string, LinePath[]> {
  const k = UNIT_MM[choice.unit];
  const on = new Set(choice.layers);
  const out = new Map<string, LinePath[]>();
  for (const c of d.curves) {
    if (!on.has(c.layer)) continue;
    if (!out.has(c.layer)) out.set(c.layer, []);
    out.get(c.layer)!.push(...curveToPaths(scaled(c.curve, k), choice.detail));
  }
  return out;
}

/** How many segments the chosen layers' curves become (shown live as the detail changes). */
export function countSegments(d: DxfDrawing, choice: Pick<DxfChoice, 'unit' | 'detail' | 'layers'>): number {
  let n = 0;
  for (const paths of layerPaths(d, choice).values()) for (const p of paths) n += p.points.length - 1;
  return n;
}

/** The drawing's extent in file units (control points and the like: close enough to show its size). */
export function drawingBounds(d: DxfDrawing, layers?: readonly string[]): { min: Vec3; max: Vec3 } | null {
  const on = layers ? new Set(layers) : null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const take = (p: Vec3) => {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], p[i]);
      max[i] = Math.max(max[i], p[i]);
    }
  };
  for (const { layer, curve: c } of d.curves) {
    if (on && !on.has(layer)) continue;
    if (c.kind === 'conic') for (const sx of [-1, 1]) for (const sy of [-1, 1]) take(add(c.center, add(scale(c.u, sx), scale(c.v, sy))));
    else c.points.forEach(take);
  }
  for (const f of d.faces) if (!on || on.has(f.layer)) f.points.forEach(take);
  return min[0] <= max[0] ? { min: min as unknown as Vec3, max: max as unknown as Vec3 } : null;
}

const trimNumber = (x: number) => String(Math.round(x * 100) / 100);

/** A dimension as a label: linear ones as VormCraft dimensions, others as their text. */
function dimensionLabel(dim: DxfDimension, k: number): DrawingLabel | null {
  const custom = dim.text === '<>' ? '' : dim.text.replace(/<>/g, Number.isFinite(dim.measured) ? trimNumber(dim.measured) : '');
  if (dim.kind === 'linear') {
    const a = scale(dim.a, k);
    const b = scale(dim.b, k);
    const line = scale(dim.line, k);
    const along = dot(sub(b, a), dim.dir);
    if (Math.abs(along) < 1e-9) return null;
    // Measured along its direction: the far end slides along its extension line onto that.
    const end = add(a, scale(dim.dir, along));
    const foot = (p: Vec3) => add(line, scale(dim.dir, dot(sub(p, line), dim.dir)));
    return { anchor: a, end, position: scale(add(foot(a), foot(b)), 0.5), text: custom };
  }
  const point = scale(dim.point, k);
  let text = custom;
  if (!text && Number.isFinite(dim.measured)) {
    if (dim.type === 2 || dim.type === 5) text = `${trimNumber((dim.measured * 180) / Math.PI)}°`;
    else if (dim.type === 3) text = `Ø${trimNumber(dim.measured)}`;
    else if (dim.type === 4) text = `R${trimNumber(dim.measured)}`;
    else text = trimNumber(dim.measured);
  }
  return text ? { anchor: point, position: point, text } : null;
}

/**
 * Turn a read DXF drawing into geometry: one group for the file with a group per chosen layer
 * (edges, true circles, faces where outlines close; 3D faces as their own group), and its texts
 * and dimensions as labels. Everything is scaled into millimetres.
 */
export function convertDxf(d: DxfDrawing, choice: DxfChoice, name: string): DxfImport {
  const k = UNIT_MM[choice.unit];
  const on = new Set(choice.layers);
  const root: DrawingPart = { name, model: new Model(), children: [] };
  let edges = 0;
  let faces = 0;
  let circles = 0;
  const paths = layerPaths(d, choice);
  const chosen = d.layers.map((l) => l.name).filter((l) => on.has(l));
  const lines = importLayers(
    chosen.map((l) => paths.get(l) ?? []),
    { faces: choice.faces },
  );
  edges += lines.edges;
  faces += lines.faces;
  circles += lines.circles;
  chosen.forEach((layer, i) => {
    const model = lines.models[i];
    if (model.halfEdges.size) root.children.push({ name: layer, model, children: [] });
    const polys = d.faces.filter((f) => f.layer === layer).map((f) => f.points.map((p) => scale(p, k)));
    if (polys.length) {
      const m = importMesh(polys, { smoothAngle: 20 });
      faces += m.model.faces.size;
      if (m.model.faces.size) root.children.push({ name: `${layer} (surfaces)`, model: m.model, children: [] });
    }
  });
  const labels: DrawingLabel[] = [];
  for (const t of d.texts) {
    if (!on.has(t.layer)) continue;
    const p = scale(t.point, k);
    labels.push({ anchor: p, position: p, text: t.text });
  }
  for (const dim of d.dimensions) {
    if (!on.has(dim.layer)) continue;
    const l = dimensionLabel(dim, k);
    if (l) labels.push(l);
  }
  return { root, labels, edges, faces, circles };
}
