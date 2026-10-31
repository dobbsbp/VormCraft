import { confirmDialog, messageDialog, progressDialog } from './dialogs';
import { renderNotes } from './releaseNotes';
import { isTauri } from './files';

export const APP_VERSION = __APP_VERSION__;
const RELEASES = 'https://github.com/dobbsbp/VormCraft/releases';

export interface UpdateHooks {
  notify(message: string): void;
  /** Before installing: make sure no work is lost (save, or at least an autosave copy). */
  beforeInstall(): Promise<boolean>;
}

/** A plain-language reason the check failed. */
export function updateErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/404|valid release json|not found/i.test(text)) return 'No release has been published on GitHub yet.';
  if (/dns|connect|network|timed? ?out|offline|resolve|request/i.test(text)) return 'GitHub could not be reached. Check your internet connection and try again.';
  if (/signature/i.test(text)) return 'The update’s signature did not match, so it was not installed.';
  return text;
}

/**
 * Look for a newer version on GitHub (the desktop app's updater reads the latest release's
 * latest.json, and only installs downloads signed with our key). If there is one, show its notes
 * and offer to install and restart. `quiet` (at startup): say nothing unless there is an update;
 * otherwise the check shows a progress window and always says what it found.
 */
export async function checkForUpdates(hooks: UpdateHooks, quiet = false): Promise<void> {
  if (!isTauri()) {
    if (!quiet) await messageDialog('Updates', `Updates come with the desktop app. Download it from:\n${RELEASES}`);
    return;
  }
  let progress = quiet ? null : progressDialog('Checking for updates', 'Looking for a newer version of VormCraft on GitHub…');
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 30_000 });
    progress?.close();
    progress = null;
    if (!update) {
      if (!quiet) await messageDialog('You’re up to date', `VormCraft ${APP_VERSION} is the latest version.`);
      return;
    }
    const notes = (update.body ?? '').trim();
    const after = document.createElement('p');
    after.textContent = 'VormCraft will close, update and open again.';
    const install = await confirmDialog(
      `VormCraft ${update.version} is available`,
      `You have ${APP_VERSION}.${notes ? ' What’s new:' : ''}`,
      'Install and restart',
      'Later',
      [...(notes ? [renderNotes(notes)] : []), after],
    );
    if (!install || !(await hooks.beforeInstall())) return;
    progress = progressDialog(`Updating to ${update.version}`, 'Downloading…');
    let total = 0;
    let got = 0;
    await update.downloadAndInstall((e) => {
      if (e.event === 'Started') total = e.data.contentLength ?? 0;
      else if (e.event === 'Progress') {
        got += e.data.chunkLength;
        progress?.set(total ? `Downloading… ${Math.round((got / total) * 100)}%` : 'Downloading…');
      } else progress?.set('Installing… VormCraft will restart.');
    });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (err) {
    progress?.close();
    // At startup a failed check (offline, say) is not worth interrupting anyone for.
    if (!quiet) await messageDialog('Could not check for updates', updateErrorMessage(err));
  }
}
