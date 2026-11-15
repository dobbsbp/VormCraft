export * from './catalog';
export { PAINTS, part, Part, type LibraryPart, type Paint } from './kit';
export { HOUSEHOLD } from './household';
export { BUILDING } from './building';
export { searchLibrary, type LibraryHit } from './search';

import type { LibraryItem } from './catalog';
import { BUILDING } from './building';
import { HOUSEHOLD } from './household';

/** Every item in the library. */
export const LIBRARY: readonly LibraryItem[] = [...HOUSEHOLD, ...BUILDING];
