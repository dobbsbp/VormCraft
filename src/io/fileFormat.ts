import type { Vec3 } from '../core/math/vec3';
import { Model } from '../core/model/Model';
import { Document } from '../doc/Document';
import { Groups } from '../doc/Groups';
import { Guides } from '../doc/Guides';
import { Labels } from '../doc/Labels';
import { Materials, type Material } from '../doc/Materials';

/** File extension of our own format. */
export const FILE_EXTENSION = 'vorm';
/** Extensions of files saved before the app was renamed (they still open). */
export const OLD_FILE_EXTENSIONS = ['benup'];
export const FORMAT_VERSION = 3;

/**
 * Geometry as stored: vertices, faces as vertex-id loops (outer first, then holes), every edge with
 * its true-curve tag, and the curves themselves. Ids are kept so a reload is identical.
 */
interface GeometryData {
  vertices: [number, number, number, number][];
  curves: { id: number; kind: 'circle'; center: Vec3; normal: Vec3; radius: number; segments: number }[];
  faces: { id: number; normal: Vec3; loops: number[][]; material?: string }[];
  /**
   * [a, b, curveId | null, soft?] for every edge, including loose (wire) edges. `soft` is 1 for a
   * soft edge, 0 for one that always shows, and absent for automatic (version 2).
   */
  edges: ([number, number, number | null] | [number, number, number | null, 0 | 1])[];
}

/**
 * VormCraft document (JSON, millimetres): the top-level geometry, the guides, labels, materials
 * and groups.
 * Version 2 adds edge smoothing (a fourth entry per edge) and materials (colours and textures,
 * with each face's material). Version 3 adds groups, each with geometry of its own. Older versions
 * still open, and so do files from before the app was renamed (format tag 'benup').
 */
interface FileV3 extends GeometryData {
  format: 'vormcraft' | 'benup';
  version: 1 | 2 | 3;
  units: 'mm';
  guides: { visible: boolean; lines: { point: Vec3; dir: Vec3 }[]; points: { pos: Vec3 }[] };
  /** Text labels (optional: files saved before labels existed have none). */
  labels?: { anchor: Vec3; position: Vec3; text: string }[];
  /** Materials (version 2); textures are embedded as data URLs. */
  materials?: Material[];
  /** Groups (version 3), parents before the groups inside them. */
  groups?: ({ id: number; name: string; parent: number | null; material?: string } & GeometryData)[];
}

function geometryData(m: Model): GeometryData {
  return {
    vertices: [...m.vertices.values()].map((v) => [v.id, ...v.pos]),
    curves: [...m.curves.values()].map((c) => ({ id: c.id, kind: c.kind, center: c.center, normal: c.normal, radius: c.radius, segments: c.segments })),
    faces: [...m.faces.values()].map((f) => ({ id: f.id, normal: f.normal, loops: m.faceVertexLoops(f.id), ...(f.material !== undefined ? { material: f.material } : {}) })),
    edges: [...m.edges()].map((e) => {
      const h = m.he(e);
      return h.soft === undefined ? [h.origin, m.dest(e), h.curve] : [h.origin, m.dest(e), h.curve, h.soft ? 1 : 0];
    }),
  };
}

export function serializeDocument(doc: Document): string {
  // Parents first, so a reader can create groups in order.
  const ordered = doc.groups.children(null).flatMap((g) => doc.groups.subtree(g.id));
  const file: FileV3 = {
    format: 'vormcraft',
    version: 3,
    units: 'mm',
    ...geometryData(doc.root),
    guides: {
      visible: doc.guides.visible,
      lines: doc.guides.lines().map((g) => ({ point: g.point, dir: g.dir })),
      points: doc.guides.points().map((g) => ({ pos: g.pos })),
    },
    labels: [...doc.labels.items.values()].map((l) => ({ anchor: l.anchor, position: l.position, text: l.text })),
    materials: [...doc.materials.items.values()],
    groups: ordered.map((g) => ({ id: g.id, name: g.name, parent: g.parent, ...(g.material !== undefined ? { material: g.material } : {}), ...geometryData(g.model) })),
  };
  return JSON.stringify(file);
}

export class FileFormatError extends Error {}

const vec = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error(`bad ${what}`);
  return [v[0], v[1], v[2]];
};

function readGeometry(f: Partial<GeometryData>, materials: Materials): Model {
  const model = new Model();
  const ids = [...(f.vertices ?? []).map((v) => v[0]), ...(f.curves ?? []).map((c) => c.id), ...(f.faces ?? []).map((x) => x.id)];
  model.reserveIdsUpTo(Math.max(0, ...ids));
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
  for (const [a, b, curve, soft] of f.edges ?? []) {
    model.addEdge(a, b);
    if (soft !== undefined) model.setEdgeSoft(a, b, soft === 1);
    if (curve !== null) {
      if (!model.curves.has(curve)) throw new Error(`edge ${a}-${b} references missing curve ${curve}`);
      model.setEdgeCurve(a, b, curve);
    }
  }
  model.validate();
  return model;
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
  if (f.version > FORMAT_VERSION) throw new FileFormatError(`This file was saved by a newer version of VormCraft (format ${f.version}); please update the app.`);
  if (f.units !== 'mm') throw new FileFormatError(`Unsupported units "${String(f.units)}".`);

  const materials = new Materials();
  const groups = new Groups();
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
    }
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
    labels.add(l.anchor, l.position, l.text);
  }
  return new Document(model, guides, labels, materials, groups);
}
