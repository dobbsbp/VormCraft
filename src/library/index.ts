export * from './catalog';
export { PAINTS, paintFields, part, Part, type LibraryPart, type Paint, type PaintFields } from './kit';
export { customisable, isCustomised, itemSource, paramShown, paramValues, presetValues } from './params';
export { HOUSEHOLD } from './household';
export { BUILDING } from './building';
export { searchLibrary, type LibraryHit } from './search';

import type { LibraryItem } from './catalog';
import { BUILDING } from './building';
import { HOUSEHOLD } from './household';

/** Every item in the library. */
export const LIBRARY: readonly LibraryItem[] = [...HOUSEHOLD, ...BUILDING];
export { buildItem, BuildError, BUILD_FORMAT, BUILD_LIMITS, BUILD_VERSION, makeBuild, readBuild, type BuildDesign } from './buildFormat';
export { aiTemplate, BUILD_EXAMPLES, problemsForAi } from './buildTemplate';
