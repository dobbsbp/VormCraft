/** Typed lengths for the Measurements box. The model unit is the millimetre. */

const UNIT_MM: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  '"': 25.4,
  ft: 304.8,
  "'": 304.8,
};

const NUMBER = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)`;
const ONE = new RegExp(String.raw`^(${NUMBER})\s*(mm|cm|m|in|ft|"|')?$`, 'i');
const FEET_INCHES = new RegExp(String.raw`^([-+])?\s*(\d+(?:\.\d*)?)\s*'\s*(\d+(?:\.\d*)?)\s*"?$`);

/**
 * Parse one length: "120", "12.5mm", "3cm", "1.2m", "2in", '2"', "3ft", "3'", "3' 6"".
 * A bare number is millimetres. Returns undefined if the text is not a length.
 */
export function parseLength(text: string): number | undefined {
  const t = text.trim();
  const fi = FEET_INCHES.exec(t);
  if (fi) {
    const v = Number(fi[2]) * 304.8 + Number(fi[3]) * 25.4;
    return fi[1] === '-' ? -v : v;
  }
  const m = ONE.exec(t);
  if (!m) return undefined;
  const unit = (m[2] ?? 'mm').toLowerCase();
  return Number(m[1]) * UNIT_MM[unit];
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

export function formatLength(mm: number): string {
  const r = Math.round(mm * 100) / 100;
  return `${Object.is(r, -0) ? 0 : r} mm`;
}
