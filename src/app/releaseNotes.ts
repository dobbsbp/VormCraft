/**
 * Release notes (from CHANGELOG.md) as simple blocks: paragraphs and bullet lists, with **bold**
 * and `code` spans. Only this small subset of Markdown is understood; everything else is shown as
 * written. Kept free of the DOM so it can be tested.
 */
export type NoteSpan = { text: string; bold?: boolean; code?: boolean };
export type NoteBlock = { kind: 'paragraph' | 'heading'; spans: NoteSpan[] } | { kind: 'list'; items: NoteSpan[][] };

/** **bold** and `code` within a line; unmatched markers stay as text. */
export function parseSpans(line: string): NoteSpan[] {
  const out: NoteSpan[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > at) out.push({ text: line.slice(at, m.index) });
    out.push(m[1] !== undefined ? { text: m[1], bold: true } : { text: m[2], code: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at) });
  return out;
}

export function parseNotes(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let paragraph: string[] = [];
  let list: NoteSpan[][] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', spans: parseSpans(paragraph.join(' ')) });
    paragraph = [];
    if (list) blocks.push({ kind: 'list', items: list });
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (bullet) {
      if (paragraph.length) flush();
      (list ??= []).push(parseSpans(bullet[1]));
    } else if (heading) {
      flush();
      blocks.push({ kind: 'heading', spans: parseSpans(heading[1]) });
    } else if (list && raw.startsWith(' ')) {
      // A wrapped bullet line continues the bullet.
      const last = list[list.length - 1];
      last.push({ text: ' ' }, ...parseSpans(line));
    } else {
      if (list) flush();
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

/** The notes as page content (text nodes only: nothing in the notes can run as HTML). */
export function renderNotes(text: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'release-notes';
  const spans = (parts: NoteSpan[], into: HTMLElement) => {
    for (const s of parts) {
      const node = s.bold ? document.createElement('strong') : s.code ? document.createElement('code') : null;
      if (node) {
        node.textContent = s.text;
        into.append(node);
      } else into.append(s.text);
    }
  };
  for (const b of parseNotes(text)) {
    if (b.kind === 'list') {
      const ul = document.createElement('ul');
      for (const item of b.items) {
        const li = document.createElement('li');
        spans(item, li);
        ul.append(li);
      }
      box.append(ul);
    } else {
      const el = document.createElement(b.kind === 'heading' ? 'h3' : 'p');
      spans(b.spans, el);
      box.append(el);
    }
  }
  return box;
}
