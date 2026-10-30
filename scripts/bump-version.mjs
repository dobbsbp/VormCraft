// Set the app version everywhere it is written: package.json (+ lock), src-tauri/Cargo.toml and
// src-tauri/tauri.conf.json. Usage: npm run version:set -- 0.2.0
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('Usage: npm run version:set -- <major.minor.patch>, e.g. 0.2.0');
  process.exit(1);
}

const edit = (file, change) => {
  const before = readFileSync(file, 'utf8');
  const after = change(before);
  if (after === before) throw new Error(`Nothing to change in ${file}`);
  writeFileSync(file, after);
  console.log(`${file}: ${version}`);
};
const json = (file, set) =>
  edit(file, (text) => {
    const data = JSON.parse(text);
    set(data);
    return JSON.stringify(data, null, 2) + '\n';
  });

json('package.json', (p) => (p.version = version));
json('package-lock.json', (p) => {
  p.version = version;
  p.packages[''].version = version;
});
json('src-tauri/tauri.conf.json', (c) => (c.version = version));
edit('src-tauri/Cargo.toml', (t) => t.replace(/^version = ".*"$/m, `version = "${version}"`));
console.log(`Now add a "## ${version}" section to CHANGELOG.md, commit, and tag v${version}.`);
