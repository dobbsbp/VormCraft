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
  /** The item's parts, one per paint. */
  build(variant?: string): LibraryPart[];
}

/** Bump when items change shape, so saved preview pictures are drawn again. */
export const LIBRARY_VERSION = 1;
