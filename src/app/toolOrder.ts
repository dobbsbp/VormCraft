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
