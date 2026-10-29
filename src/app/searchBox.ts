import { searchCommands, type Command } from './commands';

const MAX_RESULTS = 8;

/**
 * The Search box (Shift+S): type to find a tool or action, ↑/↓ to choose, Enter to run, Esc to
 * close. Clicking a result runs it too.
 */
export class SearchBox {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private results: Command[] = [];
  private active = 0;

  constructor(
    container: HTMLElement,
    private readonly commands: () => Command[],
  ) {
    this.root = document.createElement('div');
    this.root.className = 'search-box';
    this.root.hidden = true;
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'Search tools and commands…';
    this.input.setAttribute('aria-label', 'Search tools and commands');
    this.input.spellcheck = false;
    this.list = document.createElement('ul');
    this.list.setAttribute('role', 'listbox');
    this.root.append(this.input, this.list);
    container.append(this.root);

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = this.results.length;
        if (n) this.active = (this.active + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        this.render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.runActive();
      }
    });
    this.input.addEventListener('blur', () => setTimeout(() => this.close(), 120));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.input.value = '';
    this.update();
    this.input.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.input.blur();
  }

  private update(): void {
    this.results = searchCommands(this.commands(), this.input.value).slice(0, MAX_RESULTS);
    this.active = 0;
    this.render();
  }

  private render(): void {
    this.list.replaceChildren(
      ...this.results.map((c, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === this.active));
        li.append(Object.assign(document.createElement('span'), { textContent: c.name }));
        if (c.shortcut) li.append(Object.assign(document.createElement('kbd'), { textContent: c.shortcut }));
        li.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep focus so blur does not close before the click lands
          this.active = i;
          this.runActive();
        });
        return li;
      }),
    );
    if (!this.results.length) this.list.append(Object.assign(document.createElement('li'), { className: 'empty', textContent: 'No matching commands' }));
  }

  private runActive(): void {
    const c = this.results[this.active];
    this.close();
    c?.run();
  }
}
