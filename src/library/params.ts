import type { LibraryItem, LibraryParam, ParamValues } from './catalog';
import type { LibraryPart } from './kit';

/**
 * Settings of customisable Library items (Library → Customise…): turning what was typed into a
 * full, safe set of values, and naming a customised item so placing the same one again links to
 * the copy already in the model.
 */

/** A setting's value made safe: a finite number in its range, whole for counts and choices, 0 or 1 for toggles. */
function tidy(p: LibraryParam, v: number): number {
  if (!Number.isFinite(v)) return p.value;
  if (p.kind === 'toggle') return v ? 1 : 0;
  if (p.kind === 'count') v = Math.round(v);
  if (p.kind === 'choice') return Math.min(Math.max(Math.round(v), 0), (p.choices?.length ?? 1) - 1);
  if (p.min !== undefined) v = Math.max(v, p.min);
  if (p.max !== undefined) v = Math.min(v, p.max);
  return v;
}

/** What settings need of an item: its settings and what its sizes set. */
type Settings = Pick<LibraryItem, 'params' | 'preset'>;

/** The values an item's size starts from: the defaults, then what the size sets. */
export function presetValues(item: Settings, variant?: string): Record<string, number> {
  const out: Record<string, number> = {};
  const preset = item.preset?.(variant) ?? {};
  for (const p of item.params ?? []) out[p.id] = tidy(p, preset[p.id] ?? p.value);
  return out;
}

/**
 * Every setting of an item: what was given (unknown ids ignored, values put in range), else what
 * the size sets, else the default.
 */
export function paramValues(item: Settings, variant?: string, given: Partial<Record<string, number>> = {}): Record<string, number> {
  const out = presetValues(item, variant);
  for (const p of item.params ?? []) {
    const v = given[p.id];
    if (typeof v === 'number') out[p.id] = tidy(p, v);
  }
  return out;
}

/** Whether a setting is shown (and so used) with these values. */
export function paramShown(p: LibraryParam, values: ParamValues): boolean {
  return p.shown ? p.shown(values) : true;
}

/** Whether the values differ from what the size gives (settings that are not shown do not count). */
export function isCustomised(item: LibraryItem, variant: string | undefined, values: ParamValues): boolean {
  const preset = presetValues(item, variant);
  return (item.params ?? []).some((p) => paramShown(p, values) && Math.abs((values[p.id] ?? preset[p.id]) - preset[p.id]) > 1e-9);
}

/** A number written short and exact enough to tell sizes apart: 1200, 0.5, 72.25. */
const short = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * What a placed item is the same as (`Placeable.source`): the item and size, plus the settings in
 * order when they differ from the size's (settings not shown are left out).
 */
export function itemSource(item: LibraryItem, variant: string | undefined, values?: ParamValues): string {
  const base = `library:${item.id}${variant ? `:${variant}` : ''}`;
  if (!values || !isCustomised(item, variant, values)) return base;
  const set = (item.params ?? []).filter((p) => paramShown(p, values)).map((p) => `${p.id}=${short(values[p.id])}`);
  return `${base}:custom:${set.join(',')}`;
}

/**
 * A customisable item: its `build` gets every setting (`paramValues`), so the item's own code
 * never sees a missing or out-of-range value.
 */
export function customisable(def: Omit<LibraryItem, 'build'> & { params: readonly LibraryParam[]; make(values: ParamValues, variant?: string): LibraryPart[] }): LibraryItem {
  const { make, ...rest } = def;
  const item: LibraryItem = { ...rest, build: (variant, given) => make(paramValues(item, variant, given), variant) };
  return item;
}

/** Throws with `message` (what to change) unless `ok`. */
export function need(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}
