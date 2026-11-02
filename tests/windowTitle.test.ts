import { describe, expect, it } from 'vitest';
import { windowTitle } from '../src/app/fileCommands';

describe('window title', () => {
  it('app name first, then the file name, • while unsaved, and a previewed version', () => {
    expect(windowTitle('Untitled', false)).toBe('VormCraft — Untitled');
    expect(windowTitle('Untitled', true)).toBe('VormCraft — Untitled •');
    expect(windowTitle('Kitchen shelf', false)).toBe('VormCraft — Kitchen shelf');
    expect(windowTitle('Kitchen shelf', true)).toBe('VormCraft — Kitchen shelf •');
    expect(windowTitle('Kitchen shelf', false, '2 Nov 2026, 14:05')).toBe('VormCraft — Kitchen shelf (viewing 2 Nov 2026, 14:05)');
  });
});
