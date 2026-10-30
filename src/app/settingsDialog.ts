import { isTauri } from './files';
import { cleanSettings, DEFAULT_SETTINGS, type Settings } from './settings';

export interface SettingsContext {
  /** Where backups go now (shown when the folder is the default). */
  defaultFolder: string;
  /** The app version, e.g. "0.2.0". */
  version: string;
  /** "Check now" for updates. */
  checkForUpdates: () => void;
}

/** The Settings dialog. Resolves to the new settings, or null if cancelled. */
export function showSettingsDialog(current: Settings, ctx: SettingsContext): Promise<Settings | null> {
  const desktop = isTauri();
  const dlg = document.createElement('dialog');
  dlg.className = 'modal settings';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Settings</h2>
      <fieldset>
        <legend>Autosave</legend>
        <label class="row"><input type="checkbox" name="autosave"> Autosave every <input type="number" name="minutes" min="0.5" max="60" step="0.5"> minutes when something changed</label>
        <label class="row stack">Backup folder
          <span class="folder"><input type="text" name="folder" readonly><button type="button" value="browse">Browse…</button><button type="button" value="default">Default</button></span>
        </label>
        <label class="row">Delete backups that were never recovered after <input type="number" name="days" min="1" max="365" step="1"> days</label>
        <p class="note">Autosave never changes your own file: it keeps a recovery copy in the backup folder, offered back if VormCraft closes without saving.</p>
      </fieldset>
      <fieldset>
        <legend>History</legend>
        <label class="row"><input type="checkbox" name="history"> Keep a version history in each design, up to <input type="number" name="limit" min="1" max="1000" step="1"> MB</label>
        <p class="note">Versions are kept each time the design is autosaved or saved, compressed, in the .vorm file. Older ones are thinned out (all of the last day, then one an hour, then one a day). Use History to go back to one; use “Save a Copy Without History” to share a design without it.</p>
      </fieldset>
      <fieldset>
        <legend>Updates</legend>
        <label class="row"><input type="checkbox" name="updates"> Check for a newer version when VormCraft starts</label>
        <p class="row note">This is VormCraft <span class="version"></span>. <button type="button" value="check">Check now</button></p>
      </fieldset>
      <div class="buttons">
        <button type="button" value="reset">Defaults</button>
        <span class="spacer"></span>
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary">Save</button>
      </div>
    </form>`;
  const form = dlg.querySelector('form')!;
  const input = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  let folder = current.backupFolder;
  const fill = (s: Settings) => {
    input('autosave').checked = s.autosave;
    input('minutes').value = String(s.autosaveMinutes);
    input('days').value = String(s.keepBackupDays);
    input('history').checked = s.history;
    input('limit').value = String(s.historyLimitMB);
    input('updates').checked = s.checkUpdates;
    folder = s.backupFolder;
    input('folder').value = folder ?? `${ctx.defaultFolder} (default)`;
  };
  fill(current);
  dlg.querySelector('.version')!.textContent = ctx.version;
  const browse = form.querySelector<HTMLButtonElement>('button[value="browse"]')!;
  const useDefault = form.querySelector<HTMLButtonElement>('button[value="default"]')!;
  browse.disabled = useDefault.disabled = !desktop;
  browse.addEventListener('click', async () => {
    const dialog = await import('@tauri-apps/plugin-dialog');
    const picked = await dialog.open({ directory: true, multiple: false, defaultPath: folder ?? undefined, title: 'Folder for autosaved backups' });
    if (typeof picked === 'string') {
      folder = picked;
      input('folder').value = picked;
    }
  });
  useDefault.addEventListener('click', () => {
    folder = null;
    input('folder').value = `${ctx.defaultFolder} (default)`;
  });
  form.querySelector('button[value="check"]')!.addEventListener('click', () => ctx.checkForUpdates());
  form.querySelector('button[value="reset"]')!.addEventListener('click', () => fill(DEFAULT_SETTINGS));
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: Settings | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(
        cleanSettings({
          autosave: input('autosave').checked,
          autosaveMinutes: Number(input('minutes').value),
          backupFolder: folder,
          keepBackupDays: Number(input('days').value),
          history: input('history').checked,
          historyLimitMB: Number(input('limit').value),
          checkUpdates: input('updates').checked,
        }),
      );
    });
    dlg.showModal();
  });
}
