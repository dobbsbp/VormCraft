import type { TagId } from '../doc/Tags';
import type { ToolController } from '../tools/ToolController';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * The Tags panel: the design's tags (layers), each with a box to show or hide everything carrying
 * it, how many groups carry it, a button giving the selected groups that tag, renaming
 * (double-click) and deleting; and adding a tag.
 */
export class TagsPanel {
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

  /** Redraw if anything shown changed (cheap to call after every update). */
  render(): void {
    if (!this.isOpen) return;
    const c = this.controller;
    const tags = c.doc.groups.tags;
    const selected = [...c.selection.groups].filter((id) => c.doc.groups.has(id));
    const use = c.tagUse();
    const key = JSON.stringify([tags.items, [...use], selected.map((id) => c.doc.groups.get(id)?.tag ?? null)]);
    if (key === this.shown) return;
    // Keep typing in a field undisturbed until it is committed.
    if (this.shown && this.root.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type !== 'checkbox') return;
    this.shown = key;

    const close = el('button', { type: 'button', className: 'panel-close', title: 'Close', ariaLabel: 'Close tags' }, '×');
    close.addEventListener('click', () => this.toggle(false));

    const selectedTags = new Set(selected.map((id) => c.doc.groups.get(id)?.tag));
    const row = (id: TagId | undefined, name: string, hidden: boolean, count: number) => {
      const box = el('input', { type: 'checkbox', checked: !hidden, disabled: id === undefined, title: id === undefined ? 'Untagged groups are always shown (hide them one by one)' : hidden ? 'Show everything with this tag' : 'Hide everything with this tag' });
      if (id !== undefined) box.addEventListener('change', () => c.setTagHidden(id, !box.checked));
      const label = el('button', { type: 'button', className: 'scene-name', title: id === undefined ? 'Groups with no tag' : 'Double-click to rename' }, name);
      if (id !== undefined) label.addEventListener('dblclick', () => this.rename(label, id, name));
      label.setAttribute('aria-pressed', String(selected.length > 0 && selectedTags.size === 1 && selectedTags.has(id)));
      const n = el('span', { className: 'tag-count', title: `${count} ${count === 1 ? 'group' : 'groups'}` }, String(count));
      const assign = this.iconButton('⤵', id === undefined ? 'Untag the selected groups' : `Give the selected groups the tag ${name}`, selected.length === 0, () => c.tagSelection(id));
      const del = id === undefined ? el('span', { className: 'scene-icon' }) : this.iconButton('✕', `Delete the tag ${name} (its groups stay, untagged)`, false, () => c.deleteTag(id));
      return el('li', { className: 'scene-row tag-row' }, box, label, n, assign, del);
    };
    const untagged = [...c.doc.groups.items.values()].filter((g) => g.tag === undefined).length;
    const list = el('ol', { className: 'scene-list' }, row(undefined, 'Untagged', false, untagged), ...tags.items.map((t) => row(t.id, t.name, !!t.hidden, use.get(t.id) ?? 0)));

    const add = el('button', { type: 'button', className: 'panel-button' }, '+ Add tag');
    add.title = selected.length ? 'Add a tag and give it to the selected groups' : 'Add a tag';
    add.addEventListener('click', () => {
      const id = c.addTag();
      if (id !== null && selected.length) c.tagSelection(id);
    });

    this.root.replaceChildren(
      el('div', { className: 'panel-head' }, el('h2', {}, 'Tags'), close),
      list,
      el('div', { className: 'panel-row' }, add),
      el('p', { className: 'panel-note' }, 'Untick a tag to hide every group carrying it. Select groups, then ⤵ to give them a tag (also in Entity Info). Geometry outside groups has no tag: group it first.'),
    );
  }

  private iconButton(text: string, title: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'scene-icon', title, ariaLabel: title, disabled }, text);
    b.addEventListener('click', onClick);
    return b;
  }

  /** Swap the name for a text field; Enter or leaving it renames, Esc cancels. */
  private rename(button: HTMLButtonElement, id: TagId, name: string): void {
    const input = el('input', { type: 'text', value: name, spellcheck: false, className: 'scene-rename' });
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      this.shown = '';
      if (save && value && value !== name) this.controller.renameTag(id, value);
      else this.render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    button.replaceWith(input);
    input.focus();
    input.select();
  }
}
