import { describe, expect, it } from 'vitest';
import { choosePaletteTools, moveTool, orderTools, readPaletteChoice, showTool } from '../src/app/toolOrder';

const ALL = ['select', 'line', 'rectangle', 'circle', 'move'] as const;

describe('tool palette order', () => {
  it('keeps a saved order, adds tools from newer versions at the end and drops unknown or repeated ids', () => {
    expect(orderTools(['move', 'select'], ALL)).toEqual(['move', 'select', 'line', 'rectangle', 'circle']);
    expect(orderTools(['gone', 'circle', 'circle', 7], ALL)).toEqual(['circle', 'select', 'line', 'rectangle', 'move']);
  });

  it('falls back to the usual order for anything that is not a list', () => {
    expect(orderTools(null, ALL)).toEqual([...ALL]);
    expect(orderTools({ select: 1 }, ALL)).toEqual([...ALL]);
  });

  it('moves a tool before or after the one it is dropped on', () => {
    expect(moveTool([...ALL], 'move', 'line', false)).toEqual(['select', 'move', 'line', 'rectangle', 'circle']);
    expect(moveTool([...ALL], 'select', 'circle', true)).toEqual(['line', 'rectangle', 'circle', 'select', 'move']);
    expect(moveTool([...ALL], 'line', 'line', true)).toEqual([...ALL]);
  });
});

describe('choosing the palette tools', () => {
  const KEEP = ['select'] as const;

  it('starts with every tool; damaged or missing choices show every tool', () => {
    for (const saved of [null, 'x', { hidden: 3 }]) {
      expect(readPaletteChoice(saved, ALL, KEEP)).toEqual({ choice: { hidden: [], known: [...ALL], unseen: [] }, fresh: [] });
    }
  });

  it('a tool from a newer version joins a full palette, but stays out of a chosen one (offered as new)', () => {
    const older = ['select', 'line', 'rectangle', 'circle'];
    expect(readPaletteChoice({ hidden: [], known: older }, ALL, KEEP).choice.hidden).toEqual([]);
    const fewer = readPaletteChoice({ hidden: ['circle'], known: older }, ALL, KEEP);
    expect(fewer.choice.hidden).toEqual(['circle', 'move']);
    expect(fewer.choice.unseen).toEqual(['move']);
    expect(fewer.fresh).toEqual(['move']);
    expect(fewer.choice.known).toEqual([...ALL]);
    // Read again (saved after the first read): still unseen, no longer fresh.
    const again = readPaletteChoice(fewer.choice, ALL, KEEP);
    expect(again.fresh).toEqual([]);
    expect(again.choice.unseen).toEqual(['move']);
  });

  it('kept tools and unknown ids are never left out', () => {
    expect(readPaletteChoice({ hidden: ['select', 'gone', 'line'], known: ALL }, ALL, KEEP).choice.hidden).toEqual(['line']);
  });

  it('leaves a tool out or puts it back, and presets choose exactly their tools', () => {
    const none = readPaletteChoice(null, ALL, KEEP).choice;
    const out = showTool(none, 'circle', false, KEEP);
    expect(out.hidden).toEqual(['circle']);
    expect(showTool(out, 'circle', true, KEEP).hidden).toEqual([]);
    expect(showTool(none, 'select', false, KEEP).hidden).toEqual([]);
    expect(showTool({ ...out, unseen: ['circle'] }, 'circle', true, KEEP).unseen).toEqual([]);
    expect(choosePaletteTools(ALL, ['line', 'move'], KEEP).hidden).toEqual(['rectangle', 'circle']);
  });
});
