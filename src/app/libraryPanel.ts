import { modelBounds } from '../core/ops/group';
import type { LibraryItem, LibraryPart, Room } from '../library';
import type { ToolController } from '../tools/ToolController';
import { formatLengths } from '../tools/units';
import { renderThumbnail } from '../view/thumbnails';
import { showCustomiseDialog } from './customiseDialog';
import { showAiImportDialog, showAiTemplateDialog } from './aiDesignDialog';

type LibraryModule = typeof import('../library');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const THUMB_KEY = (version: number, id: string) => `vormcraft.library.thumb.${version}.${id}`;

/**
 * The Library panel: ready-made objects (our own, at real sizes) to place in the model. Search
 * (names, other names, rooms, sizes; typos allowed), narrow by room or kind, pick a size, click an
 * item, then click in the model. Preview pictures are drawn the first time they are seen and kept
 * on this device. The library's code is loaded when the panel first opens.
 */
export class LibraryPanel {
  private lib: LibraryModule | null = null;
  private loading: Promise<void> | null = null;
  private built = false;
  private query = '';
  private room: Room | '' = '';
  private kind = '';
  private readonly variant = new Map<string, string>();
  /** The settings last chosen with Customise… for each item (while the app is open). */
  private readonly custom = new Map<string, { variant: string | undefined; values: Record<string, number> }>();
  private readonly parts = new Map<string, LibraryPart[]>();
  private readonly thumbs = new Map<string, string>();
  private results: HTMLElement | null = null;
  private count: HTMLElement | null = null;
  private observer: IntersectionObserver | null = null;
  private queue: { item: LibraryItem; img: HTMLImageElement }[] = [];
  private drawing = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: ToolController,
    /** Pick a saved AI design file to import (absent: paste only). */
    private readonly openDesignFile?: () => Promise<{ name: string; text: string } | null>,
  ) {}

  /** Design with AI: describe it and copy the instructions for an AI; then, if asked, import the answer. */
  async designWithAi(): Promise<void> {
    await this.loadLibrary();
    if (await showAiTemplateDialog(this.lib!)) await this.importAiDesign();
  }

  /** Import AI design: paste (or open) an AI's design, then place it, or customise it first. */
  async importAiDesign(): Promise<void> {
    await this.loadLibrary();
    const chosen = await showAiImportDialog(this.lib!, this.openDesignFile);
    if (!chosen) return;
    if (chosen.customise) await this.customise(chosen.item);
    else this.place(chosen.item);
  }

  /** The library's code, without opening the panel. */
  private async loadLibrary(): Promise<void> {
    this.lib ??= await import('../library');
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.root.hidden = !open;
    if (open) void this.load().then(() => this.root.querySelector<HTMLInputElement>('.library-search')?.focus());
  }

  /** Nothing in the panel follows the document, so there is nothing to redraw on updates. */
  render(): void {}

  private load(): Promise<void> {
    this.loading ??= (async () => {
      this.root.replaceChildren(el('p', { className: 'panel-note' }, 'Loading the library…'));
      await this.loadLibrary();
      this.build();
    })();
    return this.loading;
  }

  private build(): void {
    const lib = this.lib!;
    if (this.built) return;
    this.built = true;
    const close = el('button', { type: 'button', className: 'panel-close', title: 'Close', ariaLabel: 'Close library' }, '×');
    close.addEventListener('click', () => this.toggle(false));

    const search = el('input', { type: 'search', className: 'library-search', placeholder: 'Search: sofa, fridge, lamp…', ariaLabel: 'Search the library' });
    search.addEventListener('input', () => {
      this.query = search.value;
      this.showResults();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) {
        e.stopPropagation();
        search.value = this.query = '';
        this.showResults();
      }
    });

    const room = el('select', { className: 'library-room', ariaLabel: 'Room' }, el('option', { value: '' }, 'All rooms'), ...lib.ROOMS.map((r) => el('option', { value: r }, r)));
    room.addEventListener('change', () => {
      this.room = room.value as Room | '';
      this.showResults();
    });

    const kinds = [...new Set(lib.LIBRARY.map((i) => i.subcategory))];
    const chips = el('div', { className: 'library-kinds', role: 'group', ariaLabel: 'Kind' });
    const chip = (value: string, label: string) => {
      const b = el('button', { type: 'button', className: 'library-kind' }, label);
      b.setAttribute('aria-pressed', String(this.kind === value));
      b.addEventListener('click', () => {
        this.kind = value;
        for (const c of Array.from(chips.children)) c.setAttribute('aria-pressed', String(c === b));
        this.showResults();
      });
      return b;
    };
    chips.append(chip('', 'All'), ...kinds.map((k) => chip(k, k)));

    const ai = el('div', { className: 'library-ai' });
    const design = el('button', { type: 'button', className: 'library-customise', title: 'Describe something, copy the instructions into your own AI chat, and import the design it writes' }, 'Design with AI…');
    design.addEventListener('click', () => void this.designWithAi());
    const importAi = el('button', { type: 'button', className: 'library-customise', title: 'Paste a design an AI wrote for VormCraft, and place it' }, 'Import AI design…');
    importAi.addEventListener('click', () => void this.importAiDesign());
    ai.append(design, importAi);

    this.count = el('p', { className: 'panel-note library-count' });
    this.results = el('div', { className: 'library-grid' });
    this.root.replaceChildren(
      el('div', { className: 'panel-head' }, el('h2', {}, 'Library'), close),
      el('p', { className: 'panel-note' }, 'Objects at real sizes. Click one, then click in the model to place it (arrow keys turn it). Doors and windows go into the wall you click. Customise… makes an item to your own sizes.'),
      ai,
      search,
      room,
      chips,
      this.count,
      this.results,
    );
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target as HTMLImageElement;
        this.observer!.unobserve(img);
        const item = lib.LIBRARY.find((i) => i.id === img.dataset.item);
        if (item) this.queueThumbnail(item, img);
      }
    }, { root: this.root });
    this.showResults();
  }

  private showResults(): void {
    const lib = this.lib;
    if (!lib || !this.results || !this.count) return;
    const hits = lib.searchLibrary(lib.LIBRARY, this.query, { room: this.room || undefined, subcategory: this.kind || undefined });
    this.count.textContent = hits.length ? `${hits.length} item${hits.length === 1 ? '' : 's'}` : 'Nothing found. Try another word, or All rooms.';
    this.observer?.disconnect();
    this.queue = [];
    this.results.replaceChildren(...hits.map(({ item }) => this.card(item)));
  }

  private card(item: LibraryItem): HTMLElement {
    const img = el('img', { className: 'library-thumb', alt: '', width: 160, height: 160 });
    img.dataset.item = item.id;
    const cached = this.thumbnail(item);
    if (cached) img.src = cached;
    else this.observer?.observe(img);
    const size = el('span', { className: 'library-size' });
    const pick = el('button', { type: 'button', className: 'library-pick', title: `Place ${item.name.toLowerCase()}: click here, then click in the model` }, img, el('span', { className: 'library-name' }, item.name), size);
    pick.addEventListener('click', () => this.place(item));
    const card = el('div', { className: 'library-card' }, pick);
    if (item.params?.length) {
      const customise = el('button', { type: 'button', className: 'library-customise', title: `Choose the ${item.name.toLowerCase()}'s sizes and settings, then place it` }, 'Customise…');
      customise.addEventListener('click', () => void this.customise(item));
      card.append(customise);
    }
    if (item.variants?.length) {
      const select = el('select', { className: 'library-variant', ariaLabel: `${item.name} size` }, ...item.variants.map((v) => el('option', { value: v.id }, v.name)));
      select.value = this.variant.get(item.id) ?? item.variants[0].id;
      select.addEventListener('change', () => {
        this.variant.set(item.id, select.value);
        size.textContent = this.sizeText(item);
      });
      card.append(select);
    }
    // Sizes need the item built; do it when the picture is drawn (or now, if it is already known).
    if (this.parts.has(this.key(item))) size.textContent = this.sizeText(item);
    else size.dataset.pending = '1';
    return card;
  }

  private key(item: LibraryItem, variant = this.variant.get(item.id)): string {
    return `${item.id}|${variant ?? ''}`;
  }

  private partsOf(item: LibraryItem, variant = this.variant.get(item.id)): LibraryPart[] {
    const key = this.key(item, variant);
    let parts = this.parts.get(key);
    if (!parts) {
      parts = item.build(variant);
      this.parts.set(key, parts);
    }
    return parts;
  }

  private sizeText(item: LibraryItem): string {
    const b = modelBounds(this.partsOf(item).map((p) => p.model));
    if (!b) return '';
    return formatLengths([0, 1, 2].map((i) => Math.round(b.max[i] - b.min[i])), ' × ');
  }

  private thumbnail(item: LibraryItem): string | null {
    const key = THUMB_KEY(this.lib!.LIBRARY_VERSION, item.id);
    let url = this.thumbs.get(key) ?? null;
    if (!url) {
      try {
        url = localStorage.getItem(key);
      } catch {
        url = null;
      }
      if (url) this.thumbs.set(key, url);
    }
    return url;
  }

  /** Draw pictures one at a time between frames, so the panel stays responsive. */
  private queueThumbnail(item: LibraryItem, img: HTMLImageElement): void {
    this.queue.push({ item, img });
    if (this.drawing) return;
    this.drawing = true;
    const next = () => {
      const job = this.queue.shift();
      if (!job) {
        this.drawing = false;
        return;
      }
      try {
        this.drawThumbnail(job.item, job.img);
      } catch (err) {
        console.error(`Library picture for ${job.item.id}`, err);
      }
      setTimeout(next, 0);
    };
    setTimeout(next, 0);
  }

  private drawThumbnail(item: LibraryItem, img: HTMLImageElement): void {
    const lib = this.lib!;
    const parts = this.partsOf(item, item.variants?.[0].id);
    const url = renderThumbnail(
      parts.map((p) => {
        const f = lib.paintFields(p);
        return { model: p.model, color: f.color, opacity: f.opacity };
      }),
    );
    if (!url) return;
    const key = THUMB_KEY(lib.LIBRARY_VERSION, item.id);
    this.thumbs.set(key, url);
    try {
      localStorage.setItem(key, url);
    } catch {
      // Storage full or blocked: the picture is drawn again next time.
    }
    img.src = url;
    const size = img.parentElement?.querySelector<HTMLElement>('.library-size[data-pending]');
    if (size) {
      delete size.dataset.pending;
      size.textContent = this.sizeText(item);
    }
  }

  /** Customise…: choose the settings, then place the item made from them. */
  private async customise(item: LibraryItem): Promise<void> {
    const lib = this.lib!;
    const last = this.custom.get(item.id);
    const chosen = await showCustomiseDialog(lib, item, last?.variant ?? this.variant.get(item.id) ?? item.variants?.[0].id, last?.values);
    if (!chosen) return;
    this.custom.set(item.id, { variant: chosen.variant, values: chosen.values });
    if (chosen.variant !== undefined && item.variants?.length) {
      this.variant.set(item.id, chosen.variant);
      this.showResults();
    }
    if (!lib.isCustomised(item, chosen.variant, chosen.values)) {
      this.place(item);
      return;
    }
    const b = modelBounds(chosen.parts.map((p) => p.model));
    const dims = b ? formatLengths([0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 10) / 10), ' × ') : '';
    this.place(item, { name: dims ? `${item.name}, ${dims}` : item.name, parts: chosen.parts, source: lib.itemSource(item, chosen.variant, chosen.values), values: chosen.values });
  }

  private place(item: LibraryItem, custom?: { name: string; parts: LibraryPart[]; source: string; values: Record<string, number> }): void {
    const lib = this.lib!;
    const variantId = this.variant.get(item.id) ?? item.variants?.[0].id;
    const variant = item.variants?.find((v) => v.id === variantId);
    let parts: LibraryPart[];
    try {
      parts = custom?.parts ?? this.partsOf(item, variantId);
    } catch (err) {
      this.controller.notify(`Could not make the ${item.name.toLowerCase()}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    this.controller.place({
      name: custom?.name ?? (variant ? `${item.name}, ${variant.name}` : item.name),
      hangs: item.hangs,
      source: custom?.source ?? `library:${item.id}${variantId ? `:${variantId}` : ''}`,
      opening: item.opening?.(variantId, custom?.values),
      parts: parts.map((p) => {
        return { name: p.name, model: p.model, paint: lib.paintFields(p) };
      }),
    });
    // On small screens the panel covers the view: get it out of the way.
    if (window.innerWidth < 900) this.toggle(false);
  }
}
