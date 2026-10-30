import { Model } from '../core/model/Model';
import { Guides } from './Guides';
import { Labels } from './Labels';
import { Materials } from './Materials';

export interface DocumentSnapshot {
  readonly model: Model;
  readonly guides: Guides;
  readonly labels: Labels;
  readonly materials: Materials;
}

/** Everything that is saved: the geometry model, the construction guides, the text labels and the materials. */
export class Document {
  readonly model: Model;
  readonly guides: Guides;
  readonly labels: Labels;
  readonly materials: Materials;

  constructor(model = new Model(), guides = new Guides(), labels = new Labels(), materials = new Materials()) {
    this.model = model;
    this.guides = guides;
    this.labels = labels;
    this.materials = materials;
  }

  snapshot(): DocumentSnapshot {
    return { model: this.model.clone(), guides: this.guides.clone(), labels: this.labels.clone(), materials: this.materials.clone() };
  }

  /** Restore in place, so everything holding this document's model sees the change. */
  restore(s: DocumentSnapshot): void {
    this.model.copyFrom(s.model);
    this.guides.copyFrom(s.guides);
    this.labels.copyFrom(s.labels);
    this.materials.copyFrom(s.materials);
  }
}
