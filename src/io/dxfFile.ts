import type { DrawingCurve } from '../core/ops/drawingCurves';
import { add, cross, length, normalize, scale, type Vec3 } from '../core/math/vec3';
import type { ImportUnit } from './meshFiles';

/**
 * Reading DXF drawings (text DXF, any version): the drawing's curves exactly as the file
 * describes them (lines, arcs, circles, ellipses, splines, polylines with arc segments), with
 * blocks placed, plus texts, dimensions and 3D faces, by layer. Turning curves into edges (and
 * choosing their resolution) happens later (`dxfImport.ts`).
 */

export class DxfError extends Error {}

export interface DxfLayer {
  name: string;
  /** Switched off or frozen in the file. */
  off: boolean;
  /** Curves, texts, dimensions and faces on it. */
  count: number;
}

export interface DxfCurve {
  layer: string;
  curve: DrawingCurve;
}

export interface DxfText {
  layer: string;
  point: Vec3;
  text: string;
}

export type DxfDimension =
  /** Measures a to b along `dir`; its line passes through `line`. */
  | { layer: string; kind: 'linear'; a: Vec3; b: Vec3; line: Vec3; dir: Vec3; text: string; measured: number }
  /** Angles, radii, diameters, ordinates: shown as their text. */
  | { layer: string; kind: 'other'; type: number; point: Vec3; text: string; measured: number };

export interface DxfFace {
  layer: string;
  points: Vec3[];
}

export interface DxfDrawing {
  /** From $INSUNITS; null when the file does not say (or uses a unit VormCraft has no name for). */
  units: ImportUnit | null;
  layers: DxfLayer[];
  curves: DxfCurve[];
  texts: DxfText[];
  dimensions: DxfDimension[];
  faces: DxfFace[];
  /** Things left out, by kind ("hatches", "images"…), with how many. */
  skipped: Map<string, number>;
}

/** The file as text: binary DXF and DWG are refused; old files in a Windows code page are read as such. */
export function decodeDxf(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 22));
  if (head.startsWith('AutoCAD Binary DXF')) throw new DxfError('This is a binary DXF file. Save it as a text (ASCII) DXF and import that.');
  if (/^AC10\d\d/.test(head)) throw new DxfError('This is a DWG file. Save it as DXF from your CAD program and import that.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

const INSUNITS: Record<number, ImportUnit> = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' };

type Pair = [number, string];

interface Raw {
  type: string;
  codes: Pair[];
  /** VERTEX records of a POLYLINE. */
  vertices?: Raw[];
}

/** An affine map: p → m·p + t (m row-major 3×3). */
interface Affine {
  m: readonly number[];
  t: Vec3;
}

const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
const dirOf = (a: Affine, v: Vec3): Vec3 => [a.m[0] * v[0] + a.m[1] * v[1] + a.m[2] * v[2], a.m[3] * v[0] + a.m[4] * v[1] + a.m[5] * v[2], a.m[6] * v[0] + a.m[7] * v[1] + a.m[8] * v[2]];
const pointOf = (a: Affine, p: Vec3): Vec3 => add(dirOf(a, p), a.t);
/** a after b (b applied first). */
function compose(a: Affine, b: Affine): Affine {
  const m: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m.push(a.m[r * 3] * b.m[c] + a.m[r * 3 + 1] * b.m[3 + c] + a.m[r * 3 + 2] * b.m[6 + c]);
  return { m, t: pointOf(a, b.t) };
}
const fromColumns = (x: Vec3, y: Vec3, z: Vec3, t: Vec3 = [0, 0, 0]): Affine => ({ m: [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]], t });

/** The object coordinate system for an extrusion direction (DXF's "arbitrary axis algorithm"). */
function ocs(extrusion: Vec3): Affine {
  const az = length(extrusion) > 1e-12 ? normalize(extrusion) : ([0, 0, 1] as Vec3);
  if (Math.abs(az[0] - 0) < 1e-12 && Math.abs(az[1]) < 1e-12 && az[2] > 0) return IDENTITY;
  const ax = normalize(Math.abs(az[0]) < 1 / 64 && Math.abs(az[1]) < 1 / 64 ? cross([0, 1, 0], az) : cross([0, 0, 1], az));
  const ay = normalize(cross(az, ax));
  return fromColumns(ax, ay, az);
}

/** Read a text DXF. Throws DxfError if it is not one. */
export function parseDxf(text: string): DxfDrawing {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new DxfError(`This does not look like a DXF file (line ${i + 1}).`);
    pairs.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  if (!pairs.some(([c, v]) => c === 0 && v.trim() === 'SECTION')) throw new DxfError('This does not look like a DXF file.');

  const header = new Map<string, Pair[]>();
  const layerTable = new Map<string, boolean>();
  const blocks = new Map<string, { base: Vec3; entities: Raw[] }>();
  let entities: Raw[] = [];

  let i = 0;
  const value = (k: number) => pairs[k][1].trim();
  while (i < pairs.length) {
    if (pairs[i][0] === 0 && value(i) === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = value(i + 1);
      i += 2;
      const start = i;
      while (i < pairs.length && !(pairs[i][0] === 0 && value(i) === 'ENDSEC')) i++;
      const body = pairs.slice(start, i);
      if (name === 'HEADER') readHeader(body, header);
      else if (name === 'TABLES') readLayers(records(body), layerTable);
      else if (name === 'BLOCKS') readBlocks(records(body), blocks);
      else if (name === 'ENTITIES') entities = records(body);
    }
    i++;
  }

  const unitCode = Number(header.get('$INSUNITS')?.[0]?.[1] ?? 0);
  const out: DxfDrawing = { units: INSUNITS[unitCode] ?? null, layers: [], curves: [], texts: [], dimensions: [], faces: [], skipped: new Map() };
  const skip = (what: string) => out.skipped.set(what, (out.skipped.get(what) ?? 0) + 1);
  const counts = new Map<string, number>();

  const emit = (raw: Raw, xf: Affine, inherited: string | null, depth: number) => {
    const g = new Fields(raw.codes);
    if (g.num(67, 0) === 1) return skip('things on paper-space layouts');
    let layer = g.str(8, '0');
    if (inherited !== null && layer === '0') layer = inherited;
    const before = out.curves.length + out.texts.length + out.dimensions.length + out.faces.length;
    convertEntity(raw, g, xf, layer, out, skip, (name, place) => {
      const block = blocks.get(name);
      if (!block) return skip('blocks missing from the file');
      if (depth > 16) return skip('blocks placed inside themselves');
      for (const e of block.entities) emit(e, place(block.base), layer, depth + 1);
    });
    const added = out.curves.length + out.texts.length + out.dimensions.length + out.faces.length - before;
    if (added) counts.set(layer, (counts.get(layer) ?? 0) + added);
  };
  for (const e of entities) emit(e, IDENTITY, null, 0);

  const names = new Set([...layerTable.keys(), ...counts.keys()]);
  out.layers = [...names].filter((n) => counts.get(n)).map((name) => ({ name, off: layerTable.get(name) ?? false, count: counts.get(name)! }));
  return out;
}

/** Entities (with a POLYLINE's VERTEX records gathered into it) from a section body. */
function records(body: readonly Pair[]): Raw[] {
  const list: Raw[] = [];
  let cur: Raw | null = null;
  for (const [c, v] of body) {
    if (c === 0) {
      cur = { type: v.trim(), codes: [] };
      list.push(cur);
    } else cur?.codes.push([c, v]);
  }
  const out: Raw[] = [];
  for (let k = 0; k < list.length; k++) {
    const r = list[k];
    if (r.type === 'POLYLINE' || r.type === 'INSERT') {
      const following: Raw[] = [];
      while (k + 1 < list.length && (list[k + 1].type === 'VERTEX' || list[k + 1].type === 'ATTRIB')) following.push(list[++k]);
      if (list[k + 1]?.type === 'SEQEND') k++;
      if (r.type === 'POLYLINE') r.vertices = following;
    }
    out.push(r);
  }
  return out;
}

function readHeader(body: readonly Pair[], header: Map<string, Pair[]>): void {
  let name = '';
  for (const p of body) {
    if (p[0] === 9) {
      name = p[1].trim();
      header.set(name, []);
    } else if (name) header.get(name)!.push([p[0], p[1].trim()]);
  }
}

function readLayers(recs: readonly Raw[], layers: Map<string, boolean>): void {
  for (const r of recs) {
    if (r.type !== 'LAYER') continue;
    const g = new Fields(r.codes);
    const name = g.str(2, '');
    if (name) layers.set(name, (g.num(70, 0) & 1) === 1 || g.num(62, 7) < 0);
  }
}

function readBlocks(recs: readonly Raw[], blocks: Map<string, { base: Vec3; entities: Raw[] }>): void {
  let cur: { base: Vec3; entities: Raw[] } | null = null;
  for (const r of recs) {
    if (r.type === 'BLOCK') {
      const g = new Fields(r.codes);
      cur = { base: g.point(10), entities: [] };
      blocks.set(g.str(2, ''), cur);
    } else if (r.type === 'ENDBLK') cur = null;
    else cur?.entities.push(r);
  }
}

/** Group code lookup for one entity. */
class Fields {
  constructor(readonly codes: readonly Pair[]) {}
  str(code: number, fallback: string): string {
    const p = this.codes.find(([c]) => c === code);
    return p ? p[1].trim() : fallback;
  }
  num(code: number, fallback: number): number {
    const p = this.codes.find(([c]) => c === code);
    const n = p ? Number(p[1]) : NaN;
    return Number.isFinite(n) ? n : fallback;
  }
  all(code: number): number[] {
    return this.codes.filter(([c]) => c === code).map(([, v]) => Number(v));
  }
  point(code: number, fallback: Vec3 = [0, 0, 0]): Vec3 {
    return [this.num(code, fallback[0]), this.num(code + 10, fallback[1]), this.num(code + 20, fallback[2])];
  }
  /** Every point of a coordinate code (control points and the like), in order. */
  points(code: number): Vec3[] {
    const out: [number, number, number][] = [];
    for (const [c, v] of this.codes) {
      if (c === code) out.push([Number(v), 0, 0]);
      else if (c === code + 10 && out.length) out[out.length - 1][1] = Number(v);
      else if (c === code + 20 && out.length) out[out.length - 1][2] = Number(v);
    }
    return out;
  }
  extrusion(): Vec3 {
    return this.point(210, [0, 0, 1]);
  }
  text(): string {
    // Long MTEXT comes in pieces: 3s first, then the 1.
    const parts = this.codes.filter(([c]) => c === 3).map(([, v]) => v);
    const last = this.codes.find(([c]) => c === 1);
    return [...parts, last?.[1] ?? ''].join('');
  }
}

const RAD = Math.PI / 180;

const SKIP_NAMES: Record<string, string> = {
  HATCH: 'hatches',
  IMAGE: 'images',
  WIPEOUT: 'wipeouts',
  VIEWPORT: 'viewports',
  '3DSOLID': '3D solids (ACIS)',
  BODY: '3D solids (ACIS)',
  REGION: 'regions (ACIS)',
  SURFACE: 'surfaces (ACIS)',
  MESH: 'subdivision meshes',
  LEADER: 'leaders',
  MULTILEADER: 'leaders',
  MLEADER: 'leaders',
  TOLERANCE: 'tolerance frames',
  XLINE: 'construction lines',
  RAY: 'construction lines',
  ATTDEF: 'attribute definitions',
  OLE2FRAME: 'embedded objects',
  ACAD_PROXY_ENTITY: 'proxy objects',
  POINT: 'points',
};

type Placer = (name: string, place: (base: Vec3) => Affine) => void;

function convertEntity(raw: Raw, g: Fields, xf: Affine, layer: string, out: DxfDrawing, skip: (what: string) => void, insert: Placer): void {
  const curve = (c: DrawingCurve) => out.curves.push({ layer, curve: c });
  const path = (pts: Vec3[]) => {
    if (pts.length >= 2) curve({ kind: 'path', points: pts.map((p) => pointOf(xf, p)) });
  };
  const conic = (local: Affine, center: Vec3, u: Vec3, v: Vec3, start: number, end: number) => {
    const a = compose(xf, local);
    curve({ kind: 'conic', center: pointOf(a, center), u: dirOf(a, u), v: dirOf(a, v), start, end });
  };

  switch (raw.type) {
    case 'LINE':
      return path([g.point(10), g.point(11)]);

    case 'CIRCLE': {
      const r = g.num(40, 0);
      if (r > 0) conic(ocs(g.extrusion()), g.point(10), [r, 0, 0], [0, r, 0], 0, 2 * Math.PI);
      return;
    }

    case 'ARC': {
      const r = g.num(40, 0);
      const a0 = g.num(50, 0) * RAD;
      let a1 = g.num(51, 360) * RAD;
      while (a1 <= a0 + 1e-12) a1 += 2 * Math.PI;
      if (r > 0) conic(ocs(g.extrusion()), g.point(10), [r, 0, 0], [0, r, 0], a0, a1);
      return;
    }

    case 'ELLIPSE': {
      const major = g.point(11);
      const ratio = g.num(40, 1);
      const minor = scale(cross(normalize(g.extrusion()), major), ratio);
      const t0 = g.num(41, 0);
      let t1 = g.num(42, 2 * Math.PI);
      while (t1 <= t0 + 1e-12) t1 += 2 * Math.PI;
      conic(IDENTITY, g.point(10), major, minor, t0, t1);
      return;
    }

    case 'LWPOLYLINE': {
      const verts: { p: Vec3; bulge: number }[] = [];
      const z = g.num(38, 0);
      for (const [c, v] of g.codes) {
        if (c === 10) verts.push({ p: [Number(v), 0, z], bulge: 0 });
        else if (c === 20 && verts.length) verts[verts.length - 1].p = [verts[verts.length - 1].p[0], Number(v), z];
        else if (c === 42 && verts.length) verts[verts.length - 1].bulge = Number(v);
      }
      polyline(verts, (g.num(70, 0) & 1) === 1, ocs(g.extrusion()));
      return;
    }

    case 'POLYLINE': {
      const flags = g.num(70, 0);
      const vs = (raw.vertices ?? []).map((v) => ({ g: new Fields(v.codes), flags: new Fields(v.codes).num(70, 0) }));
      if (flags & 64) {
        // Polyface mesh: vertices, then faces by 1-based vertex numbers.
        const positions = vs.filter((v) => v.flags & 64).map((v) => pointOf(xf, v.g.point(10)));
        for (const v of vs) {
          if (!(v.flags & 128) || v.flags & 64) continue;
          const idx = [71, 72, 73, 74].map((c) => Math.abs(v.g.num(c, 0))).filter((n) => n > 0 && n <= positions.length);
          if (idx.length >= 3) out.faces.push({ layer, points: idx.map((n) => positions[n - 1]) });
        }
        return;
      }
      if (flags & 16) {
        // Polygon mesh: an M × N grid of vertices.
        const m = g.num(71, 0);
        const n = g.num(72, 0);
        const p = vs.map((v) => pointOf(xf, v.g.point(10)));
        if (m * n !== p.length || m < 2 || n < 2) return skip('broken polygon meshes');
        const closedM = (flags & 1) === 1;
        const closedN = (flags & 32) === 32;
        for (let a = 0; a < (closedM ? m : m - 1); a++)
          for (let b = 0; b < (closedN ? n : n - 1); b++) {
            const a1 = (a + 1) % m;
            const b1 = (b + 1) % n;
            out.faces.push({ layer, points: [p[a * n + b], p[a1 * n + b], p[a1 * n + b1], p[a * n + b1]] });
          }
        return;
      }
      // Spline frame points (16) are the control frame, not the curve.
      const kept = vs.filter((v) => !(v.flags & 16));
      if (flags & 8) return path([...kept.map((v) => v.g.point(10)), ...(flags & 1 && kept.length > 2 ? [kept[0].g.point(10)] : [])]);
      const z = g.point(10)[2];
      polyline(
        kept.map((v) => ({ p: [v.g.num(10, 0), v.g.num(20, 0), z] as Vec3, bulge: v.g.num(42, 0) })),
        (flags & 1) === 1,
        ocs(g.extrusion()),
      );
      return;
    }

    case 'SPLINE': {
      const points = g.points(10).map((p) => pointOf(xf, p));
      if (points.length >= 2) {
        const weights = g.all(41);
        curve({ kind: 'spline', degree: g.num(71, 3), knots: g.all(40), points, ...(weights.length === points.length ? { weights } : {}) });
        return;
      }
      // Only fit points: the curve passes through them; joined straight (close to it when they are dense).
      const fit = g.points(11);
      if (fit.length >= 2) path(fit);
      return;
    }

    case 'SOLID':
    case 'TRACE': {
      // A filled 2D outline; its corners go 1, 2, 4, 3.
      const [p1, p2, p3, p4] = [10, 11, 12, 13].map((c) => g.point(c));
      const ring = length([p4[0] - p3[0], p4[1] - p3[1], p4[2] - p3[2]]) > 1e-9 ? [p1, p2, p4, p3] : [p1, p2, p3];
      const a = compose(xf, ocs(g.extrusion()));
      curve({ kind: 'path', points: [...ring, ring[0]].map((p) => pointOf(a, p)) });
      return;
    }

    case '3DFACE': {
      const p = [10, 11, 12, 13].map((c) => pointOf(xf, g.point(c)));
      const ring = length([p[3][0] - p[2][0], p[3][1] - p[2][1], p[3][2] - p[2][2]]) > 1e-9 ? p : p.slice(0, 3);
      out.faces.push({ layer, points: ring });
      return;
    }

    case 'TEXT':
    case 'ATTRIB': {
      const aligned = g.num(72, 0) !== 0 || g.num(73, 0) !== 0;
      const at = aligned ? g.point(11) : g.point(10);
      const t = plainText(g.str(1, ''));
      if (t) out.texts.push({ layer, point: pointOf(compose(xf, ocs(g.extrusion())), at), text: t });
      return;
    }

    case 'MTEXT': {
      const t = plainText(mtextPlain(g.text()));
      if (t) out.texts.push({ layer, point: pointOf(xf, g.point(10)), text: t });
      return;
    }

    case 'DIMENSION': {
      const type = g.num(70, 0) & 7;
      const measured = g.num(42, NaN);
      const text = plainText(mtextPlain(g.str(1, '')));
      if (type === 0 || type === 1) {
        const a = pointOf(xf, g.point(13));
        const b = pointOf(xf, g.point(14));
        const angle = g.num(50, 0) * RAD;
        const local = ocs(g.extrusion());
        const dir = type === 0 ? dirOf(compose(xf, local), [Math.cos(angle), Math.sin(angle), 0]) : ([b[0] - a[0], b[1] - a[1], b[2] - a[2]] as Vec3);
        if (length(dir) <= 1e-12) return skip('dimensions of zero length');
        out.dimensions.push({ layer, kind: 'linear', a, b, line: pointOf(xf, g.point(10)), dir: normalize(dir), text, measured: Number.isFinite(measured) ? measured : NaN });
      } else {
        out.dimensions.push({ layer, kind: 'other', type, point: pointOf(compose(xf, ocs(g.extrusion())), g.point(11)), text, measured });
      }
      return;
    }

    case 'INSERT': {
      const name = g.str(2, '');
      const sx = g.num(41, 1);
      const sy = g.num(42, 1);
      const sz = g.num(43, 1);
      const rot = g.num(50, 0) * RAD;
      const cols = Math.max(1, g.num(70, 1));
      const rows = Math.max(1, g.num(71, 1));
      const dc = g.num(44, 0);
      const dr = g.num(45, 0);
      const ins = g.point(10);
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const base = compose(xf, ocs(g.extrusion()));
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          const ox = col * dc;
          const oy = row * dr;
          insert(name, (bp) => {
            // OCS · move to the insertion point · turn · array offset · scale · block base to the origin.
            const local: Affine = {
              m: [c * sx, -s * sy, 0, s * sx, c * sy, 0, 0, 0, sz],
              t: [ins[0] + c * ox - s * oy - (c * sx * bp[0] - s * sy * bp[1]), ins[1] + s * ox + c * oy - (s * sx * bp[0] + c * sy * bp[1]), ins[2] - sz * bp[2]],
            };
            return compose(base, local);
          });
        }
      return;
    }

    default:
      skip(SKIP_NAMES[raw.type] ?? `${raw.type.toLowerCase()} entities`);
  }

  /** A 2D polyline in object coordinates: straight runs, and arcs where a vertex has a bulge. */
  function polyline(verts: { p: Vec3; bulge: number }[], closed: boolean, local: Affine): void {
    if (verts.length < 2) return;
    const a = compose(xf, local);
    const n = closed ? verts.length : verts.length - 1;
    let run: Vec3[] = [verts[0].p];
    const flush = () => {
      if (run.length >= 2) curve({ kind: 'path', points: run.map((p) => pointOf(a, p)) });
    };
    for (let k = 0; k < n; k++) {
      const p = verts[k].p;
      const q = verts[(k + 1) % verts.length].p;
      const bulge = verts[k].bulge;
      if (Math.abs(bulge) < 1e-12) {
        run.push(q);
        continue;
      }
      flush();
      run = [q];
      // Bulge = tan(included angle / 4); positive goes anticlockwise.
      const theta = 4 * Math.atan(bulge);
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const chord = Math.hypot(dx, dy);
      if (chord < 1e-12) continue;
      const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
      const d = (chord / 2) / Math.tan(theta / 2);
      // The centre is left of p→q for an anticlockwise arc under a half turn.
      const cx = (p[0] + q[0]) / 2 - (dy / chord) * d;
      const cy = (p[1] + q[1]) / 2 + (dx / chord) * d;
      const s0 = Math.atan2(p[1] - cy, p[0] - cx);
      const center: Vec3 = [cx, cy, p[2]];
      if (theta > 0) curve(arcConic(a, center, r, s0, s0 + theta, false));
      else curve(arcConic(a, center, r, -s0, -s0 - theta, true));
    }
    flush();
  }
}

/** An arc in object coordinates as a conic; `mirrored` runs it clockwise (v points down). */
function arcConic(a: Affine, center: Vec3, r: number, start: number, end: number, mirrored: boolean): DrawingCurve {
  return { kind: 'conic', center: pointOf(a, center), u: dirOf(a, [r, 0, 0]), v: dirOf(a, [0, mirrored ? -r : r, 0]), start, end };
}

/** MTEXT formatting codes removed: paragraphs become line breaks, fonts and colours go. */
export function mtextPlain(s: string): string {
  return s
    .replace(/\\[Pp]/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\S([^;]*)[\^#/]([^;]*);/g, '$1/$2')
    .replace(/\\[ACcFfHhQqTtWwp][^;\\]*;/g, '')
    .replace(/\\[LlOoKkNX]/g, '')
    .replace(/\\\\/g, '\u0000')
    .replace(/[{}]/g, '')
    .replace(/\u0000/g, '\\');
}

/** Text codes common to TEXT and MTEXT: %%c and friends, and \U+XXXX characters. */
export function plainText(s: string): string {
  return s
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%')
    .trim();
}
