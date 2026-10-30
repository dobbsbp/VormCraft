import type { WatertightReport } from '../core/check/watertight';

export interface ExportChoice {
  maxDeviation: number | undefined;
  allowOpen: boolean;
}

const PRESETS: { id: string; label: string; value: number | undefined }[] = [
  { id: 'model', label: 'As modelled', value: undefined },
  { id: 'normal', label: 'Normal (0.05 mm)', value: 0.05 },
  { id: 'fine', label: 'Fine (0.01 mm)', value: 0.01 },
];
const STORAGE_KEY = 'vormcraft.export.resolution';

function remembered(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'normal';
  } catch {
    return 'normal';
  }
}

function remember(v: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // Not available (private window etc.): just don't remember.
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Ask for export settings. STL requires a watertight model unless "Export anyway" is ticked. */
export function showExportDialog(format: 'STL' | 'OBJ', report: WatertightReport): Promise<ExportChoice | null> {
  const requiresClosed = format === 'STL';
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  const status = report.watertight
    ? `<p class="check ok">Watertight solid · ${plural(report.shells, 'shell')}${report.genus ? ` · ${plural(report.genus, 'through-hole')}` : ''}</p>`
    : `<p class="check bad">${
        report.shells === 0
          ? 'The model is empty.'
          : `Not watertight: ${[report.openEdges.length ? plural(report.openEdges.length, 'open edge') : '', report.degenerateFaces.length ? plural(report.degenerateFaces.length, 'zero-area face') : ''].filter(Boolean).join(', ')}.`
      }${requiresClosed ? ' 3D printers and slicers need a closed solid.' : ''}</p>`;
  const choice = remembered();
  dlg.innerHTML = `
    <form method="dialog">
      <h2>Export ${format}</h2>
      ${status}
      ${requiresClosed && !report.watertight && report.shells > 0 ? '<label class="row"><input type="checkbox" name="anyway"> Export anyway</label>' : ''}
      <fieldset>
        <legend>Curve resolution</legend>
        ${PRESETS.map((p) => `<label class="row"><input type="radio" name="res" value="${p.id}" ${choice === p.id ? 'checked' : ''}> ${p.label}</label>`).join('')}
        <label class="row"><input type="radio" name="res" value="custom" ${choice.startsWith('custom') ? 'checked' : ''}> Custom
          <input type="number" name="custom" min="0.0001" step="0.001" value="${choice.startsWith('custom:') ? choice.slice(7) : '0.02'}"> mm</label>
        <p class="note">Maximum distance between the true curves and the exported triangles.</p>
      </fieldset>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="export" class="primary">Export</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form')!;
  const exportButton = form.querySelector<HTMLButtonElement>('button[value="export"]')!;
  const anyway = form.querySelector<HTMLInputElement>('input[name="anyway"]');
  const update = () => {
    exportButton.disabled = requiresClosed && !report.watertight && !anyway?.checked;
  };
  anyway?.addEventListener('change', update);
  update();

  return new Promise((resolve) => {
    const finish = (value: ExportChoice | null) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const res = String(data.get('res') ?? 'normal');
      let maxDeviation = PRESETS.find((p) => p.id === res)?.value;
      if (res === 'custom') {
        const v = Number(data.get('custom'));
        if (!(v > 0)) return;
        maxDeviation = v;
        remember(`custom:${v}`);
      } else remember(res);
      finish({ maxDeviation, allowOpen: !!anyway?.checked });
    });
    dlg.showModal();
  });
}

/** A small modal question (our own, not window.confirm). Resolves true for the confirming button. */
export function confirmDialog(title: string, message: string, confirmLabel: string, cancelLabel = 'Cancel'): Promise<boolean> {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p></p>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary"></button>
      </div>
    </form>`;
  dlg.querySelector('h2')!.textContent = title;
  dlg.querySelector('p')!.textContent = message;
  dlg.querySelector('button[value="ok"]')!.textContent = confirmLabel;
  dlg.querySelector('button[value="cancel"]')!.textContent = cancelLabel;
  dlg.querySelector('p')!.classList.add('pre');
  document.body.append(dlg);
  return new Promise((resolve) => {
    const finish = (v: boolean) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(false));
    dlg.addEventListener('cancel', () => finish(false));
    dlg.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(true);
    });
    dlg.showModal();
  });
}

/** A message with a single OK button. `body` may hold a few lines (shown as written). */
export function messageDialog(title: string, body: string): Promise<void> {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p class="pre"></p>
      <div class="buttons"><button type="submit" class="primary">OK</button></div>
    </form>`;
  dlg.querySelector('h2')!.textContent = title;
  dlg.querySelector('p')!.textContent = body;
  document.body.append(dlg);
  return new Promise((resolve) => {
    const finish = () => {
      dlg.close();
      dlg.remove();
      resolve();
    };
    dlg.addEventListener('cancel', finish);
    dlg.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      finish();
    });
    dlg.showModal();
  });
}
