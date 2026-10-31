import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Makes the web version work offline and update itself, as an installed app:
 * - `sw.js`, a service worker that stores every file of this build on the device (so the app
 *   starts with no internet) and serves them from there. A new build is downloaded in the
 *   background and waits until the user chooses to restart into it (see src/app/webApp.ts).
 * - `version.json`: the version and its release notes (from CHANGELOG.md), always read from the
 *   network, for the "new version" prompt.
 * The desktop app ships the same files but never registers the worker.
 */
export function offline(version: string): Plugin {
  return {
    name: 'vormcraft-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f}`), ...publicFiles()].filter((f, i, all) => all.indexOf(f) === i && f !== './sw.js');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(version, files) });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, notes: releaseNotes(version) }, null, 2) });
    },
  };
}

/** Files copied from public/ (not part of the bundle Vite reports). */
function publicFiles(): string[] {
  return ['./manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
}

function releaseNotes(version: string): string {
  try {
    const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
    const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
    if (start < 0) return '';
    const body = lines.slice(start + 1);
    const end = body.findIndex((l) => l.startsWith('## '));
    return (end < 0 ? body : body.slice(0, end)).join('\n').trim();
  } catch {
    return '';
  }
}

function serviceWorker(version: string, files: string[]): string {
  return `// VormCraft ${version}: keeps this version's files on the device so it runs offline.
const CACHE = ${JSON.stringify(`vormcraft-${version}`)};
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  // Download everything now; the new version waits until the app asks to switch to it.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vormcraft-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'switch-version') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/version.json')) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      // Stored files first; anything else from the network; offline, a page opens the app.
      cache.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request).catch(() => (request.mode === 'navigate' ? cache.match('./') : Response.error()))),
    ),
  );
});
`;
}
