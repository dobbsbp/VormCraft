import type { Vec3 } from '../core/math/vec3';

export type LabelId = number;

/** A text label with a leader line from the point it describes to where the text sits. */
export interface Label {
  readonly id: LabelId;
  anchor: Vec3;
  position: Vec3;
  text: string;
}

/** Text labels (Text tool). Like guides they are not geometry, but they are saved and undoable. */
export class Labels {
  readonly items = new Map<LabelId, Label>();
  private nextId = 1;

  add(anchor: Vec3, position: Vec3, text: string): LabelId {
    const id = this.nextId++;
    this.items.set(id, { id, anchor, position, text });
    return id;
  }

  setText(id: LabelId, text: string): void {
    const l = this.items.get(id);
    if (!l) throw new Error('That label no longer exists');
    l.text = text;
  }

  delete(id: LabelId): void {
    this.items.delete(id);
  }

  clone(): Labels {
    const c = new Labels();
    c.nextId = this.nextId;
    for (const [k, v] of this.items) c.items.set(k, { ...v });
    return c;
  }

  copyFrom(other: Labels): void {
    const c = other.clone();
    this.nextId = c.nextId;
    this.items.clear();
    for (const [k, v] of c.items) this.items.set(k, v);
  }
}
