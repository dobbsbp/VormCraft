import type { ToolId } from '../tools/types';

/** Tools that keep the normal arrow (Select is an arrow already). */
const PLAIN: ReadonlySet<ToolId> = new Set(['select']);

const INK = '#1f2328';
const HALO = '#ffffff';
const SIZE = 32;

/**
 * The mouse cursor for a tool: a small triangle in the top-left corner whose tip is the exact
 * click point, with the tool's own icon beside it. The icon is drawn dark over a white outline so
 * it shows on light and dark backgrounds. Returns a CSS `cursor` value.
 */
export function toolCursor(id: ToolId, icon: string): string {
  if (PLAIN.has(id)) return 'default';
  const body = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(icon)?.[1] ?? '';
  const attrs = (width: number, color: string) => `fill="none" stroke="currentColor" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" color="${color}"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">` +
    `<g transform="translate(9 9) scale(0.9)">` +
    `<g ${attrs(4, HALO)}>${body}</g>` +
    `<g ${attrs(1.5, INK)}>${body}</g>` +
    `</g>` +
    `<path d="M1 1v9.5L10.5 1Z" fill="${INK}" stroke="${HALO}" stroke-width="1" stroke-linejoin="round"/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 1 1, crosshair`;
}
