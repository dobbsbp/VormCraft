import type { LibraryPart } from './kit';

/** Rooms an item belongs in (an item can be in several). */
export const ROOMS = ['Living room', 'Dining room', 'Bedroom', 'Kitchen', 'Bathroom', 'Office', 'Laundry', 'Hallway'] as const;
export type Room = (typeof ROOMS)[number];

/** Sizes or kinds of one item (a bed in Single, Double, Queen and King). */
export interface LibraryVariant {
  readonly id: string;
  readonly name: string;
}

/**
 * The opening a door or window cuts in the wall it is placed on: the frame's outside size, and
 * how high its bottom sits above the floor.
 */
export interface LibraryOpening {
  readonly width: number;
  readonly height: number;
  readonly sill: number;
}

/**
 * A setting of a customisable item (Library → Customise…): a number, kept in millimetres for
 * lengths, degrees for angles, a whole number for counts, the index of the chosen option for
 * choices, and 0 or 1 for on/off settings.
 */
export interface LibraryParam {
  readonly id: string;
  /** Shown beside the field: "Width", "Phone thickness". */
  readonly name: string;
  readonly kind: 'length' | 'angle' | 'count' | 'choice' | 'toggle';
  /** The value when nothing else sets it (a size can set some first: `preset`). */
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  /** For choices: the options' names, in order (the value is the index). */
  readonly choices?: readonly string[];
  /** A short note shown under the field. */
  readonly note?: string;
  /** Only shown (and used) when this says so, e.g. a top width only for tapered shapes. */
  shown?(values: ParamValues): boolean;
}

/** Values for an item's settings, by setting id. */
export type ParamValues = Readonly<Record<string, number>>;

/**
 * An object in the library. Items are built by code (our own, at real-world sizes, in mm): they
 * stand on the ground centred on the origin with their front facing -Y, or, if `hangs`, they hang
 * from the point they are placed at (a pendant light from the ceiling).
 */
export interface LibraryItem {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly subcategory: string;
  readonly rooms: readonly Room[];
  /** Words people may search for (other names, materials, uses). */
  readonly tags: readonly string[];
  /** The first is the default. */
  readonly variants?: readonly LibraryVariant[];
  readonly hangs?: boolean;
  /** Doors and windows: the opening they cut when placed on a wall (per size and settings). */
  opening?(variant?: string, values?: Partial<Record<string, number>>): LibraryOpening;
  /** Settings that can be changed before placing it (Library → Customise…). */
  readonly params?: readonly LibraryParam[];
  /** The settings a size starts from (a bed's width for each size). */
  preset?(variant?: string): Partial<Record<string, number>>;
  /**
   * The item's parts, one per paint. A customisable item takes the settings too (any left out
   * come from the size, else the defaults); impossible combinations throw, saying what to change.
   */
  build(variant?: string, values?: Partial<Record<string, number>>): LibraryPart[];
}

/** Bump when items change shape, so saved preview pictures are drawn again. */
export const LIBRARY_VERSION = 2;
