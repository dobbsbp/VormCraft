export type TagId = number;

/** A tag (a layer, in other programs): a name groups can carry, to show or hide them together. */
export interface Tag {
  readonly id: TagId;
  name: string;
  /** Groups carrying a hidden tag (and everything inside them) are not drawn, picked or snapped to. */
  hidden?: boolean;
}

/**
 * The document's tags, in the order they are listed. A group has at most one tag; geometry
 * outside groups is never tagged (tag the group around it instead). Kept with the groups, so it
 * is saved, undone and snapshotted with them.
 */
export class Tags {
  items: Tag[] = [];
  private nextId = 1;

  add(name: string, opts: { id?: TagId; hidden?: boolean } = {}): TagId {
    const id = opts.id ?? this.nextId;
    if (this.get(id)) throw new Error(`Tag id ${id} is in use`);
    if (!name.trim()) throw new Error('A tag needs a name');
    this.nextId = Math.max(this.nextId, id + 1);
    this.items.push({ id, name: name.trim(), ...(opts.hidden ? { hidden: true } : {}) });
    return id;
  }

  get(id: TagId | undefined): Tag | undefined {
    return id === undefined ? undefined : this.items.find((t) => t.id === id);
  }

  /** The tag with this name (ignoring case and spaces at either end), if there is one. */
  byName(name: string): Tag | undefined {
    const n = name.trim().toLowerCase();
    return this.items.find((t) => t.name.toLowerCase() === n);
  }

  /** Whether the tag is hidden (no tag, or one that no longer exists, is shown). */
  isHidden(id: TagId | undefined): boolean {
    return !!this.get(id)?.hidden;
  }

  setHidden(id: TagId, hidden: boolean): void {
    const t = this.get(id);
    if (!t) throw new Error('That tag no longer exists');
    if (hidden) t.hidden = true;
    else delete t.hidden;
  }

  rename(id: TagId, name: string): void {
    const t = this.get(id);
    if (!t) throw new Error('That tag no longer exists');
    if (!name.trim()) throw new Error('A tag needs a name');
    const other = this.byName(name);
    if (other && other.id !== id) throw new Error(`There is already a tag called ${other.name}`);
    t.name = name.trim();
  }

  /** Remove a tag from the list (the groups carrying it are untagged by `Groups.deleteTag`). */
  delete(id: TagId): void {
    this.items = this.items.filter((t) => t.id !== id);
  }

  /** "Tag 3": the first name of that form not in use. */
  nextName(): string {
    for (let i = 1; ; i++) if (!this.byName(`Tag ${i}`)) return `Tag ${i}`;
  }

  clone(): Tags {
    const c = new Tags();
    c.nextId = this.nextId;
    c.items = this.items.map((t) => ({ ...t }));
    return c;
  }

  copyFrom(other: Tags): void {
    const c = other.clone();
    this.nextId = c.nextId;
    this.items = c.items;
  }
}
