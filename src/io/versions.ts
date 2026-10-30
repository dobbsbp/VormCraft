import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { Document } from '../doc/Document';
import type { Version, VersionKind, Versions } from '../doc/Versions';
import { parseDocument, serializeDocument } from './fileFormat';

/** Texture images in a version's document are replaced by `TEXTURE_REF` + hash. */
const TEXTURE_REF = '#texture:';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A 64-bit FNV-1a hash (as hex) plus the length: enough to tell document states apart. */
export function hashText(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${text.length.toString(36)}-${a.toString(16)}${b.toString(16)}`;
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

export interface RecordOptions {
  time?: number;
  /** Largest size the history may grow to, in bytes; the oldest versions go first. */
  limitBytes?: number;
}

/**
 * Record the document as a new version (compressed, with texture images stored once). Nothing is
 * recorded if it is the same as the latest version. Older versions are thinned out: everything
 * from the last day, one per hour for the last week, one per day before that; then the oldest go
 * until the history fits `limitBytes`. Returns the new version, or null if nothing changed.
 */
export function recordVersion(doc: Document, label: string, kind: VersionKind, opts: RecordOptions = {}): Version | null {
  const versions = doc.versions;
  const file = JSON.parse(serializeDocument(doc, { history: false })) as { materials?: { texture?: { image: string } }[] };
  const textures: string[] = [];
  for (const m of file.materials ?? []) {
    if (!m.texture) continue;
    const h = hashText(m.texture.image);
    if (!versions.textures.has(h)) versions.textures.set(h, m.texture.image);
    textures.push(h);
    m.texture.image = TEXTURE_REF + h;
  }
  const text = JSON.stringify(file);
  const hash = hashText(text);
  if (versions.latest?.hash === hash) return null;
  const time = opts.time ?? Date.now();
  const v = versions.add({ time, label, kind, data: toBase64(gzipSync(strToU8(text), { level: 6 })), hash, textures });
  thinVersions(versions, time);
  if (opts.limitBytes !== undefined) trimVersions(versions, opts.limitBytes);
  return v;
}

/** The document as it was at a version. */
export function openVersion(versions: Versions, id: number): Document {
  const v = versions.get(id);
  if (!v) throw new Error('That version is no longer in the history');
  const file = JSON.parse(strFromU8(gunzipSync(fromBase64(v.data)))) as { materials?: { texture?: { image: string } }[] };
  for (const m of file.materials ?? []) {
    if (m.texture?.image.startsWith(TEXTURE_REF)) {
      const image = versions.textures.get(m.texture.image.slice(TEXTURE_REF.length));
      if (!image) throw new Error('A texture of that version is missing');
      m.texture.image = image;
    }
  }
  return parseDocument(JSON.stringify(file));
}

/**
 * Thin out older versions: keep all from the last day, the newest of each hour for the last week,
 * the newest of each day before that. The newest version is always kept.
 */
export function thinVersions(versions: Versions, now: number): void {
  const keep = new Set<number>();
  const buckets = new Map<string, Version>();
  for (const v of versions.items) {
    const age = now - v.time;
    if (age < DAY) {
      keep.add(v.id);
      continue;
    }
    const key = age < 7 * DAY ? `h${Math.floor(v.time / HOUR)}` : `d${Math.floor(v.time / DAY)}`;
    const prev = buckets.get(key);
    if (!prev || v.time >= prev.time) buckets.set(key, v);
  }
  for (const v of buckets.values()) keep.add(v.id);
  if (versions.latest) keep.add(versions.latest.id);
  if (keep.size !== versions.items.length) versions.keep(keep);
}

/** Drop the oldest versions until the history fits in `limitBytes` (the newest always stays). */
export function trimVersions(versions: Versions, limitBytes: number): void {
  while (versions.items.length > 1 && versions.bytes > limitBytes) {
    versions.keep(new Set(versions.items.slice(1).map((v) => v.id)));
  }
}
