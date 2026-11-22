import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { Vec3 } from '../core/math/vec3';
import { Model } from '../core/model/Model';
import type { Affine } from '../core/ops/transform';
import { Document, type DocumentSnapshot } from '../doc/Document';
import type { SavedStep, Step, StepState } from '../doc/History';
import { Groups } from '../doc/Groups';
import { Guides } from '../doc/Guides';
import { Labels } from '../doc/Labels';
import { Materials, type Material } from '../doc/Materials';
import { ALL_PARTS, DEFAULT_STYLE, Scenes, type Scene } from '../doc/Scenes';
import { validBackdrop } from '../doc/Backdrop';
import { Sections } from '../doc/Sections';
import { DEFAULT_UNITS, validUnits, type DisplayUnits } from '../doc/Units';
import type { Version } from '../doc/Versions';
import { hashText } from './hash';
import { applyPatch, diffLines, type Patch } from './lineDiff';

/** File extension of our own format. */
export const FILE_EXTENSION = 'vorm';
/** Extensions of files saved before the app was renamed (they still open). */
export const OLD_FILE_EXTENSIONS = ['benup'];
export const FORMAT_VERSION = 8;

/**
 * Geometry as stored: vertices, faces as vertex-id loops (outer first, then holes), every edge with
 * its true-curve tag, and the curves themselves. Ids are kept so a reload is identical.
 */
interface GeometryData {
  vertices: [number, number, number, number][];
  curves: { id: number; kind: 'circle'; center: Vec3; normal: Vec3; radius: number; segments: number }[];
  faces: { id: number; normal: Vec3; loops: number[][]; material?: string }[];
  /**
   * [a, b, curveId | null, soft?, hidden?] for every edge, including loose (wire) edges. `soft` is 1
   * for a soft edge, 0 for one that always shows, and absent (or null before `hidden`) for automatic
   * (version 2); `hidden` is 1 for an edge the user hid (version 7).
   */
  edges: ([number, number, number | null] | [number, number, number | null, 0 | 1 | null] | [number, number, number | null, 0 | 1 | null, 1])[];
}

/**
 * VormCraft document (JSON, millimetres): the top-level geometry, the guides, labels, materials
 * and groups.
 * Version 2 adds edge smoothing (a fourth entry per edge) and materials (colours and textures,
 * with each face's material). Version 3 adds groups, each with geometry of its own; version 4
 * hidden groups and scenes (saved views); version 5 the design's version history (compressed);
 * version 6 the last undo steps (each stored as only what changed: see `encodeUndo`); version 7
 * hidden edges (a fifth entry per edge), the units lengths are shown in, and dimensions (labels with an `end`); version 8
 * components (each definition saved once; an instance is a group with only its placement) and section planes. Geometry is always in
 * millimetres (`units`).
 * Older versions still open, and so do files from before the app was renamed (format tag 'benup').
 */
interface FileV3 extends GeometryData {
  format: 'vormcraft' | 'benup';
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  units: 'mm';
  /** The units lengths are shown and typed in (version 7; millimetres before). */
  displayUnits?: DisplayUnits;
  guides: { visible: boolean; lines: { point: Vec3; dir: Vec3 }[]; points: { pos: Vec3 }[] };
  /** Text labels (optional: files saved before labels existed have none), and dimensions (with `end`, version 7). */
  labels?: { anchor: Vec3; position: Vec3; text: string; end?: Vec3 }[];
  /** Materials (version 2); textures are embedded as data URLs. */
  materials?: Material[];
  /** Groups (version 3), parents before the groups inside them. */
  groups?: ({ id: number; name: string; parent: number | null; material?: string; hidden?: boolean; component?: { id: number; place: Affine } } & GeometryData)[];
  /**
   * Component definitions (version 8), in their own coordinates. Instances are groups with
   * `component` and no geometry of their own; the groups inside them are not saved either: they
   * are made again from the definition when the file is read.
   */
  /** Section planes (version 8): which one cuts the view, and whether the planes are drawn. */
  sections?: { active: number | null; visible: boolean; items: { id: number; point: Vec3; normal: Vec3 }[] };
  components?: { id: number; name: string; source?: string; parts: ({ key: number; parent: number | null; name: string; material?: string; hidden?: boolean } & GeometryData)[] }[];
  /** Scenes in order, and the glide and slideshow timings (version 4). */
  scenes?: { transition: number; delay: number; items: Scene[] };
  /** The version history (version 5): compressed documents, and the texture images they use. */
  history?: { versions: Version[]; textures: Record<string, string> };
  /** The last undo steps (version 6), newest first: see `encodeUndo`. */
  undo?: FileUndo;
}

/**
 * Undo steps as saved: `base` is the hash of the design's own text (without history and undo,
 * written by `linedJson`); each step is a patch (gzip, base64) from the text of the step after it
 * (the design itself for the newest) to its own, or, with `full`, its whole text.
 */
interface FileUndo {
  base: string;
  steps: { label: string; data: string; full?: 1 }[];
}

function geometryData(m: Model): GeometryData {
  return {
    vertices: [...m.vertices.values()].map((v) => [v.id, ...v.pos]),
    curves: [...m.curves.values()].map((c) => ({ id: c.id, kind: c.kind, center: c.center, normal: c.normal, radius: c.radius, segments: c.segments })),
    faces: [...m.faces.values()].map((f) => ({ id: f.id, normal: f.normal, loops: m.faceVertexLoops(f.id), ...(f.material !== undefined ? { material: f.material } : {}) })),
    edges: [...m.edges()].map((e) => {
      const h = m.he(e);
      const soft = h.soft === undefined ? null : h.soft ? 1 : 0;
      if (h.hidden) return [h.origin, m.dest(e), h.curve, soft, 1];
      return soft === null ? [h.origin, m.dest(e), h.curve] : [h.origin, m.dest(e), h.curve, soft];
    }),
  };
}

export interface SerializeOptions {
  /** Include the version history (default true). */
  history?: boolean;
  /** Undo steps to keep with the design (oldest first): the newest `UNDO_STEPS` are saved. */
  undo?: readonly Step[];
}

/** How many undo steps a file keeps, and the most space they may take (compressed). */
export const UNDO_STEPS = 100;
export const UNDO_LIMIT_BYTES = 8 * 1024 * 1024;

/** The design itself as a file object (no history, no undo). */
function documentFile(doc: Document): FileV3 {
  // Parents first, so a reader can create groups in order.
  // Groups inside component instances are made from the definition, so they are left out.
  const ordered = doc.groups
    .children(null)
    .flatMap((g) => doc.groups.subtree(g.id))
    .filter((g) => g.parent === null || !doc.groups.instanceOf(g.parent));
  const empty = geometryData(new Model());
  return {
    format: 'vormcraft',
    version: 8,
    units: 'mm',
    displayUnits: { unit: doc.units.unit, precision: doc.units.precision },
    ...geometryData(doc.root),
    guides: {
      visible: doc.guides.visible,
      lines: doc.guides.lines().map((g) => ({ point: g.point, dir: g.dir })),
      points: doc.guides.points().map((g) => ({ pos: g.pos })),
    },
    labels: [...doc.labels.items.values()].map((l) => ({ anchor: l.anchor, position: l.position, text: l.text, ...(l.end ? { end: l.end } : {}) })),
    materials: [...doc.materials.items.values()],
    groups: ordered.map((g) => ({
      id: g.id,
      name: g.name,
      parent: g.parent,
      ...(g.material !== undefined ? { material: g.material } : {}),
      ...(g.hidden ? { hidden: true } : {}),
      ...(g.component ? { component: { id: g.component.id, place: { m: [...g.component.place.m] as unknown as Affine['m'], t: g.component.place.t } }, ...empty } : geometryData(g.model)),
    })),
    ...(doc.groups.components.size
      ? {
          components: [...doc.groups.components.values()].map((c) => ({
            id: c.id,
            name: c.name,
            ...(c.source ? { source: c.source } : {}),
            parts: c.parts.map((p) => ({ key: p.key, parent: p.parent, name: p.name, ...(p.material !== undefined ? { material: p.material } : {}), ...(p.hidden ? { hidden: true } : {}), ...geometryData(p.model) })),
          })),
        }
      : {}),
    scenes: { transition: doc.scenes.transition, delay: doc.scenes.delay, items: doc.scenes.items },
    ...(doc.sections.items.size || !doc.sections.visible
      ? { sections: { active: doc.sections.active, visible: doc.sections.visible, items: [...doc.sections.items.values()].map((s) => ({ id: s.id, point: s.point, normal: s.normal })) } }
      : {}),
  };
}

export function serializeDocument(doc: Document, opts: SerializeOptions = {}): string {
  const file = documentFile(doc);
  const undo = opts.undo?.length ? encodeUndo(linedJson(file), opts.undo) : undefined;
  if (opts.history !== false && doc.versions.items.length) {
    file.history = { versions: doc.versions.items, textures: Object.fromEntries(doc.versions.textures) };
  }
  if (undo) file.undo = undo;
  return JSON.stringify(file);
}

const isScalar = (v: unknown) => v === null || typeof v !== 'object';
const isFlat = (v: unknown): boolean => isScalar(v) || (Array.isArray(v) && v.every(isScalar));

/**
 * JSON with a line per record (vertex, edge, face loop, material...), so two versions of a design
 * can be compared line by line. Parses as ordinary JSON.
 */
export function linedJson(v: unknown): string {
  if (Array.isArray(v)) return v.every(isScalar) ? JSON.stringify(v) : `[\n${v.map(linedJson).join(',\n')}\n]`;
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    if (entries.every(([, x]) => isFlat(x))) return JSON.stringify(v);
    return `{\n${entries.map(([k, x]) => `${JSON.stringify(k)}:${linedJson(x)}`).join(',\n')}\n}`;
  }
  return JSON.stringify(v);
}

function pack(value: unknown): string {
  const bytes = gzipSync(strToU8(JSON.stringify(value)), { level: 6 });
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unpack<T>(data: string): T {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return JSON.parse(strFromU8(gunzipSync(bytes))) as T;
}

/** A step's saved form, remembered so each save only works out the steps that are new. */
const encoded = new WeakMap<StepState, { newer: unknown; data: string; full: boolean }>();

/** The design text of an undo step. */
function stepText(s: StepState): string {
  if ('saved' in s) return s.text();
  const doc = new Document(s.model, s.guides, s.labels, s.materials, s.groups, s.scenes, s.sections);
  if (s.units) doc.units = s.units;
  return linedJson(documentFile(doc));
}

/**
 * The newest undo steps, each as a patch from the step after it (so each takes only as much room
 * as its change), up to `UNDO_STEPS` and `UNDO_LIMIT_BYTES`.
 */
function encodeUndo(base: string, steps: readonly Step[]): FileUndo {
  const out: FileUndo = { base: hashText(base), steps: [] };
  // What the step being encoded is compared with: the design for the newest, then each step in turn.
  let newer: unknown = null;
  let newerLines: () => string[] = () => base.split('\n');
  let bytes = 0;
  for (let i = steps.length - 1; i >= 0 && out.steps.length < UNDO_STEPS; i--) {
    const state = steps[i].snapshot;
    let lines: string[] | null = null;
    const ownLines = () => (lines ??= stepText(state).split('\n'));
    let e = encoded.get(state);
    // The newest step's patch depends on the design as it is now, so it is always worked out.
    if (!e || newer === null || e.newer !== newer) {
      const patch = diffLines(newerLines(), ownLines());
      e = patch ? { newer, data: pack(patch), full: false } : { newer, data: pack(ownLines().join('\n')), full: true };
      if (newer !== null) encoded.set(state, e);
    }
    bytes += e.data.length;
    if (bytes > UNDO_LIMIT_BYTES) break;
    out.steps.push({ label: steps[i].label, data: e.data, ...(e.full ? { full: 1 as const } : {}) });
    newer = state;
    newerLines = ownLines;
  }
  return out;
}

/**
 * Undo steps from a file, oldest first. Each is rebuilt only when it is needed (undone to, or
 * saved again), from the design's own text and the patches before it.
 */
function decodeUndo(base: string, undo: FileUndo): Step[] {
  const steps = undo.steps;
  // The last step worked out (undo goes back one step at a time, so it is usually the one before).
  let index = -1;
  let current = base.split('\n');
  const linesAt = (wanted: number): string[] => {
    if (index > wanted) {
      index = -1;
      current = base.split('\n');
    }
    while (index < wanted) {
      const step: FileUndo['steps'][number] = steps[index + 1];
      current = step.full ? unpack<string>(step.data).split('\n') : applyPatch(current, unpack<Patch>(step.data));
      index++;
    }
    return current;
  };
  const saved: SavedStep[] = steps.map((_, i) => {
    const text = () => linesAt(i).join('\n');
    return {
      saved: true as const,
      text,
      snapshot(): DocumentSnapshot {
        const d = parseDocument(text());
        return { model: d.root, groups: d.groups, guides: d.guides, labels: d.labels, materials: d.materials, scenes: d.scenes, sections: d.sections };
      },
    };
  });
  // Saving again reuses the stored patches where the steps still follow each other.
  saved.forEach((s, i) => {
    if (i > 0) encoded.set(s, { newer: saved[i - 1], data: steps[i].data, full: !!steps[i].full });
  });
  return saved.map((s, i) => ({ label: steps[i].label, snapshot: s as StepState })).reverse();
}

export class FileFormatError extends Error {}

/** The file was saved by a newer version of the app (updating it will open the file). */
export class NewerFormatError extends FileFormatError {}

/** The format version a file was saved in, or null if it is not one of ours. */
export function fileFormatVersion(text: string): number | null {
  try {
    const f = JSON.parse(text);
    return f && (f.format === 'vormcraft' || f.format === 'benup') && typeof f.version === 'number' ? f.version : null;
  } catch {
    return null;
  }
}

const vec = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error(`bad ${what}`);
  return [v[0], v[1], v[2]];
};

function readGeometry(f: Partial<GeometryData>, materials: Materials): Model {
  const model = new Model();
  const ids = [...(f.vertices ?? []).map((v) => v[0]), ...(f.curves ?? []).map((c) => c.id), ...(f.faces ?? []).map((x) => x.id)];
  // A loop, not Math.max(...ids): a large model has more ids than a call can take arguments.
  let top = 0;
  for (const id of ids) if (id > top) top = id;
  model.reserveIdsUpTo(top);
  for (const v of f.vertices ?? []) model.addVertex(vec(v.slice(1), 'vertex'), v[0]);
  for (const c of f.curves ?? []) {
    if (c.kind !== 'circle' || !(c.radius > 0) || !(c.segments > 0)) throw new Error(`bad curve ${c.id}`);
    model.addCurve({ kind: 'circle', center: vec(c.center, 'curve centre'), normal: vec(c.normal, 'curve normal'), radius: c.radius, segments: c.segments }, c.id);
  }
  for (const face of f.faces ?? []) {
    if (!Array.isArray(face.loops) || face.loops.length === 0) throw new Error(`face ${face.id} has no loops`);
    if (face.material !== undefined && !materials.get(face.material)) throw new Error(`face ${face.id} uses missing material ${face.material}`);
    model.addFace(face.loops[0], face.loops.slice(1), { normal: vec(face.normal, 'face normal'), id: face.id, material: face.material });
  }
  for (const [a, b, curve, soft, hidden] of f.edges ?? []) {
    model.addEdge(a, b);
    if (soft !== undefined && soft !== null) model.setEdgeSoft(a, b, soft === 1);
    if (hidden === 1) model.setEdgeHidden(a, b, true);
    if (curve !== null) {
      if (!model.curves.has(curve)) throw new Error(`edge ${a}-${b} references missing curve ${curve}`);
      model.setEdgeCurve(a, b, curve);
    }
  }
  model.validate();
  return model;
}

/** A saved placement, checked. */
function affine(a: unknown): Affine {
  const x = a as Partial<Affine> | null;
  if (!x || !Array.isArray(x.m) || x.m.length !== 9 || !x.m.every(Number.isFinite)) throw new Error('a component has a bad placement');
  return { m: [...x.m] as unknown as Affine['m'], t: vec(x.t, 'component placement') };
}

/** Parse a VormCraft file. Throws FileFormatError with a readable message for bad or newer files. */
export function parseDocument(text: string): Document {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileFormatError('This is not a VormCraft file (it is not valid JSON).');
  }
  const f = raw as Partial<FileV3> & { version?: unknown };
  if (!f || typeof f !== 'object' || (f.format !== 'vormcraft' && f.format !== 'benup')) throw new FileFormatError('This is not a VormCraft file.');
  if (typeof f.version !== 'number') throw new FileFormatError('The file has no version number.');
  if (f.version > FORMAT_VERSION) throw new NewerFormatError(`This file was saved by a newer version of VormCraft (format ${f.version}); please update the app.`);
  if (f.units !== 'mm') throw new FileFormatError(`Unsupported units "${String(f.units)}".`);

  const materials = new Materials();
  const groups = new Groups();
  const scenes = new Scenes();
  let model: Model;
  try {
    for (const mat of f.materials ?? []) {
      const { id, name, color, opacity, texture } = mat;
      if (typeof id !== 'string') throw new Error('a material has no id');
      materials.add({ name, color, opacity, ...(texture ? { texture: { image: texture.image, width: texture.width, height: texture.height } } : {}) }, id);
    }
    model = readGeometry(f, materials);
    for (const g of f.groups ?? []) {
      if (!Number.isInteger(g.id) || g.id <= 0) throw new Error('a group has a bad id');
      if (g.parent !== null && !groups.has(g.parent)) throw new Error(`group ${g.id} is inside missing group ${g.parent}`);
      if (g.material !== undefined && !materials.get(g.material)) throw new Error(`group ${g.id} uses missing material ${g.material}`);
      groups.add(readGeometry(g, materials), g.parent, { id: g.id, name: typeof g.name === 'string' ? g.name : undefined, material: g.material });
      if (g.hidden) groups.get(g.id)!.hidden = true;
      if (g.component) groups.get(g.id)!.component = { id: g.component.id, place: affine(g.component.place) };
    }
    for (const c of f.components ?? []) {
      if (!Number.isInteger(c.id) || c.id <= 0) throw new Error('a component has a bad id');
      if (!Array.isArray(c.parts) || !c.parts.length || c.parts[0].key !== 0) throw new Error(`component ${c.id} has no geometry`);
      const keys = new Set<number>();
      const parts = c.parts.map((p) => {
        if (p.parent !== null && !keys.has(p.parent)) throw new Error(`a part of component ${c.id} is inside a missing part`);
        if (p.material !== undefined && !materials.get(p.material)) throw new Error(`component ${c.id} uses missing material ${p.material}`);
        keys.add(p.key);
        return { key: p.key, parent: p.parent, name: typeof p.name === 'string' ? p.name : 'Group', ...(p.material !== undefined ? { material: p.material } : {}), ...(p.hidden ? { hidden: true } : {}), model: readGeometry(p, materials) };
      });
      groups.components.set(c.id, { id: c.id, name: typeof c.name === 'string' ? c.name : `Component ${c.id}`, parts, ...(typeof c.source === 'string' ? { source: c.source } : {}) });
      groups.reserveComponentId(c.id);
    }
    for (const g of groups.items.values()) if (g.component && !groups.components.has(g.component.id)) throw new Error(`group ${g.id} uses missing component ${g.component.id}`);
    if (f.scenes) {
      if (f.scenes.transition >= 0) scenes.transition = f.scenes.transition;
      if (f.scenes.delay >= 0) scenes.delay = f.scenes.delay;
      for (const s of f.scenes.items ?? []) {
        const c = s.camera;
        if (!c || (c.projection !== 'perspective' && c.projection !== 'parallel') || !(c.fov > 0) || !(c.height > 0)) throw new Error(`scene ${s.id} has a bad camera`);
        scenes.add(
          {
            name: typeof s.name === 'string' && s.name.trim() ? s.name : scenes.nextName(),
            parts: { ...ALL_PARTS, ...s.parts },
            camera: { position: vec(c.position, 'scene camera'), target: vec(c.target, 'scene target'), fov: c.fov, projection: c.projection, height: c.height },
            hidden: (s.hidden ?? []).filter((id) => groups.has(id)),
            style: { ...DEFAULT_STYLE, ...s.style, backdrop: validBackdrop(s.style?.backdrop) },
            ...(s.section === null || (typeof s.section === 'number' && Number.isInteger(s.section)) ? { section: s.section } : {}),
          },
          s.id,
        );
      }
    }
    // Instances are made from their definitions (after the scenes, so the new groups inside them are
    // not mistaken for groups a scene hides).
    for (const g of [...groups.items.values()]) if (g.component) groups.rebuild(g.id);
  } catch (err) {
    throw new FileFormatError(`The file is damaged: ${err instanceof Error ? err.message : String(err)}.`);
  }

  const guides = new Guides();
  guides.visible = f.guides?.visible ?? true;
  for (const g of f.guides?.lines ?? []) guides.addLine(g.point, g.dir);
  for (const g of f.guides?.points ?? []) guides.addPoint(g.pos);
  const labels = new Labels();
  for (const l of f.labels ?? []) {
    if (typeof l.text !== 'string') throw new FileFormatError('The file is damaged: a label has no text.');
    labels.add(l.anchor, l.position, l.text, l.end === undefined ? undefined : vec(l.end, 'dimension end'));
  }
  const sections = new Sections();
  if (f.sections) {
    try {
      for (const s of f.sections.items ?? []) {
        if (!Number.isInteger(s.id) || s.id <= 0) throw new Error('a section plane has a bad id');
        sections.add(vec(s.point, 'section point'), vec(s.normal, 'section direction'), s.id);
      }
    } catch (err) {
      throw new FileFormatError(`The file is damaged: ${err instanceof Error ? err.message : String(err)}.`);
    }
    sections.active = sections.get(f.sections.active ?? null) ? f.sections.active : null;
    sections.visible = f.sections.visible !== false;
  }
  const doc = new Document(model, guides, labels, materials, groups, scenes, sections);
  // Units that cannot be read fall back to millimetres rather than stopping the design opening.
  doc.units = validUnits(f.displayUnits) ?? DEFAULT_UNITS;
  // Undo steps: left out if they do not belong to this exact design (or are damaged).
  const u = f.undo;
  if (u && typeof u.base === 'string' && Array.isArray(u.steps) && u.steps.every((s) => typeof s.data === 'string' && typeof s.label === 'string')) {
    // An autosaved copy says where it came from (`autosave`), added after the undo steps were.
    const { history: _history, undo: _undo, autosave: _autosave, ...design } = f as FileV3 & { autosave?: unknown };
    const base = linedJson(design);
    if (hashText(base) === u.base) doc.savedUndo = decodeUndo(base, u);
  }
  // A damaged history must not stop the design itself from opening: it is left out instead.
  const h = f.history;
  if (h && Array.isArray(h.versions) && h.textures && typeof h.textures === 'object') {
    const ok = h.versions.every((v) => Number.isInteger(v.id) && typeof v.time === 'number' && typeof v.data === 'string' && typeof v.hash === 'string' && Array.isArray(v.textures));
    if (ok) {
      for (const [k, t] of Object.entries(h.textures)) if (typeof t === 'string') doc.versions.textures.set(k, t);
      for (const v of h.versions) doc.versions.add({ time: v.time, label: typeof v.label === 'string' ? v.label : '', kind: v.kind ?? 'auto', data: v.data, hash: v.hash, textures: v.textures }, v.id);
    }
  }
  return doc;
}
