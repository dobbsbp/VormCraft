import { beforeAll, describe, expect, it } from 'vitest';
import { drawRectangle, GROUND_PLANE, initBooleanKernel, pushPull } from '../src/core';
import { findFaceAt } from '../src/core/model/query';
import { linedJson, parseDocument, serializeDocument, UNDO_STEPS } from '../src/io/fileFormat';
import { applyPatch, diffLines } from '../src/io/lineDiff';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

describe('line diff', () => {
  it('turns one list of lines into another', () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: rnd(40) }, () => `l${rnd(8)}`);
      const b = [...a];
      for (let e = rnd(6); e > 0; e--) {
        const at = rnd(b.length + 1);
        if (rnd(2) && b.length) b.splice(at, 1);
        else b.splice(at, 0, `n${rnd(8)}`);
      }
      const patch = diffLines(a, b)!;
      expect(applyPatch(a, patch)).toEqual(b);
    }
  });

  it('gives up (null) when nearly everything differs, so the step is stored whole', () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    expect(diffLines(a, b, 10)).toBeNull();
    expect(applyPatch(a, diffLines(a, b)!)).toEqual(b);
  });
});

/** A harness with `n` boxes drawn one undo step at a time. */
function withSteps(n: number) {
  const H = harness();
  for (let i = 0; i < n; i++) {
    H.controller.ctx.apply(() => {
      const f = drawRectangle(H.doc.model, GROUND_PLANE, [i * 30, 0, 0], 20, 20).inner!;
      pushPull(H.doc.model, f, 10 + i);
    }, undefined, `Box ${i + 1}`);
  }
  return H;
}

describe('undo steps saved with the design', () => {
  it('after reopening, Ctrl+Z goes back through the saved steps, one by one', () => {
    const H = withSteps(5);
    const text = serializeDocument(H.doc, { undo: H.controller.history.steps });
    const B = harness();
    B.controller.replaceDocument(parseDocument(text));
    expect(B.doc.root.faces.size).toBe(30);
    expect(B.controller.history.undoLabel).toBe('Box 5');
    for (let left = 4; left >= 0; left--) {
      B.controller.undo();
      expect(B.doc.root.faces.size).toBe(left * 6);
    }
    expect(B.controller.history.undoLabel).toBeNull();
    // Redo works on from there as usual.
    B.controller.redo();
    B.controller.redo();
    expect(B.doc.root.faces.size).toBe(12);
    expect(findFaceAt(B.doc.root, [40, 10, 11])).toBeDefined();
  });

  it('keeps the newest 100 steps, each as only what changed (small)', () => {
    const H = withSteps(UNDO_STEPS + 5);
    const withUndo = serializeDocument(H.doc, { undo: H.controller.history.steps });
    const without = serializeDocument(H.doc);
    const f = JSON.parse(withUndo);
    expect(f.undo.steps).toHaveLength(UNDO_STEPS);
    expect(f.undo.steps.every((s: { full?: number }) => !s.full)).toBe(true);
    // 100 steps take far less room than one more copy of the design would (about 1 KB each here).
    expect(withUndo.length - without.length).toBeLessThan(without.length);
  });

  it('saving again (and again after reopening) reuses the stored steps', () => {
    const H = withSteps(4);
    const first = JSON.parse(serializeDocument(H.doc, { undo: H.controller.history.steps })).undo;
    const second = JSON.parse(serializeDocument(H.doc, { undo: H.controller.history.steps })).undo;
    expect(second).toEqual(first);
    const B = harness();
    B.controller.replaceDocument(parseDocument(serializeDocument(H.doc, { undo: H.controller.history.steps })));
    // A reopened design may list its edges in another order, so the newest step is worked out
    // again; the older ones are reused as they were.
    const third = JSON.parse(serializeDocument(B.doc, { undo: B.controller.history.steps })).undo;
    expect(third.steps.slice(1)).toEqual(first.steps.slice(1));
  });

  it('changes after reopening go on top of the saved steps, and everything saves again', () => {
    const H = withSteps(3);
    const B = harness();
    B.controller.replaceDocument(parseDocument(serializeDocument(H.doc, { undo: H.controller.history.steps })));
    B.controller.ctx.apply(() => drawRectangle(B.doc.model, GROUND_PLANE, [0, 100, 0], 10, 10), undefined, 'Rectangle');
    const C = harness();
    C.controller.replaceDocument(parseDocument(serializeDocument(B.doc, { undo: B.controller.history.steps })));
    expect(C.doc.root.faces.size).toBe(19);
    const sizes: number[] = [];
    while (C.controller.history.undoLabel) {
      C.controller.undo();
      sizes.push(C.doc.root.faces.size);
    }
    expect(sizes).toEqual([18, 12, 6, 0]);
  });

  it('steps that do not belong to the design are left out, and the design still opens', () => {
    const H = withSteps(2);
    const f = JSON.parse(serializeDocument(H.doc, { undo: H.controller.history.steps }));
    f.vertices[0][1] += 1; // the design was changed outside VormCraft
    const doc = parseDocument(JSON.stringify(f));
    expect(doc.savedUndo).toHaveLength(0);
    expect(doc.root.faces.size).toBe(12);
  });

  it('the design text compared line by line parses as the same JSON', () => {
    const H = withSteps(1);
    const f = JSON.parse(serializeDocument(H.doc));
    expect(JSON.parse(linedJson(f))).toEqual(f);
  });
});
