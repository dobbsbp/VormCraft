// Write latest.json, the file installed copies of VormCraft read to find an update, from the signed
// downloads of a (still draft) GitHub Release, and add it to that release. Run by the release
// workflow once the Windows and Linux builds have all uploaded theirs, so the file is written once,
// with every system in it (builds writing it at the same time would overwrite each other).
//
// Usage (GitHub Actions): GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo
//   node scripts/updater-json.mjs <release id> <tag> <notes file>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Which download each system's updater installs, by the end of its file name. */
export const PLATFORMS = [
  { ending: '_x64-setup.exe', keys: ['windows-x86_64', 'windows-x86_64-nsis'] },
  { ending: '_amd64.AppImage', keys: ['linux-x86_64', 'linux-x86_64-appimage'] },
  { ending: '_aarch64.AppImage', keys: ['linux-aarch64', 'linux-aarch64-appimage'] },
];

/**
 * latest.json for a release. `assets` are the release's file names; `signature(name)` gives the
 * text of a download's .sig file. Every system in PLATFORMS must have its signed download.
 */
export function updaterJson({ repo, tag, notes, pubDate, assets, signature }) {
  const platforms = {};
  for (const p of PLATFORMS) {
    const file = assets.find((a) => a.endsWith(p.ending));
    if (!file || !assets.includes(`${file}.sig`)) throw new Error(`The release has no signed download ending in ${p.ending}`);
    // The address the file will have once the release is published (a draft's own addresses change then).
    const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(file)}`;
    for (const key of p.keys) platforms[key] = { signature: signature(`${file}.sig`).trim(), url };
  }
  return { version: tag.replace(/^v/, ''), notes, pub_date: pubDate, platforms };
}

async function main() {
  const [releaseId, tag, notesFile] = process.argv.slice(2);
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!releaseId || !tag || !notesFile || !repo || !token) {
    console.error('Usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/updater-json.mjs <release id> <tag> <notes file>');
    process.exit(1);
  }
  const api = `https://api.github.com/repos/${repo}/releases`;
  const headers = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const call = async (url, init = {}) => {
    const r = await fetch(url, { ...init, headers: { ...headers, ...init.headers } });
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${r.status} ${await r.text()}`);
    return r;
  };

  const list = await (await call(`${api}/${releaseId}/assets?per_page=100`)).json();
  if (list.some((a) => a.name === 'latest.json')) throw new Error('The release already has a latest.json');
  const sigs = new Map();
  for (const a of list.filter((a) => a.name.endsWith('.sig'))) {
    sigs.set(a.name, await (await call(`${api}/assets/${a.id}`, { headers: { Accept: 'application/octet-stream' } })).text());
  }
  const json = updaterJson({
    repo,
    tag,
    notes: readFileSync(notesFile, 'utf8').trim(),
    pubDate: new Date().toISOString(),
    assets: list.map((a) => a.name),
    signature: (name) => sigs.get(name),
  });
  await call(`https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=latest.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json, null, 2),
  });
  console.log(`latest.json added for ${Object.keys(json.platforms).join(', ')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
}
