import type { FaceId, HalfEdgeId, Model } from '../core/model/Model';
import type { GroupId } from '../doc/Groups';
import type { GuideId, Guides } from '../doc/Guides';
import type { LabelId, Labels } from '../doc/Labels';

/**
 * The current selection: faces and edges by id in the model being edited (edges by their lower
 * half-edge id), groups inside it, guides and labels.
 */
export class Selection {
  readonly faces = new Set<FaceId>();
  readonly edges = new Set<HalfEdgeId>();
  readonly guides = new Set<GuideId>();
  readonly labels = new Set<LabelId>();
  readonly groups = new Set<GroupId>();
  private listeners: (() => void)[] = [];

  get size(): number {
    return this.faces.size + this.edges.size + this.guides.size + this.labels.size + this.groups.size;
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  clear(): void {
    if (this.size === 0) return;
    this.faces.clear();
    this.edges.clear();
    this.guides.clear();
    this.labels.clear();
    this.groups.clear();
    this.changed();
  }

  /** Select a label alone, or (Shift) add/remove it. */
  toggleLabel(id: LabelId, additive: boolean): void {
    if (!additive) {
      this.faces.clear();
      this.edges.clear();
      this.guides.clear();
      this.labels.clear();
      this.groups.clear();
      this.labels.add(id);
    } else if (this.labels.has(id)) this.labels.delete(id);
    else this.labels.add(id);
    this.changed();
  }

  set(faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>, guides: Iterable<GuideId> = [], groups: Iterable<GroupId> = []): void {
    this.faces.clear();
    this.edges.clear();
    this.guides.clear();
    this.labels.clear();
    this.groups.clear();
    for (const f of faces) this.faces.add(f);
    for (const e of edges) this.edges.add(e);
    for (const g of guides) this.guides.add(g);
    for (const g of groups) this.groups.add(g);
    this.changed();
  }

  add(faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>, guides: Iterable<GuideId> = [], groups: Iterable<GroupId> = []): void {
    for (const f of faces) this.faces.add(f);
    for (const e of edges) this.edges.add(e);
    for (const g of guides) this.guides.add(g);
    for (const g of groups) this.groups.add(g);
    this.changed();
  }

  /** Shift-click: add what is not selected, remove what is. */
  toggle(faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>, guides: Iterable<GuideId> = [], groups: Iterable<GroupId> = []): void {
    const flip = <T>(set: Set<T>, items: Iterable<T>) => {
      for (const x of items) {
        if (set.has(x)) set.delete(x);
        else set.add(x);
      }
    };
    flip(this.faces, faces);
    flip(this.edges, edges);
    flip(this.guides, guides);
    flip(this.groups, groups);
    this.changed();
  }

  /** Drop ids that no longer exist after a change (`groupOk`: whether a group can stay selected). */
  prune(model: Model, labels?: Labels, guides?: Guides, groupOk?: (g: GroupId) => boolean): void {
    let changed = false;
    const keep = <T>(set: Set<T>, exists: (x: T) => boolean) => {
      for (const x of set) {
        if (!exists(x)) {
          set.delete(x);
          changed = true;
        }
      }
    };
    if (labels) keep(this.labels, (l) => labels.items.has(l));
    if (guides) keep(this.guides, (g) => guides.items.has(g));
    keep(this.faces, (f) => model.faces.has(f));
    keep(this.edges, (e) => model.halfEdges.has(e));
    if (groupOk) keep(this.groups, groupOk);
    if (changed) this.changed();
  }
}

/** The canonical id of an edge: the lower id of its two half-edges. */
export function edgeId(model: Model, halfEdge: HalfEdgeId): HalfEdgeId {
  return Math.min(halfEdge, model.he(halfEdge).twin);
}
