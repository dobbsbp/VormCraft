import type { MenuEntry } from '../tools/contextMenu';
import { isTauri } from './files';
import { KEY_BINDINGS } from './keymap';
import { APP_VERSION } from './updater';

export const LINKS = {
  project: 'https://github.com/dobbsbp/VormCraft',
  releaseNotes: `https://github.com/dobbsbp/VormCraft/releases/tag/v${APP_VERSION}`,
  newIssue: 'https://github.com/dobbsbp/VormCraft/issues/new',
};

/** Open a web page in the user's browser (the desktop app hands it to the system). */
export async function openLink(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener');
}

/** Shortcuts that are not in the key map (Ctrl combinations and fixed keys). */
const OTHER_KEYS: [string, string][] = [
  ['Ctrl+N / Ctrl+O', 'New / Open'],
  ['Ctrl+S / Ctrl+Shift+S', 'Save / Save As'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['Ctrl+G', 'Make Group'],
  ['Delete', 'Erase the selection'],
  ['Esc', 'Cancel; clear the selection; close a group; leave an earlier version'],
  ['Page Down / Page Up', 'Next / previous scene'],
  ['Ctrl (tap)', 'Copy mode in Move and Rotate'],
  ['F1', 'This list'],
];

const MOUSE: [string, string][] = [
  ['Left button', 'The active tool'],
  ['Right-click', 'Menu for what is under the cursor'],
  ['Right-drag', 'Orbit'],
  ['Double right-click', 'Re-centre the view'],
  ['Middle-drag', 'Pan'],
  ['Wheel', 'Zoom toward the cursor'],
];

/** The keyboard and mouse reference (from the live key map, so it never goes out of date). */
export function showShortcuts(): void {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal shortcuts';
  const form = document.createElement('form');
  form.method = 'dialog';
  const h = document.createElement('h2');
  h.textContent = 'Keyboard and mouse';
  const table = (rows: [string, string][]) => {
    const t = document.createElement('table');
    for (const [key, what] of rows) {
      const tr = t.insertRow();
      const k = tr.insertCell();
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      k.append(kbd);
      tr.insertCell().textContent = what;
    }
    return t;
  };
  const keys: [string, string][] = KEY_BINDINGS.filter((b) => b.action.type !== 'unavailable').map((b) => [b.label, b.name]);
  const cols = document.createElement('div');
  cols.className = 'shortcut-columns';
  const half = Math.ceil(keys.length / 2);
  cols.append(table(keys.slice(0, half)), table(keys.slice(half)));
  const more = document.createElement('div');
  more.className = 'shortcut-columns';
  more.append(table(OTHER_KEYS), table(MOUSE));
  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  const ok = document.createElement('button');
  ok.type = 'submit';
  ok.className = 'primary';
  ok.textContent = 'Close';
  buttons.append(ok);
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'Every tool and command can also be found by name: press Shift+S and type.';
  form.append(h, cols, more, note, buttons);
  dlg.append(form);
  document.body.append(dlg);
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    close();
  });
  dlg.addEventListener('cancel', close);
  dlg.showModal();
}

/** The Help menu (toolbar "?" button). */
export function helpMenu(actions: { checkForUpdates(): void; about(): void }): MenuEntry[] {
  return [
    { label: 'Keyboard and Mouse', shortcut: 'F1', run: showShortcuts },
    { label: 'What’s New in This Version', run: () => void openLink(LINKS.releaseNotes) },
    { label: 'Check for Updates…', run: actions.checkForUpdates },
    'separator',
    { label: 'Report a Problem or Idea…', run: () => void openLink(LINKS.newIssue) },
    { label: 'VormCraft on GitHub', run: () => void openLink(LINKS.project) },
    'separator',
    { label: 'About VormCraft', run: actions.about },
  ];
}
