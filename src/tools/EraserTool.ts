import type { HalfEdgeId } from '../core/model/Model';
import { erase } from '../core/ops/erase';
import { edgeId } from './Selection';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';

/**
 * Eraser: click an edge to erase it (faces it bounds go with it, as in SketchUp), or hold the
 * button and drag across several edges; they are erased together on release (one undo step).
 */
export class EraserTool implements Tool {
  readonly id = 'eraser';
  readonly name = 'Eraser';
  private hover: HalfEdgeId | null = null;
  private marked = new Set<HalfEdgeId>();
  private marking = false;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return 'Click an edge to erase it (and the faces it bounds), or drag across several edges.';
  }

  vcbLabel(): string {
    return '';
  }

  vcbValue(): string {
    return '';
  }

  inference() {
    return {};
  }

  pointerMove(e: ToolEvent): void {
    this.hover = e.edge === null ? null : edgeId(this.ctx.doc.model, e.edge);
    if (this.marking && this.hover !== null) this.marked.add(this.hover);
  }

  pointerDown(e: ToolEvent): void {
    this.pointerMove(e);
    this.marking = true;
    this.marked = new Set(this.hover === null ? [] : [this.hover]);
  }

  pointerUp(): void {
    this.marking = false;
    const edges = [...this.marked];
    this.marked.clear();
    if (edges.length) this.ctx.apply(() => erase(this.ctx.doc.model, [], edges));
  }

  typed(): void {
    throw new Error('The Eraser has no typed input');
  }

  cancel(): void {
    this.marking = false;
    this.marked.clear();
  }

  reset(): void {
    this.cancel();
  }

  preview(): Preview {
    const model = this.ctx.doc.model;
    const edges = [...this.marked, ...(this.hover !== null ? [this.hover] : [])].filter((e) => model.halfEdges.has(e));
    return edges.length ? { edges } : {};
  }
}
