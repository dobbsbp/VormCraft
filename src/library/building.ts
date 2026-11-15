import type { LibraryItem, LibraryOpening, LibraryVariant } from './catalog';
import { ROOMS } from './catalog';
import { part, type LibraryPart, type Part } from './kit';

/**
 * Building items: doors and windows. Each stands on z = 0 centred on the origin, its outside face
 * towards -Y, `FRAME` deep (centred on y = 0). Placed on a wall, it turns to face out of it, sits in
 * the middle of the wall's thickness, and cuts its own opening through it (`opening`): the frame's
 * outside size, at the item's usual height above the floor (`sill`).
 */

type Range = readonly [number, number];
const sym = (half: number): Range => [-half, half];
const box = (p: Part, x: Range, y: Range, z: Range): Part => p.box([x[0], y[0], z[0]], [x[1], y[1], z[1]]);
const cut = (p: Part, x: Range, y: Range, z: Range): Part => p.cutBox([x[0], y[0], z[0]], [x[1], y[1], z[1]]);
const done = (...parts: Part[]): LibraryPart[] => parts.map((p) => p.build());

/** How deep door and window frames are, and how wide their sides. */
const FRAME = 100;
const SIDE = 50;

const ALL_ROOMS = [...ROOMS];

function item(def: Omit<LibraryItem, 'category'>): LibraryItem {
  return { category: 'Building', ...def };
}

/** "900" → 900 × 2100 for doors; "1200x1200" → width × height. */
function sizeOf(id: string | undefined, variants: readonly LibraryVariant[], height: number): { w: number; h: number } {
  const [w, h] = (id ?? variants[0].id).split('x').map(Number);
  return { w, h: h || height };
}

const DOORS: LibraryVariant[] = [
  { id: '800', name: 'Single, 800 mm' },
  { id: '900', name: 'Single, 900 mm' },
  { id: '1600', name: 'Double, 1600 mm' },
];

const WINDOWS: LibraryVariant[] = [
  { id: '600x600', name: '600 × 600 mm (small)' },
  { id: '1200x1200', name: '1200 × 1200 mm' },
  { id: '1800x1200', name: '1800 × 1200 mm (two panes)' },
  { id: '1200x2100', name: '1200 × 2100 mm (to the floor)' },
];

/** Where a window's bottom sits above the floor: small ones higher, tall ones at the floor. */
function windowSill(h: number, w: number): number {
  if (h >= 2000) return 0;
  return w <= 600 ? 1400 : 900;
}

const opening = (w: number, h: number, sill: number): LibraryOpening => ({ width: w, height: h, sill });

export const BUILDING: LibraryItem[] = [
  item({
    id: 'door',
    name: 'Door',
    subcategory: 'Doors and windows',
    rooms: ALL_ROOMS,
    tags: ['door', 'doorway', 'entrance', 'opening', 'internal door', 'double door', 'leaf'],
    variants: DOORS,
    opening: (v) => opening(sizeOf(v, DOORS, 2100).w, 2100, 0),
    build: (v) => {
      const { w, h } = sizeOf(v, DOORS, 2100);
      const frame = part('Frame', 'white');
      box(frame, sym(w / 2), sym(FRAME / 2), [0, h]);
      cut(frame, sym(w / 2 - SIDE), sym(FRAME), [-10, h - SIDE]);
      const leaf = part('Door', 'oak');
      const handle = part('Handle', 'steel');
      const leaves = w >= 1400 ? 2 : 1;
      const inner = w - 2 * SIDE;
      const each = inner / leaves;
      for (let i = 0; i < leaves; i++) {
        const x0 = -inner / 2 + i * each;
        box(leaf, [x0 + 2, x0 + each - 2], sym(20), [5, h - SIDE - 2]);
        // A lever on each side, near the free edge.
        const hx = leaves === 2 ? (i === 0 ? x0 + each - 90 : x0 + 90) : x0 + each - 90;
        for (const side of [-1, 1]) box(handle, [hx - 60, hx + 60], side < 0 ? [-45, -20] : [20, 45], [1000, 1020]);
      }
      return done(frame, leaf, handle);
    },
  }),
  item({
    id: 'window',
    name: 'Window',
    subcategory: 'Doors and windows',
    rooms: ALL_ROOMS,
    tags: ['window', 'glazing', 'glass', 'pane', 'casement', 'opening', 'light'],
    variants: WINDOWS,
    opening: (v) => {
      const { w, h } = sizeOf(v, WINDOWS, 1200);
      return opening(w, h, windowSill(h, w));
    },
    build: (v) => {
      const { w, h } = sizeOf(v, WINDOWS, 1200);
      const frame = part('Frame', 'white');
      box(frame, sym(w / 2), sym(FRAME / 2 - 15), [0, h]);
      cut(frame, sym(w / 2 - SIDE), sym(FRAME), [SIDE, h - SIDE]);
      // Wide windows have a bar down the middle: two panes.
      if (w >= 1600) box(frame, sym(SIDE / 2), sym(FRAME / 2 - 15), [SIDE - 5, h - SIDE + 5]);
      const glass = part('Glass', 'glass');
      box(glass, sym(w / 2 - SIDE + 5), sym(4), [SIDE - 5, h - SIDE + 5]);
      return done(frame, glass);
    },
  }),
];
