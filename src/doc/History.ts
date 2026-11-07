import type { Document, DocumentSnapshot } from './Document';

/**
 * An undo step read from a saved file: the document is only rebuilt when the step is undone to
 * (the file stores each step as just what changed). `text` is the step's document as file text.
 */
export interface SavedStep {
  readonly saved: true;
  snapshot(): DocumentSnapshot;
  text(): string;
}

export type StepState = DocumentSnapshot | SavedStep;

export interface Step {
  label: string;
  snapshot: StepState;
}

const resolve = (s: StepState): DocumentSnapshot => ('saved' in s ? s.snapshot() : s);

/** Undo/redo as whole-document snapshots (cheap to reason about; models stay small). */
export class History {
  private readonly undoStack: Step[] = [];
  private readonly redoStack: Step[] = [];

  constructor(readonly limit = 100) {}

  /** Record a change: `before` is the document as it was before it. */
  record(label: string, before: DocumentSnapshot): void {
    this.undoStack.push({ label, snapshot: before });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** The last change was redone with different values (re-dimensioned): same undo step. */
  amendLast(label: string): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.label = label;
    this.redoStack.length = 0;
  }

  undo(doc: Document): string | null {
    const step = this.undoStack.pop();
    if (!step) return null;
    let state: DocumentSnapshot;
    try {
      state = resolve(step.snapshot);
    } catch (err) {
      // A saved step that cannot be rebuilt: the steps before it are lost too.
      this.undoStack.length = 0;
      throw err;
    }
    this.redoStack.push({ label: step.label, snapshot: doc.snapshot() });
    doc.restore(state);
    return step.label;
  }

  redo(doc: Document): string | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push({ label: step.label, snapshot: doc.snapshot() });
    doc.restore(resolve(step.snapshot));
    return step.label;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** The undo steps, oldest first (to save them with the design). */
  get steps(): readonly Step[] {
    return this.undoStack;
  }

  /** Undo steps read from a file (oldest first), in place of any there are. */
  load(steps: Step[]): void {
    this.clear();
    this.undoStack.push(...steps.slice(-this.limit));
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }
}
