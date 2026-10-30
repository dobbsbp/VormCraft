import { faceArea } from '../core/check/measure';
import { distance } from '../core/math/vec3';
import { modelBounds } from '../core/ops/group';
import type { ToolController } from '../tools/ToolController';
import { formatLength } from '../tools/units';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/** Square millimetres, or square metres once that reads better. */
export function formatArea(mm2: number): string {
  if (mm2 >= 1e6) return `${Math.round(mm2 / 1e4) / 100} m²`;
  return `${Math.round(mm2 * 100) / 100} mm²`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Entity Info: facts about the selection (a group's name, contents, size and paint; faces' area
 * and paint; edges' length and smoothing), and renaming a group.
 */
export class EntityInfoPanel {
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: ToolController,
  ) {}

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.root.hidden = !open;
    this.shown = '';
    this.render();
  }

  render(): void {
    if (!this.isOpen) return;
    const c = this.controller;
    const sel = c.selection;
    const key = JSON.stringify([[...sel.faces], [...sel.edges], [...sel.groups], sel.guides.size, sel.labels.size, c.revision, c.doc.editing]);
    if (key === this.shown) return;
    if (this.shown && this.root.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement) return;
    this.shown = key;

    const close = el('button', { type: 'button', className: 'panel-close', title: 'Close', ariaLabel: 'Close entity info' }, '×');
    close.addEventListener('click', () => this.toggle(false));
    this.root.replaceChildren(el('div', { className: 'panel-head' }, el('h2', {}, 'Entity Info'), close), ...this.body());
  }

  private row(label: string, value: string | Node): HTMLElement {
    return el('div', { className: 'panel-field info-row' }, el('span', {}, label), typeof value === 'string' ? el('span', { className: 'info-value' }, value) : value);
  }

  private materialName(id: string | undefined): string {
    return id === undefined ? 'Default' : (this.controller.doc.materials.get(id)?.name ?? 'Default');
  }

  private body(): HTMLElement[] {
    const c = this.controller;
    const { doc, selection: sel } = c;
    const model = doc.model;
    const out: HTMLElement[] = [];

    if (sel.groups.size === 1 && sel.faces.size === 0 && sel.edges.size === 0) {
      const [id] = sel.groups;
      const g = doc.groups.get(id);
      if (!g) return out;
      const name = el('input', { type: 'text', value: g.name, spellcheck: false });
      name.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') name.blur();
      });
      name.addEventListener('change', () => (name.value.trim() ? c.renameGroup(id, name.value) : (name.value = g.name)));
      const sub = doc.groups.subtree(id);
      const faces = sub.reduce((n, x) => n + x.model.faces.size, 0);
      const edges = sub.reduce((n, x) => n + [...x.model.edges()].length, 0);
      const b = modelBounds(sub.map((x) => x.model));
      const edit = el('button', { type: 'button', className: 'panel-button' }, 'Edit group');
      edit.addEventListener('click', () => c.enterGroup(id));
      out.push(
        el('p', { className: 'panel-note' }, 'Group'),
        el('label', { className: 'panel-field' }, el('span', {}, 'Name'), name),
        this.row('Contents', [plural(faces, 'face'), plural(edges, 'edge'), sub.length > 1 ? plural(sub.length - 1, 'group') + ' inside' : ''].filter(Boolean).join(', ')),
        this.row('Size', b ? b.max.map((x, i) => formatLength(x - b.min[i]).replace(' mm', '')).join(' × ') + ' mm' : 'empty'),
        this.row('Paint', this.materialName(g.material)),
        el('div', { className: 'panel-row' }, edit),
      );
      return out;
    }

    if (sel.size === 0) {
      out.push(
        el('p', { className: 'panel-note' }, 'Nothing selected. Click something to see its details.'),
        this.row('Editing', doc.editing === null ? 'Top level' : (doc.groups.get(doc.editing)?.name ?? '')),
        this.row('Faces', String(model.faces.size)),
        this.row('Groups', String(doc.groups.children(doc.editing).length)),
      );
      return out;
    }

    const faces = [...sel.faces].filter((f) => model.faces.has(f));
    const edges = [...sel.edges].filter((e) => model.halfEdges.has(e));
    const parts = [plural(sel.groups.size, 'group'), plural(faces.length, 'face'), plural(edges.length, 'edge'), plural(sel.guides.size, 'guide'), plural(sel.labels.size, 'label')].filter((p) => !p.startsWith('0 '));
    out.push(el('p', { className: 'panel-note' }, parts.join(', ')));
    if (faces.length) {
      const paints = new Set(faces.map((f) => model.face(f).material));
      out.push(
        this.row(faces.length === 1 ? 'Area' : 'Total area', formatArea(faces.reduce((a, f) => a + faceArea(model, f), 0))),
        this.row('Paint', paints.size === 1 ? this.materialName([...paints][0]) : 'Mixed'),
      );
    }
    if (edges.length) {
      const len = edges.reduce((a, e) => a + distance(model.pos(model.he(e).origin), model.pos(model.dest(e))), 0);
      out.push(this.row(edges.length === 1 ? 'Length' : 'Total length', formatLength(len)));
      if (edges.length === 1) {
        const soft = model.he(edges[0]).soft;
        out.push(this.row('Smoothing', soft === undefined ? 'Automatic' : soft ? 'Soft (hidden)' : 'Always shown'));
      }
    }
    return out;
  }
}
