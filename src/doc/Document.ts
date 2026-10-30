import { Model } from '../core/model/Model';
import { Groups, type GroupId } from './Groups';
import { Guides } from './Guides';
import { Labels } from './Labels';
import { Materials } from './Materials';
import { Scenes } from './Scenes';

export interface DocumentSnapshot {
  /** The top-level geometry (outside every group). */
  readonly model: Model;
  readonly groups: Groups;
  readonly guides: Guides;
  readonly labels: Labels;
  readonly materials: Materials;
  readonly scenes: Scenes;
}

/**
 * Everything that is saved: the top-level geometry, the groups (each with geometry of its own),
 * the construction guides, the text labels, the materials and the scenes.
 */
export class Document {
  /** The top-level geometry (outside every group). */
  readonly root: Model;
  readonly groups: Groups;
  readonly guides: Guides;
  readonly labels: Labels;
  readonly materials: Materials;
  readonly scenes: Scenes;
  /** The group being edited (opened with a double-click), or null at the top level. Not saved. */
  editing: GroupId | null = null;

  constructor(model = new Model(), guides = new Guides(), labels = new Labels(), materials = new Materials(), groups = new Groups(), scenes = new Scenes()) {
    this.root = model;
    this.guides = guides;
    this.labels = labels;
    this.materials = materials;
    this.groups = groups;
    this.scenes = scenes;
  }

  /** The geometry being edited: the open group's, else the top level. Tools work on this. */
  get model(): Model {
    return this.modelOf(this.editing);
  }

  /** The geometry of a group (null: the top level). */
  modelOf(group: GroupId | null): Model {
    return group === null ? this.root : (this.groups.get(group)?.model ?? this.root);
  }

  /** Every model in the document: the top level, then each group's. */
  allModels(): Model[] {
    return [this.root, ...[...this.groups.items.values()].map((g) => g.model)];
  }

  snapshot(): DocumentSnapshot {
    return { model: this.root.clone(), groups: this.groups.clone(), guides: this.guides.clone(), labels: this.labels.clone(), materials: this.materials.clone(), scenes: this.scenes.clone() };
  }

  /**
   * Restore in place, so everything holding this document sees the change. If the open group no
   * longer exists, editing moves out to the nearest group around it that does.
   */
  restore(s: DocumentSnapshot): void {
    const path: GroupId[] = [];
    for (let g = this.editing === null ? undefined : this.groups.get(this.editing); g; g = g.parent === null ? undefined : this.groups.get(g.parent)) path.push(g.id);
    this.root.copyFrom(s.model);
    this.groups.copyFrom(s.groups);
    this.guides.copyFrom(s.guides);
    this.labels.copyFrom(s.labels);
    this.materials.copyFrom(s.materials);
    this.scenes.copyFrom(s.scenes);
    this.editing = path.find((id) => this.groups.has(id)) ?? null;
  }
}
