import type { Vec3 } from '../core/math/vec3';
import { Model } from '../core/model/Model';
import { Document } from '../doc/Document';
import { Guides } from '../doc/Guides';
import { Labels } from '../doc/Labels';

/** File extension of our own format. */
export const FILE_EXTENSION = 'benup';
export const FORMAT_VERSION = 1;

/**
 * Benup document, version 1 (JSON, millimetres). The boundary representation is stored exactly:
 * vertices, faces as vertex-id loops (outer first, then holes), every edge with its true-curve
 * tag, the curves themselves, and the guides. Ids are kept so a reload is identical.
 */
interface FileV1 {
  format: 'benup';
  version: 1;
  units: 'mm';
  vertices: [number, number, number, number][];
  curves: { id: number; kind: 'circle'; center: Vec3; normal: Vec3; radius: number; segments: number }[];
  faces: { id: number; normal: Vec3; loops: number[][] }[];
  /** [a, b, curveId | null] for every edge, including loose (wire) edges. */
  edges: [number, number, number | null][];
  guides: { visible: boolean; lines: { point: Vec3; dir: Vec3 }[]; points: { pos: Vec3 }[] };
  /** Text labels (optional: files saved before labels existed have none). */
  labels?: { anchor: Vec3; position: Vec3; text: string }[];
}

export function serializeDocument(doc: Document): string {
  const m = doc.model;
  const file: FileV1 = {
    format: 'benup',
    version: 1,
    units: 'mm',
    vertices: [...m.vertices.values()].map((v) => [v.id, ...v.pos]),
    curves: [...m.curves.values()].map((c) => ({ id: c.id, kind: c.kind, center: c.center, normal: c.normal, radius: c.radius, segments: c.segments })),
    faces: [...m.faces.values()].map((f) => ({ id: f.id, normal: f.normal, loops: m.faceVertexLoops(f.id) })),
    edges: [...m.edges()].map((e) => [m.he(e).origin, m.dest(e), m.he(e).curve]),
    guides: {
      visible: doc.guides.visible,
      lines: doc.guides.lines().map((g) => ({ point: g.point, dir: g.dir })),
      points: doc.guides.points().map((g) => ({ pos: g.pos })),
    },
    labels: [...doc.labels.items.values()].map((l) => ({ anchor: l.anchor, position: l.position, text: l.text })),
  };
  return JSON.stringify(file);
}

export class FileFormatError extends Error {}

/** Parse a Benup file. Throws FileFormatError with a readable message for bad or newer files. */
export function parseDocument(text: string): Document {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileFormatError('This is not a Benup file (it is not valid JSON).');
  }
  const f = raw as Partial<FileV1> & { version?: unknown };
  if (!f || typeof f !== 'object' || f.format !== 'benup') throw new FileFormatError('This is not a Benup file.');
  if (typeof f.version !== 'number') throw new FileFormatError('The file has no version number.');
  if (f.version > FORMAT_VERSION) throw new FileFormatError(`This file was saved by a newer version of Benup (format ${f.version}); please update the app.`);
  if (f.units !== 'mm') throw new FileFormatError(`Unsupported units "${String(f.units)}".`);

  const model = new Model();
  try {
    const vec = (v: unknown, what: string): Vec3 => {
      if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error(`bad ${what}`);
      return [v[0], v[1], v[2]];
    };
    const ids = [...(f.vertices ?? []).map((v) => v[0]), ...(f.curves ?? []).map((c) => c.id), ...(f.faces ?? []).map((x) => x.id)];
    model.reserveIdsUpTo(Math.max(0, ...ids));
    for (const v of f.vertices ?? []) model.addVertex(vec(v.slice(1), 'vertex'), v[0]);
    for (const c of f.curves ?? []) {
      if (c.kind !== 'circle' || !(c.radius > 0) || !(c.segments > 0)) throw new Error(`bad curve ${c.id}`);
      model.addCurve({ kind: 'circle', center: vec(c.center, 'curve centre'), normal: vec(c.normal, 'curve normal'), radius: c.radius, segments: c.segments }, c.id);
    }
    for (const face of f.faces ?? []) {
      if (!Array.isArray(face.loops) || face.loops.length === 0) throw new Error(`face ${face.id} has no loops`);
      model.addFace(face.loops[0], face.loops.slice(1), { normal: vec(face.normal, 'face normal'), id: face.id });
    }
    for (const [a, b, curve] of f.edges ?? []) {
      model.addEdge(a, b);
      if (curve !== null) {
        if (!model.curves.has(curve)) throw new Error(`edge ${a}-${b} references missing curve ${curve}`);
        model.setEdgeCurve(a, b, curve);
      }
    }
    model.validate();
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
  return new Document(model, guides, labels);
}
