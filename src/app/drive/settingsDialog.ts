import type { SavedDevice } from '../preferences';

const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export type SettingsChoice = { load: string } | { delete: string } | null;

/**
 * Load settings from Google Drive: the devices whose settings are saved there, this one first.
 * Each can be loaded onto this device (to set up a new computer like another) or deleted.
 * Resolves to the choice, or null if cancelled.
 */
export function showLoadSettingsDialog(devices: Record<string, SavedDevice>, thisDevice: string): Promise<SettingsChoice> {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal drive-open';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Load settings from Google Drive</h2>
      <p class="note">Loading uses those settings on this device: sky and ground, tools, units for new designs, autosave and the rest. Things that belong to this device (its backup folder, window positions) stay as they are.</p>
      <ul class="drive-files"></ul>
      <div class="buttons"><button type="button" value="cancel">Cancel</button></div>
    </form>`;
  const list = dlg.querySelector('ul')!;
  let resolve!: (c: SettingsChoice) => void;
  const result = new Promise<SettingsChoice>((r) => (resolve = r));
  const finish = (c: SettingsChoice) => {
    dlg.close();
    dlg.remove();
    resolve(c);
  };
  const ids = Object.keys(devices).sort((a, b) => (a === thisDevice ? -1 : b === thisDevice ? 1 : devices[b].saved - devices[a].saved));
  if (!ids.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No settings saved yet. Use “Save This Device’s Settings” on a device first.';
    list.append(li);
  }
  for (const id of ids) {
    const d = devices[id];
    const li = document.createElement('li');
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: id === thisDevice ? `${d.name} (this device)` : d.name });
    const meta = Object.assign(document.createElement('span'), { className: 'meta', textContent: `Saved ${when(d.saved)}${d.app ? ` · VormCraft ${d.app}` : ''}` });
    const load = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Load', className: 'primary' });
    const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Delete', title: 'Delete these saved settings from Google Drive' });
    load.addEventListener('click', () => finish({ load: id }));
    remove.addEventListener('click', () => finish({ delete: id }));
    const actions = Object.assign(document.createElement('span'), { className: 'actions' });
    actions.append(load, remove);
    li.append(name, meta, actions);
    list.append(li);
  }
  document.body.append(dlg);
  dlg.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
  dlg.addEventListener('cancel', () => finish(null));
  dlg.showModal();
  return result;
}
