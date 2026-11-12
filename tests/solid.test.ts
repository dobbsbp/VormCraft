import { beforeAll, describe, expect, it } from 'vitest';
import { describeSolid, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, mergeGeometry, Model, pushPull, reverseFaces, solidReport, volumeLines } from '../src/core';
import { formatVolume } from '../src/tools/units';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

function box(m: Model, x: number, size = 100): void {
  const f = drawRectangle(m, GROUND_PLANE, [x, 0, 0], size, size).inner!;
  pushPull(m, f, m.face(f).normal[2] > 0 ? size : -size);
}

describe('solid check', () => {
  it('a closed box is a solid; two are two solids', () => {
    const m = new Model();
    box(m, 0);
    expect(describeSolid(solidReport(m))).toBe('Solid');
    box(m, 300);
    expect(describeSolid(solidReport(m))).toBe('2 solids');
  });

  it('a box with a face erased is not closed: its open edges are listed', () => {
    const m = new Model();
    box(m, 0);
    m.removeFace(findFaceAt(m, [50, 50, 100])!);
    const r = solidReport(m);
    expect(r.open).toBe(1);
    expect(r.openEdges).toHaveLength(4);
    expect(describeSolid(r)).toBe('Not closed: 4 open edges');
  });

  it('an inside-out box says so, and how to fix it', () => {
    const m = new Model();
    box(m, 0);
    reverseFaces(m, [...m.faces.keys()]);
    const r = solidReport(m);
    expect(r.insideOut).toBe(1);
    expect(describeSolid(r)).toMatch(/^Inside out .*Reverse Faces/);
  });

  it('two boxes pressed face to face are found (Merge Shapes joins them)', () => {
    const m = new Model();
    box(m, 0);
    const other = new Model();
    box(other, 100);
    mergeGeometry(m, other);
    const r = solidReport(m);
    expect(r.solids).toBe(2);
    expect(r.pressed).toBe(2);
    expect(describeSolid(r)).toMatch(/pressed face to face/);
  });

  it('a flat face is flat, not a broken solid', () => {
    const m = new Model();
    drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100);
    const r = solidReport(m);
    expect(r.flat).toBe(1);
    expect(r.openEdges).toHaveLength(0);
    expect(describeSolid(r)).toBe('Flat (not a solid)');
  });

  it('Select open edges selects them', () => {
    const h = harness();
    box(h.model, 0);
    h.model.removeFace(findFaceAt(h.model, [50, 50, 100])!);
    h.controller.selection.set([findFaceAt(h.model, [50, 0, 50])!], []);
    h.controller.selectOpenEdges();
    expect(h.controller.selection.edges.size).toBe(4);
    expect(h.controller.notice).toMatch(/4 open edges selected/);
  });
});

describe('volumes in Entity Info', () => {
  const fmt = (v: number) => `${v}`;

  it('each closed solid has its volume (an inside-out one its size); open and flat ones none', () => {
    const m = new Model();
    box(m, 0);
    box(m, 300, 50);
    expect(solidReport(m).volumes.sort((a, b) => a - b)).toEqual([125000, 1e6].map((v) => expect.closeTo(v, 3)));
    reverseFaces(m, [...m.connectedFaces(findFaceAt(m, [50, 50, 100])!, false)]);
    expect(Math.max(...solidReport(m).volumes)).toBeCloseTo(1e6, 3);
    drawRectangle(m, GROUND_PLANE, [600, 0, 0], 100, 100);
    expect(solidReport(m).volumes).toHaveLength(2);
  });

  it('one thing shows its volume; up to five are listed with the total; more give a count and the total', () => {
    expect(volumeLines([], fmt)).toEqual([]);
    expect(volumeLines([{ name: 'Flat', volume: 0 }], fmt)).toEqual([]);
    expect(volumeLines([{ name: 'Box', volume: 8 }], fmt)).toEqual([['Volume', '8']]);
    expect(volumeLines([{ name: 'A', volume: 1 }, { name: 'Open', volume: 0 }, { name: 'B', volume: 2 }], fmt)).toEqual([
      ['A', '1'],
      ['B', '2'],
      ['Total volume', '3'],
    ]);
    const five = Array.from({ length: 5 }, (_, i) => ({ name: `Solid ${i + 1}`, volume: 1 }));
    expect(volumeLines(five, fmt)).toHaveLength(6);
    expect(volumeLines([...five, { name: 'Solid 6', volume: 1 }], fmt)).toEqual([
      ['Solids', '6'],
      ['Total volume', '6'],
    ]);
  });

  it('volumes show in the design units cubed, with thousands separators', () => {
    expect(formatVolume(1e6, { unit: 'mm', precision: 2 })).toBe('1,000,000 mm³');
    expect(formatVolume(2e9, { unit: 'mm', precision: 2 })).toBe('2 m³');
    expect(formatVolume(1e6, { unit: 'cm', precision: 1 })).toBe('1,000 cm³');
    expect(formatVolume(16387.064, { unit: 'in', precision: 2 })).toBe('1 in³');
    expect(formatVolume(28316846.592, { unit: 'ftin', precision: 16 })).toBe('1 ft³');
  });
});
