import { Model } from '../core/model/Model';
import { Guides } from './Guides';
import { Labels } from './Labels';

export interface DocumentSnapshot {
  readonly model: Model;
  readonly guides: Guides;
  readonly labels: Labels;
}

/** Everything that is saved: the geometry model, the construction guides and the text labels. */
export class Document {
  readonly model: Model;
  readonly guides: Guides;
  readonly labels: Labels;

  constructor(model = new Model(), guides = new Guides(), labels = new Labels()) {
    this.model = model;
    this.guides = guides;
    this.labels = labels;
  }

  snapshot(): DocumentSnapshot {
    return { model: this.model.clone(), guides: this.guides.clone(), labels: this.labels.clone() };
  }

  /** Restore in place, so everything holding this document's model sees the change. */
  restore(s: DocumentSnapshot): void {
    this.model.copyFrom(s.model);
    this.guides.copyFrom(s.guides);
    this.labels.copyFrom(s.labels);
  }
}
