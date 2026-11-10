import type { LibraryItem, Room } from './catalog';

export interface LibraryHit {
  item: LibraryItem;
  score: number;
}

/** Lower case, accents dropped, split into words, a plural "s" taken off ("chairs" → "chair"). */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Edits (insert, delete, change, swap two neighbours) to turn a into b, giving up above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Typos allowed for a word of this length. */
const allowedTypos = (w: string): number => (w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0);

/** How well one searched word matches a list of words: exact, start of a word, or with a typo. */
function wordScore(q: string, targets: readonly string[], exact: number): number {
  let best = 0;
  for (const t of targets) {
    if (t === q) return exact;
    if (q.length >= 2 && t.startsWith(q)) best = Math.max(best, exact * 0.8);
    else if (allowedTypos(q) && editDistance(q, t, allowedTypos(q)) <= allowedTypos(q)) best = Math.max(best, exact * 0.5);
  }
  return best;
}

interface Indexed {
  item: LibraryItem;
  name: string[];
  tags: string[];
  other: string[];
}

const indexCache = new WeakMap<readonly LibraryItem[], Indexed[]>();

function index(items: readonly LibraryItem[]): Indexed[] {
  let idx = indexCache.get(items);
  if (!idx) {
    idx = items.map((item) => ({
      item,
      name: words(item.name),
      tags: item.tags.flatMap(words),
      other: [item.subcategory, item.category, ...item.rooms, ...(item.variants ?? []).map((v) => v.name)].flatMap(words),
    }));
    indexCache.set(items, idx);
  }
  return idx;
}

/**
 * Items matching a search, best first. Every searched word must match the item's name, tags,
 * category, rooms or sizes (allowing a typo or the start of a word); matches in the name count
 * most. An empty search lists everything (in catalogue order). `room` and `subcategory` narrow it.
 */
export function searchLibrary(items: readonly LibraryItem[], query: string, filter: { room?: Room; subcategory?: string } = {}): LibraryHit[] {
  const q = words(query);
  const hits: LibraryHit[] = [];
  for (const e of index(items)) {
    if (filter.room && !e.item.rooms.includes(filter.room)) continue;
    if (filter.subcategory && e.item.subcategory !== filter.subcategory) continue;
    let score = 0;
    let all = true;
    for (const w of q) {
      const s = Math.max(wordScore(w, e.name, 10), wordScore(w, e.tags, 6), wordScore(w, e.other, 4));
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) hits.push({ item: e.item, score });
  }
  // Stable: equal scores keep catalogue order.
  return hits.sort((a, b) => b.score - a.score);
}
