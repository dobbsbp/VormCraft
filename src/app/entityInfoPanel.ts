import { faceArea } from '../core/check/measure';
import { describeSolid, solidReport, volumeLines, type SolidReport } from '../core/check/solid';
import { distance } from '../core/math/vec3';
import { modelBounds } from '../core/ops/group';
import type { ToolController } from '../tools/ToolController';
import { formatArea, formatLength, formatLengths, formatVolume } from '../tools/units';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Entity Info: facts about the selection (a group's name, contents, size and paint; faces' area
 * and paint; volumes of solids and groups; whether shapes are proper solids; edges' length and
 * smoothing; a point's position), and renaming a group.
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
    const key = JSON.stringify([[...sel.faces], [...sel.edges], [...sel.points], [...sel.groups], sel.guides.size, sel.labels.size, c.revision, c.doc.editing]);
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

  /** The volume of a group's solids, with those of the groups inside it. */
  private groupVolume(id: number): number {
    return this.controller.doc.groups.subtree(id).reduce((a, g) => a + solidReport(g.model).volumes.reduce((x, v) => x + v, 0), 0);
  }

  private volumeRows(things: { name: string; volume: number }[]): HTMLElement[] {
    return volumeLines(things, (v) => formatVolume(v)).map(([label, value]) => this.row(label, value));
  }

  /** Whether the shapes are proper solids, and a button to show where one is open. */
  private solidRows(r: SolidReport): HTMLElement[] {
    const text = describeSolid(r);
    if (!text) return [];
    const row = this.row('Solid', text);
    row.classList.toggle('problem', r.open + r.insideOut + r.pressed > 0);
    if (!r.openEdges.length) return [row];
    const show = el('button', { type: 'button', className: 'panel-button' }, 'Select open edges');
    show.addEventListener('click', () => this.controller.selectOpenEdges());
    return [row, el('div', { className: 'panel-row' }, show)];
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
        this.row('Size', b ? formatLengths(b.max.map((x, i) => x - b.min[i]), ' × ') : 'empty'),
        ...this.volumeRows([{ name: g.name, volume: this.groupVolume(id) }]),
        this.row('Paint', this.materialName(g.material)),
        ...this.solidRows(solidReport(g.model)),
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
    const points = [...sel.points].filter((v) => model.vertices.has(v));
    const parts = [plural(sel.groups.size, 'group'), plural(faces.length, 'face'), plural(edges.length, 'edge'), plural(points.length, 'point'), plural(sel.guides.size, 'guide'), plural(sel.labels.size, 'label')].filter((p) => !p.startsWith('0 '));
    out.push(el('p', { className: 'panel-note' }, parts.join(', ')));
    if (points.length === 1) out.push(this.row('Position', formatLengths(model.pos(points[0]), ', ')));
    const report = faces.length ? solidReport(model, faces) : null;
    // Each selected group, and each solid the selected faces belong to, with its volume.
    out.push(
      ...this.volumeRows([
        ...[...sel.groups].map((id) => ({ name: doc.groups.get(id)?.name ?? 'Group', volume: this.groupVolume(id) })),
        ...(report?.volumes.map((volume, i) => ({ name: `Solid ${i + 1}`, volume })) ?? []),
      ]),
    );
    if (report) {
      const paints = new Set(faces.map((f) => model.face(f).material));
      out.push(
        this.row(faces.length === 1 ? 'Area' : 'Total area', formatArea(faces.reduce((a, f) => a + faceArea(model, f), 0))),
        this.row('Paint', paints.size === 1 ? this.materialName([...paints][0]) : 'Mixed'),
        ...this.solidRows(report),
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
