import type { MaterialId } from '../core/model/Model';
import type { Material, MaterialFields, Materials } from '../doc/Materials';
import type { ToolController } from '../tools/ToolController';
import { formatLength, parseLength } from '../tools/units';
import { LIBRARY, textureFromFile, type LibraryEntry } from './materialLibrary';

const DEFAULT_LABEL = 'Default';

/** CSS background for a swatch: the texture, or the colour (over a checkerboard when see-through). */
function swatchBackground(m: Pick<Material, 'color' | 'opacity' | 'texture'> | null): string {
  if (!m) return 'var(--face-default)';
  if (m.texture) return `center / cover no-repeat url("${m.texture.image}")`;
  const n = parseInt(m.color.slice(1), 16);
  const rgba = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${m.opacity})`;
  return `linear-gradient(${rgba}, ${rgba}), repeating-conic-gradient(#cfd0d2 0 25%, #fff 0 50%) 0 0 / 10px 10px`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * The Materials window (floating over the view): an editor for the current material, then tabs
 * for the materials in the model (plus Default, which removes paint), library colours (by family)
 * and library textures (by kind). Picking one makes it the Paint Bucket's material and switches to
 * the Paint Bucket.
 */
type Tab = 'model' | 'colours' | 'textures';
const TAB_KEY = 'vormcraft.materials.tab';
const POS_KEY = 'vormcraft.materials.position';

export class MaterialsPanel {
  private shown: { current: MaterialId | undefined; list: Material[]; tab: Tab } | null = null;
  private tab: Tab = 'colours';

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: ToolController,
    private readonly usePaintBucket: () => void,
  ) {
    try {
      const t = localStorage.getItem(TAB_KEY);
      if (t === 'model' || t === 'colours' || t === 'textures') this.tab = t;
    } catch {
      // Colours.
    }
    this.makeFloating();
  }

  /**
   * The panel floats over the view: dragged by its title bar, kept inside the window, and its
   * place remembered on the device.
   */
  private makeFloating(): void {
    const root = this.root;
    root.classList.add('floating-panel');
    const place = (left: number, top: number) => {
      const w = root.offsetWidth || 300;
      const h = root.offsetHeight || 200;
      const x = Math.max(4, Math.min(left, window.innerWidth - w - 4));
      const y = Math.max(4, Math.min(top, window.innerHeight - Math.min(h, 80)));
      root.style.left = `${x}px`;
      root.style.top = `${y}px`;
      return [x, y];
    };
    let saved: [number, number] | null = null;
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null');
      if (Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number')) saved = p as [number, number];
    } catch {
      // Default place.
    }
    this.placeFloating = () => {
      if (saved) place(saved[0], saved[1]);
      else place(window.innerWidth - 340, 110);
    };
    let drag: { dx: number; dy: number } | null = null;
    root.addEventListener('pointerdown', (e) => {
      const head = e.target instanceof Element ? e.target.closest('.panel-head') : null;
      if (!head || e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return;
      drag = { dx: e.clientX - root.offsetLeft, dy: e.clientY - root.offsetTop };
      root.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    root.addEventListener('pointermove', (e) => {
      if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy);
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      saved = [root.offsetLeft, root.offsetTop];
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(saved));
      } catch {
        // Not remembered.
      }
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => this.isOpen && this.placeFloating());
  }

  private placeFloating: () => void = () => {};

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.root.hidden = !open;
    this.shown = null;
    this.render();
    if (open) this.placeFloating();
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Not remembered.
    }
    this.render();
  }

  /** Redraw if anything shown changed (cheap to call after every update). */
  render(): void {
    if (!this.isOpen) return;
    const current = this.controller.paintMaterial;
    const list = [...this.controller.doc.materials.items.values()];
    const s = this.shown;
    if (s && s.current === current && s.tab === this.tab && s.list.length === list.length && s.list.every((m, i) => m === list[i])) return;
    // Keep typing in an editor field undisturbed until it is committed.
    if (s && this.root.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text') return;
    this.shown = { current, list, tab: this.tab };
    const def = current === undefined ? null : (this.controller.doc.materials.get(current) ?? null);

    const close = el('button', { type: 'button', className: 'panel-close', title: 'Close', ariaLabel: 'Close materials' }, '×');
    close.addEventListener('click', () => this.toggle(false));

    const inModel = el('div', { className: 'swatches' }, this.swatch(DEFAULT_LABEL, null, current === undefined, () => this.pick(undefined)));
    for (const m of list) inModel.append(this.swatch(m.name, m, m.id === current, () => this.pick(m.id)));

    const newColour = el('button', { type: 'button', className: 'panel-button' }, 'New colour');
    newColour.addEventListener('click', () => this.addMaterial({ name: this.controller.doc.materials.uniqueName('Colour'), color: '#8a9bb0', opacity: 1 }));
    const newTexture = el('button', { type: 'button', className: 'panel-button' }, 'New from image…');
    newTexture.addEventListener('click', () =>
      this.chooseImage(async (file) => {
        const t = await textureFromFile(file);
        this.addMaterial({ name: this.controller.doc.materials.uniqueName(t.name), color: '#c8c8c8', opacity: 1, texture: { image: t.image, width: t.width, height: t.height } });
      }),
    );

    // Library entries under their group headings (Neutrals, Warm…; Wood, Stone…).
    const library = (entries: LibraryEntry[]): HTMLElement[] => {
      const out: HTMLElement[] = [];
      for (const group of [...new Set(entries.map((e) => e.group))]) {
        const box = el('div', { className: 'swatches' });
        for (const entry of entries.filter((e) => e.group === group)) {
          const btn = this.swatch(entry.key.split(':')[1], null, false, () => this.fromLibrary(entry));
          btn.dataset.library = entry.key;
          box.append(btn);
          // Textures are drawn on first show; paint the swatch once they exist.
          requestAnimationFrame(() => (btn.querySelector<HTMLElement>('.chip')!.style.background = swatchBackground(entry.fields())));
        }
        out.push(el('h3', {}, group), box);
      }
      return out;
    };

    const tabs = el('div', { className: 'panel-tabs', role: 'tablist' });
    for (const [id, label] of [
      ['model', `In model (${list.length + 1})`],
      ['colours', 'Colours'],
      ['textures', 'Textures'],
    ] as [Tab, string][]) {
      const b = el('button', { type: 'button', className: 'panel-tab', role: 'tab' }, label);
      b.setAttribute('aria-selected', String(this.tab === id));
      b.addEventListener('click', () => this.setTab(id));
      tabs.append(b);
    }
    const body =
      this.tab === 'model'
        ? [inModel, el('div', { className: 'panel-row' }, newColour, newTexture)]
        : this.tab === 'colours'
          ? library(LIBRARY.colours)
          : [...library(LIBRARY.textures), el('div', { className: 'panel-row' }, newTexture)];

    const bigChip = el('span', { className: 'chip big' });
    bigChip.style.background = swatchBackground(def);
    this.root.replaceChildren(
      el('div', { className: 'panel-head' }, el('h2', {}, 'Materials'), close),
      el('div', { className: 'panel-current' }, bigChip, el('strong', {}, def?.name ?? DEFAULT_LABEL)),
      def ? this.editor(def) : el('p', { className: 'panel-note' }, 'Default removes paint from the faces you click.'),
      tabs,
      el('div', { className: 'panel-tab-body' }, ...body),
    );
  }

  private swatch(name: string, m: Material | null, pressed: boolean, onPick: () => void): HTMLButtonElement {
    const chip = el('span', { className: 'chip' });
    chip.style.background = swatchBackground(m);
    const b = el('button', { type: 'button', className: 'swatch', title: name }, chip, el('span', { className: 'swatch-name' }, name));
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', onPick);
    return b;
  }

  private pick(id: MaterialId | undefined): void {
    this.controller.setPaintMaterial(id);
    this.usePaintBucket();
  }

  private addMaterial(fields: MaterialFields): void {
    let id: MaterialId | undefined;
    this.controller.editDocument('Add material', () => (id = this.controller.doc.materials.add(fields)));
    if (id !== undefined) this.pick(id);
  }

  /** Use a library material: the one already in the model if it is the same, else a new copy. */
  private fromLibrary(entry: LibraryEntry): void {
    const fields = entry.fields();
    const same = [...this.controller.doc.materials.items.values()].find(
      (m) => m.name === fields.name && m.color === fields.color && m.opacity === fields.opacity && m.texture?.image === fields.texture?.image,
    );
    if (same) this.pick(same.id);
    else this.addMaterial({ ...fields, name: this.controller.doc.materials.uniqueName(fields.name) });
  }

  private edit(id: MaterialId, changes: Parameters<Materials['update']>[1]): void {
    this.controller.editDocument('Edit material', () => this.controller.doc.materials.update(id, changes));
  }

  private chooseImage(use: (file: File) => Promise<void>): void {
    const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) use(file).catch((err: unknown) => this.controller.notify(err instanceof Error ? err.message : String(err)));
    });
    input.click();
  }

  private editor(m: Material): HTMLElement {
    const name = el('input', { type: 'text', value: m.name, spellcheck: false });
    name.addEventListener('change', () => (name.value.trim() ? this.edit(m.id, { name: name.value.trim() }) : (name.value = m.name)));
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

    const colour = el('input', { type: 'color', value: m.color, title: m.texture ? 'The texture covers the colour' : 'Colour', disabled: !!m.texture });
    colour.addEventListener('change', () => this.edit(m.id, { color: colour.value }));

    const opacity = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(m.opacity * 100)), title: 'Opacity' });
    const opacityText = el('span', { className: 'panel-value' }, `${Math.round(m.opacity * 100)}%`);
    opacity.addEventListener('input', () => (opacityText.textContent = `${opacity.value}%`));
    opacity.addEventListener('change', () => this.edit(m.id, { opacity: Number(opacity.value) / 100 }));

    const rows: HTMLElement[] = [
      el('label', { className: 'panel-field' }, el('span', {}, 'Name'), name),
      el('label', { className: 'panel-field' }, el('span', {}, 'Colour'), colour),
      el('label', { className: 'panel-field' }, el('span', {}, 'Opacity'), opacity, opacityText),
    ];

    const replace = el('button', { type: 'button', className: 'panel-button' }, m.texture ? 'Replace image…' : 'Add image…');
    replace.addEventListener('click', () =>
      this.chooseImage(async (file) => {
        const t = await textureFromFile(file);
        // Keep the current size when replacing, so the pattern stays to scale.
        const size = m.texture ? { width: m.texture.width, height: (m.texture.width * t.height) / t.width } : { width: t.width, height: t.height };
        this.edit(m.id, { texture: { image: t.image, ...size } });
      }),
    );
    const actions = el('div', { className: 'panel-row' }, replace);
    if (m.texture) {
      const tex = m.texture;
      const size = (axis: 'width' | 'height') => {
        const input = el('input', { type: 'text', value: formatLength(tex[axis]), spellcheck: false, className: 'panel-size' });
        input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
        input.addEventListener('change', () => {
          const v = parseLength(input.value);
          if (v === undefined || v <= 0) {
            input.value = formatLength(tex[axis]);
            this.controller.notify('Type a size, e.g. 600 or 0.6m');
            return;
          }
          this.edit(m.id, { texture: { ...tex, [axis]: v } });
        });
        return input;
      };
      rows.push(el('label', { className: 'panel-field' }, el('span', {}, 'Tile size'), size('width'), '×', size('height')));
      const remove = el('button', { type: 'button', className: 'panel-button' }, 'Remove image');
      remove.addEventListener('click', () => this.edit(m.id, { texture: null }));
      actions.append(remove);
    }
    const del = el('button', { type: 'button', className: 'panel-button danger' }, 'Delete material');
    del.addEventListener('click', () => this.controller.deleteMaterial(m.id));
    actions.append(del);
    return el('div', { className: 'panel-editor' }, ...rows, actions);
  }
}
