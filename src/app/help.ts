import type { MenuEntry } from '../tools/contextMenu';
import { isTauri } from './files';
import { KEY_BINDINGS } from './keymap';
import { APP_VERSION } from './updater';

export const LINKS = {
  project: 'https://github.com/dobbsbp/VormCraft',
  releaseNotes: `https://github.com/dobbsbp/VormCraft/releases/tag/v${APP_VERSION}`,
  newIssue: 'https://github.com/dobbsbp/VormCraft/issues/new',
  /** Donations (GitHub Sponsors). */
  support: 'https://github.com/sponsors/dobbsbp',
  /** The newest desktop app (the Windows installer and the Linux AppImages). */
  windowsApp: 'https://github.com/dobbsbp/VormCraft/releases/latest',
  /** The pages around the app (public/about, public/privacy, public/terms). */
  about: 'https://vormcraft.app/about/',
  privacy: 'https://vormcraft.app/privacy/',
  terms: 'https://vormcraft.app/terms/',
  contact: 'mailto:info@vormcraft.app',
};

/** Open a web page in the user's browser (the desktop app hands it to the system). */
export async function openLink(url: string): Promise<void> {
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank', 'noopener');
}

/**
 * A link to show in a window (About): web pages open in a new tab, an e-mail address in the mail
 * program; the desktop app hands both to the system, as `openLink` does.
 */
export function linkTo(url: string, text = url.replace(/^(https:\/\/|mailto:)/, '').replace(/\/$/, '')): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = url;
  a.textContent = text;
  if (url.startsWith('https:')) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  if (isTauri())
    a.addEventListener('click', (e) => {
      e.preventDefault();
      void openLink(url);
    });
  return a;
}

/** Shortcuts that are not in the key map (Ctrl combinations and fixed keys). */
const OTHER_KEYS: [string, string][] = [
  ['Ctrl+N / Ctrl+O', 'New / Open'],
  ['Ctrl+S / Ctrl+Shift+S', 'Save / Save As'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
  ['Ctrl+A', 'Select everything in the model'],
  ['Ctrl+G', 'Make Group'],
  ['Ctrl+H / Ctrl+Shift+H', 'Hide the selected lines or groups / Unhide all'],
  ['Delete', 'Erase the selection'],
  ['Esc', 'Cancel; clear the selection; close a group; leave an earlier version'],
  ['Page Down / Page Up', 'Next / previous scene'],
  ['Ctrl', 'Copy in Move and Rotate; new starting face in Push/Pull (+ on the cursor)'],
  ['F1', 'This list'],
];

const MOUSE: [string, string][] = [
  ['Left button', 'The active tool'],
  ['Middle-drag', 'Orbit'],
  ['Right-drag', 'Pan'],
  ['Right-click', 'Menu for what is under the cursor'],
  ['Double-click / triple-click', 'A face with its edges / everything joined to the line or face'],
  ['Double middle-click', 'Re-centre the view'],
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
export function helpMenu(actions: { checkForUpdates(): void; about(): void; support(): void }): MenuEntry[] {
  return [
    { label: 'Keyboard and Mouse', shortcut: 'F1', run: showShortcuts },
    { label: 'What’s New in This Version', run: () => void openLink(LINKS.releaseNotes) },
    { label: 'Check for Updates…', run: actions.checkForUpdates },
    'separator',
    { label: 'Report a Problem or Idea…', run: () => void openLink(LINKS.newIssue) },
    { label: 'VormCraft on GitHub', run: () => void openLink(LINKS.project) },
    { label: 'Support VormCraft ♥', run: actions.support },
    'separator',
    { label: 'Privacy Policy', run: () => void openLink(LINKS.privacy) },
    { label: 'Terms of Use', run: () => void openLink(LINKS.terms) },
    { label: 'About VormCraft', run: actions.about },
  ];
}
