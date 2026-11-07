import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, pushPull, volume, type Vec3 } from '../src/core';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { Document } from '../src/doc/Document';

beforeAll(async () => {
  await initBooleanKernel();
});

/**
 * Two 20 × 20 × 40 boxes drawn so they share one vertical 40 line (as when two squares are drawn
 * corner to corner on the ground and each pulled up).
 */
function twoBoxes(): Model {
  const m = new Model();
  pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 20, 20).inner!, 40);
  pushPull(m, drawRectangle(m, GROUND_PLANE, [20, 20, 0], 20, 20).inner!, 40);
  return m;
}

const sound = (m: Model) => {
  m.validate();
  expect(checkWatertight(m).watertight).toBe(true);
};
const faceAt = (m: Model, p: Vec3, n: Vec3) => findFaceAt(m, p, n)!;

describe('parts touching along an edge', () => {
  it('every face of two boxes sharing a line pushes and pulls, with and without Ctrl', () => {
    const m = twoBoxes();
    sound(m);
    for (const f of [...m.faces.keys()]) {
      for (const d of [10, -10]) {
        for (const newStart of [false, true]) {
          const c = m.clone();
          pushPull(c, f, d, { newStart });
          sound(c);
        }
      }
    }
  });

  it('pushing one top down splits the shared line where the face stops', () => {
    const m = twoBoxes();
    pushPull(m, faceAt(m, [10, 10, 40], [0, 0, 1]), -10);
    sound(m);
    expect(volume(m)).toBeCloseTo(20 * 20 * 30 + 20 * 20 * 40);
    // The shared line now runs 0..30; above that it belongs to the taller box only.
    expect(m.findVertex([20, 20, 30])).toBeDefined();
    expect(m.findVertex([20, 20, 40])).toBeDefined();
  });

  it('pulling one box into contact along a face merges them into one solid', () => {
    const m = twoBoxes();
    // The second box's left side (x = 20, y 20..40) pulled 5 towards -x: it now lies against the
    // first box's back (y = 20, x 15..20).
    pushPull(m, faceAt(m, [20, 30, 20], [-1, 0, 0]), 5);
    sound(m);
    expect(checkWatertight(m).shells).toBe(1);
    expect(volume(m)).toBeCloseTo(20 * 20 * 40 + 25 * 20 * 40);
  });

  it('the two boxes count as one object, and the watertight check still sees two shells', () => {
    const m = twoBoxes();
    expect(m.connectedFaces(faceAt(m, [10, 10, 40], [0, 0, 1])).size).toBe(12);
    expect(m.connectedFaces(faceAt(m, [10, 10, 40], [0, 0, 1]), false).size).toBe(6);
    const w = checkWatertight(m);
    expect(w.shells).toBe(2);
    expect(w.genus).toBe(0);
  });

  it('blocks that end up touching only along an edge are kept as touching parts', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 200, 200).inner!, -50);
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100, findFaceAt(m, [50, 50, 0])).inner!, 100);
    pushPull(m, drawRectangle(m, GROUND_PLANE, [100, 100, 0], 100, 100, findFaceAt(m, [150, 150, 0])).inner!, 100);
    sound(m);
    expect(volume(m)).toBeCloseTo(200 * 200 * 50 + 2 * 100 * 100 * 100);
    // And they go on working: push the first block's top down, pull the second one's side out.
    pushPull(m, faceAt(m, [50, 50, 100], [0, 0, 1]), -30);
    pushPull(m, faceAt(m, [100, 150, 50], [-1, 0, 0]), 10);
    sound(m);
  });

  it('touching parts save and open again unchanged', () => {
    const m = twoBoxes();
    const back = parseDocument(serializeDocument(new Document(m))).root;
    sound(back);
    expect(back.vertices.size).toBe(m.vertices.size);
    expect(volume(back)).toBeCloseTo(volume(m));
  });
});
