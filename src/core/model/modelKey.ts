import type { Model } from './Model';

/** Scratch space for reading a number's exact bits. */
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/**
 * The fields `modelKey` reads from each kind of record. Any other field would be missed, so a test
 * checks that records carry only these.
 */
export const KEYED_FIELDS = {
  vertex: ['id', 'pos'],
  halfEdge: ['id', 'origin', 'twin', 'next', 'prev', 'loop', 'curve', 'soft', 'hidden'],
  loop: ['id', 'face', 'first'],
  face: ['id', 'outer', 'holes', 'normal', 'material'],
  curve: ['id', 'kind', 'center', 'normal', 'radius', 'segments'],
} as const;

/**
 * A fingerprint of everything in a model (every field of every vertex, half-edge, loop, face and
 * curve). The view rebuilds a group's drawing only when its fingerprint changes: rebuilding every
 * group after each change (moving one object in a furnished room) took most of a second. It runs
 * for every group after every change, so it reads the fields directly: a generic walk over the
 * records took a quarter of a second in a furnished room. Two 32-bit hashes of the numbers' bits.
 */
export function modelKey(m: Model): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const mix = (x: number) => {
    a = Math.imul(a ^ x, 0x01000193);
    b = Math.imul(b ^ x, 0x5bd1e995) ^ (b >>> 15);
  };
  /** Ids and links: small whole numbers, or null. */
  const id = (x: number | null | undefined) => mix(x === null || x === undefined ? 0x6e756c6c : x | 0);
  const num = (x: number) => {
    f64[0] = x;
    mix(u32[0]);
    mix(u32[1]);
  };
  const vec = (v: readonly number[]) => {
    num(v[0]);
    num(v[1]);
    num(v[2]);
  };
  const str = (s: string | undefined) => {
    if (s === undefined) return mix(0x7564);
    mix(0x5354 + s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  mix(m.vertices.size);
  for (const v of m.vertices.values()) {
    id(v.id);
    vec(v.pos);
  }
  mix(m.halfEdges.size);
  for (const h of m.halfEdges.values()) {
    id(h.id);
    id(h.origin);
    id(h.twin);
    id(h.next);
    id(h.prev);
    id(h.loop);
    id(h.curve);
    mix(h.soft === undefined ? 2 : h.soft ? 1 : 0);
    mix(h.hidden ? 1 : 0);
  }
  mix(m.loops.size);
  for (const l of m.loops.values()) {
    id(l.id);
    id(l.face);
    id(l.first);
  }
  mix(m.faces.size);
  for (const f of m.faces.values()) {
    id(f.id);
    id(f.outer);
    mix(f.holes.length);
    for (const h of f.holes) id(h);
    vec(f.normal);
    str(f.material);
  }
  mix(m.curves.size);
  for (const c of m.curves.values()) {
    id(c.id);
    str(c.kind);
    vec(c.center);
    vec(c.normal);
    num(c.radius);
    num(c.segments);
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

const known = new WeakMap<Model, { version: number; key: string }>();

/** `modelKey`, worked out again only when the model's version has moved since last asked. */
export function cachedModelKey(m: Model): string {
  const k = known.get(m);
  if (k && k.version === m.version) return k.key;
  const key = modelKey(m);
  known.set(m, { version: m.version, key });
  return key;
}
