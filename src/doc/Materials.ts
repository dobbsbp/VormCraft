import type { MaterialId } from '../core/model/Model';

/** An image tiled over a face: `width` × `height` millimetres per copy of the image. */
export interface MaterialTexture {
  /** The image as a data URL (PNG or JPEG), so the document is self-contained. */
  readonly image: string;
  readonly width: number;
  readonly height: number;
}

/**
 * A paint: a colour, optionally see-through, optionally with a texture image (which replaces the
 * colour). Materials are never changed in place: an edit replaces the object, so the viewer can
 * tell what changed by identity.
 */
export interface Material {
  readonly id: MaterialId;
  readonly name: string;
  /** "#rrggbb". */
  readonly color: string;
  /** 1 = solid, down to 0 = fully see-through. */
  readonly opacity: number;
  readonly texture?: MaterialTexture;
}

export type MaterialFields = Omit<Material, 'id'>;

function check(m: MaterialFields): void {
  if (!/^#[0-9a-f]{6}$/i.test(m.color)) throw new Error(`Bad colour "${m.color}"`);
  if (!(m.opacity >= 0 && m.opacity <= 1)) throw new Error('Opacity must be between 0 and 1');
  if (!m.name.trim()) throw new Error('A material needs a name');
  if (m.texture && !(m.texture.width > 0 && m.texture.height > 0)) throw new Error('A texture needs a size');
  if (m.texture && !m.texture.image.startsWith('data:image/')) throw new Error('A texture must be an image');
}

/** The materials defined in a document (saved and undoable, like guides and labels). */
export class Materials {
  readonly items = new Map<MaterialId, Material>();
  private nextId = 1;

  add(fields: MaterialFields, id?: MaterialId): MaterialId {
    check(fields);
    if (id === undefined) {
      do id = `m${this.nextId++}`;
      while (this.items.has(id));
    } else if (this.items.has(id)) throw new Error(`Material ${id} already exists`);
    this.items.set(id, { ...fields, id });
    return id;
  }

  get(id: MaterialId): Material | undefined {
    return this.items.get(id);
  }

  /** Change some fields; `texture: null` removes the texture. */
  update(id: MaterialId, changes: Partial<Omit<MaterialFields, 'texture'>> & { texture?: MaterialTexture | null }): void {
    const old = this.items.get(id);
    if (!old) throw new Error('That material no longer exists');
    const { texture, ...rest } = changes;
    const next: { -readonly [K in keyof Material]: Material[K] } = { ...old, ...rest };
    if (texture === null) delete next.texture;
    else if (texture !== undefined) next.texture = texture;
    check(next);
    this.items.set(id, next);
  }

  delete(id: MaterialId): void {
    this.items.delete(id);
  }

  /** `base`, or "base 2", "base 3"... if a material already has that name. */
  uniqueName(base: string): string {
    const names = new Set([...this.items.values()].map((m) => m.name));
    if (!names.has(base)) return base;
    let i = 2;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  clone(): Materials {
    const c = new Materials();
    c.nextId = this.nextId;
    for (const [k, v] of this.items) c.items.set(k, v);
    return c;
  }

  copyFrom(other: Materials): void {
    this.nextId = other.nextId;
    this.items.clear();
    for (const [k, v] of other.items) this.items.set(k, v);
  }
}
