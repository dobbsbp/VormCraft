/** A runnable command for the Search box (tools and app actions). */
export interface Command {
  id: string;
  name: string;
  /** Extra words that should find it (e.g. "export" for STL). */
  keywords?: string[];
  shortcut?: string;
  run(): void;
}

/**
 * Commands matching a query, best first. Every word of the query must match: as the start of a
 * word in the name (best), anywhere in the name or keywords, or as letters in order ("pp" →
 * Push/Pull). An empty query lists everything in order.
 */
export function searchCommands(commands: readonly Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...commands];
  const scored: { c: Command; score: number; i: number }[] = [];
  commands.forEach((c, i) => {
    const name = c.name.toLowerCase();
    const nameWords = name.split(/[^a-z0-9]+/).filter(Boolean);
    const extra = (c.keywords ?? []).flatMap((k) => k.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean);
    let score = 0;
    for (const w of words) {
      if (nameWords.some((n) => n.startsWith(w))) score += name.startsWith(w) ? 4 : 3;
      else if (name.includes(w) || extra.some((k) => k.startsWith(w))) score += 2;
      else if (isSubsequence(w, name)) score += 1;
      else return;
    }
    scored.push({ c, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.c);
}

function isSubsequence(needle: string, hay: string): boolean {
  let j = 0;
  for (const ch of hay) if (ch === needle[j]) j++;
  return j === needle.length;
}
