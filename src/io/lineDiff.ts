/**
 * A line diff (Myers' O(ND) algorithm) for storing undo steps as only what changed. A patch turns
 * one list of lines into another: a positive number keeps that many lines, a negative number
 * drops that many, and an array inserts those lines.
 */
export type Patch = (number | string[])[];

/**
 * The patch from `a` to `b`, or null if they differ in more than `maxEdits` lines (then storing
 * `b` whole is about as small, and much quicker).
 */
export function diffLines(a: readonly string[], b: readonly string[], maxEdits = 4000): Patch | null {
  // Most edits touch one area: skip the common start and end first.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = diffMiddle(a.slice(start, endA), b.slice(start, endB), maxEdits);
  if (!middle) return null;
  const patch: Patch = [];
  push(patch, start);
  for (const op of middle) push(patch, op);
  push(patch, a.length - endA);
  return patch;
}

/** Add an operation, merging it with the last one of the same kind. */
function push(patch: Patch, op: number | string[]): void {
  if (typeof op === 'number' && op === 0) return;
  if (Array.isArray(op) && op.length === 0) return;
  const last = patch[patch.length - 1];
  if (typeof op === 'number' && typeof last === 'number' && Math.sign(op) === Math.sign(last)) patch[patch.length - 1] = last + op;
  else if (Array.isArray(op) && Array.isArray(last)) last.push(...op);
  else patch.push(Array.isArray(op) ? [...op] : op);
}

function diffMiddle(a: string[], b: string[], maxEdits: number): Patch | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m ? [b] : [];
  if (m === 0) return [-n];
  // Compare numbers, not strings.
  const ids = new Map<string, number>();
  const id = (s: string) => {
    let v = ids.get(s);
    if (v === undefined) ids.set(s, (v = ids.size));
    return v;
  };
  const A = a.map(id);
  const B = b.map(id);
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, d, a, b);
    }
  }
  return null;
}

/** Walk back through the saved rows to the edit script. */
function backtrack(trace: Int32Array[], dEnd: number, a: string[], b: string[]): Patch {
  const ops: (number | string[])[] = [];
  let x = a.length;
  let y = b.length;
  // trace[d] holds v[k] for k in [-d-1, d+1] at index k + d + 1.
  const at = (d: number, k: number) => trace[d][k + d + 1];
  for (let d = dEnd; d > 0; d--) {
    const k = x - y;
    const prevK = k === -d || (k !== d && at(d, k - 1) < at(d, k + 1)) ? k + 1 : k - 1;
    const prevX = at(d, prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(1);
      x--;
      y--;
    }
    if (x === prevX) ops.push([b[prevY]]);
    else ops.push(-1);
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push(1);
    x--;
    y--;
  }
  const patch: Patch = [];
  for (let i = ops.length - 1; i >= 0; i--) push(patch, ops[i]);
  return patch;
}

/** Apply a patch made by `diffLines`. */
export function applyPatch(a: readonly string[], patch: Patch): string[] {
  const out: string[] = [];
  let i = 0;
  for (const op of patch) {
    if (Array.isArray(op)) out.push(...op);
    else if (op > 0) {
      if (i + op > a.length) throw new Error('The undo history does not match the design');
      for (let j = 0; j < op; j++) out.push(a[i + j]);
      i += op;
    } else i -= op;
  }
  if (i !== a.length) throw new Error('The undo history does not match the design');
  return out;
}
