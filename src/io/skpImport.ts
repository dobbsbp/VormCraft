import type { SkpModel } from 'openskp';
import { cross, dot, length, newellNormal, normalize, scale, type Vec3 } from '../core/math/vec3';
import { Model, type VertexId } from '../core/model/Model';
import type { MaterialFields } from '../doc/Materials';
import { DEFAULT_STYLE, type Scene } from '../doc/Scenes';

/**
 * SketchUp (.skp) files, read by OpenSKP (an independent, open-source reader; VormCraft is not
 * affiliated with Trimble or SketchUp), turned into VormCraft geometry:
 * - every placed group or component becomes a group (nested as in the file; VormCraft has no
 *   components, so each placement of a component becomes its own copy), with its position,
 *   rotation and scale applied;
 * - faces keep their holes, paint, and soft/smooth edges; circles and arcs keep their true radius;
 * - materials (colours, transparency, textures at their real size), scenes (cameras) and guides.
 * SketchUp allows faces our solids do not (a face turned the other way from its neighbours, three
 * faces on one edge): such a face is turned round to fit, or else given its own edges.
 */

type Definition = SkpModel['root'];
type Instance = Definition['instances'][number];

const INCH = 25.4;
/** Placements nest no deeper than this (guards against a broken file referring to itself). */
const MAX_DEPTH = 40;

/** One imported group: its own geometry (already in place, in millimetres) and the groups inside it. */
export interface SkpPart {
  name: string;
  model: Model;
  /** Key into `SkpImport.materials` of the paint on the whole group, if any. */
  material?: string;
  hidden?: boolean;
  children: SkpPart[];
}

export interface SkpStats {
  version: string;
  units: string | null;
  /** Faces in the file's definitions, and after every placement is made into its own copy. */
  definitionFaces: number;
  placedFaces: number;
  placements: number;
  materials: number;
  scenes: number;
  guides: number;
}

export interface SkpImport {
  /** The whole file, as one group (its loose geometry, with every placed group inside). */
  root: SkpPart;
  /** Materials used by the imported faces and groups, by key (faces' `material` holds the key). */
  materials: Map<string, MaterialFields>;
  scenes: Omit<Scene, 'id'>[];
  guides: { lines: { point: Vec3; dir: Vec3 }[]; points: Vec3[] };
  /** How the faces went in. */
  faces: { total: number; turned: number; detached: number; skipped: number };
}

/** A 4×4 row-major transform (inches). */
type M4 = number[];
const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * A placement's transform: SketchUp stores 13 numbers (a row-major 3×3, the translation, then an
 * overall scale factor), or occasionally a column-major 4×4.
 */
export function placementMatrix(m: readonly number[]): M4 {
  if (m.length === 16) return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14], 0, 0, 0, 1];
  if (m.length < 12) return IDENTITY;
  const s = m.length >= 13 && m[12] !== 0 ? m[12] : 1;
  return [m[0] * s, m[1] * s, m[2] * s, m[9] * s, m[3] * s, m[4] * s, m[5] * s, m[10] * s, m[6] * s, m[7] * s, m[8] * s, m[11] * s, 0, 0, 0, 1];
}

const mul = (a: M4, b: M4): M4 => {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
  return r;
};
/** A point (inches, local) to the world, in millimetres. */
const toWorld = (m: M4, x: number, y: number, z: number): Vec3 => [
  (m[0] * x + m[1] * y + m[2] * z + m[3]) * INCH,
  (m[4] * x + m[5] * y + m[6] * z + m[7]) * INCH,
  (m[8] * x + m[9] * y + m[10] * z + m[11]) * INCH,
];
/** A direction (no translation, no unit change). */
const turn = (m: M4, v: readonly number[]): Vec3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[4] * v[0] + m[5] * v[1] + m[6] * v[2], m[8] * v[0] + m[9] * v[1] + m[10] * v[2]];
const det3 = (m: M4) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);

/** The definition an instance places. */
function definitionOf(skp: SkpModel, inst: Instance): Definition | undefined {
  return skp.definitions.get(inst.refIdx) ?? [...skp.definitions.values()][inst.refIdx];
}

/** What the file holds, for the import window (cheap: no geometry is built). */
export function summarizeSkp(skp: SkpModel): SkpStats {
  let placedFaces = 0;
  let placements = 0;
  const count = (def: Definition, depth: number) => {
    placedFaces += def.faces.length;
    if (depth >= MAX_DEPTH) return;
    for (const inst of def.instances) {
      const child = definitionOf(skp, inst);
      if (!child) continue;
      placements++;
      count(child, depth + 1);
    }
  };
  count(skp.root, 0);
  return {
    version: skp.version,
    units: skp.units,
    definitionFaces: skp.root.faces.length + [...skp.definitions.values()].reduce((n, d) => n + d.faces.length, 0),
    placedFaces,
    placements,
    materials: skp.materials.length,
    scenes: skp.pages.length,
    guides: skp.root.constructionLines.length + skp.root.constructionPoints.length,
  };
}

export interface SkpConvertOptions {
  /** The file's name (without extension), for the top group. */
  name: string;
  scenes?: boolean;
  guides?: boolean;
}

export function convertSkp(skp: SkpModel, opts: SkpConvertOptions): SkpImport {
  const faces = { total: 0, turned: 0, detached: 0, skipped: 0 };
  const usedMaterials = new Set<number>();
  const materialKey = (id: number | null | undefined): string | undefined => {
    if (id === null || id === undefined || !skp.materialsById.has(id)) return undefined;
    usedMaterials.add(id);
    return `skp${id}`;
  };

  const build = (def: Definition, m: M4): Model => {
    const model = new Model();
    const verts = new Map(def.vertices.map((v) => [v.id, v]));
    const edges = new Map(def.edges.map((e) => [e.id, e]));
    const ids = new Map<number, VertexId>();
    const vertex = (id: number): VertexId => {
      let v = ids.get(id);
      if (v === undefined) {
        const p = verts.get(id);
        if (!p) throw new Error('missing vertex');
        v = model.addVertex(toWorld(m, p.x, p.y, p.z));
        ids.set(id, v);
      }
      return v;
    };
    // A mirroring placement turns faces inside out: run their loops the other way.
    const mirrored = det3(m) < 0;
    const used = new Set<number>();
    for (const face of def.faces) {
      faces.total++;
      let rings: VertexId[][];
      try {
        rings = face.loops.map((loop) =>
          loop.map((ce) => {
            const e = edges.get(ce.edgeId);
            if (!e) throw new Error('missing edge');
            used.add(e.id);
            return vertex(ce.orientation >= 0 ? e.v1Id : e.v2Id);
          }),
        );
        if (mirrored) rings = rings.map((r) => [...r].reverse());
        if (rings.some((r) => r.length < 3 || new Set(r).size !== r.length)) throw new Error('degenerate');
      } catch {
        faces.skipped++;
        continue;
      }
      const material = materialKey(face.materialId ?? face.backMaterialId);
      const add = (loops: VertexId[][]) => {
        const normal = newellNormal(loops[0].map((v) => model.pos(v)));
        model.addFace(loops[0], loops.slice(1), { normal, ...(material !== undefined ? { material } : {}) });
      };
      try {
        add(rings);
        continue;
      } catch {
        // Not joined as it is: see below.
      }
      try {
        add(rings.map((r) => [...r].reverse()));
        faces.turned++;
        continue;
      } catch {
        // Still clashes (three faces on an edge): give the face corners of its own.
      }
      try {
        add(rings.map((r) => r.map((v) => model.addVertex(model.pos(v)))));
        faces.detached++;
      } catch {
        faces.skipped++;
      }
    }
    // Edges drawn on their own (not around a face), unless SketchUp hides them.
    for (const e of def.edges) {
      if (used.has(e.id) || e.hidden || e.v1Id === e.v2Id) continue;
      try {
        model.addEdge(vertex(e.v1Id), vertex(e.v2Id));
      } catch {
        // A broken edge: leave it out.
      }
    }
    // Soft, smooth and hidden edges are not drawn (curved surfaces read as one surface).
    for (const e of def.edges) {
      if (!(e.soft || e.smooth || e.hidden)) continue;
      const a = ids.get(e.v1Id);
      const b = ids.get(e.v2Id);
      if (a !== undefined && b !== undefined && model.halfEdgeBetween(a, b) !== undefined) model.setEdgeSoft(a, b, true);
    }
    addCurves(model, def, m, ids);
    model.purgeFree();
    model.validate();
    return model;
  };

  const visit = (def: Definition, m: M4, name: string, inst: Instance | null, depth: number): SkpPart | null => {
    const model = build(def, m);
    const children: SkpPart[] = [];
    if (depth < MAX_DEPTH) {
      for (const child of def.instances) {
        const cdef = definitionOf(skp, child);
        if (!cdef) continue;
        const part = visit(cdef, mul(m, placementMatrix(child.matrix)), child.name || cdef.name || (cdef.isGroup ? 'Group' : 'Component'), child, depth + 1);
        if (part) children.push(part);
      }
    }
    if (!model.faces.size && !model.halfEdges.size && !children.length) return null;
    const material = materialKey(inst?.materialId);
    return { name, model, children, ...(material !== undefined ? { material } : {}), ...(inst?.hidden ? { hidden: true } : {}) };
  };

  const root = visit(skp.root, IDENTITY, opts.name, null, 0) ?? { name: opts.name, model: new Model(), children: [] };

  const materials = new Map<string, MaterialFields>();
  for (const id of usedMaterials) {
    const mat = skp.materialsById.get(id);
    if (mat) materials.set(`skp${id}`, materialFields(mat));
  }

  const scenes: Omit<Scene, 'id'>[] = [];
  if (opts.scenes) {
    for (const p of skp.pages) {
      if (!p.eye || !p.target) continue;
      const eye = scale(p.eye as Vec3, INCH);
      const target = scale(p.target as Vec3, INCH);
      const fov = p.fov > 1 && p.fov < 170 ? p.fov : 35;
      const dist = length([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
      const height = p.parallel && p.orthoHeight > 0 ? p.orthoHeight * INCH : 2 * Math.max(dist, 1) * Math.tan((fov * Math.PI) / 360);
      scenes.push({
        name: p.name || `Scene ${scenes.length + 1}`,
        parts: { camera: true, hidden: false, style: false },
        camera: { position: eye, target, fov, projection: p.parallel ? 'parallel' : 'perspective', height },
        hidden: [],
        style: { ...DEFAULT_STYLE },
      });
    }
  }

  const guides: SkpImport['guides'] = { lines: [], points: [] };
  if (opts.guides) {
    for (const g of skp.root.constructionLines) {
      if (length(g.direction as Vec3) < 1e-9) continue;
      guides.lines.push({ point: scale(g.point as Vec3, INCH), dir: normalize(g.direction as Vec3) });
    }
    for (const p of skp.root.constructionPoints) guides.points.push(scale(p.position as Vec3, INCH));
  }

  return { root, materials, scenes, guides, faces };
}

/**
 * Circles and arcs keep their true centre and radius (VormCraft re-divides them smoothly on
 * export), where the placement keeps them circles (no stretching).
 */
function addCurves(model: Model, def: Definition, m: M4, ids: Map<number, VertexId>): void {
  if (!def.arcs.size) return;
  const byCurve = new Map<number, { a: VertexId; b: VertexId }[]>();
  for (const e of def.edges) {
    if (e.curveId === null || e.curveId === undefined || !def.arcs.has(e.curveId)) continue;
    const a = ids.get(e.v1Id);
    const b = ids.get(e.v2Id);
    if (a === undefined || b === undefined || model.halfEdgeBetween(a, b) === undefined) continue;
    if (!byCurve.has(e.curveId)) byCurve.set(e.curveId, []);
    byCurve.get(e.curveId)!.push({ a, b });
  }
  for (const [curveId, edges] of byCurve) {
    const arc = def.arcs.get(curveId)!;
    const x = scale(turn(m, arc.xAxis), INCH);
    const y = scale(turn(m, arc.yAxis), INCH);
    const r = length(x);
    if (r <= 1e-6 || Math.abs(length(y) - r) > 1e-6 * Math.max(1, r) || Math.abs(dot(x, y)) > 1e-6 * r * r) continue;
    const c = arc.center;
    const sweep = arc.isFullCircle ? 2 * Math.PI : Math.abs(arc.endAngle - arc.startAngle);
    if (sweep <= 1e-6) continue;
    const segments = Math.max(3, Math.round((edges.length * 2 * Math.PI) / sweep));
    const curve = model.addCurve({ kind: 'circle', center: toWorld(m, c[0], c[1], c[2]), normal: normalize(cross(x, y)), radius: r, segments });
    for (const { a, b } of edges) model.setEdgeCurve(a, b, curve);
  }
}

function materialFields(mat: SkpModel['materials'][number]): MaterialFields {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const color = `#${hex(mat.color.r)}${hex(mat.color.g)}${hex(mat.color.b)}`;
  const opacity = Number.isFinite(mat.transparency) ? Math.min(1, Math.max(0.05, mat.transparency)) : 1;
  const name = (mat.name || 'Material').replace(/^\[|\]$/g, '').slice(0, 60) || 'Material';
  const tex = mat.texture;
  if (tex?.data && tex.data.length > 0) {
    const mime = imageMime(tex.data);
    if (mime) {
      return {
        name,
        color,
        opacity,
        texture: {
          image: `data:${mime};base64,${base64(tex.data)}`,
          width: tex.width > 1e-6 ? tex.width * INCH : 1000,
          height: tex.height > 1e-6 ? tex.height * INCH : 1000,
        },
      };
    }
  }
  return { name, color, opacity };
}

/** The image type from its first bytes (PNG, JPEG, GIF, BMP, WebP), or null. */
function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
