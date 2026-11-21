import type { DriveFile } from './driveApi';
import type { DesignEverywhere, FolderContents } from './driveSession';
import type { MenuEntry } from '../../tools/contextMenu';
import { ContextMenu } from '../contextMenuView';
import { choiceDialog, confirmDialog, promptDialog } from '../dialogs';
import { ICONS } from '../icons';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const size = (bytes?: string) => {
  const n = Number(bytes ?? 0);
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};
const shown = (name: string) => name.replace(/\.(vorm|benup)$/i, '');

/** What the browser needs from Google Drive (a `DriveSession`; a stand-in in tests). */
export interface DriveBrowserSource {
  account: string;
  /** VormCraft's folder: the top of what can be browsed. */
  rootId: string;
  folders(folderId: string): Promise<DriveFile[]>;
  designs(folderId: string): Promise<DriveFile[]>;
  everywhere(): Promise<DesignEverywhere[]>;
  /** The folders from VormCraft's (not included) down to `folderId`, or null if it is not inside it. */
  pathTo(folderId: string): Promise<DriveFile[] | null>;
  makeFolder(name: string, parent: string): Promise<DriveFile>;
  rename(item: DriveFile, name: string, folder: boolean): Promise<DriveFile>;
  move(item: DriveFile, to: string, folder: boolean): Promise<DriveFile>;
  contents(folderId: string): Promise<FolderContents>;
  trash(item: DriveFile): Promise<void>;
  link(folderId: string): string;
  /** A design was renamed, moved or put in the bin (the app updates the open design if it is that one). */
  designChanged(file: DriveFile, trashed: boolean): void;
}

export type DriveBrowserMode =
  | { kind: 'open' }
  /** Save to Google Drive: the name to suggest. */
  | { kind: 'save'; name: string }
  /** Move to…: the design or folder being moved. */
  | { kind: 'move'; item: DriveFile; folder: boolean };

export type DriveBrowserResult =
  | { kind: 'open'; file: DriveFile }
  /** `replace`: save over this design (its name was taken and the person chose Replace). */
  | { kind: 'save'; name: string; folderId: string; replace?: DriveFile }
  | { kind: 'move'; folderId: string };

/** Designs whose name has every word of `query` in it (any case). */
export function searchDesigns(all: DesignEverywhere[], query: string): DesignEverywhere[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? all.filter((d) => words.every((w) => d.file.name.toLowerCase().includes(w))) : all;
}

/** The folder line under a design in All designs. */
export function folderLabel(path: string[] | null): string {
  if (path === null) return 'outside the VormCraft folder';
  return ['VormCraft', ...path].join(' › ');
}

/** "3 designs and 1 folder". */
export function contentsText(c: FolderContents): string {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [c.designs ? part(c.designs, 'design', 'designs') : '', c.folders ? part(c.folders, 'folder', 'folders') : ''].filter(Boolean);
  return parts.join(' and ');
}

/**
 * Google Drive browser, for Open, Save and Move to…: VormCraft's folder and the folders made in
 * it, with a breadcrumb back up, New folder, and Rename, Move to… and Delete on each item (its ⋯
 * button or a right-click). Opening also has All designs: every design VormCraft can see, with a
 * search. Resolves to what was picked, or null.
 */
export function showDriveBrowser(source: DriveBrowserSource, mode: DriveBrowserMode, startFolder: string): Promise<DriveBrowserResult | null> {
  const title = mode.kind === 'open' ? 'Open from Google Drive' : mode.kind === 'save' ? 'Save to Google Drive' : `Move “${shown(mode.item.name)}”`;
  const okLabel = mode.kind === 'open' ? 'Open' : mode.kind === 'save' ? 'Save here' : 'Move here';
  const dlg = document.createElement('dialog');
  dlg.className = 'modal drive-open drive-browser';
  dlg.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p class="note account"></p>
      <div class="drive-bar">
        <div class="drive-views" role="tablist">
          <button type="button" role="tab" value="folders" class="on">Folders</button>
          <button type="button" role="tab" value="all">All designs</button>
        </div>
        <input type="search" class="drive-search" placeholder="Search designs" aria-label="Search designs" hidden>
        <button type="button" value="new-folder" class="drive-new">${ICONS.open}<span>New folder</span></button>
      </div>
      <nav class="drive-crumbs" aria-label="Folder"></nav>
      <ul class="drive-files" role="listbox"></ul>
      <label class="field drive-name" hidden>Name <input type="text" name="name" autocomplete="off"></label>
      <p class="drive-error" role="alert" hidden></p>
      <p class="note">Folders made on the Google Drive website don’t show here: make folders with New folder.</p>
      <div class="buttons"><button type="button" value="cancel">Cancel</button><button type="submit" class="primary"></button></div>
    </form>`;
  dlg.querySelector('h2')!.textContent = title;
  const account = dlg.querySelector<HTMLElement>('.account')!;
  const views = dlg.querySelector<HTMLElement>('.drive-views')!;
  const search = dlg.querySelector<HTMLInputElement>('.drive-search')!;
  const newFolder = dlg.querySelector<HTMLButtonElement>('button[value="new-folder"]')!;
  const crumbs = dlg.querySelector<HTMLElement>('.drive-crumbs')!;
  const list = dlg.querySelector<HTMLUListElement>('.drive-files')!;
  const nameField = dlg.querySelector<HTMLElement>('.drive-name')!;
  const nameInput = nameField.querySelector('input')!;
  const errorLine = dlg.querySelector<HTMLElement>('.drive-error')!;
  const ok = dlg.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  ok.textContent = okLabel;
  if (mode.kind !== 'open') views.hidden = true;
  if (mode.kind === 'save') {
    nameField.hidden = false;
    nameInput.value = mode.name;
  }
  const menu = new ContextMenu();

  /** Where the browser is: the folders from VormCraft's down. */
  let path: DriveFile[] = [];
  let view: 'folders' | 'all' = 'folders';
  let picked: DriveFile | null = null;
  let everything: DesignEverywhere[] | null = null;
  /** The designs in the folder shown (for a name already taken there). */
  let designsHere: DriveFile[] = [];
  let busy = 0;
  const here = () => path[path.length - 1]?.id ?? source.rootId;
  /** In Move to…: the folder being moved, and what is inside it, cannot be the target. */
  const blocked = (folder: DriveFile) => mode.kind === 'move' && mode.folder && folder.id === mode.item.id;

  const showError = (err: unknown) => {
    errorLine.textContent = err instanceof Error ? err.message : String(err);
    errorLine.hidden = false;
  };
  const updateOk = () => {
    if (mode.kind === 'open') ok.disabled = picked === null;
    else if (mode.kind === 'save') ok.disabled = nameInput.value.trim() === '' || busy > 0;
    else ok.disabled = busy > 0 || here() === mode.item.parents?.[0] || (mode.folder && path.some((f) => f.id === mode.item.id));
  };
  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    busy++;
    dlg.classList.add('busy');
    errorLine.hidden = true;
    updateOk();
    try {
      return await work();
    } catch (err) {
      showError(err);
      return undefined;
    } finally {
      busy--;
      if (!busy) dlg.classList.remove('busy');
      updateOk();
    }
  };

  const showAccount = () => {
    account.replaceChildren(`${source.account} · `);
    const a = document.createElement('a');
    a.href = source.link(here());
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Show in Google Drive';
    account.append(a);
  };

  const drawCrumbs = () => {
    crumbs.replaceChildren();
    crumbs.hidden = view === 'all';
    const steps: { name: string; at: number }[] = [{ name: 'VormCraft', at: 0 }, ...path.map((f, i) => ({ name: f.name, at: i + 1 }))];
    steps.forEach((step, i) => {
      if (i) crumbs.append(' › ');
      const last = i === steps.length - 1;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crumb';
      b.textContent = step.name;
      b.disabled = last;
      if (!last) b.addEventListener('click', () => void go(path.slice(0, step.at)));
      crumbs.append(b);
    });
  };

  const row = (icon: string, label: string, meta: string, onPick: () => void, onOpen: () => void, actions: MenuEntry[] | null, folder: boolean) => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.setAttribute('role', 'option');
    li.classList.toggle('folder', folder);
    const ic = document.createElement('span');
    ic.className = 'icon';
    ic.innerHTML = icon;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = label;
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = meta;
    li.append(ic, name, m);
    const select = () => {
      list.querySelectorAll('li').forEach((x) => x.classList.toggle('picked', x === li));
      onPick();
      updateOk();
    };
    li.addEventListener('click', select);
    li.addEventListener('focus', select);
    li.addEventListener('dblclick', onOpen);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onOpen();
      }
    });
    if (actions) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more';
      more.title = 'Rename, move or delete';
      more.setAttribute('aria-label', `More for ${label}`);
      more.innerHTML = ICONS.more;
      const open = (x: number, y: number) => menu.open(actions, x, y, dlg);
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const r = more.getBoundingClientRect();
        open(r.left, r.bottom);
      });
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        select();
        open(e.clientX, e.clientY);
      });
      li.append(more);
    }
    list.append(li);
    return li;
  };

  const empty = (text: string) => {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    list.append(li);
  };

  const itemActions = (item: DriveFile, folder: boolean): MenuEntry[] => [
    { label: 'Rename…', run: () => void renameItem(item, folder) },
    { label: 'Move to…', run: () => void moveItem(item, folder) },
    'separator',
    { label: 'Delete…', run: () => void deleteItem(item, folder) },
  ];

  /** Show a folder: its folders, then (unless moving) its designs. */
  const go = async (to: DriveFile[]) => {
    view = 'folders';
    path = to;
    picked = null;
    drawCrumbs();
    showAccount();
    const found = await run(() => Promise.all([source.folders(here()), mode.kind === 'move' ? Promise.resolve([]) : source.designs(here())]));
    if (path !== to) return; // went somewhere else meanwhile
    list.replaceChildren();
    if (!found) return;
    const [folders, designs] = found;
    designsHere = designs;
    for (const f of folders) {
      const li = row(ICONS.open, f.name, 'Folder', () => (picked = null), () => (blocked(f) ? undefined : void go([...path, f])), mode.kind === 'move' ? null : itemActions(f, true), true);
      if (blocked(f)) li.classList.add('disabled');
    }
    for (const d of designs) {
      row(
        ICONS.newDoc,
        shown(d.name),
        `${when(d.modifiedTime)} · ${size(d.size)}`,
        () => {
          picked = d;
          if (mode.kind === 'save') nameInput.value = shown(d.name);
        },
        () => (mode.kind === 'open' ? finish({ kind: 'open', file: d }) : mode.kind === 'save' ? submit() : undefined),
        itemActions(d, false),
        false,
      );
    }
    if (!folders.length && !designs.length) {
      empty(mode.kind === 'open' ? 'Nothing here yet. Use “Save to Google Drive” to put a design here, or New folder.' : 'No folders here.');
    }
    updateOk();
  };

  /** All designs: every design VormCraft can see, newest first, filtered by the search. */
  const showAll = async () => {
    view = 'all';
    picked = null;
    drawCrumbs();
    everything ??= (await run(() => source.everywhere())) ?? null;
    if (view !== 'all') return;
    list.replaceChildren();
    const found = searchDesigns(everything ?? [], search.value);
    for (const e of found) {
      const li = row(
        ICONS.newDoc,
        shown(e.file.name),
        `${when(e.file.modifiedTime)} · ${size(e.file.size)}`,
        () => (picked = e.file),
        () => finish({ kind: 'open', file: e.file }),
        e.path === null ? null : itemActions(e.file, false),
        false,
      );
      const where = document.createElement('span');
      where.className = 'where';
      where.textContent = folderLabel(e.path);
      li.querySelector('.name')!.append(where);
    }
    if (!found.length) empty(search.value.trim() ? 'No design has that in its name.' : 'No designs in Google Drive yet.');
    updateOk();
  };

  const refresh = () => {
    everything = null;
    return view === 'all' ? showAll() : go(path);
  };

  const setView = (v: 'folders' | 'all') => {
    views.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.value === v));
    search.hidden = v !== 'all';
    newFolder.hidden = v === 'all';
    if (v === 'all') {
      void showAll();
      search.focus();
    } else void go(path);
  };
  views.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setView(b.value as 'folders' | 'all')));
  search.addEventListener('input', () => void showAll());

  newFolder.addEventListener('click', async () => {
    const name = await promptDialog('New folder', 'Folder name', '', 'Make folder');
    if (!name?.trim()) return;
    const made = await run(() => source.makeFolder(name, here()));
    if (made) await go([...path, made]);
  });

  const renameItem = async (item: DriveFile, folder: boolean) => {
    const name = await promptDialog(folder ? 'Rename folder' : 'Rename design', 'Name', folder ? item.name : shown(item.name), 'Rename');
    if (!name?.trim()) return;
    const renamed = await run(() => source.rename(item, name, folder));
    if (!renamed) return;
    if (!folder) source.designChanged(renamed, false);
    await refresh();
  };

  const moveItem = async (item: DriveFile, folder: boolean) => {
    const target = await showDriveBrowser(source, { kind: 'move', item, folder }, item.parents?.[0] ?? source.rootId);
    if (target?.kind !== 'move') return;
    const moved = await run(() => source.move(item, target.folderId, folder));
    if (!moved) return;
    if (!folder) source.designChanged(moved, false);
    await refresh();
  };

  const deleteItem = async (item: DriveFile, folder: boolean) => {
    if (!folder) {
      if (!(await confirmDialog('Delete design', `Move “${shown(item.name)}” to the Google Drive bin? It can be restored from the bin on the Google Drive website for 30 days.`, 'Move to bin'))) return;
    } else {
      const inside = await run(() => source.contents(item.id));
      if (!inside) return;
      const holds = contentsText(inside);
      if (!holds) {
        if (!(await confirmDialog('Delete folder', `Move the empty folder “${item.name}” to the Google Drive bin?`, 'Move to bin'))) return;
      } else {
        // A folder with designs in it: say so plainly, and ask a second time.
        if (!(await confirmDialog('This folder is not empty', `“${item.name}” holds ${holds}. Deleting the folder moves all of it to the Google Drive bin.`, 'Continue…'))) return;
        if (
          !(await confirmDialog(
            'Delete the folder and everything in it?',
            `“${item.name}” and the ${holds} in it go to the Google Drive bin. They can be restored from the bin on the Google Drive website for 30 days, after which they are gone for good.`,
            `Delete folder and ${holds}`,
          ))
        )
          return;
      }
    }
    const done = await run(async () => {
      await source.trash(item);
      return true;
    });
    if (!done) return;
    if (!folder) source.designChanged(item, true);
    await refresh();
  };

  /** Save: a name already used in this folder asks whether to replace that design or keep both. */
  const saveHere = async () => {
    const name = nameInput.value.trim().replace(/\.(vorm|benup)$/i, '');
    const same = designsHere.find((d) => shown(d.name).toLowerCase() === name.toLowerCase());
    if (!same) return finish({ kind: 'save', name, folderId: here() });
    const choice = await choiceDialog('That name is taken', `There is already a design called “${shown(same.name)}” in this folder.\n\nReplace: your design takes its place (Google Drive keeps the old one in its version history).\nKeep both: yours is saved as a new file next to it, with a number added to the name.`, [
      { label: 'Replace', value: 'replace' },
      { label: 'Keep both', value: 'both' },
    ]);
    if (choice === 'replace') finish({ kind: 'save', name, folderId: here(), replace: same });
    else if (choice === 'both') finish({ kind: 'save', name, folderId: here() });
  };

  nameInput.addEventListener('input', updateOk);

  document.body.append(dlg);
  let resolve!: (r: DriveBrowserResult | null) => void;
  const result = new Promise<DriveBrowserResult | null>((r) => (resolve = r));
  const finish = (r: DriveBrowserResult | null) => {
    menu.close();
    dlg.close();
    dlg.remove();
    resolve(r);
  };
  const submit = () => {
    if (ok.disabled) return;
    if (mode.kind === 'open') {
      if (picked) finish({ kind: 'open', file: picked });
    } else if (mode.kind === 'save') void saveHere();
    else finish({ kind: 'move', folderId: here() });
  };
  dlg.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
  dlg.addEventListener('cancel', (e) => {
    if (menu.isOpen) {
      e.preventDefault();
      menu.close();
    } else finish(null);
  });
  dlg.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  // Backspace (outside the name box and search): up one folder.
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && view === 'folders' && path.length && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      void go(path.slice(0, -1));
    }
  });

  dlg.showModal();
  updateOk();
  if (mode.kind === 'save') {
    nameInput.focus();
    nameInput.select();
  }
  void (async () => {
    const start = startFolder === source.rootId ? [] : ((await run(() => source.pathTo(startFolder))) ?? []);
    await go(start ?? []);
  })();
  return result;
}
