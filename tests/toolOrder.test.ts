import { describe, expect, it } from 'vitest';
import { moveTool, orderTools } from '../src/app/toolOrder';

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
