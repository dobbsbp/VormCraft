import type { Version } from '../doc/Versions';
import type { ToolController } from '../tools/ToolController';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const KIND_NOTE: Record<Version['kind'], string> = { auto: '', save: 'Saved', opened: 'Opened', restore: 'Restored' };

/** "Today", "Yesterday" or the date, for grouping versions by day. */
function dayLabel(time: number, now: number): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(time) === day(now)) return 'Today';
  if (day(time) === day(now - 24 * 3600_000)) return 'Yesterday';
  return new Date(time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

const megabytes = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * History: the design's saved versions, newest first, grouped by day. Click one to look at it;
 * Restore makes it the current design (what you had stays in the list, so you can come back).
 */
export class HistoryPanel {
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: ToolController,
    private readonly enabled: () => boolean,
    private readonly restore: (id: number) => void,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.root.hidden = !open;
    if (!open) this.controller.endPreview();
    this.shown = '';
    this.render();
  }

  render(): void {
    if (!this.isOpen) return;
    const c = this.controller;
    const versions = c.doc.versions;
    const viewing = c.previewing?.id ?? null;
    const key = JSON.stringify([versions.items.map((v) => v.id), viewing, this.enabled(), new Date().toDateString()]);
    if (key === this.shown) return;
    this.shown = key;

    const close = el('button', { type: 'button', className: 'panel-close', title: 'Close', ariaLabel: 'Close history' }, '×');
    close.addEventListener('click', () => this.toggle(false));

    const now = Date.now();
    const list = el('div', { className: 'history-list' });
    const current = el('button', { type: 'button', className: 'history-item' }, el('span', { className: 'history-time' }, 'Now'), el('span', { className: 'history-label' }, 'The design as it is'));
    current.setAttribute('aria-pressed', String(viewing === null));
    current.addEventListener('click', () => c.endPreview());
    list.append(current);
    let day = '';
    for (const v of [...versions.items].reverse()) {
      const d = dayLabel(v.time, now);
      if (d !== day) {
        day = d;
        list.append(el('h3', {}, d));
      }
      const time = new Date(v.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const item = el('button', { type: 'button', className: 'history-item', title: 'Look at this version' }, el('span', { className: 'history-time' }, time), el('span', { className: 'history-label' }, v.label));
      if (KIND_NOTE[v.kind] && KIND_NOTE[v.kind] !== v.label) item.append(el('span', { className: 'history-kind' }, KIND_NOTE[v.kind]));
      item.setAttribute('aria-pressed', String(v.id === viewing));
      item.addEventListener('click', () => c.previewVersion(v.id));
      list.append(item);
    }

    const note = !this.enabled()
      ? 'History is switched off in Settings: no new versions are being kept.'
      : versions.items.length === 0
        ? 'No versions yet. One is kept each time the design is autosaved or saved.'
        : `Click a version to look at it, then Restore it or go back to Now. Nothing is lost: restoring keeps the current design in this list too. (${megabytes(versions.bytes)})`;

    const restore = el('button', { type: 'button', className: 'panel-button primary', disabled: viewing === null }, 'Restore this version');
    restore.addEventListener('click', () => viewing !== null && this.restore(viewing));

    this.root.replaceChildren(
      el('div', { className: 'panel-head' }, el('h2', {}, 'History'), close),
      el('p', { className: 'panel-note' }, note),
      el('div', { className: 'panel-row' }, restore),
      list,
    );
  }
}
