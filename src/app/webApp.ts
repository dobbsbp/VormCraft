import { confirmDialog, messageDialog, progressDialog } from './dialogs';
import { isTauri } from './files';
import { renderNotes } from './releaseNotes';

/**
 * The web version as an installed app: works offline (a service worker keeps this version's files
 * on the device; see scripts/offline.ts) and updates the way the desktop app does: a new version
 * downloads in the background, then the user is asked before switching to it.
 */
let registration: ServiceWorkerRegistration | null = null;

/** Whether this is the web version running in its own window (installed), not in a browser tab. */
export function installedWebApp(): boolean {
  return !isTauri() && typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
}

/** Start offline support (web version, built app only). */
export async function startOffline(): Promise<void> {
  if (isTauri() || import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  try {
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    // Ask the browser not to clear the app's storage (autosave copies) when space runs low.
    await navigator.storage?.persist?.();
  } catch {
    // No offline support (e.g. a private window): the app still works online.
  }
}

/** Wait until a new version that is downloading has finished, if one is. */
function installed(reg: ServiceWorkerRegistration): Promise<void> {
  const worker = reg.installing;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (worker.state === 'installed' || worker.state === 'redundant' || worker.state === 'activated') resolve();
    };
    worker.addEventListener('statechange', done);
    done();
  });
}

export interface WebUpdateHooks {
  /** Before switching: make sure no work is lost. */
  beforeInstall(): Promise<boolean>;
}

/**
 * Look for a newer web version. `quiet` (at startup): only speak up if there is one. A new
 * version is downloaded in the background; switching to it reloads the app.
 */
export async function checkWebUpdate(hooks: WebUpdateHooks, current: string, quiet: boolean): Promise<void> {
  const reg = registration;
  if (!reg) {
    if (!quiet) await messageDialog('Updates', 'This copy of VormCraft is not set up to update itself here. Reload the page to get the newest version.');
    return;
  }
  const progress = quiet ? null : progressDialog('Checking for updates', 'Looking for a newer version of VormCraft…');
  try {
    await reg.update();
    await installed(reg);
  } catch {
    progress?.close();
    if (!quiet) await messageDialog('Could not check for updates', 'The VormCraft website could not be reached. Check your internet connection and try again. (VormCraft keeps working offline.)');
    return;
  }
  progress?.close();
  const waiting = reg.waiting;
  if (!waiting) {
    if (!quiet) await messageDialog('You’re up to date', `VormCraft ${current} is the latest version.`);
    return;
  }
  let next = { version: 'A new version', notes: '' };
  try {
    next = await (await fetch('./version.json', { cache: 'no-store' })).json();
  } catch {
    // Offline after downloading: switch without notes.
  }
  const after = document.createElement('p');
  after.textContent = 'VormCraft will restart into the new version.';
  const ok = await confirmDialog(
    `VormCraft ${next.version} is available`,
    `You have ${current}.${next.notes ? ' What’s new:' : ''}`,
    'Restart now',
    'Later',
    [...(next.notes ? [renderNotes(next.notes)] : []), after],
  );
  if (!ok || !(await hooks.beforeInstall())) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage('switch-version');
}
