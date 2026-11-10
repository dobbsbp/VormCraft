import { scale, type Vec3 } from '../core/math/vec3';
import type { LibraryItem, LibraryVariant, Room } from './catalog';
import { part, type LibraryPart, type Paint, type Part } from './kit';

/**
 * Household items: furniture, kitchen, bathroom, electronics, lighting and decor, at common
 * real-world sizes (mm). Each stands on z = 0 centred on the origin, front facing -Y. Shapes in
 * one part overlap a little where they join (so they union into one solid); parts may touch or
 * overlap each other freely, as each becomes a group of its own.
 */

type Range = readonly [number, number];
const sym = (half: number): Range => [-half, half];
const box = (p: Part, x: Range, y: Range, z: Range): Part => p.box([x[0], y[0], z[0]], [x[1], y[1], z[1]]);
const cut = (p: Part, x: Range, y: Range, z: Range): Part => p.cutBox([x[0], y[0], z[0]], [x[1], y[1], z[1]]);
const done = (...parts: Part[]): LibraryPart[] => parts.map((p) => p.build());

/** Four square legs `t` thick, `inset` in from the corners of a w × d footprint, from the floor to `h`. */
function squareLegs(p: Part, w: number, d: number, t: number, h: number, inset = 0): Part {
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx * (w / 2 - inset - t / 2);
      const y = sy * (d / 2 - inset - t / 2);
      box(p, [x - t / 2, x + t / 2], [y - t / 2, y + t / 2], [0, h]);
    }
  }
  return p;
}

/** Four round legs of radius `r`, `inset` in from the corners, from the floor to `h`. */
function roundLegs(p: Part, w: number, d: number, r: number, h: number, inset = 0): Part {
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) p.cylinder('z', [sx * (w / 2 - inset - r), sy * (d / 2 - inset - r), 0], r, h, 12);
  return p;
}

/**
 * Doors or drawer fronts on the face y = `y` (the front), filling x × z in `cols` × `rows` panels
 * with 3 mm gaps, 18 mm thick, each with a handle (vertical for doors, else horizontal).
 */
function fronts(f: Part, h: Part | null, x: Range, z: Range, y: number, cols: number, rows: number, doors: boolean): void {
  const gap = 3;
  const w = (x[1] - x[0] - gap * (cols + 1)) / cols;
  const t = (z[1] - z[0] - gap * (rows + 1)) / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x0 = x[0] + gap + c * (w + gap);
      const z0 = z[0] + gap + r * (t + gap);
      box(f, [x0, x0 + w], [y - 18, y], [z0, z0 + t]);
      if (!h) continue;
      if (doors) {
        // Handles beside the meeting edges (by the hinge-free side), near the top.
        const hx = cols === 1 ? x0 + w - 40 : c % 2 === 0 ? x0 + w - 40 : x0 + 40;
        const len = Math.min(200, t * 0.4);
        const top = z0 + t - 60;
        box(h, [hx - 6, hx + 6], [y - 45, y - 15], [top - len, top]);
      } else {
        const len = Math.min(w * 0.5, 300);
        const mid = z0 + t / 2;
        box(h, [x0 + w / 2 - len / 2, x0 + w / 2 + len / 2], [y - 45, y - 15], [mid - 6, mid + 6]);
      }
    }
  }
}

function item(def: Omit<LibraryItem, 'category'>): LibraryItem {
  return { category: 'Household', ...def };
}

/** Variants from widths: "800 mm" names unless given. */
const widths = (...ws: (number | [number, string])[]): LibraryVariant[] =>
  ws.map((w) => (Array.isArray(w) ? { id: String(w[0]), name: w[1] } : { id: String(w), name: `${w} mm wide` }));

const pick = (variants: readonly LibraryVariant[], id: string | undefined): number => Number(id ?? variants[0].id);

// ——— Furniture ———

const SOFAS = widths([1600, '2-seat (1600 mm)'], [2100, '3-seat (2100 mm)'], [2600, '4-seat (2600 mm)']);

function upholstered(w: number, seats: number, cover: Paint): LibraryPart[] {
  const d = 880;
  const body = part('Upholstery', cover);
  box(body, sym(w / 2), sym(d / 2), [140, 420]);
  box(body, sym(w / 2), [d / 2 - 180, d / 2], [140, 800]);
  for (const s of [-1, 1]) box(body, s < 0 ? [-w / 2, -w / 2 + 130] : [w / 2 - 130, w / 2], sym(d / 2), [140, 620]);
  const cushions = part('Cushions', 'linen');
  const inner = w - 260;
  const cw = (inner - (seats - 1) * 10) / seats;
  for (let i = 0; i < seats; i++) {
    const x0 = -inner / 2 + i * (cw + 10);
    box(cushions, [x0, x0 + cw], [-d / 2 + 10, d / 2 - 180], [420, 520]);
    box(cushions, [x0, x0 + cw], [d / 2 - 300, d / 2 - 180], [520, 760]);
  }
  const legs = roundLegs(part('Legs', 'walnut'), w, d, 20, 150, 50);
  return done(body, cushions, legs);
}

const TABLES = widths([1200, 'For 4 (1200 × 800)'], [1800, 'For 6 (1800 × 900)'], [2400, 'For 8 (2400 × 1000)']);
const BEDS: LibraryVariant[] = [
  { id: '900', name: 'Single (90 × 200 cm)' },
  { id: '1200', name: 'Small double (120 × 200 cm)' },
  { id: '1600', name: 'Queen (160 × 200 cm)' },
  { id: '1800', name: 'King (180 × 200 cm)' },
];

const furniture: LibraryItem[] = [
  item({
    id: 'dining-chair',
    name: 'Dining chair',
    subcategory: 'Furniture',
    rooms: ['Dining room', 'Kitchen'],
    tags: ['chair', 'seat', 'wooden chair', 'kitchen chair', 'seating'],
    build: () => {
      const w = 440;
      const d = 460;
      const frame = part('Frame', 'oak');
      box(frame, sym(w / 2), sym(d / 2), [420, 450]);
      for (const sx of [-1, 1]) {
        const x: Range = [sx * (w / 2) - (sx > 0 ? 35 : 0), sx * (w / 2) + (sx < 0 ? 35 : 0)];
        box(frame, x, [-d / 2, -d / 2 + 35], [0, 435]);
        box(frame, x, [d / 2 - 35, d / 2], [0, 900]);
      }
      box(frame, sym(w / 2 - 10), [d / 2 - 30, d / 2 - 10], [620, 880]);
      return done(frame);
    },
  }),
  item({
    id: 'armchair',
    name: 'Armchair',
    subcategory: 'Furniture',
    rooms: ['Living room', 'Bedroom'],
    tags: ['chair', 'easy chair', 'lounge chair', 'seat', 'upholstered', 'seating'],
    build: () => upholstered(860, 1, 'fabric'),
  }),
  item({
    id: 'sofa',
    name: 'Sofa',
    subcategory: 'Furniture',
    rooms: ['Living room'],
    tags: ['couch', 'settee', 'lounge', 'seating', 'upholstered'],
    variants: SOFAS,
    build: (v) => {
      const w = pick(SOFAS, v);
      return upholstered(w, w <= 1600 ? 2 : w <= 2100 ? 3 : 4, 'fabricBlue');
    },
  }),
  item({
    id: 'bar-stool',
    name: 'Bar stool',
    subcategory: 'Furniture',
    rooms: ['Kitchen', 'Dining room'],
    tags: ['stool', 'counter stool', 'high chair', 'seat', 'seating', 'island'],
    variants: [
      { id: '750', name: 'Bar height (seat 750 mm)' },
      { id: '650', name: 'Counter height (seat 650 mm)' },
    ],
    build: (v) => {
      const h = Number(v ?? 750);
      const seat = part('Seat', 'oak').cylinder('z', [0, 0, h - 40], 180, 40);
      const frame = part('Frame', 'black');
      for (const [x, y] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ])
        frame.cylinder('z', [x * 115, y * 115, 0], 14, h - 30, 12);
      box(frame, sym(129), [-129, -101], [280, 300]);
      box(frame, sym(129), [101, 129], [280, 300]);
      box(frame, [-129, -101], sym(129), [280, 300]);
      box(frame, [101, 129], sym(129), [280, 300]);
      return done(seat, frame);
    },
  }),
  item({
    id: 'dining-table',
    name: 'Dining table',
    subcategory: 'Furniture',
    rooms: ['Dining room', 'Kitchen'],
    tags: ['table', 'kitchen table', 'rectangular table', 'wooden table'],
    variants: TABLES,
    build: (v) => {
      const w = pick(TABLES, v);
      const d = w <= 1200 ? 800 : w <= 1800 ? 900 : 1000;
      const t = part('Table', 'oak');
      box(t, sym(w / 2), sym(d / 2), [720, 750]);
      squareLegs(t, w, d, 70, 735, 50);
      return done(t);
    },
  }),
  item({
    id: 'round-table',
    name: 'Round table',
    subcategory: 'Furniture',
    rooms: ['Dining room', 'Kitchen'],
    tags: ['table', 'pedestal table', 'circular table', 'bistro table'],
    variants: [
      { id: '900', name: 'Ø 900 mm (2–4 people)' },
      { id: '1200', name: 'Ø 1200 mm (4–6 people)' },
    ],
    build: (v) => {
      const r = Number(v ?? 900) / 2;
      const top = part('Top', 'oak').cylinder('z', [0, 0, 720], r, 30, 32);
      const base = part('Base', 'black').cylinder('z', [0, 0, 0], 60, 730, 16).cylinder('z', [0, 0, 0], r * 0.5, 25, 24);
      return done(top, base);
    },
  }),
  item({
    id: 'coffee-table',
    name: 'Coffee table',
    subcategory: 'Furniture',
    rooms: ['Living room'],
    tags: ['table', 'low table', 'cocktail table', 'centre table'],
    build: () => {
      const w = 1100;
      const d = 600;
      const t = part('Table', 'walnut');
      box(t, sym(w / 2), sym(d / 2), [390, 420]);
      box(t, sym(w / 2 - 30), sym(d / 2 - 30), [110, 130]);
      squareLegs(t, w, d, 40, 400, 20);
      return done(t);
    },
  }),
  item({
    id: 'side-table',
    name: 'Side table',
    subcategory: 'Furniture',
    rooms: ['Living room', 'Bedroom'],
    tags: ['table', 'end table', 'lamp table', 'small table'],
    build: () => {
      const t = part('Table', 'oak');
      box(t, sym(250), sym(250), [520, 550]);
      squareLegs(t, 500, 500, 35, 530, 15);
      return done(t);
    },
  }),
  item({
    id: 'desk',
    name: 'Desk',
    subcategory: 'Furniture',
    rooms: ['Office', 'Bedroom'],
    tags: ['table', 'writing desk', 'computer desk', 'work desk', 'study', 'workstation'],
    variants: widths(1200, 1400, 1600),
    build: (v) => {
      const w = Number(v ?? 1200);
      const top = part('Top', 'oak');
      box(top, sym(w / 2), sym(350), [725, 750]);
      const frame = squareLegs(part('Frame', 'black'), w, 700, 40, 730, 30);
      box(frame, sym(w / 2 - 50), [300, 320], [600, 730]);
      return done(top, frame);
    },
  }),
  item({
    id: 'office-chair',
    name: 'Office chair',
    subcategory: 'Furniture',
    rooms: ['Office'],
    tags: ['chair', 'desk chair', 'task chair', 'swivel chair', 'computer chair', 'seating'],
    build: () => {
      const seat = part('Seat', 'black');
      box(seat, sym(240), [-250, 230], [400, 470]);
      box(seat, sym(230), [200, 240], [480, 1020]);
      const frame = part('Frame', 'darkGrey');
      frame.cylinder('z', [0, 0, 60], 25, 350, 16);
      box(frame, sym(20), [-20, 230], [380, 410]);
      box(frame, sym(20), [200, 235], [380, 560]);
      for (const s of [-1, 1]) {
        box(frame, s < 0 ? [-270, -240] : [240, 270], [-150, 120], [640, 670]);
        box(frame, s < 0 ? [-265, -245] : [245, 265], [0, 60], [420, 650]);
        box(frame, s < 0 ? [-265, -200] : [200, 265], [0, 60], [400, 430]);
      }
      // A five-point base on castors.
      for (let i = 0; i < 5; i++) {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const pt = (r: number, side: number): Vec3 => [r * c - side * s, r * s + side * c, 50];
        frame.prism([pt(0, -22), pt(320, -18), pt(320, 18), pt(0, 22)], [0, 0, 30]);
        frame.cylinder('z', [300 * c, 300 * s, 0], 25, 55, 12);
      }
      return done(seat, frame);
    },
  }),
  item({
    id: 'bed',
    name: 'Bed',
    subcategory: 'Furniture',
    rooms: ['Bedroom'],
    tags: ['bed frame', 'mattress', 'double bed', 'single bed', 'queen bed', 'king bed', 'headboard', 'sleep'],
    variants: BEDS,
    build: (v) => {
      const w = pick(BEDS, v);
      const L = 2000;
      const frame = part('Frame', 'walnut');
      box(frame, sym(w / 2 + 25), sym(L / 2 + 25), [120, 300]);
      box(frame, sym(w / 2 + 25), [L / 2 + 5, L / 2 + 60], [0, 1050]);
      squareLegs(frame, w + 50, L + 50, 60, 130);
      const mattress = part('Mattress', 'white');
      box(mattress, sym(w / 2), sym(L / 2), [300, 500]);
      const bedding = part('Bedding', 'fabricBlue');
      box(bedding, sym(w / 2 + 15), [-L / 2 - 15, L / 2 - 500], [460, 520]);
      const pillows = part('Pillows', 'linen');
      const n = w < 1200 ? 1 : 2;
      const pw = Math.min(650, (w - 80 - (n - 1) * 40) / n);
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? 0 : (i === 0 ? -1 : 1) * (pw / 2 + 20);
        box(pillows, [x - pw / 2, x + pw / 2], [L / 2 - 460, L / 2 - 60], [500, 620]);
      }
      return done(frame, mattress, bedding, pillows);
    },
  }),
  item({
    id: 'nightstand',
    name: 'Bedside table',
    subcategory: 'Furniture',
    rooms: ['Bedroom'],
    tags: ['nightstand', 'night table', 'bedside cabinet', 'drawers'],
    build: () => {
      const body = part('Body', 'oak');
      box(body, sym(225), [-182, 200], [130, 560]);
      roundLegs(body, 450, 382, 15, 140, 20);
      const fr = part('Drawers', 'oak');
      const handles = part('Handles', 'steel');
      fronts(fr, handles, sym(225), [130, 560], -182, 1, 2, false);
      return done(body, fr, handles);
    },
  }),
  item({
    id: 'wardrobe',
    name: 'Wardrobe',
    subcategory: 'Furniture',
    rooms: ['Bedroom', 'Hallway'],
    tags: ['closet', 'armoire', 'cupboard', 'clothes', 'storage'],
    variants: widths([1000, '2 doors (1000 mm)'], [1500, '3 doors (1500 mm)']),
    build: (v) => {
      const w = Number(v ?? 1000);
      const body = part('Body', 'white');
      box(body, sym(w / 2), [-282, 300], [0, 2000]);
      const doors = part('Doors', 'offWhite');
      const handles = part('Handles', 'steel');
      fronts(doors, handles, sym(w / 2), [60, 2000], -282, w <= 1000 ? 2 : 3, 1, true);
      return done(body, doors, handles);
    },
  }),
  item({
    id: 'chest-of-drawers',
    name: 'Chest of drawers',
    subcategory: 'Furniture',
    rooms: ['Bedroom', 'Hallway'],
    tags: ['dresser', 'drawers', 'bureau', 'storage', 'cabinet'],
    build: () => {
      const body = part('Body', 'oak');
      box(body, sym(400), [-207, 225], [80, 850]);
      squareLegs(body, 800, 432, 40, 90, 20);
      const fr = part('Drawers', 'oak');
      const handles = part('Handles', 'steel');
      fronts(fr, handles, sym(400), [80, 850], -207, 1, 4, false);
      return done(body, fr, handles);
    },
  }),
  item({
    id: 'bookshelf',
    name: 'Bookshelf',
    subcategory: 'Furniture',
    rooms: ['Living room', 'Office', 'Bedroom'],
    tags: ['bookcase', 'shelves', 'shelving', 'shelf unit', 'books', 'storage'],
    variants: [
      { id: '1800', name: '1800 mm tall, 5 shelves' },
      { id: '1000', name: '1000 mm tall, 3 shelves' },
    ],
    build: (v) => {
      const h = Number(v ?? 1800);
      const n = h >= 1800 ? 5 : 3;
      const shelf = part('Shelf', 'oak');
      box(shelf, sym(400), sym(150), [0, h]);
      const inner = (h - 60 - 20 - (n - 1) * 20) / n;
      for (let i = 0; i < n; i++) {
        const z0 = 60 + i * (inner + 20);
        cut(shelf, sym(382), [-160, 140], [z0, z0 + inner]);
      }
      return done(shelf);
    },
  }),
  item({
    id: 'tv-stand',
    name: 'TV stand',
    subcategory: 'Furniture',
    rooms: ['Living room', 'Bedroom'],
    tags: ['media unit', 'tv unit', 'tv bench', 'entertainment unit', 'low cabinet', 'console'],
    build: () => {
      const body = part('Body', 'walnut');
      box(body, sym(800), sym(200), [150, 500]);
      for (const x of [-780, -250, 270]) cut(body, [x, x + 510], [-210, 182], [168, 482]);
      const legs = squareLegs(part('Legs', 'black'), 1600, 400, 30, 160, 40);
      return done(body, legs);
    },
  }),
  item({
    id: 'sideboard',
    name: 'Sideboard',
    subcategory: 'Furniture',
    rooms: ['Dining room', 'Living room'],
    tags: ['buffet', 'credenza', 'cabinet', 'cupboard', 'storage'],
    build: () => {
      const body = part('Body', 'walnut');
      box(body, sym(800), [-207, 225], [150, 800]);
      const doors = part('Doors', 'walnut');
      const handles = part('Handles', 'steel');
      fronts(doors, handles, sym(800), [150, 800], -207, 4, 1, true);
      const legs = roundLegs(part('Legs', 'black'), 1600, 432, 15, 160, 40);
      return done(body, doors, handles, legs);
    },
  }),
];

// ——— Kitchen ———

/** A kitchen base unit: carcass on a plinth, worktop, doors (or drawers) and handles. */
function baseUnit(w: number, opts: { drawers?: boolean; worktopBack?: number } = {}): { parts: Part[]; worktop: Part } {
  const carcass = part('Carcass', 'white');
  box(carcass, sym(w / 2), [-282, 300], [100, 870]);
  box(carcass, sym(w / 2), [-232, 300], [0, 110]);
  const doors = part(opts.drawers ? 'Drawers' : 'Doors', 'white');
  const handles = part('Handles', 'steel');
  fronts(doors, handles, sym(w / 2), [100, 870], -282, opts.drawers ? 1 : w > 600 ? 2 : 1, opts.drawers ? 3 : 1, !opts.drawers);
  const worktop = part('Worktop', 'worktop');
  box(worktop, sym(w / 2), [-320, opts.worktopBack ?? 300], [870, 900]);
  return { parts: [carcass, doors, handles], worktop };
}

const kitchen: LibraryItem[] = [
  item({
    id: 'base-cabinet',
    name: 'Kitchen base cabinet',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['cabinet', 'base unit', 'cupboard', 'counter', 'worktop', 'countertop'],
    variants: widths(300, 400, 600, 800, 900),
    build: (v) => {
      const u = baseUnit(Number(v ?? 300));
      return done(...u.parts, u.worktop);
    },
  }),
  item({
    id: 'drawer-cabinet',
    name: 'Kitchen drawer unit',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['cabinet', 'drawers', 'base unit', 'pan drawers', 'counter', 'worktop'],
    variants: widths(400, 600, 800),
    build: (v) => {
      const u = baseUnit(Number(v ?? 400), { drawers: true });
      return done(...u.parts, u.worktop);
    },
  }),
  item({
    id: 'sink-cabinet',
    name: 'Sink unit',
    subcategory: 'Kitchen',
    rooms: ['Kitchen', 'Laundry'],
    tags: ['sink', 'kitchen sink', 'basin', 'tap', 'faucet', 'cabinet', 'base unit'],
    variants: widths(800, 1000),
    build: (v) => {
      const w = Number(v ?? 800);
      const u = baseUnit(w);
      const bw = Math.min(w - 260, 700) / 2;
      cut(u.worktop, sym(bw + 10), [-240, 200], [860, 910]);
      cut(u.parts[0], sym(bw + 20), [-250, 210], [690, 880]);
      const sink = part('Sink', 'steel');
      box(sink, sym(bw + 20), [-250, 210], [700, 904]);
      cut(sink, sym(bw), [-230, 190], [720, 910]);
      const tap = part('Tap', 'steel').cylinder('z', [0, 250, 895], 16, 260, 12);
      box(tap, sym(12), [80, 262], [1120, 1150]);
      box(tap, sym(12), [80, 104], [1060, 1150]);
      return done(...u.parts, u.worktop, sink, tap);
    },
  }),
  item({
    id: 'wall-cabinet',
    name: 'Kitchen wall cabinet',
    subcategory: 'Kitchen',
    rooms: ['Kitchen', 'Laundry'],
    tags: ['cabinet', 'wall unit', 'upper cabinet', 'cupboard', 'overhead'],
    variants: widths(300, 600, 800),
    build: (v) => {
      const w = Number(v ?? 300);
      // Hung at the usual height: 500 mm above a 900 mm worktop.
      const carcass = part('Carcass', 'white');
      box(carcass, sym(w / 2), [-157, 175], [1400, 2120]);
      const doors = part('Doors', 'white');
      const handles = part('Handles', 'steel');
      fronts(doors, handles, sym(w / 2), [1400, 2120], -157, w > 600 ? 2 : 1, 1, true);
      return done(carcass, doors, handles);
    },
  }),
  item({
    id: 'tall-cabinet',
    name: 'Tall kitchen cabinet',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['pantry', 'larder', 'tall unit', 'broom cupboard', 'cupboard', 'storage'],
    build: () => {
      const carcass = part('Carcass', 'white');
      box(carcass, sym(300), [-282, 300], [100, 2100]);
      box(carcass, sym(300), [-232, 300], [0, 110]);
      const doors = part('Doors', 'white');
      const handles = part('Handles', 'steel');
      fronts(doors, handles, sym(300), [100, 2100], -282, 1, 2, true);
      return done(carcass, doors, handles);
    },
  }),
  item({
    id: 'kitchen-island',
    name: 'Kitchen island',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['island', 'breakfast bar', 'counter', 'worktop', 'cabinet'],
    variants: widths(1800, 2400),
    build: (v) => {
      const w = Number(v ?? 1800);
      const carcass = part('Carcass', 'white');
      box(carcass, sym(w / 2), [-282, 300], [100, 870]);
      box(carcass, sym(w / 2), [-232, 250], [0, 110]);
      const doors = part('Doors', 'white');
      const handles = part('Handles', 'steel');
      fronts(doors, handles, sym(w / 2), [100, 870], -282, Math.round(w / 600), 1, true);
      const worktop = part('Worktop', 'worktop');
      box(worktop, sym(w / 2 + 20), [-320, 600], [870, 910]);
      return done(carcass, doors, handles, worktop);
    },
  }),
  item({
    id: 'refrigerator',
    name: 'Fridge freezer',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['fridge', 'refrigerator', 'freezer', 'appliance', 'cooler'],
    build: () => {
      const body = part('Body', 'steel');
      box(body, sym(350), [-322, 350], [0, 1850]);
      const doors = part('Doors', 'steel');
      box(doors, sym(350), [-345, -320], [20, 640]);
      box(doors, sym(350), [-345, -320], [646, 1845]);
      const handles = part('Handles', 'black');
      box(handles, [290, 310], [-385, -340], [420, 620]);
      box(handles, [290, 310], [-385, -340], [680, 1080]);
      return done(body, doors, handles);
    },
  }),
  item({
    id: 'cooker',
    name: 'Cooker',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['stove', 'range', 'oven', 'hob', 'cooktop', 'burners', 'appliance'],
    build: () => {
      const body = part('Body', 'steel');
      box(body, sym(300), [-280, 300], [0, 880]);
      const top = part('Hob', 'black');
      box(top, sym(300), [-300, 300], [875, 900]);
      for (const [x, y, r] of [
        [-140, -140, 55],
        [140, -140, 45],
        [-140, 140, 45],
        [140, 140, 65],
      ])
        top.cylinder('z', [x, y, 895], r, 15, 16);
      const door = part('Oven door', 'black');
      box(door, sym(290), [-300, -278], [110, 700]);
      const handles = part('Controls', 'steel');
      box(handles, sym(240), [-335, -295], [650, 670]);
      for (const x of [-200, -100, 0, 100, 200]) handles.cylinder('y', [x, -320, 790], 18, 45, 12);
      return done(body, top, door, handles);
    },
  }),
  item({
    id: 'dishwasher',
    name: 'Dishwasher',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['dish washer', 'appliance', 'washer'],
    build: () => {
      const body = part('Body', 'white');
      box(body, sym(300), [-280, 300], [0, 850]);
      const door = part('Door', 'white');
      box(door, sym(298), [-300, -278], [80, 760]);
      const panel = part('Panel', 'darkGrey');
      box(panel, sym(298), [-300, -278], [765, 848]);
      const handle = part('Handle', 'steel');
      box(handle, sym(150), [-335, -295], [700, 715]);
      return done(body, door, panel, handle);
    },
  }),
  item({
    id: 'microwave',
    name: 'Microwave',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['microwave oven', 'appliance', 'countertop'],
    build: () => {
      const body = part('Body', 'darkGrey');
      box(body, sym(250), [-180, 190], [0, 300]);
      const door = part('Door', 'black');
      box(door, [-245, 120], [-192, -175], [15, 285]);
      const handle = part('Controls', 'steel');
      box(handle, [100, 112], [-215, -185], [40, 260]);
      return done(body, door, handle);
    },
  }),
  item({
    id: 'range-hood',
    name: 'Cooker hood',
    subcategory: 'Kitchen',
    rooms: ['Kitchen'],
    tags: ['extractor', 'range hood', 'vent', 'chimney hood', 'appliance'],
    variants: widths(600, 900),
    build: (v) => {
      const w = Number(v ?? 600);
      // Hung 650 mm above a 900 mm hob, up to a 2400 mm ceiling.
      const hood = part('Hood', 'steel');
      box(hood, sym(w / 2), [-200, 300], [1550, 1620]);
      box(hood, sym(150), [50, 300], [1610, 2400]);
      return done(hood);
    },
  }),
];

// ——— Bathroom and laundry ———

const bathroom: LibraryItem[] = [
  item({
    id: 'toilet',
    name: 'Toilet',
    subcategory: 'Bathroom',
    rooms: ['Bathroom'],
    tags: ['wc', 'loo', 'lavatory', 'water closet', 'cistern', 'sanitary'],
    build: () => {
      const bowl = part('Toilet', 'ceramic');
      bowl.cylinder('z', [0, -150, 280], 185, 115, 24);
      box(bowl, sym(115), [-230, 200], [0, 330]);
      box(bowl, sym(180), [130, 310], [380, 780]);
      box(bowl, sym(130), [100, 200], [300, 420]);
      bowl.cutCylinder('z', [0, -150, 320], 140, 100, 24);
      const seat = part('Seat', 'white').cylinder('z', [0, -150, 395], 190, 18, 24);
      seat.cutCylinder('z', [0, -150, 390], 125, 30, 24);
      return done(bowl, seat);
    },
  }),
  item({
    id: 'bathtub',
    name: 'Bathtub',
    subcategory: 'Bathroom',
    rooms: ['Bathroom'],
    tags: ['bath', 'tub', 'bath tub', 'sanitary'],
    variants: widths([1700, '1700 × 750 mm'], [1500, '1500 × 700 mm']),
    build: (v) => {
      const w = Number(v ?? 1700);
      const d = w >= 1700 ? 750 : 700;
      const tub = part('Bath', 'ceramic');
      box(tub, sym(w / 2), sym(d / 2), [0, 560]);
      cut(tub, sym(w / 2 - 60), sym(d / 2 - 60), [80, 600]);
      const tap = part('Tap', 'steel').cylinder('z', [w / 2 - 30, 0, 555], 16, 160, 12);
      box(tap, [w / 2 - 160, w / 2 - 18], sym(12), [685, 715]);
      return done(tub, tap);
    },
  }),
  item({
    id: 'shower',
    name: 'Shower',
    subcategory: 'Bathroom',
    rooms: ['Bathroom'],
    tags: ['shower tray', 'shower enclosure', 'shower screen', 'glass', 'sanitary'],
    variants: [
      { id: '900', name: '900 × 900 mm' },
      { id: '800', name: '800 × 800 mm' },
      { id: '1000', name: '1000 × 1000 mm' },
    ],
    build: (v) => {
      const s = Number(v ?? 900) / 2;
      const tray = part('Tray', 'ceramic');
      box(tray, sym(s), sym(s), [0, 40]);
      cut(tray, sym(s - 40), sym(s - 40), [30, 50]);
      const glass = part('Glass', 'glass');
      box(glass, sym(s), [-s, -s + 8], [40, 2000]);
      box(glass, [-s, -s + 8], [-s + 4, s], [40, 2000]);
      const fittings = part('Shower', 'steel');
      fittings.cylinder('z', [0, s - 30, 900], 12, 1100, 12);
      box(fittings, sym(12), [s - 250, s - 18], [1980, 2000]);
      fittings.cylinder('z', [0, s - 230, 1965], 100, 20, 24);
      return done(tray, glass, fittings);
    },
  }),
  item({
    id: 'vanity',
    name: 'Basin and vanity unit',
    subcategory: 'Bathroom',
    rooms: ['Bathroom'],
    tags: ['sink', 'washbasin', 'basin', 'vanity', 'wash stand', 'tap', 'faucet', 'cabinet'],
    variants: widths(600, 800),
    build: (v) => {
      const w = Number(v ?? 600);
      const unit = part('Cabinet', 'white');
      box(unit, sym(w / 2), [-212, 230], [150, 700]);
      squareLegs(unit, w, 442, 30, 160, 20);
      const doors = part('Doors', 'white');
      const handles = part('Handles', 'steel');
      fronts(doors, handles, sym(w / 2), [150, 700], -212, w > 600 ? 2 : 1, 1, true);
      const top = part('Basin', 'ceramic');
      box(top, sym(w / 2 + 10), [-240, 230], [700, 850]);
      cut(top, sym(w / 2 - 70), [-180, 120], [740, 860]);
      const tap = part('Tap', 'steel').cylinder('z', [0, 180, 845], 14, 150, 12);
      box(tap, sym(10), [80, 192], [970, 995]);
      return done(unit, doors, handles, top, tap);
    },
  }),
  item({
    id: 'bathroom-mirror',
    name: 'Mirror',
    subcategory: 'Bathroom',
    rooms: ['Bathroom', 'Hallway', 'Bedroom'],
    tags: ['wall mirror', 'looking glass', 'framed mirror'],
    variants: [
      { id: '600', name: '600 × 800 mm' },
      { id: '800', name: '800 × 1000 mm' },
    ],
    build: (v) => {
      const w = Number(v ?? 600);
      const h = w === 600 ? 800 : 1000;
      // Hung with its middle at 1500 mm.
      const z: Range = [1500 - h / 2, 1500 + h / 2];
      const frame = part('Frame', 'black');
      box(frame, sym(w / 2), sym(12), z);
      cut(frame, sym(w / 2 - 30), [-20, 6], [z[0] + 30, z[1] - 30]);
      const glass = part('Mirror', 'mirror');
      box(glass, sym(w / 2 - 25), [-6, 4], [z[0] + 25, z[1] - 25]);
      return done(frame, glass);
    },
  }),
  item({
    id: 'washing-machine',
    name: 'Washing machine',
    subcategory: 'Bathroom',
    rooms: ['Laundry', 'Bathroom', 'Kitchen'],
    tags: ['washer', 'laundry', 'front loader', 'dryer', 'tumble dryer', 'appliance'],
    build: () => {
      const body = part('Body', 'white');
      box(body, sym(300), [-280, 300], [0, 850]);
      const door = part('Door', 'lightGrey').cylinder('y', [0, -300, 420], 210, 25, 32);
      const glass = part('Glass', 'black').cylinder('y', [0, -310, 420], 160, 20, 32);
      const panel = part('Panel', 'lightGrey');
      box(panel, sym(298), [-290, -278], [720, 840]);
      panel.cylinder('y', [200, -310, 780], 30, 25, 16);
      return done(body, door, glass, panel);
    },
  }),
];

// ——— Electronics ———

/** A flat screen of diagonal `inches` (16:9), bottom edge at `z0`, with the panel facing -Y. */
function screen(inches: number, z0: number, depth: number): { w: number; h: number; body: Part; glass: Part } {
  const w = Math.round(inches * 25.4 * 0.8716) + 20;
  const h = Math.round(inches * 25.4 * 0.4903) + 20;
  const body = part('Body', 'black');
  box(body, sym(w / 2), [-depth / 2, depth / 2], [z0, z0 + h]);
  const glass = part('Screen', 'screen');
  box(glass, sym(w / 2 - 10), [-depth / 2 - 2, -depth / 2 + 1], [z0 + 10, z0 + h - 10]);
  return { w, h, body, glass };
}

const TV_SIZES: LibraryVariant[] = [43, 50, 55, 65, 75].map((n) => ({ id: String(n), name: `${n}"` }));

const electronics: LibraryItem[] = [
  item({
    id: 'tv',
    name: 'Television',
    subcategory: 'Electronics',
    rooms: ['Living room', 'Bedroom'],
    tags: ['tv', 'telly', 'television', 'flat screen', 'smart tv', 'screen', 'display'],
    variants: TV_SIZES,
    build: (v) => {
      const s = screen(Number(v ?? TV_SIZES[2].id), 70, 50);
      const stand = part('Stand', 'darkGrey');
      box(stand, sym(160), sym(110), [0, 12]);
      box(stand, sym(40), [-10, 20], [5, 200]);
      return done(s.body, s.glass, stand);
    },
  }),
  item({
    id: 'monitor',
    name: 'Computer monitor',
    subcategory: 'Electronics',
    rooms: ['Office', 'Bedroom'],
    tags: ['monitor', 'screen', 'display', 'computer', 'pc'],
    variants: [24, 27, 32].map((n) => ({ id: String(n), name: `${n}"` })),
    build: (v) => {
      const s = screen(Number(v ?? 24), 110, 40);
      const stand = part('Stand', 'darkGrey');
      box(stand, sym(120), [-60, 120], [0, 15]);
      box(stand, sym(35), [20, 50], [5, 300]);
      return done(s.body, s.glass, stand);
    },
  }),
  item({
    id: 'laptop',
    name: 'Laptop',
    subcategory: 'Electronics',
    rooms: ['Office', 'Bedroom', 'Living room'],
    tags: ['notebook', 'computer', 'pc', 'macbook'],
    build: () => {
      const base = part('Laptop', 'steel');
      box(base, sym(160), sym(110), [0, 16]);
      // The lid, open about 110°.
      const tilt = (20 * Math.PI) / 180;
      const up: Vec3 = [0, Math.sin(tilt), Math.cos(tilt)];
      const back: Vec3 = [0, Math.cos(tilt), -Math.sin(tilt)];
      const at = (x: number, along: number, out: number): Vec3 => [x, 104 + up[1] * along + back[1] * out, 12 + up[2] * along + back[2] * out];
      base.prism([at(-160, 0, 0), at(160, 0, 0), at(160, 225, 0), at(-160, 225, 0)], scale(back, 7));
      const display = part('Screen', 'screen');
      display.prism([at(-148, 14, -1), at(148, 14, -1), at(148, 212, -1), at(-148, 212, -1)], scale(back, 2));
      const keys = part('Keyboard', 'black');
      box(keys, sym(135), [-20, 90], [15, 17]);
      return done(base, display, keys);
    },
  }),
  item({
    id: 'floor-speaker',
    name: 'Floor-standing speaker',
    subcategory: 'Electronics',
    rooms: ['Living room'],
    tags: ['speaker', 'loudspeaker', 'tower speaker', 'hifi', 'audio', 'sound'],
    build: () => {
      const cab = part('Cabinet', 'walnut');
      box(cab, sym(100), sym(150), [0, 1000]);
      const drivers = part('Drivers', 'black');
      for (const [z, r] of [
        [920, 25],
        [760, 65],
        [580, 65],
      ])
        drivers.cylinder('y', [0, -158, z], r, 12, 24);
      return done(cab, drivers);
    },
  }),
  item({
    id: 'soundbar',
    name: 'Soundbar',
    subcategory: 'Electronics',
    rooms: ['Living room'],
    tags: ['speaker', 'audio', 'sound bar', 'home theatre', 'tv'],
    build: () => {
      const bar = part('Soundbar', 'black');
      box(bar, sym(450), sym(50), [0, 70]);
      const grille = part('Grille', 'darkGrey');
      box(grille, sym(440), [-53, -48], [8, 62]);
      return done(bar, grille);
    },
  }),
  item({
    id: 'desktop-pc',
    name: 'Desktop computer',
    subcategory: 'Electronics',
    rooms: ['Office', 'Bedroom'],
    tags: ['computer', 'pc', 'tower', 'tower case', 'gaming pc'],
    build: () => {
      const tower = part('Case', 'black');
      box(tower, sym(100), sym(225), [0, 450]);
      const front = part('Front', 'darkGrey');
      box(front, sym(90), [-230, -222], [20, 440]);
      front.cylinder('y', [0, -236, 400], 10, 10, 12);
      return done(tower, front);
    },
  }),
];

// ——— Lighting ———

/** Points round a quarter circle (angles in degrees), as (radius, height) pairs. */
const arc = (cr: number, cz: number, r: number, from: number, to: number, steps: number): [number, number][] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return [cr + r * Math.cos(a), cz + r * Math.sin(a)];
  });

const lighting: LibraryItem[] = [
  item({
    id: 'floor-lamp',
    name: 'Floor lamp',
    subcategory: 'Lighting',
    rooms: ['Living room', 'Bedroom', 'Office'],
    tags: ['lamp', 'standard lamp', 'standing lamp', 'light', 'lampshade'],
    build: () => {
      const stand = part('Stand', 'black').cylinder('z', [0, 0, 0], 140, 20, 24).cylinder('z', [0, 0, 10], 12, 1380, 12);
      const shade = part('Shade', 'shade').lathe(
        [0, 0, 1300],
        [
          [212, 0],
          [220, 0],
          [160, 300],
          [152, 300],
        ],
      );
      return done(stand, shade);
    },
  }),
  item({
    id: 'table-lamp',
    name: 'Table lamp',
    subcategory: 'Lighting',
    rooms: ['Living room', 'Bedroom', 'Office'],
    tags: ['lamp', 'bedside lamp', 'desk lamp', 'light', 'lampshade'],
    build: () => {
      const base = part('Base', 'ceramic').lathe(
        [0, 0, 0],
        [
          [0, 0],
          [70, 0],
          [95, 90],
          [70, 200],
          [20, 230],
          [0, 230],
        ],
      );
      base.cylinder('z', [0, 0, 220], 8, 120, 12);
      const shade = part('Shade', 'shade').lathe(
        [0, 0, 300],
        [
          [164, 0],
          [170, 0],
          [120, 200],
          [114, 200],
        ],
      );
      return done(base, shade);
    },
  }),
  item({
    id: 'pendant-light',
    name: 'Pendant light',
    subcategory: 'Lighting',
    rooms: ['Dining room', 'Kitchen', 'Living room'],
    tags: ['pendant', 'hanging light', 'ceiling light', 'lamp', 'light', 'dome'],
    hangs: true,
    build: () => {
      // A dome 6 mm thick, open at the top for the cord.
      const shade = part('Shade', 'black').lathe([0, 0, 0], [...arc(0, 0, 175, 0, 80, 8), ...arc(0, 0, 169, 80, 0, 8)]);
      const cord = part('Cord', 'black').cylinder('z', [0, 0, 160], 4, 640, 8).cylinder('z', [0, 0, 780], 60, 20, 16);
      return done(shade, cord);
    },
  }),
  item({
    id: 'ceiling-light',
    name: 'Ceiling light',
    subcategory: 'Lighting',
    rooms: ['Bedroom', 'Living room', 'Hallway', 'Bathroom', 'Kitchen'],
    tags: ['flush light', 'ceiling lamp', 'light', 'downlight', 'dome light'],
    hangs: true,
    build: () => {
      const base = part('Base', 'white').cylinder('z', [0, 0, 80], 200, 20, 32);
      const diffuser = part('Diffuser', 'shade').lathe([0, 0, 0], [[0, 0], ...arc(0, 85, 180, -28, 0, 4), [0, 85]].map(([r, z]) => [Math.max(r, 0), Math.max(z, 0)] as [number, number]), 32);
      return done(base, diffuser);
    },
  }),
];

// ——— Decor ———

const decor: LibraryItem[] = [
  item({
    id: 'rug',
    name: 'Rug',
    subcategory: 'Decor',
    rooms: ['Living room', 'Bedroom', 'Dining room'],
    tags: ['carpet', 'mat', 'area rug', 'floor covering'],
    variants: [
      { id: '1600', name: '160 × 230 cm' },
      { id: '2000', name: '200 × 300 cm' },
      { id: '1200', name: '120 × 170 cm' },
    ],
    build: (v) => {
      const w = Number(v ?? 1600);
      const l = w === 1600 ? 2300 : w === 2000 ? 3000 : 1700;
      return done(box(part('Rug', 'rug'), sym(l / 2), sym(w / 2), [0, 10]));
    },
  }),
  item({
    id: 'potted-plant',
    name: 'Potted plant',
    subcategory: 'Decor',
    rooms: ['Living room', 'Office', 'Hallway', 'Bedroom'],
    tags: ['plant', 'houseplant', 'pot', 'planter', 'tree', 'greenery'],
    variants: [
      { id: 'large', name: 'Large (1430 mm tall)' },
      { id: 'small', name: 'Small (640 mm tall)' },
    ],
    build: (v) => {
      const k = v === 'small' ? 0.375 : 1;
      const pot = part('Pot', 'terracotta').lathe(
        [0, 0, 0],
        [
          [0, 0],
          [120 * k + 20, 0],
          [160 * k + 25, 300 * k + 40],
          [0, 300 * k + 40],
        ],
      );
      const top = 300 * k + 40;
      const stem = part('Stem', 'walnut').cylinder('z', [0, 0, top - 20], 15 * k + 5, 600 * k, 8);
      const r = 260 * k + 60;
      const foliage = part('Foliage', 'leaf').lathe([0, 0, top + 450 * k], [[0, 0], ...arc(0, r, r, -60, 90, 6).slice(1)].map(([a, b]) => [Math.max(a, 0), b] as [number, number]), 12);
      return done(pot, stem, foliage);
    },
  }),
  item({
    id: 'picture-frame',
    name: 'Picture frame',
    subcategory: 'Decor',
    rooms: ['Living room', 'Bedroom', 'Hallway', 'Office', 'Dining room'],
    tags: ['picture', 'frame', 'art', 'painting', 'poster', 'wall art', 'print'],
    variants: [
      { id: '500', name: '500 × 700 mm (portrait)' },
      { id: '1000', name: '1000 × 700 mm (landscape)' },
      { id: '300', name: '300 × 400 mm (portrait)' },
    ],
    build: (v) => {
      const w = Number(v ?? 500);
      const h = w === 500 ? 700 : w === 1000 ? 700 : 400;
      // Hung with its middle at 1500 mm.
      const z: Range = [1500 - h / 2, 1500 + h / 2];
      const frame = part('Frame', 'black');
      box(frame, sym(w / 2), sym(15), z);
      cut(frame, sym(w / 2 - 25), [-25, 5], [z[0] + 25, z[1] - 25]);
      const art = part('Picture', 'linen');
      box(art, sym(w / 2 - 20), [-5, 8], [z[0] + 20, z[1] - 20]);
      return done(frame, art);
    },
  }),
  item({
    id: 'vase',
    name: 'Vase',
    subcategory: 'Decor',
    rooms: ['Living room', 'Dining room', 'Hallway'],
    tags: ['vase', 'flower vase', 'pot', 'ornament', 'ceramic'],
    build: () => {
      const vase = part('Vase', 'ceramic').lathe(
        [0, 0, 0],
        [
          [0, 0],
          [55, 0],
          [85, 100],
          [60, 220],
          [45, 300],
          [52, 320],
          [44, 320],
          [37, 300],
          [52, 220],
          [77, 100],
          [47, 10],
          [0, 10],
        ],
      );
      return done(vase);
    },
  }),
  item({
    id: 'wall-clock',
    name: 'Wall clock',
    subcategory: 'Decor',
    rooms: ['Kitchen', 'Living room', 'Office', 'Dining room'],
    tags: ['clock', 'time', 'watch'],
    build: () => {
      // Hung with its middle at 1800 mm.
      const rim = part('Rim', 'black').cylinder('y', [0, -20, 1800], 160, 40, 32);
      rim.cutCylinder('y', [0, -30, 1800], 145, 20, 32);
      const face = part('Face', 'white').cylinder('y', [0, -12, 1800], 146, 6, 32);
      const hands = part('Hands', 'black');
      box(hands, [-4, 4], [-18, -11], [1795, 1910]);
      box(hands, [-4, 70], [-18, -11], [1796, 1804]);
      return done(rim, face, hands);
    },
  }),
];

export const HOUSEHOLD: LibraryItem[] = [...furniture, ...kitchen, ...bathroom, ...electronics, ...lighting, ...decor];
export type { Room };
