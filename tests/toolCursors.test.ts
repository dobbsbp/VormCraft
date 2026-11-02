import { describe, expect, it } from 'vitest';
import { toolCursor } from '../src/app/toolCursors';

const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M1 2h3"/></svg>';

describe('tool cursors', () => {
  it('Select keeps the normal arrow', () => {
    expect(toolCursor('select', icon)).toBe('default');
  });

  it("other tools: the tool's icon with a pointer triangle, tip (hotspot) at the top-left", () => {
    const css = toolCursor('paint', icon);
    const m = /^url\("data:image\/svg\+xml,(.+)"\) 1 1, crosshair$/.exec(css);
    expect(m).not.toBeNull();
    const svg = decodeURIComponent(m![1]);
    expect(svg).toContain('width="32" height="32"');
    expect(svg).toContain('<path d="M1 1v9.5L10.5 1Z"'); // the triangle, its tip at (1, 1)
    expect(svg.split('<path d="M1 2h3"/>')).toHaveLength(3); // icon drawn twice: outline and ink
    expect(svg).not.toContain('aria-hidden');
    // Well-formed XML (a repeated attribute makes the browser drop the whole cursor).
    for (const tag of svg.match(/<[a-z][^>]*>/g)!) {
      const names = [...tag.matchAll(/\s([a-z-]+)=/g)].map((x) => x[1]);
      expect(new Set(names).size, tag).toBe(names.length);
    }
  });
});
