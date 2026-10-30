import type { MenuEntry } from '../tools/contextMenu';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  e.append(...children);
  return e;
}

/**
 * The right-click menu on screen: opens at the cursor (kept inside the window), submenus open on
 * hover or click, and it closes on a choice, Esc, a click elsewhere, scrolling or resizing.
 */
export class ContextMenu {
  private root: HTMLElement | null = null;
  private readonly closeOnOutside = (e: Event) => {
    if (this.root && e.target instanceof Node && this.root.contains(e.target)) return;
    this.close();
  };
  private readonly closeOnKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      this.close();
    }
  };
  private readonly closeNow = () => this.close();

  /** Called after a command ran (to redraw the app). */
  onDone: () => void = () => {};

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(entries: MenuEntry[], x: number, y: number): void {
    this.close();
    const root = this.list(entries, 'context-menu');
    root.setAttribute('role', 'menu');
    document.body.append(root);
    this.root = root;
    // Just right of and below the cursor (so a second right-click lands on the model, not the menu).
    place(root, x + 2, y + 2);
    window.addEventListener('pointerdown', this.closeOnOutside, true);
    window.addEventListener('keydown', this.closeOnKey, true);
    window.addEventListener('wheel', this.closeNow, true);
    window.addEventListener('resize', this.closeNow);
    window.addEventListener('blur', this.closeNow);
  }

  close(): void {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    window.removeEventListener('pointerdown', this.closeOnOutside, true);
    window.removeEventListener('keydown', this.closeOnKey, true);
    window.removeEventListener('wheel', this.closeNow, true);
    window.removeEventListener('resize', this.closeNow);
    window.removeEventListener('blur', this.closeNow);
  }

  private list(entries: MenuEntry[], className: string): HTMLElement {
    const box = el('div', className);
    // No separator at the start or end, and never two in a row.
    const clean = entries.filter((e, i, all) => e !== 'separator' || (i > 0 && i < all.length - 1 && all[i - 1] !== 'separator'));
    for (const entry of clean) {
      if (entry === 'separator') {
        box.append(el('div', 'context-separator'));
        continue;
      }
      const button = el('button', 'context-item', el('span', 'context-label', entry.label));
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.disabled = !!entry.disabled;
      if (entry.shortcut) button.append(el('span', 'context-shortcut', entry.shortcut));
      if (entry.items && !entry.disabled) {
        button.append(el('span', 'context-arrow', '›'));
        const wrap = el('div', 'context-parent', button);
        const sub = this.list(entry.items, 'context-menu context-submenu');
        wrap.append(sub);
        const show = () => {
          box.querySelectorAll('.context-parent.open').forEach((open) => open !== wrap && open.classList.remove('open'));
          wrap.classList.add('open');
          place(sub, button.getBoundingClientRect().right - 2, button.getBoundingClientRect().top - 4, button.getBoundingClientRect().left + 2);
        };
        wrap.addEventListener('pointerenter', show);
        button.addEventListener('click', show);
        box.append(wrap);
        continue;
      }
      button.addEventListener('pointerenter', () => box.querySelectorAll('.context-parent.open').forEach((p) => p.classList.remove('open')));
      button.addEventListener('click', () => {
        this.close();
        entry.run?.();
        this.onDone();
      });
      box.append(button);
    }
    return box;
  }
}

/** Put a fixed-position menu at (x, y), moved to stay in the window (or to the left of `flipX`). */
function place(menu: HTMLElement, x: number, y: number, flipX?: number): void {
  menu.style.left = '0px';
  menu.style.top = '0px';
  const r = menu.getBoundingClientRect();
  const maxX = window.innerWidth - r.width - 4;
  const left = x > maxX ? (flipX !== undefined ? flipX - r.width : maxX) : x;
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
}
