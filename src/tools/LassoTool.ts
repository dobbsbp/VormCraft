import { smoothSurface } from '../core/model/surfaces';
import { polygonSelect, screenArea } from './boxSelect';
import { edgeId } from './Selection';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';

/**
 * Lasso Select: hold the button and draw a loop around what you want. Drawn clockwise it takes
 * what is fully inside; counter-clockwise it also takes anything the loop touches. Shift adds or
 * removes; a plain click selects what is under the cursor, like Select.
 */
export class LassoTool implements Tool {
  readonly id = 'lasso';
  readonly name = 'Lasso Select';
  private path: [number, number][] | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return 'Drag a loop around what to select: clockwise = fully inside, counter-clockwise = touching. Shift adds/removes.';
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

  pointerDown(e: ToolEvent): void {
    this.path = [e.screen];
  }

  pointerMove(e: ToolEvent): void {
    if (!this.path || !e.down) return;
    const last = this.path[this.path.length - 1];
    if (Math.hypot(e.screen[0] - last[0], e.screen[1] - last[1]) >= 3) this.path.push(e.screen);
  }

  pointerUp(e: ToolEvent): void {
    const path = this.path;
    this.path = null;
    if (!path) return;
    const { selection, doc } = this.ctx;
    // A lasso usually ends where it started, so judge by the path drawn, not where the button
    // came up: anything spanning more than a few pixels is a loop, otherwise it was a click.
    const xs = path.map((p) => p[0]);
    const ys = path.map((p) => p[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (path.length < 3 || span <= 6) {
      // A click: select what is under the cursor.
      const faces = e.edge === null && e.face !== null ? smoothSurface(doc.model, e.face) : [];
      const edges = e.edge !== null ? [edgeId(doc.model, e.edge)] : [];
      if (e.shift) selection.toggle(faces, edges);
      else if (faces.length || edges.length) selection.set(faces, edges);
      else selection.clear();
      return;
    }
    const crossing = screenArea(path) < 0;
    const hit = polygonSelect(doc.model, this.ctx.projector(), path, crossing);
    if (e.shift) selection.toggle(hit.faces, hit.edges);
    else selection.set(hit.faces, hit.edges);
  }

  typed(): void {
    throw new Error('Lasso Select has no typed input');
  }

  cancel(): void {
    this.path = null;
  }

  reset(): void {
    this.cancel();
  }

  preview(): Preview {
    if (!this.path || this.path.length < 2) return {};
    return { lasso: { points: this.path, crossing: screenArea(this.path) < 0 } };
  }
}
