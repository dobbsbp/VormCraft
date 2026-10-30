import type { Preview, Tool, ToolEvent } from './types';

type P2 = [number, number];

/**
 * Zoom Window: drag a box (or click two corners) around what you want to fill the view. The
 * camera work is the viewport's: the tool only reports the screen box.
 */
export class ZoomWindowTool implements Tool {
  readonly id = 'zoomWindow';
  readonly name = 'Zoom Window';
  private start: P2 | null = null;
  private cursor: P2 | null = null;

  /** `zoom` receives the box's two corners in screen pixels. */
  constructor(private readonly zoom: (from: P2, to: P2) => void) {}

  hint(): string {
    return this.start ? 'Release (or click) at the opposite corner of the area to zoom to.' : 'Drag a box around the area to zoom to. Space returns to Select.';
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
    this.cursor = e.screen;
  }

  pointerDown(e: ToolEvent): void {
    if (!this.start) {
      this.start = e.screen;
      this.cursor = e.screen;
      return;
    }
    this.finish(e.screen);
  }

  pointerUp(e: ToolEvent, dragged: boolean): void {
    if (dragged && this.start) this.finish(e.screen);
  }

  private finish(to: P2): void {
    const from = this.start!;
    this.start = null;
    if (Math.abs(to[0] - from[0]) < 4 && Math.abs(to[1] - from[1]) < 4) throw new Error('Drag a bigger box to zoom to');
    this.zoom(from, to);
  }

  typed(): void {
    throw new Error('Zoom Window has no typed input');
  }

  cancel(): void {
    this.start = null;
  }

  reset(): void {
    this.cancel();
  }

  preview(): Preview {
    return this.start && this.cursor ? { box: { from: this.start, to: this.cursor, crossing: false } } : {};
  }
}
