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

describe('desktop links', () => {
  it('every link the app opens is allowed by the desktop opener scope', async () => {
    const { LINKS } = await import('../src/app/help');
    const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')) as { permissions: (string | { identifier: string; allow?: { url: string }[] })[] };
    const scope = caps.permissions.flatMap((p) => (typeof p !== 'string' && p.identifier === 'opener:allow-open-url' ? (p.allow ?? []) : []));
    // Scope entries are a URL, optionally ending in * (anything after it).
    const allowed = (url: string) => scope.some((s) => (s.url.endsWith('*') ? url.startsWith(s.url.slice(0, -1)) : url === s.url));
    expect(Object.values(LINKS).filter((url) => !allowed(url))).toEqual([]);
  });
});

describe('web Content-Security-Policy', () => {
  it('allows the Google addresses the web app uses for Drive, and nothing inline', async () => {
    const { WEB_CSP } = await import('../scripts/csp');
    const directive = (name: string) => WEB_CSP.split('; ').find((d) => d.startsWith(`${name} `))!.split(' ').slice(1);
    const allows = (name: string, url: string) => directive(name).some((s) => s === url || (s.endsWith('/') && url.startsWith(s)) || url.startsWith(`${s}/`));
    const read = (file: string, name: string) => new RegExp(`const ${name} = '([^']+)'`).exec(readFileSync(file, 'utf8'))![1];
    expect(allows('script-src', read('src/app/drive/googleAuth.ts', 'GIS_SCRIPT'))).toBe(true);
    expect(allows('connect-src', read('src/app/drive/driveApi.ts', 'API'))).toBe(true);
    expect(allows('connect-src', read('src/app/drive/driveApi.ts', 'UPLOAD'))).toBe(true);
    expect(directive('script-src')).not.toContain("'unsafe-inline'");
    expect(directive('script-src')).not.toContain("'unsafe-eval'");
  });
});
