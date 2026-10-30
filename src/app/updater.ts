import { confirmDialog } from './dialogs';
import { isTauri } from './files';

export const APP_VERSION = __APP_VERSION__;
const RELEASES = 'https://github.com/dobbsbp/VormCraft/releases';

export interface UpdateHooks {
  notify(message: string): void;
  /** Before installing: make sure no work is lost (save, or at least an autosave copy). */
  beforeInstall(): Promise<boolean>;
}

/**
 * Look for a newer version on GitHub (the desktop app's updater reads the latest release's
 * latest.json, and only installs downloads signed with our key). If there is one, show its notes
 * and offer to install and restart. `quiet`: say nothing unless there is an update (startup).
 */
export async function checkForUpdates(hooks: UpdateHooks, quiet = false): Promise<void> {
  if (!isTauri()) {
    if (!quiet) hooks.notify(`Updates come with the desktop app: download it from ${RELEASES}`);
    return;
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      if (!quiet) hooks.notify(`VormCraft ${APP_VERSION} is the latest version.`);
      return;
    }
    const notes = (update.body ?? '').trim();
    const install = await confirmDialog(
      `VormCraft ${update.version} is available`,
      `You have ${APP_VERSION}.${notes ? `\n\nWhat's new:\n${notes}` : ''}\n\nVormCraft will close, update and open again.`,
      'Install and restart',
    );
    if (!install || !(await hooks.beforeInstall())) return;
    let total = 0;
    let got = 0;
    await update.downloadAndInstall((e) => {
      if (e.event === 'Started') total = e.data.contentLength ?? 0;
      else if (e.event === 'Progress') {
        got += e.data.chunkLength;
        hooks.notify(total ? `Downloading update… ${Math.round((got / total) * 100)}%` : 'Downloading update…');
      } else hooks.notify('Installing update…');
    });
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (err) {
    if (!quiet) hooks.notify(`Could not check for updates: ${err instanceof Error ? err.message : String(err)}`);
  }
}
