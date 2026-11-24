import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Document } from '../doc/Document';
import type { Version } from '../doc/Versions';
import { documentToFile, FileFormatError, FORMAT_VERSION, NewerFormatError, OLDER_VERSION, parseFile, serializeDocument, WRITE_ZIPPED, type FileV3, type SerializeOptions } from './fileFormat';
import { hashText } from './hash';

/**
 * The `.vorm` file on disk (format 9 on): a zip holding the design as JSON (`design.json`, the
 * same JSON `fileFormat.ts` reads and writes), with what is already compressed kept beside it as
 * it is instead of as base64 text: texture images (`textures/`), the design history's versions
 * (`history/`) and the undo steps (`undo/`). A value moved out is replaced in the JSON by
 * `ENTRY` and the entry's name.
 *
 * Files from before format 9 are plain JSON; they are told apart by their first bytes, and keep
 * opening. Anyone can unzip a file to look inside it. Entries this version does not know are
 * left alone when reading, so later versions can add their own (a preview picture, say).
 */

export interface VormSaveOptions extends Omit<SerializeOptions, 'version'> {
  /** The app saving the file ("VormCraft 1.0.0"), written into zipped files. */
  savedBy?: string;
  /** A zip (format 9), or plain JSON every 0.9 app opens (format 8). Default: `WRITE_ZIPPED`. */
  zipped?: boolean;
}

export interface ReadVorm {
  doc: Document;
  /** The format version the file was saved in. */
  version: number;
  /** Saved by a newer version that older readers can open: parts this version does not know are left out. */
  newer: boolean;
}

const DESIGN = 'design.json';
/** A JSON value kept in an entry of its own: this prefix and the entry's name. */
const ENTRY = 'vorm-entry:';
/** Deflate level for the design: 3 is within 10 % of the smallest and about twice as fast as 6. */
const LEVEL = 3;
/** The most a file may unpack to (the design's JSON must also fit in one string). */
const MAX_DESIGN_BYTES = 500_000_000;
const MAX_TOTAL_BYTES = 2_000_000_000;

/** Texture images moved into entries of their own, by type. Others stay in the JSON. */
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' };
const EXT_IMAGE = Object.fromEntries(Object.entries(IMAGE_EXT).map(([type, ext]) => [ext, type]));
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/;

/** A zip file starts with a local file header ("PK", 3, 4); a JSON file with "{" (or a BOM). */
export function isZipped(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
}

/** The design as a `.vorm` file. */
export function encodeVorm(doc: Document, opts: VormSaveOptions = {}): Uint8Array {
  // Plain JSON marked format 8 (and no `savedBy`, which 0.9 apps would count as a change to the
  // design and so drop the undo steps).
  if (!(opts.zipped ?? WRITE_ZIPPED)) return strToU8(serializeDocument(doc, { history: opts.history, undo: opts.undo, version: OLDER_VERSION }));
  const file = documentToFile(doc, { history: opts.history, undo: opts.undo, version: FORMAT_VERSION });
  if (opts.savedBy) file.savedBy = opts.savedBy;
  const entries: Zippable = {};
  const out = (name: string, bytes: Uint8Array) => {
    entries[name] = [bytes, { level: 0 }];
    return ENTRY + name;
  };
  // A texture image, once however many materials and versions use it.
  const image = (url: string): string => {
    const m = DATA_URL.exec(url);
    const ext = m && IMAGE_EXT[m[1]];
    if (!m || !ext) return url;
    const name = `textures/${hashText(url)}.${ext}`;
    if (!entries[name]) {
      const data = fromBase64(url.slice(m[0].length));
      // Only if it reads back exactly as it was (so undo steps still match the design).
      if (toBase64(data) !== url.slice(m[0].length)) return url;
      entries[name] = [data, { level: 0 }];
    }
    return ENTRY + name;
  };
  // The JSON is first in the zip, as anyone looking inside would expect.
  entries[DESIGN] = new Uint8Array(0);
  // (Copies: the materials are the design's own.)
  if (file.materials) file.materials = file.materials.map((mat) => (mat.texture ? { ...mat, texture: { ...mat.texture, image: image(mat.texture.image) } } : mat));
  if (file.history) {
    file.history = {
      versions: file.history.versions.map((v) => ({ ...v, data: out(`history/${v.id}.gz`, fromBase64(v.data)) })),
      textures: Object.fromEntries(Object.entries(file.history.textures).map(([k, url]) => [k, image(url)])),
    };
  }
  if (file.undo) file.undo = { ...file.undo, steps: file.undo.steps.map((s, i) => ({ ...s, data: out(`undo/${i}.gz`, fromBase64(s.data)) })) };
  entries[DESIGN] = [strToU8(JSON.stringify(file)), { level: LEVEL }];
  return zipSync(entries);
}

/** Read a `.vorm` (or older `.benup`) file: a zip from format 9 on, plain JSON before. */
export function readVorm(bytes: Uint8Array): ReadVorm {
  let raw: unknown;
  if (isZipped(bytes)) {
    raw = unzipDesign(bytes);
  } else {
    // (The decoder drops a byte-order mark, which some editors add.)
    const text = new TextDecoder().decode(bytes);
    // Not text at all: perhaps a way of saving that a later version brought in.
    if (!looksLikeJson(text)) throw new NewerFormatError(MAYBE_NEWER);
    try {
      raw = JSON.parse(text);
    } catch {
      throw new FileFormatError('This is not a VormCraft file (it is not valid JSON).');
    }
  }
  const doc = parseFile(raw);
  const version = (raw as FileV3).version;
  return { doc, version, newer: version > FORMAT_VERSION };
}

/** The design's JSON from a zipped file, with the values kept in entries put back. */
function unzipDesign(bytes: Uint8Array): unknown {
  let files: Record<string, Uint8Array>;
  try {
    let total = 0;
    files = unzipSync(bytes, {
      // Only what this version reads, and never more than it can hold (a damaged or hostile file).
      filter: (f) => {
        if (f.name !== DESIGN && !/^(textures|history|undo)\//.test(f.name)) return false;
        total += f.originalSize;
        if ((f.name === DESIGN && f.originalSize > MAX_DESIGN_BYTES) || total > MAX_TOTAL_BYTES) throw new Error('it is too large to open');
        return true;
      },
    });
  } catch (err) {
    throw new FileFormatError(`The file is damaged: ${err instanceof Error ? err.message : String(err)}.`);
  }
  const design = files[DESIGN];
  if (!design) throw new NewerFormatError(MAYBE_NEWER);
  let f: FileV3;
  try {
    f = JSON.parse(strFromU8(design)) as FileV3;
  } catch {
    throw new FileFormatError('The file is damaged: its design cannot be read.');
  }
  if (!f || typeof f !== 'object') throw new FileFormatError('This is not a VormCraft file.');
  /** The value an entry holds, or null if it is missing. */
  const entry = (value: unknown): string | null => {
    if (typeof value !== 'string' || !value.startsWith(ENTRY)) return typeof value === 'string' ? value : null;
    const name = value.slice(ENTRY.length);
    const data = files[name];
    if (!data) return null;
    const type = EXT_IMAGE[name.slice(name.lastIndexOf('.') + 1)];
    return type && name.startsWith('textures/') ? `data:${type};base64,${toBase64(data)}` : toBase64(data);
  };
  // A missing texture loses only the picture (the colour stays); missing history or undo steps
  // lose only those, never the design.
  if (Array.isArray(f.materials)) {
    f.materials = f.materials.map((mat) => {
      if (!mat?.texture) return mat;
      const image = entry(mat.texture.image);
      if (image !== null) return { ...mat, texture: { ...mat.texture, image } };
      const { texture: _lost, ...rest } = mat;
      return rest;
    });
  }
  if (f.history) {
    const versions = Array.isArray(f.history.versions) ? f.history.versions.map((v) => ({ ...v, data: entry(v?.data) })) : [];
    const textures = Object.entries(f.history.textures ?? {}).map(([k, v]) => [k, entry(v)] as const);
    if (versions.every((v) => v.data !== null) && textures.every(([, v]) => v !== null)) f.history = { versions: versions as Version[], textures: Object.fromEntries(textures) as Record<string, string> };
    else delete f.history;
  }
  if (f.undo) {
    const steps = Array.isArray(f.undo.steps) ? f.undo.steps.map((s) => ({ ...s, data: entry(s?.data) })) : [];
    if (steps.every((s) => s.data !== null)) f.undo = { ...f.undo, steps: steps as NonNullable<FileV3['undo']>['steps'] };
    else delete f.undo;
  }
  return f;
}

/** For a file that is not one this version knows how to read, but could be one from a later version. */
const MAYBE_NEWER = 'This file cannot be read. If it was saved by a newer version of VormCraft, updating VormCraft will open it.';

/** Starts like JSON (an object, after any spaces). */
function looksLikeJson(text: string): boolean {
  return /^\s*\{/.test(text.slice(0, 64));
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
