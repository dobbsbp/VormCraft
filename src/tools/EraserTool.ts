import type { HalfEdgeId } from '../core/model/Model';
import { erase } from '../core/ops/erase';
import type { GroupId } from '../doc/Groups';
import type { GuideId } from '../doc/Guides';
import { guideFirst } from './SelectTool';
import { edgeId } from './Selection';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';

/**
 * Eraser: click an edge to erase it (faces it bounds go with it, as in SketchUp), or hold the
 * button and drag across several edges; they are erased together on release (one undo step).
 * Clicking a group erases the whole group.
 */
export class EraserTool implements Tool {
  readonly id = 'eraser';
  readonly name = 'Eraser';
  private hover: HalfEdgeId | null = null;
  private hoverGuide: GuideId | null = null;
  private hoverGroup: GroupId | null = null;
  private marked = new Set<HalfEdgeId>();
  private markedGuides = new Set<GuideId>();
  private markedGroups = new Set<GroupId>();
  private marking = false;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return 'Click an edge, group or guide to erase it (an edge takes the faces it bounds with it), or drag across several.';
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
    this.hoverGuide = guideFirst(e);
    this.hover = this.hoverGuide === null && e.edge !== null ? edgeId(this.ctx.doc.model, e.edge) : null;
    this.hoverGroup = this.hoverGuide === null && this.hover === null ? e.group : null;
    if (this.marking && this.hover !== null) this.marked.add(this.hover);
    if (this.marking && this.hoverGuide !== null) this.markedGuides.add(this.hoverGuide);
    if (this.marking && this.hoverGroup !== null) this.markedGroups.add(this.hoverGroup);
  }

  pointerDown(e: ToolEvent): void {
    this.pointerMove(e);
    this.marking = true;
    this.marked = new Set(this.hover === null ? [] : [this.hover]);
    this.markedGuides = new Set(this.hoverGuide === null ? [] : [this.hoverGuide]);
    this.markedGroups = new Set(this.hoverGroup === null ? [] : [this.hoverGroup]);
  }

  pointerUp(): void {
    this.marking = false;
    const edges = [...this.marked];
    const guides = [...this.markedGuides];
    const groups = [...this.markedGroups];
    this.marked.clear();
    this.markedGuides.clear();
    this.markedGroups.clear();
    if (!edges.length && !guides.length && !groups.length) return;
    this.ctx.apply(() => {
      erase(this.ctx.doc.model, [], edges);
      for (const g of guides) this.ctx.doc.guides.delete(g);
      for (const g of groups) this.ctx.doc.groups.delete(g);
    });
  }

  typed(): void {
    throw new Error('The Eraser has no typed input');
  }

  cancel(): void {
    this.marking = false;
    this.marked.clear();
    this.markedGuides.clear();
    this.markedGroups.clear();
  }

  reset(): void {
    this.cancel();
  }

  preview(): Preview {
    const model = this.ctx.doc.model;
    const edges = [...this.marked, ...(this.hover !== null ? [this.hover] : [])].filter((e) => model.halfEdges.has(e));
    const guides = [...this.markedGuides, ...(this.hoverGuide !== null ? [this.hoverGuide] : [])];
    const groups = [...this.markedGroups, ...(this.hoverGroup !== null ? [this.hoverGroup] : [])].filter((g) => this.ctx.doc.groups.has(g));
    return { ...(edges.length ? { edges } : {}), ...(guides.length ? { guides } : {}), ...(groups.length ? { groups } : {}) };
  }
}
