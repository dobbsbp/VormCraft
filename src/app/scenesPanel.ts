import type { SceneId, SceneParts } from '../doc/Scenes';
import type { ToolController } from '../tools/ToolController';
import type { ScenePlayer } from './scenePlayer';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

const PART_LABELS: [keyof SceneParts, string][] = [
  ['camera', 'Camera'],
  ['hidden', 'Hidden groups'],
  ['style', 'Style'],
];

/**
 * The Scenes panel: the scenes in order (click to go, double-click to rename, arrows to reorder),
 * add / update / delete, what the current scene restores, the transition and slideshow timings,
 * and play/stop.
 */
export class ScenesPanel {
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly controller: ToolController,
    private readonly player: ScenePlayer,
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
    const { scenes } = this.controller.doc;
    const current = this.controller.currentScene;
    const key = JSON.stringify([scenes.items.map((s) => [s.id, s.name, s.parts]), current, scenes.transition, scenes.delay, this.player.playing]);
    if (key === this.shown) return;
    // Keep typing in a field undisturbed until it is committed.
    if (this.shown && this.root.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement && document.activeElement.type !== 'checkbox') return;
    this.shown = key;

    const close = el('button', { type: 'button', className: 'panel-close', title: 'Close', ariaLabel: 'Close scenes' }, '×');
    close.addEventListener('click', () => this.toggle(false));

    const list = el('ol', { className: 'scene-list' });
    scenes.items.forEach((s, i) => {
      const name = el('button', { type: 'button', className: 'scene-name', title: 'Click to go to this scene; double-click to rename' }, s.name);
      name.setAttribute('aria-pressed', String(s.id === current));
      name.addEventListener('click', () => this.controller.goToScene(s.id));
      name.addEventListener('dblclick', () => this.rename(name, s.id, s.name));
      const up = this.iconButton('▲', 'Move up', i === 0, () => this.controller.moveScene(s.id, i - 1));
      const down = this.iconButton('▼', 'Move down', i === scenes.items.length - 1, () => this.controller.moveScene(s.id, i + 1));
      const del = this.iconButton('✕', `Delete ${s.name}`, false, () => this.controller.deleteScene(s.id));
      list.append(el('li', { className: 'scene-row' }, name, up, down, del));
    });

    const add = el('button', { type: 'button', className: 'panel-button' }, '+ Add scene');
    add.title = 'Save the current view as a new scene';
    add.addEventListener('click', () => this.controller.addScene());
    const update = el('button', { type: 'button', className: 'panel-button', disabled: current === null }, 'Update');
    update.title = 'Overwrite the selected scene with the current view';
    update.addEventListener('click', () => current !== null && this.controller.updateScene(current));
    const play = el('button', { type: 'button', className: 'panel-button', disabled: scenes.items.length === 0 }, this.player.playing ? '■ Stop' : '▶ Play');
    play.title = 'Play the scenes in order as a slideshow';
    play.addEventListener('click', () => this.player.toggle());

    const parts: HTMLElement[] = [];
    const scene = current !== null ? scenes.get(current) : undefined;
    if (scene) {
      parts.push(el('h3', {}, `“${scene.name}” restores`));
      for (const [part, label] of PART_LABELS) {
        const box = el('input', { type: 'checkbox', checked: scene.parts[part] });
        box.addEventListener('change', () => this.controller.setSceneParts(scene.id, { [part]: box.checked }));
        parts.push(el('label', { className: 'panel-check' }, box, label));
      }
    }

    const seconds = (value: number, title: string) => {
      const input = el('input', { type: 'number', min: '0', step: '0.25', value: String(value), title, className: 'panel-size' });
      input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
      return input;
    };
    const transition = seconds(scenes.transition, 'How long the camera glides to a scene');
    const delay = seconds(scenes.delay, 'How long the slideshow stays on each scene');
    const commit = () => this.controller.setSceneTimings(Number(transition.value), Number(delay.value));
    transition.addEventListener('change', commit);
    delay.addEventListener('change', commit);

    this.root.replaceChildren(
      el('div', { className: 'panel-head' }, el('h2', {}, 'Scenes'), close),
      scenes.items.length ? list : el('p', { className: 'panel-note' }, 'No scenes yet. Set up a view (camera, style, hidden groups), then add it as a scene.'),
      el('div', { className: 'panel-row' }, add, update, play),
      ...parts,
      el('h3', {}, 'Timing'),
      el('label', { className: 'panel-field wide' }, el('span', {}, 'Transition'), transition, 's'),
      el('label', { className: 'panel-field wide' }, el('span', {}, 'Slideshow delay'), delay, 's'),
      el('p', { className: 'panel-note' }, 'Page Up / Page Down step through the scenes.'),
    );
  }

  private iconButton(text: string, title: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
    const b = el('button', { type: 'button', className: 'scene-icon', title, ariaLabel: title, disabled }, text);
    b.addEventListener('click', onClick);
    return b;
  }

  /** Swap the name for a text field; Enter or leaving it renames, Esc cancels. */
  private rename(button: HTMLButtonElement, id: SceneId, name: string): void {
    const input = el('input', { type: 'text', value: name, spellcheck: false, className: 'scene-rename' });
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      this.shown = '';
      if (save && value && value !== name) this.controller.renameScene(id, value);
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
