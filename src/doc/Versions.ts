/** Why a version was recorded. */
export type VersionKind = 'auto' | 'save' | 'opened' | 'restore';

/**
 * One saved point in a design's history: the whole document at that moment, compressed. Texture
 * images are kept once in `Versions.textures` (by hash), not in every version.
 */
export interface Version {
  readonly id: number;
  /** When it was recorded (milliseconds since 1970). */
  readonly time: number;
  /** The last change before it (an undo label such as "Push/Pull"). */
  readonly label: string;
  readonly kind: VersionKind;
  /** The document (without history) as gzip, base64. */
  readonly data: string;
  /** Hash of the uncompressed document, to skip recording the same state twice. */
  readonly hash: string;
  /** Hashes of the texture images it uses (in `Versions.textures`). */
  readonly textures: readonly string[];
}

/**
 * A design's version history (oldest first). Unlike the rest of the document it is not part of
 * undo: versions are only ever added (and old ones thinned out), so going back to one never loses
 * what came after. Saved in the file.
 */
export class Versions {
  items: Version[] = [];
  /** Texture images used by any version, by hash. */
  textures = new Map<string, string>();
  private nextId = 1;

  add(v: Omit<Version, 'id'>, id?: number): Version {
    const version = { ...v, id: id ?? this.nextId };
    this.nextId = Math.max(this.nextId, version.id + 1);
    this.items.push(version);
    this.items.sort((a, b) => a.time - b.time || a.id - b.id);
    return version;
  }

  get(id: number): Version | undefined {
    return this.items.find((v) => v.id === id);
  }

  get latest(): Version | undefined {
    return this.items[this.items.length - 1];
  }

  /** Compressed size of all versions and their textures, in bytes (about). */
  get bytes(): number {
    let n = 0;
    for (const v of this.items) n += v.data.length;
    for (const t of this.textures.values()) n += t.length;
    return n;
  }

  /** Keep only these versions (and the textures they still use). */
  keep(ids: Set<number>): void {
    this.items = this.items.filter((v) => ids.has(v.id));
    const used = new Set(this.items.flatMap((v) => v.textures));
    for (const h of [...this.textures.keys()]) if (!used.has(h)) this.textures.delete(h);
  }

  clear(): void {
    this.items = [];
    this.textures.clear();
  }

  copyFrom(other: Versions): void {
    this.items = [...other.items];
    this.textures = new Map(other.textures);
    this.nextId = other.nextId;
  }
}
