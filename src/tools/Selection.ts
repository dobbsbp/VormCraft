import type { FaceId, HalfEdgeId, Model } from '../core/model/Model';
import type { LabelId, Labels } from '../doc/Labels';

/** The current selection: faces and edges by model id (edges by their lower half-edge id). */
export class Selection {
  readonly faces = new Set<FaceId>();
  readonly edges = new Set<HalfEdgeId>();
  readonly labels = new Set<LabelId>();
  private listeners: (() => void)[] = [];

  get size(): number {
    return this.faces.size + this.edges.size + this.labels.size;
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
    this.labels.clear();
    this.changed();
  }

  /** Select a label alone, or (Shift) add/remove it. */
  toggleLabel(id: LabelId, additive: boolean): void {
    if (!additive) {
      this.faces.clear();
      this.edges.clear();
      this.labels.clear();
      this.labels.add(id);
    } else if (this.labels.has(id)) this.labels.delete(id);
    else this.labels.add(id);
    this.changed();
  }

  set(faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>): void {
    this.faces.clear();
    this.edges.clear();
    this.labels.clear();
    for (const f of faces) this.faces.add(f);
    for (const e of edges) this.edges.add(e);
    this.changed();
  }

  add(faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>): void {
    for (const f of faces) this.faces.add(f);
    for (const e of edges) this.edges.add(e);
    this.changed();
  }

  /** Shift-click: add what is not selected, remove what is. */
  toggle(faces: Iterable<FaceId>, edges: Iterable<HalfEdgeId>): void {
    for (const f of faces) {
      if (this.faces.has(f)) this.faces.delete(f);
      else this.faces.add(f);
    }
    for (const e of edges) {
      if (this.edges.has(e)) this.edges.delete(e);
      else this.edges.add(e);
    }
    this.changed();
  }

  /** Drop ids that no longer exist after a model change. */
  prune(model: Model, labels?: Labels): void {
    let changed = false;
    if (labels) {
      for (const l of this.labels) {
        if (!labels.items.has(l)) {
          this.labels.delete(l);
          changed = true;
        }
      }
    }
    for (const f of this.faces) {
      if (!model.faces.has(f)) {
        this.faces.delete(f);
        changed = true;
      }
    }
    for (const e of this.edges) {
      if (!model.halfEdges.has(e)) {
        this.edges.delete(e);
        changed = true;
      }
    }
    if (changed) this.changed();
  }
}

/** The canonical id of an edge: the lower id of its two half-edges. */
export function edgeId(model: Model, halfEdge: HalfEdgeId): HalfEdgeId {
  return Math.min(halfEdge, model.he(halfEdge).twin);
}
