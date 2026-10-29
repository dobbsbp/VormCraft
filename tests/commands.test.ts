import { describe, expect, it } from 'vitest';
import { searchCommands, type Command } from '../src/app/commands';

const cmd = (name: string, keywords?: string[]): Command => ({ id: name, name, keywords, run: () => {} });
const list = [
  cmd('Select'),
  cmd('Push/Pull'),
  cmd('Rectangle'),
  cmd('Export STL…', ['export', '3d print']),
  cmd('Top View', ['camera']),
  cmd('Show/Hide Guides', ['guide']),
  cmd('Zoom Extents', ['camera', 'fit']),
];
const names = (q: string) => searchCommands(list, q).map((c) => c.name);

describe('command search', () => {
  it('empty query lists everything in order', () => {
    expect(names('')).toEqual(list.map((c) => c.name));
  });

  it('matches the start of any word in the name, best first', () => {
    expect(names('pull')[0]).toBe('Push/Pull');
    expect(names('stl')[0]).toBe('Export STL…');
    expect(names('top')).toEqual(['Top View']);
  });

  it('matches keywords', () => {
    expect(names('print')).toEqual(['Export STL…']);
    expect(names('camera')).toEqual(['Top View', 'Zoom Extents']);
  });

  it('every word must match', () => {
    expect(names('zoom fit')).toEqual(['Zoom Extents']);
    expect(names('zoom stl')).toEqual([]);
  });

  it('letters in order still find a command (pp → Push/Pull)', () => {
    expect(names('pp')).toContain('Push/Pull');
  });

  it('is case-insensitive', () => {
    expect(names('RECT')).toEqual(['Rectangle']);
  });
});
