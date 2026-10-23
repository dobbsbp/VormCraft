import type { Document, DocumentSnapshot } from './Document';

interface Step {
  label: string;
  snapshot: DocumentSnapshot;
}

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
    this.redoStack.push({ label: step.label, snapshot: doc.snapshot() });
    doc.restore(step.snapshot);
    return step.label;
  }

  redo(doc: Document): string | null {
    const step = this.redoStack.pop();
    if (!step) return null;
    this.undoStack.push({ label: step.label, snapshot: doc.snapshot() });
    doc.restore(step.snapshot);
    return step.label;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }
}
