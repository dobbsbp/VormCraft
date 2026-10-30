// Print the CHANGELOG.md section for a version (the release notes the updater shows).
// Usage: node scripts/release-notes.mjs 0.2.0
import { readFileSync } from 'node:fs';

const version = process.argv[2] ?? '';
const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/);
const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section`);
  process.exit(1);
}
const body = lines.slice(start + 1);
const end = body.findIndex((line) => line.startsWith('## '));
console.log((end < 0 ? body : body.slice(0, end)).join('\n').trim());
