import { DEFAULT_UNITS, UNIT_CHOICES, validUnits, type DisplayUnits, type LengthUnit } from '../doc/Units';
import { formatLength } from '../tools/units';

const KEY = 'vormcraft.units.default';

/** The units new designs start with on this device: the last ones chosen for a new design. */
export function defaultUnits(): DisplayUnits {
  try {
    return validUnits(JSON.parse(localStorage.getItem(KEY) ?? 'null')) ?? DEFAULT_UNITS;
  } catch {
    return DEFAULT_UNITS;
  }
}

export function rememberDefaultUnits(units: DisplayUnits): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(units));
  } catch {
    // Not remembered.
  }
}

/**
 * Ask for a design's units and precision, with an example of how lengths will look. Used for a
 * new design (`okLabel` "Create") and for Design Properties. Resolves to the choice, or null if
 * cancelled.
 */
export function showUnitsDialog(title: string, start: DisplayUnits, okLabel: string, note: string): Promise<DisplayUnits | null> {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form method="dialog">
      <h2></h2>
      <p class="note"></p>
      <label class="row">Units <select name="unit">${UNIT_CHOICES.map((c) => `<option value="${c.unit}">${c.label}</option>`).join('')}</select></label>
      <label class="row">Show lengths to <select name="precision"></select></label>
      <p class="note example"></p>
      <div class="buttons">
        <button type="button" value="cancel">Cancel</button>
        <button type="submit" value="ok" class="primary" autofocus></button>
      </div>
    </form>`;
  dlg.querySelector('h2')!.textContent = title;
  dlg.querySelector('p.note')!.textContent = note;
  dlg.querySelector('button[value="ok"]')!.textContent = okLabel;
  const form = dlg.querySelector('form')!;
  const unit = form.querySelector<HTMLSelectElement>('select[name="unit"]')!;
  const precision = form.querySelector<HTMLSelectElement>('select[name="precision"]')!;
  const example = form.querySelector<HTMLElement>('.example')!;
  const choice = (): DisplayUnits => ({ unit: unit.value as LengthUnit, precision: Number(precision.value) });
  const showExample = () => {
    example.textContent = `A 1.25 m line shows as ${formatLength(1250, choice())}; one 3 in long as ${formatLength(76.2, choice())}.`;
  };
  const fillPrecisions = (value: number) => {
    const c = UNIT_CHOICES.find((x) => x.unit === unit.value)!;
    precision.innerHTML = c.precisions.map((p) => `<option value="${p.value}">${p.label}</option>`).join('');
    precision.value = String(c.precisions.some((p) => p.value === value) ? value : c.precision);
    showExample();
  };
  unit.value = start.unit;
  fillPrecisions(start.precision);
  unit.addEventListener('change', () => fillPrecisions(UNIT_CHOICES.find((x) => x.unit === unit.value)!.precision));
  precision.addEventListener('change', showExample);
  document.body.append(dlg);

  return new Promise((resolve) => {
    const finish = (v: DisplayUnits | null) => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    form.querySelector('button[value="cancel"]')!.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(choice());
    });
    dlg.showModal();
  });
}
