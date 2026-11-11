/**
 * The order of the tool palette, which people can change by dragging tools. Kept as a list of
 * tool ids; tools added in later versions go at the end, ids no longer used are dropped.
 */
export function orderTools<T extends string>(saved: unknown, all: readonly T[]): T[] {
  const known = new Set<string>(all);
  const out: T[] = [];
  if (Array.isArray(saved)) for (const id of saved) if (typeof id === 'string' && known.has(id) && !out.includes(id as T)) out.push(id as T);
  for (const id of all) if (!out.includes(id)) out.push(id);
  return out;
}

/** Move `id` next to `target` (after it if `after`, else before it). */
export function moveTool<T extends string>(order: readonly T[], id: T, target: T, after: boolean): T[] {
  if (id === target || !order.includes(id) || !order.includes(target)) return [...order];
  const out = order.filter((x) => x !== id);
  out.splice(out.indexOf(target) + (after ? 1 : 0), 0, id);
  return out;
}

/**
 * Which tools are left out of the palette (they still work from their keys, Search and the More
 * tools button), every tool the palette knew about when it was last changed, and tools added since
 * that have not been looked at yet.
 */
export interface PaletteChoice<T extends string> {
  hidden: T[];
  known: T[];
  unseen: T[];
}

/**
 * Read the saved choice. Tools from a newer version (not in `known`) join a full palette, so
 * people who never left a tool out see them at once; for someone who chose fewer tools they stay
 * out, marked `unseen` (offered under More tools) and listed in `fresh`. Tools in `keep` are never
 * left out.
 */
export function readPaletteChoice<T extends string>(saved: unknown, all: readonly T[], keep: readonly T[]): { choice: PaletteChoice<T>; fresh: T[] } {
  const ids = (v: unknown) => (Array.isArray(v) ? all.filter((id) => v.includes(id)) : null);
  const s = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const hidden = (ids(s.hidden) ?? []).filter((id) => !keep.includes(id));
  const known = ids(s.known) ?? [...all];
  const fresh = hidden.length ? all.filter((id) => !known.includes(id) && !keep.includes(id)) : [];
  const unseen = [...(ids(s.unseen) ?? []), ...fresh].filter((id) => hidden.includes(id) || fresh.includes(id));
  return { choice: { hidden: [...hidden, ...fresh], known: [...all], unseen: all.filter((id) => unseen.includes(id)) }, fresh };
}

/** Put a tool back in the palette (`shown`) or leave it out; tools in `keep` always stay. */
export function showTool<T extends string>(choice: PaletteChoice<T>, id: T, shown: boolean, keep: readonly T[]): PaletteChoice<T> {
  const hidden = choice.hidden.filter((x) => x !== id);
  if (!shown && !keep.includes(id)) hidden.push(id);
  return { ...choice, hidden, unseen: choice.unseen.filter((x) => x !== id) };
}

/** A palette of exactly `shown` (plus the tools in `keep`): a preset or the Customise list. */
export function choosePaletteTools<T extends string>(all: readonly T[], shown: readonly T[], keep: readonly T[]): PaletteChoice<T> {
  return { hidden: all.filter((id) => !shown.includes(id) && !keep.includes(id)), known: [...all], unseen: [] };
}
