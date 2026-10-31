import type { Vec3 } from '../core/math/vec3';

/** One object from a mesh file: its name and polygons (in the file's own units and axes). */
export interface MeshObject {
  name: string;
  polygons: Vec3[][];
}

export class MeshFileError extends Error {}

/** The file's name without folders and extension. */
const baseName = (fileName: string) => fileName.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '') || 'Imported';

/**
 * STL, binary or text (detected): triangles. Binary STL is 80 header bytes, a triangle count and
 * 50 bytes per triangle; anything else is read as text ("facet … vertex x y z … endfacet").
 */
export function parseStl(bytes: Uint8Array, fileName = 'model.stl'): MeshObject[] {
  const name = baseName(fileName);
  if (bytes.length >= 84) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(80, true);
    if (84 + count * 50 === bytes.length) {
      const polygons: Vec3[][] = [];
      for (let t = 0; t < count; t++) {
        const o = 84 + t * 50 + 12; // skip the stored normal: it is worked out from the corners
        const p = (k: number): Vec3 => [view.getFloat32(o + k * 12, true), view.getFloat32(o + k * 12 + 4, true), view.getFloat32(o + k * 12 + 8, true)];
        polygons.push([p(0), p(1), p(2)]);
      }
      return [{ name, polygons }];
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid\b/i.test(text) && !/\bfacet\b/i.test(text)) throw new MeshFileError('This is not an STL file.');
  const polygons: Vec3[][] = [];
  let current: Vec3[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'vertex') {
      const p = parts.slice(1, 4).map(Number);
      if (p.length !== 3 || p.some((x) => !Number.isFinite(x))) throw new MeshFileError('The STL file is damaged: a vertex has bad coordinates.');
      current.push([p[0], p[1], p[2]]);
    } else if (parts[0] === 'endfacet') {
      if (current.length >= 3) polygons.push(current);
      current = [];
    }
  }
  if (!polygons.length) throw new MeshFileError('The STL file has no triangles.');
  return [{ name, polygons }];
}

/**
 * OBJ (text): vertices ("v x y z") and faces ("f 1 2 3 …", with v/vt/vn forms and negative
 * indices). Each object ("o name") becomes its own object; a file without objects is split by
 * its groups ("g name") instead. Lines, points, texture coordinates and normals are ignored.
 */
export function parseObj(text: string, fileName = 'model.obj'): MeshObject[] {
  const lines = text.split(/\r?\n/);
  const hasObjects = lines.some((l) => /^\s*o\s/.test(l));
  const splitKey = hasObjects ? 'o' : 'g';
  const vertices: Vec3[] = [];
  const objects: MeshObject[] = [];
  let current: MeshObject = { name: baseName(fileName), polygons: [] };
  const start = (name: string) => {
    if (current.polygons.length) objects.push(current);
    current = { name: name || baseName(fileName), polygons: [] };
  };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line || line.startsWith('#')) continue;
    const [kind, ...rest] = line.split(/\s+/);
    if (kind === 'v') {
      const p = rest.slice(0, 3).map(Number);
      if (p.length < 3 || p.some((x) => !Number.isFinite(x))) throw new MeshFileError(`The OBJ file is damaged: bad vertex on line ${n + 1}.`);
      vertices.push([p[0], p[1], p[2]]);
    } else if (kind === 'f') {
      const ring: Vec3[] = [];
      for (const ref of rest) {
        const i = parseInt(ref.split('/')[0], 10);
        const index = i < 0 ? vertices.length + i : i - 1;
        const p = vertices[index];
        if (!Number.isInteger(i) || i === 0 || !p) throw new MeshFileError(`The OBJ file is damaged: face on line ${n + 1} uses a vertex that does not exist.`);
        ring.push(p);
      }
      if (ring.length >= 3) current.polygons.push(ring);
    } else if (kind === splitKey) {
      start(rest.join(' '));
    }
  }
  if (current.polygons.length) objects.push(current);
  if (!objects.length) throw new MeshFileError('The OBJ file has no faces.');
  return objects;
}

export type ImportUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft';
export const UNIT_MM: Record<ImportUnit, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

/**
 * Into our units and axes: scaled to millimetres, and with Y up (as many programs export OBJ)
 * turned so that Z is up.
 */
export function convertMesh(objects: readonly MeshObject[], unit: ImportUnit, yUp: boolean): MeshObject[] {
  const k = UNIT_MM[unit];
  const map = (p: Vec3): Vec3 => (yUp ? [p[0] * k, -p[2] * k, p[1] * k] : [p[0] * k, p[1] * k, p[2] * k]);
  return objects.map((o) => ({ name: o.name, polygons: o.polygons.map((poly) => poly.map(map)) }));
}

/** Read an OBJ or STL file by its extension. */
export function parseMeshFile(fileName: string, bytes: Uint8Array): MeshObject[] {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'stl') return parseStl(bytes, fileName);
  if (ext === 'obj') return parseObj(new TextDecoder().decode(bytes), fileName);
  throw new MeshFileError('VormCraft can import .obj and .stl files.');
}
