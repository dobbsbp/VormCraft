import { normalize, type Vec3 } from '../core/math/vec3';

export type SectionId = number;

/**
 * A section plane: everything on the side its normal points to is cut away while it is active,
 * so the inside of the model shows.
 */
export interface SectionPlane {
  readonly id: SectionId;
  point: Vec3;
  /** Points to the side that is cut away. */
  normal: Vec3;
}

/**
 * The document's section planes. At most one cuts the view at a time (`active`). `visible` is
 * whether the planes themselves are drawn (the cut still works when they are not). Saved and
 * undoable like the rest of the document.
 */
export class Sections {
  readonly items = new Map<SectionId, SectionPlane>();
  active: SectionId | null = null;
  visible = true;
  private nextId = 1;

  add(point: Vec3, normal: Vec3, id?: SectionId): SectionId {
    const sid = id ?? this.nextId;
    if (this.items.has(sid)) throw new Error(`Section id ${sid} is in use`);
    this.nextId = Math.max(this.nextId, sid + 1);
    this.items.set(sid, { id: sid, point: [...point], normal: normalize(normal) });
    return sid;
  }

  get(id: SectionId | null): SectionPlane | undefined {
    return id === null ? undefined : this.items.get(id);
  }

  /** The plane cutting the view, if any. */
  activePlane(): SectionPlane | undefined {
    return this.get(this.active);
  }

  delete(id: SectionId): void {
    this.items.delete(id);
    if (this.active === id) this.active = null;
  }

  clone(): Sections {
    const c = new Sections();
    c.nextId = this.nextId;
    c.active = this.active;
    c.visible = this.visible;
    for (const [k, s] of this.items) c.items.set(k, { ...s, point: [...s.point], normal: [...s.normal] });
    return c;
  }

  copyFrom(other: Sections): void {
    const c = other.clone();
    this.nextId = c.nextId;
    this.active = c.active;
    this.visible = c.visible;
    this.items.clear();
    for (const [k, s] of c.items) this.items.set(k, s);
  }
}
