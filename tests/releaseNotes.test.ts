import { describe, expect, it } from 'vitest';
import { parseNotes, parseSpans } from '../src/app/releaseNotes';

describe('release notes', () => {
  it('bold and code spans; unmatched markers stay as text', () => {
    expect(parseSpans('**Groups:** Ctrl+G and `.vorm`')).toEqual([{ text: 'Groups:', bold: true }, { text: ' Ctrl+G and ' }, { text: '.vorm', code: true }]);
    expect(parseSpans('a ** b')).toEqual([{ text: 'a ** b' }]);
  });

  it('paragraphs, bullet lists and headings', () => {
    const blocks = parseNotes('The first release.\n\n- **Groups:** one\n- Scenes: two\n  still two\n\n## Fixes\nPlain text');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'heading', 'paragraph']);
    const list = blocks[1] as Extract<(typeof blocks)[number], { kind: 'list' }>;
    expect(list.items).toHaveLength(2);
    expect(list.items[0][0]).toEqual({ text: 'Groups:', bold: true });
    expect(list.items[1].map((s) => s.text).join('')).toBe('Scenes: two still two');
  });

  it('the 0.2.0 changelog section reads as a paragraph and a list', () => {
    const notes = 'The first Windows release.\n\n- **Groups:** a\n- **Scenes:** b';
    expect(parseNotes(notes).map((b) => b.kind)).toEqual(['paragraph', 'list']);
  });
});
