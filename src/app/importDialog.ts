import { meshBounds } from '../core/ops/importMesh';
import { UNIT_MM, type ImportUnit, type MeshObject } from '../io/meshFiles';

export interface ImportChoice {
  unit: ImportUnit;
  /** The file has Y pointing up (common for OBJ); turn it so Z is up. */
  yUp: boolean;
  /** Soften edges between faces at a shallow angle (curved surfaces look smooth). */
  smooth: boolean;
}

const UNIT_LABELS: Record<ImportUnit, string> = { mm: 'Millimetres', cm: 'Centimetres', m: 'Metres', in: 'Inches', ft: 'Feet' };
const KEY = 'vormcraft.import';

function remembered(ext: string): ImportChoice {
  // STL is usually millimetres with Z up; OBJ often comes from programs with Y up.
  const fallback: ImportChoice = { unit: 'mm', yUp: ext === 'obj', smooth: true };
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, ImportChoice>;
    return { ...fallback, ...all[ext] };
  } catch {
    return fallback;
  }
}

function remember(ext: string, c: ImportChoice): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    all[ext] = c;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not remembered: fine.
  }
}

const fmt = (mm: number) => (mm >= 10000 ? `${Math.round(mm / 10) / 100} m` : `${Math.round(mm * 10) / 10} mm`);

/**
 * Ask how to read a mesh file: its units (STL and OBJ files do not say), which way is up, and
 * whether to smooth curved surfaces. Shows the resulting size live, so the right unit is easy to
 * spot. Resolves to the choice, or null if cancelled.
 */
export function showImportDialog(fileName: string, objects: readonly MeshObject[]): Promise<ImportChoice | null> {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const start = remembered(ext);
  const polygons = objects.reduce((n, o) => n + o.polygons.length, 0);
  const b = meshBounds(objects.flatMap((o) => o.polygons));
  const size = b ? b.max.map((x, i) => x - b.min[i]) : [0, 0, 0];

  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p class="note summary"></p>
      <fieldset>
        <legend>Units in the file</legend>
        <label class="row">One unit in the file is <select name="unit">${(Object.keys(UNIT_LABELS) as ImportUnit[]).map((u) => `<option value="${u}">${UNIT_LABELS[u]}</option>`).join('')}</select></label>
        <p class="row size"></p>
      </fieldset>
      <fieldset>
        <legend>Orientation</legend>
        <label class="row"><input type="radio" name="up" value="z"> Z is up (most CAD programs, 3D printing)</label>
        <label class="row"><input type="radio" name="up" value="y"> Y is up (Blender, many games and scanners)</label>
      </fieldset>
      <label class="row"><input type="checkbox" name="smooth"> Smooth curved surfaces (hide the edges between gently angled faces)</label>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary">Import</button>
      </div>
    </form>`;
  dlg.querySelector('h2')!.textContent = `Import ${fileName.split(/[\\/]/).pop()}`;
  dlg.querySelector('.summary')!.textContent = `${polygons.toLocaleString()} polygons in ${objects.length} object${objects.length === 1 ? '' : 's'}. Each object becomes a group; flat areas become single faces.`;
  const form = dlg.querySelector('form')!;
  const unit = form.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  const smooth = form.querySelector<HTMLInputElement>('input[name="smooth"]')!;
  unit.value = start.unit;
  smooth.checked = start.smooth;
  form.querySelector<HTMLInputElement>(`input[name="up"][value="${start.yUp ? 'y' : 'z'}"]`)!.checked = true;
  const yUp = () => form.querySelector<HTMLInputElement>('input[name="up"]:checked')?.value === 'y';
  const showSize = () => {
    const k = UNIT_MM[unit.value as ImportUnit];
    const [w, d, h] = yUp() ? [size[0], size[2], size[1]] : size;
    dlg.querySelector('.size')!.textContent = `Size: ${fmt(w * k)} × ${fmt(d * k)} × ${fmt(h * k)} (width × depth × height)`;
  };
  unit.addEventListener('change', showSize);
  form.querySelectorAll('input[name="up"]').forEach((r) => r.addEventListener('change', showSize));
  showSize();
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: ImportChoice | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const choice: ImportChoice = { unit: unit.value as ImportUnit, yUp: yUp(), smooth: smooth.checked };
      remember(ext, choice);
      finish(choice);
    });
    dlg.showModal();
  });
}
