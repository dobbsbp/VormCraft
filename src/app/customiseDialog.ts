import { modelBounds } from '../core/ops/group';
import type { LibraryItem, LibraryParam, LibraryPart } from '../library';
import { activeUnits, formatLength, formatLengths, parseLength } from '../tools/units';
import { renderThumbnail } from '../view/thumbnails';

type LibraryModule = typeof import('../library');

export interface CustomisedItem {
  variant: string | undefined;
  values: Record<string, number>;
  parts: LibraryPart[];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

/**
 * The text a setting's field starts with. Lengths show finer than the design's precision, so a
 * 0.5 mm gap in centimetres reads 0.05 cm, not 0.1 cm.
 */
function fieldText(p: LibraryParam, v: number): string {
  if (p.kind === 'length') {
    const units = activeUnits();
    return formatLength(v, { ...units, precision: units.unit === 'ftin' ? 64 : 3 });
  }
  if (p.kind === 'angle') return `${v}°`;
  return String(v);
}

/** What a field says, as a value, or a sentence saying what to type. */
function readField(p: LibraryParam, input: HTMLInputElement | HTMLSelectElement): number | string {
  if (p.kind === 'toggle') return (input as HTMLInputElement).checked ? 1 : 0;
  if (p.kind === 'choice') return Number(input.value);
  // Left as filled in: the exact value, not the rounded text.
  if (input.dataset.text === input.value && input.dataset.value) return Number(input.dataset.value);
  const text = input.value.trim();
  const v = p.kind === 'length' ? parseLength(text) : Number(text.replace(/°|deg/gi, '').trim());
  const show = (x: number) => (p.kind === 'length' ? formatLength(x) : p.kind === 'angle' ? `${x}°` : String(x));
  const range = p.min !== undefined && p.max !== undefined ? ` between ${show(p.min)} and ${show(p.max)}` : '';
  if (v === undefined || !Number.isFinite(v) || text === '') return `${p.name}: type a ${p.kind === 'length' ? 'length' : 'number'}${range}`;
  if (p.kind === 'count' && !Number.isInteger(v)) return `${p.name}: type a whole number${range}`;
  if ((p.min !== undefined && v < p.min - 1e-9) || (p.max !== undefined && v > p.max + 1e-9)) return `${p.name} must be${range}`;
  return v;
}

/**
 * Customise a Library item before placing it: a field per setting (lengths in the design's
 * units), with a picture and the overall size that follow what is typed. Resolves to the chosen
 * size and settings with the parts built from them, or null if cancelled.
 */
export function showCustomiseDialog(lib: LibraryModule, item: LibraryItem, variant: string | undefined, start: Record<string, number> | undefined): Promise<CustomisedItem | null> {
  const params = item.params ?? [];
  let current = variant;
  const dlg = el('dialog', { className: 'modal customise' });
  const form = el('form', { method: 'dialog' });
  const picture = el('img', { className: 'customise-picture', alt: '', width: 200, height: 200 });
  const sizeLine = el('p', { className: 'note customise-size' });
  const error = el('p', { className: 'note error' });
  error.hidden = true;
  const place = el('button', { type: 'submit', className: 'primary' }, 'Place');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const reset = el('button', { type: 'button', title: 'Put every setting back to how this size starts' }, 'Reset');

  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const rows = new Map<string, HTMLElement>();
  const fill = (values: Record<string, number>) => {
    for (const p of params) {
      const input = inputs.get(p.id)!;
      if (p.kind === 'toggle') (input as HTMLInputElement).checked = values[p.id] === 1;
      else if (p.kind === 'choice') input.value = String(values[p.id]);
      else {
        input.value = input.dataset.text = fieldText(p, values[p.id]);
        input.dataset.value = String(values[p.id]);
      }
    }
  };

  const fields = el('div', { className: 'customise-fields' });
  for (const p of params) {
    let input: HTMLInputElement | HTMLSelectElement;
    if (p.kind === 'choice') input = el('select', {}, ...(p.choices ?? []).map((c, i) => el('option', { value: String(i) }, c)));
    else if (p.kind === 'toggle') input = el('input', { type: 'checkbox' });
    else input = el('input', { type: 'text', size: 9, spellcheck: false });
    input.name = p.id;
    inputs.set(p.id, input);
    const row =
      p.kind === 'toggle'
        ? el('label', { className: 'customise-row toggle' }, input, el('span', {}, p.name))
        : el('label', { className: 'customise-row' }, el('span', {}, p.name), input);
    const wrap = el('div', { className: 'customise-field' }, row);
    if (p.note) wrap.append(el('span', { className: 'note' }, p.note));
    rows.set(p.id, wrap);
    fields.append(wrap);
  }

  const head: Node[] = [el('h2', {}, `Customise: ${item.name}`)];
  if (item.variants?.length) {
    const sizes = el('select', { ariaLabel: 'Start from a size' }, ...item.variants.map((v) => el('option', { value: v.id }, v.name)));
    sizes.value = current ?? item.variants[0].id;
    sizes.addEventListener('change', () => {
      current = sizes.value;
      fill(lib.presetValues(item, current));
      update();
    });
    head.push(el('label', { className: 'customise-row' }, el('span', {}, 'Start from'), sizes));
  }
  form.append(
    ...head,
    el('div', { className: 'customise-body' }, el('div', { className: 'customise-preview' }, picture, sizeLine), fields),
    error,
    el('div', { className: 'buttons' }, reset, el('span', { className: 'spacer' }), cancel, place),
  );
  dlg.append(form);
  fill(lib.paramValues(item, current, start));

  let built: CustomisedItem | null = null;
  /** Read the fields, show and hide what applies, and build the item for the picture. */
  const update = () => {
    const values = lib.presetValues(item, current);
    const problems: { param: (typeof params)[number]; message: string }[] = [];
    for (const p of params) {
      const v = readField(p, inputs.get(p.id)!);
      if (typeof v === 'number') values[p.id] = v;
      else problems.push({ param: p, message: v });
    }
    for (const p of params) rows.get(p.id)!.hidden = !lib.paramShown(p, values);
    // A hidden field's problem does not count: it is not used.
    const shownProblems = problems.filter((e) => lib.paramShown(e.param, values)).map((e) => e.message);
    built = null;
    if (!shownProblems.length) {
      try {
        built = { variant: current, values: lib.paramValues(item, current, values), parts: item.build(current, values) };
      } catch (err) {
        shownProblems.push(err instanceof Error ? err.message : String(err));
      }
    }
    error.textContent = shownProblems.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(' ');
    error.hidden = !shownProblems.length;
    place.disabled = !built;
    if (!built) return;
    const b = modelBounds(built.parts.map((p) => p.model));
    sizeLine.textContent = b ? `${formatLengths([0, 1, 2].map((i) => Math.round((b.max[i] - b.min[i]) * 10) / 10), ' × ')} (width × depth × height)` : '';
    const url = renderThumbnail(
      built.parts.map((p) => {
        const f = lib.paintFields(p);
        return { model: p.model, color: f.color, opacity: f.opacity };
      }),
      200,
    );
    if (url) picture.src = url;
  };
  // Building takes a moment: wait for a pause in typing.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  };
  form.addEventListener('input', later);
  form.addEventListener('change', later);

  document.body.append(dlg);
  return new Promise((resolve) => {
    const finish = (v: CustomisedItem | null) => {
      clearTimeout(timer);
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    cancel.addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', () => finish(null));
    reset.addEventListener('click', () => {
      fill(lib.presetValues(item, current));
      update();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      clearTimeout(timer);
      update();
      if (built) finish(built);
    });
    dlg.showModal();
    update();
    inputs.get(params[0]?.id ?? '')?.focus();
  });
}
