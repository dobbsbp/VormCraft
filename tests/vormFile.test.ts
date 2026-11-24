import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, drawRectangle, GROUND_PLANE, initBooleanKernel, pushPull, TOL } from '../src/core';
import { rotation, transformVertices, composeAffine, type Affine } from '../src/core/ops/transform';
import { Document } from '../src/doc/Document';
import { FileFormatError, FORMAT_VERSION, NewerFormatError, OLDER_VERSION, serializeDocument, WRITE_ZIPPED } from '../src/io/fileFormat';
import { encodeVorm as encodeAny, isZipped, readVorm, type VormSaveOptions } from '../src/io/vormFile';

/** The zipped form (format 9), whatever Save writes today. */
const encodeVorm = (doc: Document, opts: VormSaveOptions = {}) => encodeAny(doc, { zipped: true, ...opts });
import { LIBRARY } from '../src/library';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A design with a box, a textured material, undo steps and a version in its history. */
function design() {
  const h = harness();
  const brick = h.doc.materials.add({ name: 'Brick', color: '#aa5533', opacity: 1, texture: { image: PNG, width: 400, height: 150 } });
  h.ctx.apply(() => drawRectangle(h.doc.model, GROUND_PLANE, [0, 0, 0], 300, 200), undefined, 'Rectangle');
  const face = [...h.doc.model.faces.keys()][0];
  h.ctx.apply(() => pushPull(h.doc.model, face, 100), undefined, 'Push/Pull');
  for (const f of h.doc.model.faces.values()) f.material = brick;
  h.doc.model.touch();
  h.controller.recordVersion('save');
  return h;
}

/** The entries of a zip, and its design JSON. */
const open = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return { files, design: JSON.parse(strFromU8(files['design.json'])) };
};
/** A zip made from entries (to build damaged or future files). */
const rezip = (files: Record<string, Uint8Array>, design: unknown) => zipSync({ ...files, 'design.json': strToU8(JSON.stringify(design)) } as Zippable);

describe('.vorm files (format 9)', () => {
  it('are a zip: the design as JSON, with images, history and undo steps as entries of their own', () => {
    const h = design();
    const bytes = encodeVorm(h.doc, { undo: h.controller.history.steps, savedBy: 'VormCraft test' });
    expect(isZipped(bytes)).toBe(true);
    const { files, design: d } = open(bytes);
    expect(Object.keys(files)[0]).toBe('design.json');
    expect(d).toMatchObject({ format: 'vormcraft', version: FORMAT_VERSION, minReaderVersion: 8, savedBy: 'VormCraft test' });
    // The texture once, as the image itself, though both the material and the history use it.
    const textures = Object.keys(files).filter((n) => n.startsWith('textures/'));
    expect(textures).toHaveLength(1);
    expect(textures[0]).toMatch(/\.png$/);
    expect(files[textures[0]].slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    expect(d.materials[0].texture.image).toBe(`vorm-entry:${textures[0]}`);
    expect(Object.keys(files).filter((n) => n.startsWith('undo/'))).toHaveLength(2);
    expect(Object.keys(files).filter((n) => n.startsWith('history/'))).toHaveLength(1);
    // Saving leaves the design itself alone.
    expect([...h.doc.materials.items.values()][0].texture!.image).toBe(PNG);
  });

  it('open again as they were: geometry, paint, history and undo', () => {
    const h = design();
    const read = readVorm(encodeVorm(h.doc, { undo: h.controller.history.steps }));
    expect(read).toMatchObject({ version: FORMAT_VERSION, newer: false });
    const doc = read.doc;
    expect(doc.root.faces.size).toBe(6);
    expect(checkWatertight(doc.root).watertight).toBe(true);
    expect([...doc.materials.items.values()][0].texture!.image).toBe(PNG);
    expect(doc.versions.items).toHaveLength(1);
    expect(doc.savedUndo.map((s) => s.label)).toEqual(['Rectangle', 'Push/Pull']);
    const b = harness();
    b.controller.replaceDocument(doc);
    b.controller.undo();
    expect(b.doc.root.faces.size).toBe(1);
  });

  it('are much smaller than the same design as JSON', () => {
    const h = harness();
    for (let i = 0; i < 200; i++) {
      h.ctx.apply(() => drawRectangle(h.doc.model, GROUND_PLANE, [i * 500 + 0.123456789, (i % 7) * 333.3333333, 0], 250.5, 120.25), undefined, 'Rectangle');
    }
    const json = serializeDocument(h.doc, { history: false }).length;
    expect(encodeVorm(h.doc, { history: false }).length).toBeLessThan(json / 4);
  });

  it('round positions to a millionth of a millimetre, so shapes stay exactly as they were', () => {
    const h = harness();
    h.ctx.apply(() => drawRectangle(h.doc.model, GROUND_PLANE, [1 / 3, 2 / 3, 0], 100 / 3, 100 / 7), undefined, 'Rectangle');
    const { design: d } = open(encodeVorm(h.doc, { history: false }));
    for (const [, x, y] of d.vertices) for (const c of [x, y]) expect(String(c).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
    const doc = readVorm(encodeVorm(h.doc, { history: false })).doc;
    for (const v of h.doc.root.vertices.values()) expect(doc.root.findVertex(v.pos)).toBeDefined();
  });

  it('every Library item, turned and placed far away, comes back closed and in place', () => {
    const far: Affine = composeAffine({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [98765.4321, -12345.6789, 2500.25] }, rotation([0, 0, 0], [0, 0, 1], 0.5759586531581288));
    for (const item of LIBRARY) {
      const doc = new Document();
      for (const part of item.build()) {
        transformVertices(part.model, new Set(part.model.vertices.keys()), far);
        doc.groups.add(part.model, null, { name: part.name });
      }
      const back = readVorm(encodeVorm(doc, { history: false })).doc;
      const before = [...doc.groups.items.values()];
      const after = [...back.groups.items.values()];
      expect(after, item.id).toHaveLength(before.length);
      before.forEach((g, i) => {
        const m = after[i].model;
        expect(checkWatertight(m).watertight, `${item.id} ${g.name}`).toBe(checkWatertight(g.model).watertight);
        expect(m.faces.size, `${item.id} ${g.name}`).toBe(g.model.faces.size);
        for (const v of g.model.vertices.values()) {
          const p = m.vertices.get(v.id)!.pos;
          expect(Math.hypot(p[0] - v.pos[0], p[1] - v.pos[1], p[2] - v.pos[2]), item.id).toBeLessThan(TOL / 100);
        }
      });
    }
  });

  it('files from before format 9 (plain JSON, even with a byte-order mark) still open', () => {
    const h = design();
    const json = strToU8('﻿' + serializeDocument(h.doc));
    expect(isZipped(json)).toBe(false);
    expect(readVorm(json).doc.root.faces.size).toBe(6);
  });

  it('a missing texture loses only the picture; missing history or undo lose only those', () => {
    const h = design();
    const { files, design: d } = open(encodeVorm(h.doc, { undo: h.controller.history.steps }));
    const kept = Object.fromEntries(Object.entries(files).filter(([n]) => n !== 'design.json' && !n.startsWith('textures/') && n !== 'undo/1.gz'));
    const doc = readVorm(rezip(kept, d)).doc;
    expect(doc.root.faces.size).toBe(6);
    const mat = [...doc.materials.items.values()][0];
    expect(mat.texture).toBeUndefined();
    expect(mat.color).toBe('#aa5533');
    expect(doc.savedUndo).toHaveLength(0);
    // (The history needs its texture too, so it goes as well.)
    expect(doc.versions.items).toHaveLength(0);
  });

  it('entries this version does not know are left alone', () => {
    const h = design();
    const { files, design: d } = open(encodeVorm(h.doc));
    const doc = readVorm(rezip({ ...files, 'thumbnail.png': new Uint8Array([1, 2, 3]), 'extras/notes.txt': strToU8('hi') }, d)).doc;
    expect(doc.root.faces.size).toBe(6);
  });

  it('a newer file opens when it says older readers can read it, and is refused when not', () => {
    const h = design();
    const { files, design: d } = open(encodeVorm(h.doc));
    const readable = readVorm(rezip(files, { ...d, version: FORMAT_VERSION + 3, minReaderVersion: 8, somethingNew: [1, 2] }));
    expect(readable.newer).toBe(true);
    expect(readable.doc.root.faces.size).toBe(6);
    expect(() => readVorm(rezip(files, { ...d, version: FORMAT_VERSION + 3, minReaderVersion: FORMAT_VERSION + 1 }))).toThrow(NewerFormatError);
    // A file from before `minReaderVersion` existed is judged by its version alone.
    const { minReaderVersion: _m, ...old } = d;
    expect(() => readVorm(rezip(files, { ...old, version: FORMAT_VERSION + 1 }))).toThrow(NewerFormatError);
  });

  it('damaged files say so instead of failing strangely', () => {
    const h = design();
    const bytes = encodeVorm(h.doc);
    expect(() => readVorm(bytes.slice(0, bytes.length / 2))).toThrow(FileFormatError);
    expect(() => readVorm(zipSync({ 'design.json': strToU8('{ not json') }))).toThrow(/damaged/);
    expect(() => readVorm(strToU8('{ not a design'))).toThrow(/not a VormCraft file/);
  });

  it('a file that is not one this version knows offers the update, in case a later version saved it', () => {
    // A zip without the design, or something that is not text at all.
    expect(() => readVorm(zipSync({ 'model.bin': strToU8('hello') }))).toThrow(NewerFormatError);
    expect(() => readVorm(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]))).toThrow(NewerFormatError);
    expect(() => readVorm(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]))).toThrow(/updating VormCraft will open it/);
  });
});

describe('the bridge release (reads format 9, saves format 8)', () => {
  it('saves plain JSON marked format 8 that 0.9 apps open, undo steps, history and all', () => {
    const h = design();
    const bytes = encodeAny(h.doc, { undo: h.controller.history.steps, zipped: false, savedBy: 'VormCraft test' });
    expect(isZipped(bytes)).toBe(false);
    const text = strFromU8(bytes);
    const f = JSON.parse(text);
    // What 0.9.3 checks: version 8 or lower, its own fields, and no `savedBy` (which it would count
    // as part of the design, so it would drop the undo steps).
    expect(f.version).toBe(OLDER_VERSION);
    expect(f.savedBy).toBeUndefined();
    expect(text).not.toContain('vorm-entry:');
    expect(f.materials[0].texture.image).toBe(PNG);
    // The history's versions are format 8 inside too.
    const read = readVorm(bytes);
    expect(read.version).toBe(8);
    expect(read.doc.savedUndo.map((s) => s.label)).toEqual(['Rectangle', 'Push/Pull']);
    expect(read.doc.versions.items).toHaveLength(1);
  });

  it('Save follows the switch', () => {
    const h = design();
    expect(isZipped(encodeAny(h.doc))).toBe(WRITE_ZIPPED);
  });
});
