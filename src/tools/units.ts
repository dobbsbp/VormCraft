import { DEFAULT_UNITS, type DisplayUnits } from '../doc/Units';

/** Lengths typed in the Measurements box and shown by the tools. The model unit is the millimetre. */
const UNIT_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  '"': 25.4,
  ft: 304.8,
  "'": 304.8,
};

/** A plain number, or inches as fractions: "6 1/2", "3/4". */
const NUMBER = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d*)?|\.\d+)`;
const ONE = new RegExp(String.raw`^([-+])?\s*(${NUMBER})\s*(mm|cm|m|in|ft|"|')?$`, 'i');
const FEET_INCHES = new RegExp(String.raw`^([-+])?\s*(${NUMBER})\s*'\s*(?:(${NUMBER})\s*"?)?$`);

function numberValue(text: string): number {
  const f = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(text.trim());
  if (!f) return Number(text);
  return Number(f[3]) === 0 ? NaN : Number(f[1] ?? 0) + Number(f[2]) / Number(f[3]);
}

/**
 * The open design's units, which lengths are shown in and a plain typed number is read in. Set by
 * the ToolController whenever the document (or its units) changes; the helpers below take other
 * units when given.
 */
let active: DisplayUnits = DEFAULT_UNITS;

export function setActiveUnits(units: DisplayUnits): void {
  active = units;
}

export function activeUnits(): DisplayUnits {
  return active;
}

/**
 * Parse one length: "120", "12.5mm", "3cm", "1.2m", "2in", '2"', "3ft", "3'", "3' 6"", '6 1/2"'.
 * A plain number is in the design's units (inches for feet and inches). Returns undefined if the
 * text is not a length.
 */
export function parseLength(text: string, units: DisplayUnits = active): number | undefined {
  const t = text.trim();
  const fi = FEET_INCHES.exec(t);
  if (fi) {
    const v = numberValue(fi[2]) * 304.8 + (fi[3] === undefined ? 0 : numberValue(fi[3]) * 25.4);
    if (!Number.isFinite(v)) return undefined;
    return fi[1] === '-' ? -v : v;
  }
  const m = ONE.exec(t);
  if (!m) return undefined;
  const unit = (m[3] ?? (units.unit === 'ftin' ? 'in' : units.unit)).toLowerCase();
  const v = numberValue(m[2]) * UNIT_MM[unit];
  if (!Number.isFinite(v)) return undefined;
  return m[1] === '-' ? -v : v;
}

/**
 * Parse a list of lengths separated by "," or ";" (e.g. "300,200" for a rectangle). Empty parts
 * are returned as undefined so "300," or ",200" can change just one dimension.
 */
export function parseLengths(text: string): (number | undefined)[] | undefined {
  const parts = text.split(/[,;]/);
  const out: (number | undefined)[] = [];
  for (const p of parts) {
    if (p.trim() === '') {
      out.push(undefined);
      continue;
    }
    const v = parseLength(p);
    if (v === undefined) return undefined;
    out.push(v);
  }
  return out;
}

/** "24s" sets the number of sides (segments) of a circle. */
export function parseSegments(text: string): number | undefined {
  const m = /^\s*(\d+)\s*s\s*$/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

const round = (v: number, places: number) => {
  const r = Math.round(v * 10 ** places) / 10 ** places;
  return Object.is(r, -0) ? 0 : r;
};

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Feet and inches to the nearest 1/`den` inch: 3' 6 1/2", 3' 0 3/4"; under a foot, 3/4". */
function feetInches(mm: number, den: number): string {
  const n = Math.round((Math.abs(mm) / 25.4) * den);
  const feet = Math.floor(n / (12 * den));
  const rest = n - feet * 12 * den;
  const whole = Math.floor(rest / den);
  const part = rest % den;
  const g = gcd(part, den);
  const fraction = part ? `${part / g}/${den / g}` : '';
  const inches = fraction ? (whole || feet ? `${whole} ${fraction}` : fraction) : String(whole);
  const sign = mm < 0 && n > 0 ? '-' : '';
  return feet ? `${sign}${feet}' ${inches}"` : `${sign}${inches}"`;
}

/** A length in the design's units (or `units`): "12.5 mm", "1.2 m", "3' 6 1/2"". */
export function formatLength(mm: number, units: DisplayUnits = active): string {
  if (units.unit === 'ftin') return feetInches(mm, units.precision);
  return `${round(mm / UNIT_MM[units.unit], units.precision)} ${units.unit}`;
}

/** Several lengths with the unit once at the end where it can be: "300 × 200 × 100 mm". */
export function formatLengths(values: readonly number[], separator: string, units: DisplayUnits = active): string {
  if (units.unit === 'ftin') return values.map((v) => feetInches(v, units.precision)).join(separator);
  return `${values.map((v) => round(v / UNIT_MM[units.unit], units.precision)).join(separator)} ${units.unit}`;
}

/** An area in the design's units squared (feet and inches show square feet); millimetres switch to square metres once that reads better. */
export function formatArea(mm2: number, units: DisplayUnits = active): string {
  const unit = units.unit === 'ftin' ? 'ft' : units.unit === 'mm' && mm2 >= 1e6 ? 'm' : units.unit;
  return `${round(mm2 / UNIT_MM[unit] ** 2, 2)} ${unit}²`;
}
