import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The desktop app only lets the page use file operations listed in its capabilities file; one
 * missing there fails only in the installed app (never in tests or the browser). So: every
 * `fs.someCall(` in the source must have its `fs:allow-some-call` permission.
 */
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.ts$/.test(e.name)) yield p;
  }
}

describe('desktop permissions', () => {
  it('every file operation the app uses is allowed in the desktop capabilities', () => {
    const used = new Set<string>();
    for (const file of sources('src')) {
      const text = readFileSync(file, 'utf8');
      if (!text.includes("'@tauri-apps/plugin-fs'")) continue;
      for (const m of text.matchAll(/\bfs\.([a-zA-Z]+)\(/g)) used.add(`fs:allow-${kebab(m[1])}`);
    }
    const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')) as { permissions: (string | { identifier: string })[] };
    const granted = new Set(caps.permissions.map((p) => (typeof p === 'string' ? p : p.identifier)));
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((p) => !granted.has(p))).toEqual([]);
  });
});
