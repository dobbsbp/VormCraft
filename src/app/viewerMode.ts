import type { MenuEntry } from '../tools/contextMenu';
import type { Viewer } from '../view/Viewer';
import type { ContextMenu } from './contextMenuView';
import { ICONS } from './icons';

/** The chosen drawing resolution in Viewer mode (a share of the screen's), kept on this device. */
const RESOLUTION_KEY = 'vormcraft.viewer.resolution';

export const RESOLUTIONS: { scale: number; label: string }[] = [
  { scale: 1, label: 'Sharpest (full resolution)' },
  { scale: 0.75, label: 'Balanced' },
  { scale: 0.5, label: 'Faster' },
  { scale: 0.35, label: 'Fastest (blurrier)' },
];

/** How long the gesture hint stays up after entering Viewer mode (ms). */
const HINT_MS = 7000;

export function savedResolution(): number {
  try {
    const v = Number(localStorage.getItem(RESOLUTION_KEY));
    return RESOLUTIONS.some((r) => r.scale === v) ? v : 1;
  } catch {
    return 1;
  }
}

function saveResolution(scale: number): void {
  try {
    localStorage.setItem(RESOLUTION_KEY, String(scale));
  } catch {
    // Storage blocked: the choice lasts until the page is closed.
  }
}

/** What Viewer mode needs from the app. */
export interface ViewerModeHost {
  viewer: Viewer;
  menu: ContextMenu;
  open(): void;
  /** Whether Google Drive is available (its button shows). */
  driveShown(): boolean;
  driveMenu(anchor: HTMLElement): void;
  /** Entering (true) or leaving (false): the app hides or brings back its tools and panels. */
  onChange(on: boolean): void;
}

/**
 * Viewer mode, for looking at a model on a phone, foldable or tablet (or any screen): the tools,
 * panels and status bar go away; touch navigates (see Viewer.viewerMode); a bar in the corner
 * has Exit viewer, Zoom to fit, Open, Google Drive and a gear for the drawing resolution.
 */
export class ViewerMode {
  active = false;
  private readonly bar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly driveButton: HTMLButtonElement;
  private hintTimer = 0;

  constructor(
    container: HTMLElement,
    private readonly host: ViewerModeHost,
  ) {
    this.bar = document.createElement('div');
    this.bar.className = 'viewer-bar';
    this.bar.hidden = true;
    const exit = button(ICONS.eyeOff, 'Exit viewer', 'Exit viewer mode and bring the tools back (Esc)', () => this.exit());
    exit.classList.add('viewer-exit');
    const row = document.createElement('div');
    row.className = 'viewer-actions';
    this.driveButton = button(ICONS.cloud, '', 'Google Drive: open a design', () => host.driveMenu(this.driveButton));
    const gear = button(ICONS.settings, '', 'Display resolution (lower it if moving the model is slow)', () => {
      const r = gear.getBoundingClientRect();
      this.host.menu.open(this.resolutionMenu(), r.left, r.bottom + 4);
    });
    row.append(
      button(ICONS.zoomExtents, '', 'Zoom to fit the whole model', () => host.viewer.zoomExtents()),
      button(ICONS.open, '', 'Open a design', () => host.open()),
      this.driveButton,
      gear,
    );
    this.bar.append(exit, row);

    this.hint = document.createElement('div');
    this.hint.className = 'viewer-hint';
    this.hint.hidden = true;
    const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
    this.hint.textContent = touch
      ? 'One finger: pan\nTwo fingers: pinch to zoom, move to orbit\nDouble-tap: centre there'
      : 'Middle-drag: orbit · Right-drag: pan · Wheel: zoom\nEsc: exit viewer';
    container.append(this.bar, this.hint);
    // Keep the browser's own pinch-zoom and page gestures (Safari) out of the way.
    document.addEventListener('gesturestart', (e) => this.active && e.preventDefault());
  }

  toggle(): void {
    if (this.active) this.exit();
    else this.enter();
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('viewer-mode');
    this.host.viewer.viewerMode = true;
    this.host.viewer.setResolutionScale(savedResolution());
    this.driveButton.hidden = !this.host.driveShown();
    this.bar.hidden = false;
    this.showHint();
    this.host.onChange(true);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('viewer-mode');
    this.host.viewer.viewerMode = false;
    this.host.viewer.setResolutionScale(1);
    this.bar.hidden = true;
    this.hint.hidden = true;
    this.host.menu.close();
    this.host.onChange(false);
  }

  private showHint(): void {
    this.hint.hidden = false;
    this.hint.classList.remove('fading');
    clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      this.hint.classList.add('fading');
      this.hintTimer = window.setTimeout(() => (this.hint.hidden = true), 600);
    }, HINT_MS);
  }

  private resolutionMenu(): MenuEntry[] {
    const current = savedResolution();
    return RESOLUTIONS.map((r) => ({
      label: `${r.scale === current ? '✓ ' : ''}${r.label}`,
      run: () => {
        saveResolution(r.scale);
        this.host.viewer.setResolutionScale(r.scale);
      },
    }));
  }
}

function button(icon: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'viewer-button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  if (text) b.append(Object.assign(document.createElement('span'), { textContent: text }));
  b.addEventListener('click', () => {
    onClick();
    b.blur();
  });
  return b;
}
