import type { DriveFile } from './driveApi';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const size = (bytes?: string) => {
  const n = Number(bytes ?? 0);
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
};

/** Open from Google Drive: the designs in VormCraft's folder, newest first. Resolves to the one picked. */
export function showDriveOpenDialog(files: DriveFile[], account: string, folderUrl: string | null): Promise<DriveFile | null> {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal drive-open';
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Open from Google Drive</h2>
      <p class="note account"></p>
      <ul class="drive-files"></ul>
      <div class="buttons"><button type="button" value="cancel">Cancel</button><button type="submit" class="primary" disabled>Open</button></div>
    </form>`;
  const note = dlg.querySelector('.account')!;
  note.append(`${account} · the VormCraft folder`);
  if (folderUrl) {
    const a = document.createElement('a');
    a.href = folderUrl;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'Show in Google Drive';
    note.append(' · ', a);
  }
  const list = dlg.querySelector('ul')!;
  const open = dlg.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  let picked: DriveFile | null = null;
  if (files.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No designs here yet. Use “Save to Google Drive” to put one here.';
    list.append(li);
  }
  for (const f of files) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = f.name.replace(/\.(vorm|benup)$/i, '');
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${when(f.modifiedTime)} · ${size(f.size)}`;
    li.append(name, meta);
    const pick = () => {
      list.querySelectorAll('li').forEach((x) => x.classList.toggle('picked', x === li));
      picked = f;
      open.disabled = false;
    };
    li.addEventListener('click', pick);
    li.addEventListener('focus', pick);
    li.addEventListener('dblclick', () => finish(f));
    list.append(li);
  }
  document.body.append(dlg);
  let resolve!: (f: DriveFile | null) => void;
  const result = new Promise<DriveFile | null>((r) => (resolve = r));
  const finish = (f: DriveFile | null) => {
    dlg.close();
    dlg.remove();
    resolve(f);
  };
  dlg.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
  dlg.addEventListener('cancel', () => finish(null));
  dlg.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    if (picked) finish(picked);
  });
  dlg.showModal();
  return result;
}
