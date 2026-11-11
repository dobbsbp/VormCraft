import { add, distance, length, normalize, scale, type Vec3 } from '../core/math/vec3';
import type { LabelId } from '../doc/Labels';
import { dimensionDragPoint, dimensionLayout } from './dimension';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

/**
 * Dimension: click a line (or two points), move out from it and click to place a dimension that
 * shows its length end to end, in the design's units. Typing a distance places it that far out.
 * The dimension is a label with an end (see `Label`): it is selected, erased, saved and undone
 * like one.
 */
export class DimensionTool implements Tool {
  readonly id = 'dimension';
  readonly name = 'Dimension';
  readonly dragIsClick = true;
  /** The first point, while waiting for the second. */
  private first: Vec3 | null = null;
  /** The ends being measured, while moving the dimension out from them. */
  private ends: { a: Vec3; b: Vec3 } | null = null;
  private cursor: Vec3 | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    if (this.ends) return 'Move out from the line and click to place the dimension, or type how far out and press Enter.';
    if (this.first) return 'Click the second point.';
    return 'Click a line to measure it end to end, or click two points.';
  }

  vcbLabel(): string {
    return this.ends ? 'Offset' : 'Length';
  }

  vcbValue(): string {
    if (this.ends) return this.cursor ? formatLength(length(dimensionLayout(this.ends.a, this.ends.b, this.cursor).offset)) : '';
    if (this.first && this.cursor) return formatLength(distance(this.first, this.cursor));
    return '';
  }

  inference() {
    return this.first && !this.ends ? { reference: this.first } : {};
  }

  pointerMove(e: ToolEvent): void {
    if (this.ends) {
      this.cursor = dimensionDragPoint(this.ends.a, this.ends.b, e.ray) ?? this.cursor;
      return;
    }
    this.cursor = e.snap?.point ?? null;
  }

  pointerDown(e: ToolEvent): void {
    if (this.ends) {
      this.pointerMove(e);
      this.place(this.cursor ?? this.ends.a);
      return;
    }
    const model = this.ctx.doc.model;
    const edge = e.edge ?? e.snap?.edge ?? null;
    if (!this.first && e.snap?.kind !== 'endpoint' && edge !== null && model.halfEdges.has(edge)) {
      this.start(model.pos(model.he(edge).origin), model.pos(model.dest(edge)));
      return;
    }
    const p = e.snap?.point;
    if (!p) return;
    if (!this.first) {
      this.first = p;
      this.cursor = p;
      return;
    }
    if (distance(this.first, p) < 1e-6) throw new Error('Click a second point away from the first');
    this.start(this.first, p);
  }

  private start(a: Vec3, b: Vec3): void {
    this.first = null;
    this.ends = { a, b };
    this.cursor = scale(add(a, b), 0.5);
  }

  /** Add the dimension with its line through `through`, and select it (Delete erases it at once). */
  private place(through: Vec3): void {
    const { a, b } = this.ends!;
    this.ends = null;
    this.cursor = null;
    let id: LabelId | null = null;
    this.ctx.apply(() => {
      id = this.ctx.doc.labels.add(a, dimensionLayout(a, b, through).mid, '', b);
    });
    if (id !== null) this.ctx.selection.set([], [], [], [], [], [id]);
  }

  typed(text: string): void {
    if (!this.ends) throw new Error('Click a line, or two points, first');
    const d = parseLength(text);
    if (d === undefined || d < 0) throw new Error('Type how far out from the line, e.g. 300');
    const { a, b } = this.ends;
    const out = this.cursor ? dimensionLayout(a, b, this.cursor).offset : null;
    if (!out || length(out) < 1e-6) throw new Error('Move the mouse to the side the dimension goes, then type');
    this.place(add(dimensionLayout(a, b, a).mid, scale(normalize(out), d)));
  }

  cancel(): void {
    this.first = null;
    this.ends = null;
    this.cursor = null;
  }

  reset(): void {
    this.cancel();
  }

  preview(): Preview {
    if (this.ends && this.cursor) {
      const { a, b } = this.ends;
      const l = dimensionLayout(a, b, this.cursor);
      return { lines: [{ points: [a, l.from, b, l.to, l.from, l.to], color: 'preview', dashed: true }] };
    }
    if (this.first && this.cursor) return { lines: [{ points: [this.first, this.cursor], color: 'preview', dashed: true }] };
    return {};
  }
}
