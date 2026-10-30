import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkWatertight } from '../src/core';
import { FORMAT_VERSION, parseDocument, serializeDocument } from '../src/io/fileFormat';
import { openVersion } from '../src/io/versions';

/**
 * Files saved by every earlier version of the app must keep opening. Each file in tests/fixtures
 * was saved in one format version; never change or delete them. When FORMAT_VERSION goes up,
 * add a fixture for the new version (saved by the new code) and a case here.
 */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('files from every format version open', () => {
  it.each([
    ['format-v1.benup', 1],
    ['format-v2.vorm', 2],
    ['format-v3.vorm', 3],
    ['format-v4.vorm', 4],
    ['format-v5.vorm', 5],
  ])('%s', (name, version) => {
    const text = fixture(name);
    expect(JSON.parse(text).version).toBe(version);
    const doc = parseDocument(text);
    // The geometry every version has: a 300 × 200 × 100 plate with a circle on top, and a guide.
    expect(doc.root.faces.size).toBe(7);
    expect(checkWatertight(doc.root).shells).toBe(1);
    expect([...doc.root.curves.values()]).toHaveLength(1);
    expect(doc.guides.lines()).toHaveLength(1);
    if (version >= 2) {
      expect(doc.materials.items.size).toBe(2);
      expect([...doc.root.faces.values()].some((f) => f.material !== undefined)).toBe(true);
      expect([...doc.root.halfEdges.values()].some((h) => h.soft === false)).toBe(true);
      expect(doc.labels.items.size).toBe(version >= 5 ? 2 : 1);
    }
    if (version >= 3) {
      expect(doc.groups.items.size).toBe(2);
      const block = [...doc.groups.items.values()].find((g) => g.name === 'Block')!;
      expect(block.model.faces.size).toBe(6);
      expect(block.material).toBeDefined();
      expect(doc.groups.children(block.id)).toHaveLength(1);
    }
    if (version >= 4) {
      expect(doc.scenes.items.map((s) => s.name)).toEqual(['Front']);
      expect([...doc.groups.items.values()].some((g) => g.hidden)).toBe(true);
    }
    if (version >= 5) {
      expect(doc.versions.items.map((v) => [v.label, v.kind])).toEqual([
        ['Opened', 'opened'],
        ['Text', 'save'],
      ]);
      expect(openVersion(doc.versions, doc.versions.items[0].id).labels.items.size).toBe(1);
    }
    // Opened and saved again, it is in the current format and still opens.
    const again = parseDocument(serializeDocument(doc));
    expect(JSON.parse(serializeDocument(again)).version).toBe(FORMAT_VERSION);
    expect(again.root.faces.size).toBe(7);
  });

  it('there is a fixture for the current format version', () => {
    const names = ['format-v1.benup', 'format-v2.vorm', 'format-v3.vorm', 'format-v4.vorm', 'format-v5.vorm'];
    expect(names.some((n) => n.includes(`v${FORMAT_VERSION}.`))).toBe(true);
  });
});
