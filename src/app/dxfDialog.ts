import { DEFAULT_CURVE_DETAIL, type CurveDetail } from '../core/ops/drawingCurves';
import type { DxfDrawing } from '../io/dxfFile';
import { countSegments, defaultLayers, drawingBounds, type DxfChoice } from '../io/dxfImport';
import { UNIT_MM, type ImportUnit } from '../io/meshFiles';

const UNIT_LABELS: Record<ImportUnit, string> = { mm: 'Millimetres', cm: 'Centimetres', m: 'Metres', in: 'Inches', ft: 'Feet' };
const KEY = 'vormcraft.import.dxf';

interface Remembered {
  unit: ImportUnit;
  detail: CurveDetail;
  faces: boolean;
}

function remembered(): Remembered {
  const fallback: Remembered = { unit: 'mm', detail: DEFAULT_CURVE_DETAIL, faces: true };
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Remembered>;
    return { ...fallback, ...r, detail: { ...fallback.detail, ...r.detail } };
  } catch {
    return fallback;
  }
}

function remember(r: Remembered): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Not remembered: fine.
  }
}

const fmt = (mm: number) => (mm >= 10000 ? `${Math.round(mm / 10) / 100} m` : `${Math.round(mm * 10) / 10} mm`);
const n = (x: number) => x.toLocaleString();
const count = (x: number, one: string, many: string) => `${n(x)} ${x === 1 ? one : many}`;

/**
 * What a DXF drawing holds and how to bring it in: its units (from the file when it says), how
 * finely curves become segments (with a live count), whether closed outlines become faces, and
 * which layers. Resolves to the choice, or null if cancelled.
 */
export function showDxfDialog(fileName: string, d: DxfDrawing): Promise<DxfChoice | null> {
  const start = remembered();
  const kinds = { path: 0, conic: 0, spline: 0 };
  for (const c of d.curves) kinds[c.curve.kind]++;
  const dlg = document.createElement('dialog');
  dlg.className = 'modal dxf-import';
  dlg.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p class="note summary pre"></p>
      <fieldset>
        <legend>Units in the file</legend>
        <label class="row">One unit in the file is <select name="unit">${(Object.keys(UNIT_LABELS) as ImportUnit[]).map((u) => `<option value="${u}">${UNIT_LABELS[u]}</option>`).join('')}</select></label>
        <p class="row note said"></p>
        <p class="row size"></p>
      </fieldset>
      <fieldset>
        <legend>Curves</legend>
        <label class="row"><input type="number" name="segments" min="3" max="720" step="1"> segments for a full circle (arcs get their share)</label>
        <label class="row"><input type="number" name="tolerance" min="0.001" max="100" step="any"> mm: the largest gap between other curves and their lines</label>
        <label class="row"><input type="checkbox" name="arcs"> Find arcs and circles drawn as splines (they become true circles)</label>
        <p class="row note count"></p>
      </fieldset>
      <label class="row"><input type="checkbox" name="faces"> Make faces where outlines close, so shapes can be pushed and pulled</label>
      <fieldset class="layers">
        <legend>Layers</legend>
        <div class="layer-list"></div>
      </fieldset>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary">Import</button>
      </div>
    </form>`;
  dlg.querySelector('h2')!.textContent = `Import ${fileName.split(/[\\/]/).pop()}`;
  const left = [...d.skipped].map(([what, count]) => `${n(count)} ${what}`);
  dlg.querySelector('.summary')!.textContent = [
    `${count(d.curves.length, 'line or curve', 'lines and curves')} (${count(kinds.conic, 'arc, circle or ellipse', 'arcs, circles and ellipses')}, ${count(kinds.spline, 'spline', 'splines')}), ${count(d.texts.length, 'text', 'texts')}, ${count(d.dimensions.length, 'dimension', 'dimensions')}${d.faces.length ? `, ${count(d.faces.length, '3D face', '3D faces')}` : ''}.`,
    'The drawing comes in as a group, with a group for each layer; texts and dimensions become labels.',
    ...(left.length ? [`Left out: ${left.join(', ')}.`] : []),
  ].join('\n');

  const form = dlg.querySelector('form')!;
  const unit = form.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  const input = (name: string) => form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  unit.value = d.units ?? start.unit;
  dlg.querySelector('.said')!.textContent = d.units ? `The file says ${UNIT_LABELS[d.units].toLowerCase()}.` : 'The file does not say; check the size below.';
  input('segments').value = String(start.detail.circleSegments);
  input('tolerance').value = String(start.detail.tolerance);
  input('arcs').checked = start.detail.arcs;
  input('faces').checked = start.faces;

  const on = new Set(defaultLayers(d));
  const list = dlg.querySelector('.layer-list')!;
  for (const l of d.layers) {
    const row = document.createElement('label');
    row.className = 'row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = on.has(l.name);
    box.dataset.layer = l.name;
    row.append(box, ` ${l.name} `);
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = `${n(l.count)}${l.off ? ', off in the file' : /hidden/i.test(l.name) ? ', hidden lines' : ''}`;
    row.append(note);
    list.append(row);
  }
  const layers = () => Array.from(list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter((b) => b.checked).map((b) => b.dataset.layer!);
  const detail = (): CurveDetail => ({
    circleSegments: Math.min(720, Math.max(3, Math.round(Number(input('segments').value) || DEFAULT_CURVE_DETAIL.circleSegments))),
    tolerance: Math.min(100, Math.max(0.001, Number(input('tolerance').value) || DEFAULT_CURVE_DETAIL.tolerance)),
    arcs: input('arcs').checked,
  });

  const showSize = () => {
    const b = drawingBounds(d, layers());
    const k = UNIT_MM[unit.value as ImportUnit];
    dlg.querySelector('.size')!.textContent = b ? `Size: ${[0, 1, 2].map((i) => fmt((b.max[i] - b.min[i]) * k)).join(' × ')} (width × depth × height)` : 'No layers chosen.';
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const showCount = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const segs = countSegments(d, { unit: unit.value as ImportUnit, detail: detail(), layers: layers() });
      dlg.querySelector('.count')!.textContent = `About ${n(segs)} edges.`;
    }, 120);
  };
  const update = () => {
    showSize();
    showCount();
  };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: DxfChoice | null) => {
      clearTimeout(timer);
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const choice: DxfChoice = { unit: unit.value as ImportUnit, detail: detail(), faces: input('faces').checked, layers: layers() };
      remember({ unit: choice.unit, detail: choice.detail, faces: choice.faces });
      finish(choice);
    });
    dlg.showModal();
  });
}
