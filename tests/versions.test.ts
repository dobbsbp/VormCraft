import { beforeAll, describe, expect, it } from 'vitest';
import { drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, pushPull, volume } from '../src/core';
import { Document } from '../src/doc/Document';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { openVersion, recordVersion, thinVersions, trimVersions } from '../src/io/versions';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** A harness with a 100 mm box (its top pushed with the controller so undo labels exist). */
function boxHarness() {
  const h = harness();
  const f = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
  h.ctx.apply(() => pushPull(h.model, f, h.model.face(f).normal[2] > 0 ? 100 : -100), undefined, 'Push/Pull');
  return h;
}
const top = (h: ReturnType<typeof harness>) => findFaceAt(h.doc.model, [50, 50, h.doc.model === h.doc.root ? maxZ(h) : 0])!;
const maxZ = (h: ReturnType<typeof harness>) => Math.max(...[...h.doc.root.vertices.values()].map((v) => v.pos[2]));
const raise = (h: ReturnType<typeof harness>, d: number) => h.ctx.apply(() => pushPull(h.doc.model, top(h), d), undefined, 'Push/Pull');

describe('recording versions', () => {
  it('records the design compressed, labelled with the last change; the same state is not recorded twice', () => {
    const h = boxHarness();
    const v = recordVersion(h.doc, 'Push/Pull', 'auto')!;
    expect(v.label).toBe('Push/Pull');
    expect(recordVersion(h.doc, 'Push/Pull', 'auto')).toBeNull();
    expect(h.doc.versions.items).toHaveLength(1);
    const back = openVersion(h.doc.versions, v.id);
    expect(Math.abs(volume(back.root))).toBeCloseTo(1e6, 3);
  });

  it('compresses a real-sized model to about a third of its size', () => {
    const h = harness();
    for (let i = 0; i < 40; i++) {
      const f = drawRectangle(h.model, GROUND_PLANE, [i * 150, 0, 0], 100, 100).inner!;
      pushPull(h.model, f, h.model.face(f).normal[2] > 0 ? 100 + i : -100 - i);
    }
    const v = recordVersion(h.doc, 'boxes', 'auto')!;
    expect(v.data.length).toBeLessThan(serializeDocument(h.doc, { history: false }).length * 0.4);
  });

  it('texture images are stored once however many versions use them', () => {
    const h = boxHarness();
    h.doc.materials.add({ name: 'Brick', color: '#aa5533', opacity: 1, texture: { image: PIXEL.repeat(1), width: 440, height: 150 } });
    recordVersion(h.doc, 'a', 'auto');
    raise(h, 10);
    recordVersion(h.doc, 'b', 'auto');
    expect(h.doc.versions.textures.size).toBe(1);
    expect(h.doc.versions.items.every((v) => v.textures.length === 1)).toBe(true);
    const back = openVersion(h.doc.versions, h.doc.versions.items[0].id);
    expect([...back.materials.items.values()][0].texture!.image).toBe(PIXEL);
  });

  it('thinning: all of the last day, one per hour for a week, one per day before', () => {
    const h = boxHarness();
    const now = 100 * DAY;
    const times = [now - 10 * DAY - 2 * HOUR, now - 10 * DAY - HOUR, now - 3 * DAY - 0.5 * HOUR, now - 3 * DAY - 0.25 * HOUR, now - 2 * HOUR, now - HOUR];
    for (const [i, t] of times.entries()) {
      raise(h, 1);
      recordVersion(h.doc, `v${i}`, 'auto', { time: t });
    }
    thinVersions(h.doc.versions, now);
    expect(h.doc.versions.items.map((v) => v.label)).toEqual(['v1', 'v3', 'v4', 'v5']);
  });

  it('a size limit drops the oldest versions first, never the newest', () => {
    const h = boxHarness();
    for (let i = 0; i < 5; i++) {
      raise(h, 1);
      recordVersion(h.doc, `v${i}`, 'auto');
    }
    trimVersions(h.doc.versions, 1);
    expect(h.doc.versions.items.map((v) => v.label)).toEqual(['v4']);
  });
});

describe('history in the file', () => {
  it('is saved and opened again (and can be left out)', () => {
    const h = boxHarness();
    recordVersion(h.doc, 'first', 'save');
    raise(h, 50);
    recordVersion(h.doc, 'second', 'auto');
    const back = parseDocument(serializeDocument(h.doc));
    expect(back.versions.items.map((v) => [v.label, v.kind])).toEqual([
      ['first', 'save'],
      ['second', 'auto'],
    ]);
    expect(Math.abs(volume(openVersion(back.versions, back.versions.items[0].id).root))).toBeCloseTo(1e6, 3);
    expect(parseDocument(serializeDocument(h.doc, { history: false })).versions.items).toHaveLength(0);
  });

  it('a damaged history does not stop the design from opening', () => {
    const h = boxHarness();
    recordVersion(h.doc, 'first', 'save');
    const file = JSON.parse(serializeDocument(h.doc));
    file.history.versions[0].data = 42;
    const back = parseDocument(JSON.stringify(file));
    expect(back.root.faces.size).toBe(6);
    expect(back.versions.items).toHaveLength(0);
  });
});

describe('going back and coming forward', () => {
  it('previewing an earlier version is read-only; Back to now returns exactly', () => {
    const h = boxHarness();
    h.controller.recordVersion('auto');
    const early = h.doc.versions.latest!.id;
    raise(h, 100);
    h.controller.dirty = true;
    h.controller.previewVersion(early);
    expect(maxZ(h)).toBeCloseTo(100, 6);
    expect(() => h.ctx.apply(() => {})).toThrow(/earlier version/);
    h.controller.undo();
    expect(h.controller.error).toMatch(/earlier version/);
    h.controller.endPreview();
    expect(maxZ(h)).toBeCloseTo(200, 6);
    expect(h.controller.dirty).toBe(true);
    expect(h.controller.previewing).toBeNull();
  });

  it('restoring keeps what you had as a version, and is one undo step', () => {
    const h = boxHarness();
    h.controller.recordVersion('auto');
    const early = h.doc.versions.latest!.id;
    raise(h, 100); // now 200 high, not yet recorded
    h.controller.previewVersion(early);
    h.controller.restoreVersion(early);
    expect(maxZ(h)).toBeCloseTo(100, 6);
    expect(h.controller.history.undoLabel).toMatch(/^Restore version from/);
    // The 200-high design was recorded before restoring: we can come forward to it.
    const forward = h.doc.versions.items.find((v) => Math.abs(Math.max(...[...openVersion(h.doc.versions, v.id).root.vertices.values()].map((x) => x.pos[2])) - 200) < 1e-6);
    expect(forward).toBeDefined();
    h.controller.restoreVersion(forward!.id);
    expect(maxZ(h)).toBeCloseTo(200, 6);
    // And Undo takes the restore back.
    h.controller.undo();
    expect(maxZ(h)).toBeCloseTo(100, 6);
  });

  it('opening a file brings its history; a new document has none', () => {
    const h = boxHarness();
    h.controller.recordVersion('save');
    const text = serializeDocument(h.doc);
    h.controller.replaceDocument(new Document());
    expect(h.doc.versions.items).toHaveLength(0);
    h.controller.replaceDocument(parseDocument(text));
    expect(h.doc.versions.items).toHaveLength(1);
  });
});
