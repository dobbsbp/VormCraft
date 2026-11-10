export * from './catalog';
export { PAINTS, part, Part, type LibraryPart, type Paint } from './kit';
export { HOUSEHOLD } from './household';
export { searchLibrary, type LibraryHit } from './search';

import type { LibraryItem } from './catalog';
import { HOUSEHOLD } from './household';

/** Every item in the library. */
export const LIBRARY: readonly LibraryItem[] = [...HOUSEHOLD];
