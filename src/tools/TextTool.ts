import { makePlane } from '../core/math/plane';
import { distance, scale, type Vec3 } from '../core/math/vec3';
import { faceArea } from '../core/check/measure';
import type { LabelId } from '../doc/Labels';
import { rayPlane } from './geom';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';
import { formatLength } from './units';

const fmt = (x: number) => String(Math.round(x * 100) / 100 + 0);

/**
 * Text: click a point, edge or face, then click where the label goes. The label starts with the
 * length, area or coordinates of what you clicked; type to replace it and press Enter. Click an
 * existing label with this tool to edit its text.
 */
export class TextTool implements Tool {
  readonly id = 'text';
  readonly name = 'Text';
  readonly dragIsClick = true;
  private anchor: { point: Vec3; text: string } | null = null;
  private cursor: Vec3 | null = null;
  /** The label whose text typing replaces (just placed, or clicked). */
  private editing: LabelId | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    if (this.anchor) return 'Click where the label goes.';
    if (this.editing !== null) return 'Type the label text and press Enter (Esc to stop editing), or click to start another label.';
    return 'Click a point, edge or face to label it, or click a label to edit it.';
  }

  vcbLabel(): string {
    return 'Text';
  }

  vcbValue(): string {
    if (this.anchor) return this.anchor.text;
    const l = this.editing !== null ? this.ctx.doc.labels.items.get(this.editing) : undefined;
    return l?.text ?? '';
  }

  /** While a label is being edited, every key typed is text (not a tool shortcut). */
  acceptsText(): boolean {
    return this.editing !== null && !this.anchor && this.ctx.doc.labels.items.has(this.editing);
  }

  inference() {
    return {};
  }

  pointerMove(e: ToolEvent): void {
    if (!this.anchor) return;
    // Keep the label on a plane through the anchor that faces the viewer.
    const p = rayPlane(e.ray, makePlane(this.anchor.point, scale(e.ray.dir, -1)));
    if (p) this.cursor = p;
  }

  pointerDown(e: ToolEvent): void {
    if (!this.anchor) {
      const p = e.snap?.point;
      if (!p) return;
      this.anchor = { point: p, text: this.defaultText(e, p) };
      this.cursor = p;
      this.editing = null;
      return;
    }
    this.pointerMove(e);
    const { point, text } = this.anchor;
    const position = this.cursor ?? point;
    this.anchor = null;
    let id: LabelId | null = null;
    this.ctx.apply(() => {
      id = this.ctx.doc.labels.add(point, position, text);
    });
    this.editing = id;
  }

  /** What a label says before you type: the edge length, face area, or point coordinates. */
  private defaultText(e: ToolEvent, p: Vec3): string {
    const model = this.ctx.doc.model;
    const kind = e.snap?.kind;
    const edge = e.edge ?? e.snap?.edge;
    if (kind !== 'endpoint' && edge !== undefined && edge !== null && model.halfEdges.has(edge)) {
      return formatLength(distance(model.pos(model.he(edge).origin), model.pos(model.dest(edge))));
    }
    if (kind !== 'endpoint' && e.face !== null && model.faces.has(e.face)) return `${fmt(faceArea(model, e.face))} mm²`;
    return `(${p.map(fmt).join(', ')})`;
  }

  /** Start editing an existing label (clicked with this tool). */
  editLabel(id: LabelId): void {
    this.anchor = null;
    this.editing = id;
  }

  typed(text: string): void {
    if (this.editing === null || !this.ctx.doc.labels.items.has(this.editing)) throw new Error('Place or click a label first, then type its text');
    const id = this.editing;
    this.ctx.apply(() => this.ctx.doc.labels.setText(id, text));
  }

  cancel(): void {
    this.anchor = null;
    this.editing = null;
  }

  reset(): void {
    this.cancel();
  }

  preview(): Preview {
    if (!this.anchor || !this.cursor) return {};
    return { lines: [{ points: [this.anchor.point, this.cursor], color: 'preview', width: 1.5 }] };
  }
}
