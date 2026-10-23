import type { Preview, Tool } from './types';

export type NavigationMode = 'orbit' | 'pan' | 'zoom';

const HINTS: Record<NavigationMode, string> = {
  orbit: 'Drag to orbit around the point under the cursor. Space returns to Select.',
  pan: 'Drag to pan. Space returns to Select.',
  zoom: 'Drag up to zoom in, down to zoom out (toward where you pressed). Space returns to Select.',
};

/**
 * Orbit / Pan / Zoom as tools (O, H, Z): the left mouse button navigates like the middle button.
 * They never touch the model; the viewport does the camera work while one of them is active.
 */
export class NavigationTool implements Tool {
  readonly name: string;

  constructor(readonly id: NavigationMode) {
    this.name = { orbit: 'Orbit', pan: 'Pan', zoom: 'Zoom' }[id];
  }

  hint(): string {
    return HINTS[this.id];
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

  pointerMove(): void {}

  pointerDown(): void {}

  typed(): void {
    throw new Error(`${this.name} has no typed input`);
  }

  cancel(): void {}

  reset(): void {}

  preview(): Preview {
    return {};
  }
}
