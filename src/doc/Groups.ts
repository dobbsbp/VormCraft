import type { MaterialId } from '../core/model/Model';
import { Model } from '../core/model/Model';

export type GroupId = number;

/**
 * A group: geometry kept in a model of its own (so it never sticks to anything outside it),
 * inside another group or at the top level (`parent` null). Groups can hold groups.
 */
export interface Group {
  readonly id: GroupId;
  name: string;
  parent: GroupId | null;
  model: Model;
  /** Paint for the group's faces that have none of their own (and those of groups inside it). */
  material?: MaterialId;
}

/** The document's groups. Like the rest of the document they are saved and undoable. */
export class Groups {
  readonly items = new Map<GroupId, Group>();
  private nextId = 1;

  add(model: Model, parent: GroupId | null, opts: { name?: string; id?: GroupId; material?: MaterialId } = {}): GroupId {
    const id = opts.id ?? this.nextId;
    if (this.items.has(id)) throw new Error(`Group id ${id} is in use`);
    this.nextId = Math.max(this.nextId, id + 1);
    this.items.set(id, { id, name: opts.name ?? `Group ${id}`, parent, model, ...(opts.material !== undefined ? { material: opts.material } : {}) });
    return id;
  }

  get(id: GroupId): Group | undefined {
    return this.items.get(id);
  }

  has(id: GroupId): boolean {
    return this.items.has(id);
  }

  /** Groups directly inside `parent` (null: the top level). */
  children(parent: GroupId | null): Group[] {
    return [...this.items.values()].filter((g) => g.parent === parent);
  }

  /** The group and every group inside it, at any depth. */
  subtree(id: GroupId): Group[] {
    const out: Group[] = [];
    const visit = (g: Group | undefined) => {
      if (!g) return;
      out.push(g);
      for (const c of this.children(g.id)) visit(c);
    };
    visit(this.items.get(id));
    return out;
  }

  /** Whether `id` is `ancestor` or inside it (at any depth). Null stands for the top level. */
  isWithin(id: GroupId, ancestor: GroupId | null): boolean {
    for (let g = this.items.get(id); g; g = g.parent === null ? undefined : this.items.get(g.parent)) {
      if (g.id === ancestor) return true;
    }
    return ancestor === null;
  }

  /**
   * The group directly inside `context` that holds `id` (`id` itself, or the group around it), or
   * null if `id` is not inside `context`.
   */
  childOf(context: GroupId | null, id: GroupId): GroupId | null {
    for (let g = this.items.get(id); g; g = g.parent === null ? undefined : this.items.get(g.parent)) {
      if (g.parent === context) return g.id;
    }
    return null;
  }

  /** Paint shown on unpainted faces of the group: its own, else that of the nearest group around it. */
  inheritedMaterial(id: GroupId): MaterialId | undefined {
    for (let g = this.items.get(id); g; g = g.parent === null ? undefined : this.items.get(g.parent)) {
      if (g.material !== undefined) return g.material;
    }
    return undefined;
  }

  /** Delete a group and everything inside it. */
  delete(id: GroupId): void {
    for (const g of this.subtree(id)) this.items.delete(g.id);
  }

  /** Copy a group and everything inside it into `parent`; returns the new group's id. */
  duplicate(id: GroupId, parent: GroupId | null): GroupId {
    const src = this.items.get(id);
    if (!src) throw new Error('That group no longer exists');
    const copy = this.add(src.model.clone(), parent, { name: src.name, material: src.material });
    for (const c of this.children(id)) this.duplicate(c.id, copy);
    return copy;
  }

  clone(): Groups {
    const c = new Groups();
    c.nextId = this.nextId;
    for (const [k, g] of this.items) c.items.set(k, { ...g, model: g.model.clone() });
    return c;
  }

  copyFrom(other: Groups): void {
    const c = other.clone();
    this.nextId = c.nextId;
    this.items.clear();
    for (const [k, g] of c.items) this.items.set(k, g);
  }
}
