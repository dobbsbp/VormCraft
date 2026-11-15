import type { MaterialId } from '../core/model/Model';
import { Model } from '../core/model/Model';
import { modelBounds, transformModel } from '../core/ops/group';
import { composeAffine, invertAffine, translation, type Affine } from '../core/ops/transform';

export type GroupId = number;
export type ComponentId = number;

/** A part of a component's definition: a group, in the component's own coordinates. */
export interface ComponentPart {
  /** 0 for the component's own geometry; groups inside it count up from 1. */
  key: number;
  parent: number | null;
  name: string;
  material?: MaterialId;
  hidden?: boolean;
  model: Model;
}

/**
 * A component: geometry shared by linked copies (its instances). The definition is kept in the
 * component's own coordinates; each instance is an ordinary group holding that geometry placed
 * in the model (`Group.component.place`), so every tool works on it as on any group. Editing
 * inside one instance changes the definition, and every other instance is rebuilt from it.
 */
export interface ComponentDef {
  readonly id: ComponentId;
  name: string;
  /** Parents before the parts inside them; `parts[0]` is the component's own geometry. */
  parts: ComponentPart[];
  /** Where it came from, such as a Library item, so placing that again reuses it. */
  source?: string;
}

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
  /** Hidden groups (and everything inside them) are not drawn, picked or snapped to. */
  hidden?: boolean;
  /** Set on a component instance: which component, and where its definition is placed. */
  component?: { id: ComponentId; place: Affine };
}

/** The document's groups. Like the rest of the document they are saved and undoable. */
export class Groups {
  readonly items = new Map<GroupId, Group>();
  private nextId = 1;
  readonly components = new Map<ComponentId, ComponentDef>();
  private nextComponentId = 1;

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

  /** Whether the group, or a group around it, is hidden. */
  isHidden(id: GroupId): boolean {
    for (let g = this.items.get(id); g; g = g.parent === null ? undefined : this.items.get(g.parent)) if (g.hidden) return true;
    return false;
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
    if (src.component) this.items.get(copy)!.component = { ...src.component };
    for (const c of this.children(id)) this.duplicate(c.id, copy);
    return copy;
  }

  /**
   * Move, turn, scale or mirror a group and everything inside it. Component instances inside
   * keep track of where they are, so they can be rebuilt from their definition.
   */
  transform(id: GroupId, a: Affine): void {
    for (const g of this.subtree(id)) {
      transformModel(g.model, a);
      if (g.component) g.component = { id: g.component.id, place: composeAffine(a, g.component.place) };
    }
  }

  /** The instances of a component, in the order they were made. */
  instances(id: ComponentId): Group[] {
    return [...this.items.values()].filter((g) => g.component?.id === id);
  }

  /** The component instance a group belongs to: the group itself, or the nearest instance around it. */
  instanceOf(id: GroupId): Group | undefined {
    for (let g = this.items.get(id); g; g = g.parent === null ? undefined : this.items.get(g.parent)) if (g.component) return g;
    return undefined;
  }

  /**
   * Turn a group into a component of its own (with this one instance). Its definition is placed at
   * the group's lowest corner. Components inside it become plain groups: components cannot hold
   * components yet. A group inside a component cannot become one.
   */
  makeComponent(id: GroupId, opts: { name?: string; source?: string } = {}): ComponentId {
    const g = this.items.get(id);
    if (!g) throw new Error('That group no longer exists');
    if (g.parent !== null && this.instanceOf(g.parent)) throw new Error('A component cannot be made inside another component; close the component first');
    for (const x of this.subtree(id)) delete x.component;
    const b = modelBounds(this.subtree(id).map((x) => x.model));
    const cid = this.nextComponentId++;
    if (opts.name) g.name = opts.name;
    else if (/^Group \d+$/.test(g.name)) g.name = `Component ${cid}`;
    g.component = { id: cid, place: translation(b ? b.min : [0, 0, 0]) };
    this.components.set(cid, { id: cid, name: g.name, parts: this.definitionFrom(id), ...(opts.source ? { source: opts.source } : {}) });
    return cid;
  }

  /** Add an instance of a component, placed by `place`, inside `parent`; returns the new group. */
  addInstance(cid: ComponentId, parent: GroupId | null, place: Affine): GroupId {
    const def = this.components.get(cid);
    if (!def) throw new Error('That component no longer exists');
    // A new copy takes the paint the component's own geometry had (each copy can be painted apart).
    const id = this.add(new Model(), parent, { name: def.name, material: def.parts[0].material });
    this.items.get(id)!.component = { id: cid, place };
    this.rebuild(id);
    return id;
  }

  /**
   * After a change made inside an instance: the definition becomes what that instance now holds,
   * and every other instance is rebuilt from it.
   */
  syncFrom(id: GroupId): void {
    const g = this.instanceOf(id);
    if (!g?.component) return;
    const def = this.components.get(g.component.id);
    if (!def) return;
    for (const x of this.subtree(g.id)) if (x !== g) delete x.component;
    def.parts = this.definitionFrom(g.id);
    for (const other of this.instances(def.id)) if (other !== g) this.rebuild(other.id);
  }

  /** Give an instance a component of its own, so changing it no longer changes the others. */
  makeUnique(id: GroupId): ComponentId {
    const g = this.items.get(id);
    if (!g?.component) throw new Error('Select a component to make unique');
    const def = this.components.get(g.component.id);
    if (!def) throw new Error('That component no longer exists');
    const cid = this.nextComponentId++;
    const name = this.uniqueComponentName(def.name);
    this.components.set(cid, { id: cid, name, parts: def.parts.map((p) => ({ ...p, model: p.model.clone() })) });
    g.component = { id: cid, place: g.component.place };
    g.name = name;
    return cid;
  }

  /** Rename a component and every instance of it. */
  renameComponent(cid: ComponentId, name: string): void {
    const def = this.components.get(cid);
    if (!def) return;
    def.name = name;
    for (const g of this.instances(cid)) g.name = name;
  }

  /** Forget components that no longer have any instances. */
  prune(): void {
    const used = new Set<ComponentId>();
    for (const g of this.items.values()) if (g.component) used.add(g.component.id);
    for (const id of [...this.components.keys()]) if (!used.has(id)) this.components.delete(id);
  }

  /** A component name not used yet: "Chair" becomes "Chair 2" (or the next free number). */
  uniqueComponentName(name: string): string {
    const base = name.replace(/ \d+$/, '');
    const taken = new Set([...this.components.values()].map((c) => c.name));
    for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  /** A component's definition parts, read from one instance (in the component's own coordinates). */
  private definitionFrom(id: GroupId): ComponentPart[] {
    const g = this.items.get(id)!;
    const back = invertAffine(g.component!.place);
    const keys = new Map<GroupId, number>();
    return this.subtree(id).map((x, i) => {
      keys.set(x.id, i);
      const model = x.model.clone();
      transformModel(model, back);
      return { key: i, parent: i === 0 ? null : keys.get(x.parent!)!, name: x.name, ...(x.material !== undefined ? { material: x.material } : {}), ...(x.hidden ? { hidden: true } : {}), model };
    });
  }

  /** Rebuild an instance from its definition (the groups inside it are made again). */
  rebuild(id: GroupId): void {
    const g = this.items.get(id);
    const def = g?.component && this.components.get(g.component.id);
    if (!g || !def) return;
    for (const c of this.children(id)) this.delete(c.id);
    const placed = (m: Model) => {
      const copy = m.clone();
      transformModel(copy, g.component!.place);
      return copy;
    };
    g.model = placed(def.parts[0].model);
    const ids = new Map<number, GroupId>([[0, id]]);
    for (const p of def.parts.slice(1)) {
      const child = this.add(placed(p.model), ids.get(p.parent!)!, { name: p.name, material: p.material });
      if (p.hidden) this.items.get(child)!.hidden = true;
      ids.set(p.key, child);
    }
  }

  clone(): Groups {
    const c = new Groups();
    c.nextId = this.nextId;
    c.nextComponentId = this.nextComponentId;
    for (const [k, g] of this.items) c.items.set(k, { ...g, model: g.model.clone(), ...(g.component ? { component: { ...g.component } } : {}) });
    for (const [k, d] of this.components) c.components.set(k, { ...d, parts: d.parts.map((p) => ({ ...p, model: p.model.clone() })) });
    return c;
  }

  copyFrom(other: Groups): void {
    const c = other.clone();
    this.nextId = c.nextId;
    this.nextComponentId = c.nextComponentId;
    this.items.clear();
    for (const [k, g] of c.items) this.items.set(k, g);
    this.components.clear();
    for (const [k, d] of c.components) this.components.set(k, d);
  }

  /** Used when reading a file: keeps new component ids above those read. */
  reserveComponentId(id: ComponentId): void {
    this.nextComponentId = Math.max(this.nextComponentId, id + 1);
  }
}
