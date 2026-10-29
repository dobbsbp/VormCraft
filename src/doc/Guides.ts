import { normalize, type Vec3 } from '../core/math/vec3';

export type GuideId = number;

/** An infinite construction line. */
export interface GuideLine {
  readonly id: GuideId;
  readonly kind: 'line';
  readonly point: Vec3;
  readonly dir: Vec3;
}

export interface GuidePoint {
  readonly id: GuideId;
  readonly kind: 'point';
  readonly pos: Vec3;
}

export type Guide = GuideLine | GuidePoint;

/**
 * Construction guides (Tape Measure). They are not geometry: they never bound faces, but every
 * drawing tool can snap to them. They can be hidden or deleted in bulk.
 */
export class Guides {
  readonly items = new Map<GuideId, Guide>();
  visible = true;
  private nextId = 1;

  addLine(point: Vec3, dir: Vec3): GuideId {
    const id = this.nextId++;
    this.items.set(id, { id, kind: 'line', point, dir: normalize(dir) });
    return id;
  }

  addPoint(pos: Vec3): GuideId {
    const id = this.nextId++;
    this.items.set(id, { id, kind: 'point', pos });
    return id;
  }

  delete(id: GuideId): void {
    this.items.delete(id);
  }

  /** Put a guide in a new place (Move/Rotate). Line directions are re-normalised. */
  update(guide: Guide): void {
    if (!this.items.has(guide.id)) throw new Error('That guide no longer exists');
    this.items.set(guide.id, guide.kind === 'line' ? { ...guide, dir: normalize(guide.dir) } : guide);
  }

  /** Add a copy of a guide with new coordinates; returns the new id. */
  addLike(guide: Guide): GuideId {
    return guide.kind === 'line' ? this.addLine(guide.point, guide.dir) : this.addPoint(guide.pos);
  }

  clear(): void {
    this.items.clear();
  }

  lines(): GuideLine[] {
    return [...this.items.values()].filter((g): g is GuideLine => g.kind === 'line');
  }

  points(): GuidePoint[] {
    return [...this.items.values()].filter((g): g is GuidePoint => g.kind === 'point');
  }

  clone(): Guides {
    const g = new Guides();
    g.visible = this.visible;
    g.nextId = this.nextId;
    for (const [k, v] of this.items) g.items.set(k, v);
    return g;
  }

  copyFrom(other: Guides): void {
    const c = other.clone();
    this.visible = c.visible;
    this.nextId = c.nextId;
    this.items.clear();
    for (const [k, v] of c.items) this.items.set(k, v);
  }
}
