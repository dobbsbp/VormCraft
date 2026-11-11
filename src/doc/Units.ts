/**
 * The units a design shows and takes lengths in. The model itself is always in millimetres: units
 * change only what is shown and what a plain typed number means, never the size of anything.
 */
export type LengthUnit = 'mm' | 'cm' | 'm' | 'in' | 'ft' | 'ftin';

export interface DisplayUnits {
  unit: LengthUnit;
  /**
   * Decimal places shown at most (trailing zeros are dropped); for feet and inches, the smallest
   * fraction of an inch, as its denominator (16 shows lengths to the nearest 1/16").
   */
  precision: number;
}

/** What designs from before units could be chosen show (and the start when nothing is remembered). */
export const DEFAULT_UNITS: DisplayUnits = { unit: 'mm', precision: 2 };

export interface UnitChoice {
  unit: LengthUnit;
  label: string;
  precisions: { value: number; label: string }[];
  /** The precision picked when switching to this unit. */
  precision: number;
}

const decimals = (unit: string) => [0, 1, 2, 3].map((d) => ({ value: d, label: d === 0 ? `1 ${unit}` : `${(0.1 ** d).toFixed(d)} ${unit}` }));

/** The units on offer, in the order shown. */
export const UNIT_CHOICES: readonly UnitChoice[] = [
  { unit: 'mm', label: 'Millimetres', precisions: decimals('mm'), precision: 2 },
  { unit: 'cm', label: 'Centimetres', precisions: decimals('cm'), precision: 2 },
  { unit: 'm', label: 'Metres', precisions: decimals('m'), precision: 3 },
  { unit: 'in', label: 'Inches', precisions: decimals('in'), precision: 2 },
  { unit: 'ft', label: 'Feet', precisions: decimals('ft'), precision: 3 },
  { unit: 'ftin', label: 'Feet and inches', precisions: [1, 2, 4, 8, 16, 32, 64].map((d) => ({ value: d, label: d === 1 ? '1"' : `1/${d}"` })), precision: 16 },
];

/** The units as given if they are valid (from a file or a device setting), else undefined. */
export function validUnits(v: unknown): DisplayUnits | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { unit, precision } = v as Partial<DisplayUnits>;
  const choice = UNIT_CHOICES.find((c) => c.unit === unit);
  if (!choice || !choice.precisions.some((p) => p.value === precision)) return undefined;
  return { unit: choice.unit, precision: precision! };
}
