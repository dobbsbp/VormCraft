import type { LibraryItem, LibraryOpening, LibraryParam, LibraryVariant } from './catalog';
import { ROOMS } from './catalog';
import { part, type LibraryPart, type Part } from './kit';
import { customisable, need, paramValues } from './params';

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

const custom = (def: Omit<Parameters<typeof customisable>[0], 'category'>): LibraryItem => customisable({ category: 'Building', ...def });

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

/** The settings of doors and windows, shared by `build` and `opening`. */
const DOOR: { params: LibraryParam[]; preset(v?: string): Record<string, number> } = {
  params: [
    { id: 'width', name: 'Width (outside the frame)', kind: 'length', value: 800, min: 500, max: 2400, note: 'Two doors from 1400 mm.' },
    { id: 'height', name: 'Height', kind: 'length', value: 2100, min: 1500, max: 3000 },
  ],
  preset: (v) => ({ width: sizeOf(v, DOORS, 2100).w }),
};

const WINDOW: typeof DOOR = {
  params: [
    { id: 'width', name: 'Width (outside the frame)', kind: 'length', value: 600, min: 300, max: 4000, note: 'Two panes from 1600 mm.' },
    { id: 'height', name: 'Height', kind: 'length', value: 600, min: 300, max: 3000 },
    { id: 'sill', name: 'Bottom above the floor', kind: 'length', value: 1400, min: 0, max: 2500 },
  ],
  preset: (v) => {
    const { w, h } = sizeOf(v, WINDOWS, 1200);
    return { width: w, height: h, sill: windowSill(h, w) };
  },
};

export const BUILDING: LibraryItem[] = [
  custom({
    id: 'door',
    name: 'Door',
    subcategory: 'Doors and windows',
    rooms: ALL_ROOMS,
    tags: ['door', 'doorway', 'entrance', 'opening', 'internal door', 'double door', 'leaf'],
    variants: DOORS,
    ...DOOR,
    opening(v, given) {
      const { width, height } = paramValues(DOOR, v, given);
      return opening(width, height, 0);
    },
    make: ({ width: w, height: h }) => {
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
  custom({
    id: 'window',
    name: 'Window',
    subcategory: 'Doors and windows',
    rooms: ALL_ROOMS,
    tags: ['window', 'glazing', 'glass', 'pane', 'casement', 'opening', 'light'],
    variants: WINDOWS,
    ...WINDOW,
    opening(v, given) {
      const { width, height, sill } = paramValues(WINDOW, v, given);
      return opening(width, height, sill);
    },
    make: ({ width: w, height: h }) => {
      need(w > 2 * SIDE + 50 && h > 2 * SIDE + 50, 'Too small for its frame: make it bigger');
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
