import { isTauri } from './files';
import { GRAPHICS_LABELS, type GraphicsChoice } from './graphics';
import { cleanSettings, DEFAULT_SETTINGS, type Settings } from './settings';

export interface SettingsContext {
  /** Where backups go now (shown when the folder is the default). */
  defaultFolder: string;
  /** The app version, e.g. "0.2.0". */
  version: string;
  /** "Check now" for updates. */
  checkForUpdates: () => void;
  /** The graphics card choice (null where it cannot be chosen: the web version). */
  graphics: GraphicsChoice | null;
  /** The graphics card in use now (for showing). */
  graphicsInUse: string;
}

export interface SettingsResult {
  settings: Settings;
  graphics: GraphicsChoice | null;
}

/** The Settings dialog. Resolves to the new settings (and graphics choice), or null if cancelled. */
export function showSettingsDialog(current: Settings, ctx: SettingsContext): Promise<SettingsResult | null> {
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
      <fieldset class="graphics">
        <legend>Graphics card</legend>
        ${(Object.keys(GRAPHICS_LABELS) as GraphicsChoice[]).map((g) => `<label class="row"><input type="radio" name="graphics" value="${g}"> ${GRAPHICS_LABELS[g]}</label>`).join('')}
        <p class="note">In use now: <span class="gpu"></span>. A change takes effect when VormCraft restarts.</p>
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
  dlg.querySelector('.gpu')!.textContent = ctx.graphicsInUse;
  const graphicsBox = dlg.querySelector<HTMLFieldSetElement>('fieldset.graphics')!;
  if (ctx.graphics === null) {
    // The web version: the browser picks the graphics card.
    graphicsBox.querySelectorAll('label').forEach((l) => l.remove());
    graphicsBox.querySelector('.note')!.append(' In the web version the browser chooses the graphics card.');
  }
  const setGraphics = (g: GraphicsChoice | null) => {
    graphicsBox.querySelectorAll<HTMLInputElement>('input[name="graphics"]').forEach((r) => (r.checked = r.value === g));
  };
  setGraphics(ctx.graphics);
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
  form.querySelector('button[value="reset"]')!.addEventListener('click', () => {
    fill(DEFAULT_SETTINGS);
    if (ctx.graphics !== null) setGraphics('high');
  });
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: SettingsResult | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = graphicsBox.querySelector<HTMLInputElement>('input[name="graphics"]:checked');
      finish({
        graphics: ctx.graphics === null ? null : ((picked?.value as GraphicsChoice | undefined) ?? ctx.graphics),
        settings: cleanSettings({
          autosave: input('autosave').checked,
          autosaveMinutes: Number(input('minutes').value),
          backupFolder: folder,
          keepBackupDays: Number(input('days').value),
          history: input('history').checked,
          historyLimitMB: Number(input('limit').value),
          checkUpdates: input('updates').checked,
        }),
      });
    });
    dlg.showModal();
  });
}
