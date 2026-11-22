import { checkWatertight } from '../core/check/watertight';
import { composeAffine, IDENTITY, rotation, translation, type Affine } from '../core/ops/transform';
import { transformModel } from '../core/ops/group';
import type { Model } from '../core/model/Model';
import type { Vec3 } from '../core/math/vec3';
import type { LibraryItem, LibraryParam, ParamValues } from './catalog';
import { Part, PAINTS, shapeModels, type Axis, type LibraryPart, type Paint, type PaintFields } from './kit';
import { customisable } from './params';

/**
 * VormCraft build files: a design described as data, written by an AI from the template
 * (`buildTemplate.ts`) or by hand, and turned into something to place like a Library item. The
 * file is only ever read as data: numbers may be short formulas over the design's settings, worked
 * out by the small evaluator below (never `eval`). Everything is checked first, with problems
 * reported as plain sentences that say where they are, so they can be pasted back to the AI.
 *
 * {
 *   "format": "vormcraft-build", "version": 1, "name": "Phone stand", "units": "mm",
 *   "settings": [{ "id": "width", "name": "Width", "kind": "length", "value": 80, "min": 40, "max": 200 }],
 *   "parts": [{ "name": "Stand", "colour": "darkGrey", "shapes": [...], "cuts": [...] }]
 * }
 */

export const BUILD_FORMAT = 'vormcraft-build';
export const BUILD_VERSION = 1;

/** Limits that keep a file from making something too heavy for the app. */
export const BUILD_LIMITS = { parts: 40, shapes: 400, repeat: 100, sides: 64, points: 200, size: 50_000, faces: 20_000, expression: 300 };

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const SHAPES = ['box', 'cylinder', 'extrude', 'taper', 'lathe', 'sphere'] as const;
type ShapeType = (typeof SHAPES)[number];

/** A problem in a build file, with every message found (each says where). */
export class BuildError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'BuildError';
  }
}

// ——— Formulas ———

type Expr = { k: 'num'; v: number } | { k: 'name'; n: string } | { k: 'neg'; a: Expr } | { k: 'op'; op: string; a: Expr; b: Expr } | { k: 'call'; f: string; args: Expr[] };

const deg = Math.PI / 180;
const FUNCTIONS: Record<string, { args: [number, number]; f: (...x: number[]) => number }> = {
  min: { args: [1, 20], f: Math.min },
  max: { args: [1, 20], f: Math.max },
  abs: { args: [1, 1], f: Math.abs },
  sqrt: { args: [1, 1], f: Math.sqrt },
  round: { args: [1, 1], f: Math.round },
  floor: { args: [1, 1], f: Math.floor },
  ceil: { args: [1, 1], f: Math.ceil },
  sin: { args: [1, 1], f: (a) => Math.sin(a * deg) },
  cos: { args: [1, 1], f: (a) => Math.cos(a * deg) },
  tan: { args: [1, 1], f: (a) => Math.tan(a * deg) },
  asin: { args: [1, 1], f: (a) => Math.asin(a) / deg },
  acos: { args: [1, 1], f: (a) => Math.acos(a) / deg },
  atan: { args: [1, 1], f: (a) => Math.atan(a) / deg },
  atan2: { args: [2, 2], f: (y, x) => Math.atan2(y, x) / deg },
  if: { args: [3, 3], f: (c, a, b) => (c ? a : b) },
};
const CONSTANTS: Record<string, number> = { pi: Math.PI };
/** Only the object's own keys: a name such as "constructor" must not reach built-in properties. */
const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

const PRECEDENCE: Record<string, number> = { '<': 1, '>': 1, '<=': 1, '>=': 1, '==': 1, '!=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '%': 3, '^': 4 };

/** Read a formula such as "width / 2 - 30" or "if(shelf, 120, 0)"; `names` are the settings it may use. */
export function parseFormula(text: string, names: ReadonlySet<string>): Expr {
  const tokens = text.match(/\d+\.?\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|<=|>=|==|!=|[-+*/%^(),<>]|\S/gi) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const fail = (why: string): never => {
    throw new Error(`the formula "${text}" ${why}`);
  };
  const primary = (): Expr => {
    const t = tokens[i++];
    if (t === undefined) return fail('ends too soon');
    if (t === '(') {
      const e = expr(0);
      if (tokens[i++] !== ')') fail('is missing a ")"');
      return e;
    }
    if (t === '-') return { k: 'neg', a: primary() };
    if (t === '+') return primary();
    if (/^[\d.]/.test(t)) {
      const v = Number(t);
      if (!Number.isFinite(v)) fail(`has a number it cannot read: ${t}`);
      return { k: 'num', v };
    }
    if (/^[A-Za-z_]/.test(t)) {
      if (peek() === '(') {
        const fn = has(FUNCTIONS, t) ? FUNCTIONS[t] : undefined;
        if (!fn) return fail(`uses "${t}(", which is not a function it knows (${Object.keys(FUNCTIONS).join(', ')})`);
        i++;
        const args: Expr[] = [];
        if (peek() !== ')') {
          args.push(expr(0));
          while (peek() === ',') {
            i++;
            args.push(expr(0));
          }
        }
        if (tokens[i++] !== ')') fail(`is missing a ")" after ${t}(…`);
        if (args.length < fn.args[0] || args.length > fn.args[1]) fail(`gives ${t} ${args.length} values; it takes ${fn.args[0] === fn.args[1] ? fn.args[0] : `${fn.args[0]} to ${fn.args[1]}`}`);
        return { k: 'call', f: t, args };
      }
      if (!has(CONSTANTS, t) && !names.has(t)) fail(`uses "${t}", which is not one of the settings${names.size ? ` (${[...names].join(', ')})` : ' (there are none)'}`);
      return { k: 'name', n: t };
    }
    return fail(`has "${t}" where a number or setting should be`);
  };
  const expr = (min: number): Expr => {
    let left = primary();
    for (;;) {
      const op = peek();
      const p = op !== undefined && has(PRECEDENCE, op) ? PRECEDENCE[op] : undefined;
      if (p === undefined || p < min) return left;
      i++;
      // ^ groups to the right, the others to the left.
      left = { k: 'op', op, a: left, b: expr(op === '^' ? p : p + 1) };
    }
  };
  if (text.length > BUILD_LIMITS.expression) fail(`is longer than ${BUILD_LIMITS.expression} characters`);
  const e = expr(0);
  if (i < tokens.length) fail(`has "${tokens[i]}" left over at the end`);
  return e;
}

function evaluate(e: Expr, env: Readonly<Record<string, number>>): number {
  switch (e.k) {
    case 'num':
      return e.v;
    case 'name':
      return has(CONSTANTS, e.n) ? CONSTANTS[e.n] : env[e.n];
    case 'neg':
      return -evaluate(e.a, env);
    case 'call':
      return FUNCTIONS[e.f].f(...e.args.map((a) => evaluate(a, env)));
    case 'op': {
      const [a, b] = [evaluate(e.a, env), evaluate(e.b, env)];
      switch (e.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '^': return a ** b;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return Math.abs(a - b) < 1e-9 ? 1 : 0;
        default: return Math.abs(a - b) >= 1e-9 ? 1 : 0;
      }
    }
  }
}

// ——— Reading the file ———

/**
 * The JSON in what was pasted: the reply may wrap it in a ```json block or add a sentence before
 * or after, so the outermost { … } is taken.
 */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new BuildError(['There is no design in this text: it should be JSON starting with { and ending with }.']);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new BuildError([`The design is not valid JSON (${err instanceof Error ? err.message : String(err)}). Check for a missing comma or bracket, or comments, which JSON does not allow.`]);
  }
}

/** A number, or a formula, compiled; `length` ones are in the file's units. */
type Value = { length: boolean; e: Expr; where: string };

interface Transform {
  rotate: { axis: Axis; degrees: Value; about: Value[] }[];
  move?: Value[];
}

interface Shape extends Transform {
  type: ShapeType;
  where: string;
  when?: Value;
  repeat?: { count: Value; step?: Value[]; rotate?: { axis: Axis; degrees: Value; about: Value[] } };
  values: Record<string, Value | Value[] | Value[][] | string>;
}

interface PartSpec {
  name: string;
  where: string;
  paint: Paint;
  colour?: PaintFields;
  shapes: Shape[];
  cuts: Shape[];
}

/** A build file read and checked: what is needed to make the design for any settings. */
export interface BuildDesign {
  name: string;
  description?: string;
  hangs: boolean;
  /** Settings, in mm for lengths (as the Customise dialog takes them). */
  params: LibraryParam[];
  /** File units in mm. */
  scale: number;
  parts: PartSpec[];
  /** A short id from the file's contents, so the same design placed twice links its copies. */
  id: string;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const quote = (s: string) => `"${s}"`;

class Reader {
  problems: string[] = [];
  names = new Set<string>();
  lengthNames = new Set<string>();

  say(where: string, what: string): void {
    this.problems.push(`${where}: ${what}`);
  }

  /** A number or formula; undefined (after saying why) if it is not one. */
  value(where: string, x: unknown, length: boolean): Value | undefined {
    if (typeof x === 'number') {
      if (!Number.isFinite(x)) return void this.say(where, 'must be a finite number');
      return { length, e: { k: 'num', v: x }, where };
    }
    if (typeof x === 'string') {
      try {
        return { length, e: parseFormula(x, this.names), where };
      } catch (err) {
        return void this.say(where, (err as Error).message);
      }
    }
    return void this.say(where, x === undefined ? 'is missing (a number, or a formula in quotes)' : 'must be a number, or a formula in quotes like "width / 2"');
  }

  vector(where: string, x: unknown, n: number, length: boolean, example: string): Value[] | undefined {
    if (!Array.isArray(x) || x.length !== n) return void this.say(where, `${x === undefined ? 'is missing: it needs' : 'needs'} ${n} numbers, like ${example}`);
    const out = x.map((v, i) => this.value(`${where}[${i}]`, v, length));
    return out.every((v) => v) ? (out as Value[]) : undefined;
  }

  axis(where: string, x: unknown, fallback?: Axis): Axis | undefined {
    if (x === undefined && fallback) return fallback;
    if (x === 'x' || x === 'y' || x === 'z') return x;
    return void this.say(where, 'must be "x", "y" or "z" (red, green or blue)');
  }

  rotate(where: string, x: unknown): Transform['rotate'] | undefined {
    const list = x === undefined ? [] : Array.isArray(x) ? x : [x];
    const out: Transform['rotate'] = [];
    list.forEach((r, i) => {
      const w = Array.isArray(x) ? `${where}[${i}]` : where;
      if (!isObject(r)) return this.say(w, 'must be like { "axis": "z", "degrees": 30, "about": [0, 0, 0] }');
      const axis = this.axis(`${w}.axis`, r.axis);
      const degrees = this.value(`${w}.degrees`, r.degrees, false);
      const about = r.about === undefined ? [0, 0, 0].map((v) => ({ length: true, e: { k: 'num' as const, v }, where: w })) : this.vector(`${w}.about`, r.about, 3, true, '[0, 0, 0]');
      if (axis && degrees && about) out.push({ axis, degrees, about });
    });
    return out;
  }

  shape(where: string, raw: unknown): Shape | undefined {
    if (!isObject(raw)) return void this.say(where, `must be a shape like { "type": "box", "from": [0, 0, 0], "to": [100, 50, 20] }`);
    // "center" is taken for "centre" (AIs often write it the American way).
    const x = raw.centre === undefined && raw.center !== undefined ? { ...raw, centre: raw.center } : raw;
    const type = x.type as ShapeType;
    const w = typeof x.type === 'string' ? `${where} (${x.type})` : where;
    if (!SHAPES.includes(type)) return void this.say(w, `"type" must be one of ${SHAPES.map(quote).join(', ')}`);
    const known = new Set(['type', 'rotate', 'move', 'repeat', 'when', 'name']);
    const values: Shape['values'] = {};
    const need = (key: string, read: () => Value | Value[] | Value[][] | string | undefined) => {
      known.add(key);
      const v = read();
      if (v !== undefined) values[key] = v;
    };
    const sides = (fallback: number) => {
      known.add('sides');
      const s = x.sides ?? fallback;
      if (typeof s !== 'number' || !Number.isInteger(s) || s < 3 || s > BUILD_LIMITS.sides) this.say(`${w}.sides`, `must be a whole number from 3 to ${BUILD_LIMITS.sides}`);
      else values.sides = String(s);
    };
    known.add('center');
    const v3 = (key: string, example = '[0, 0, 0]') => need(key, () => this.vector(`${w}.${key}`, x[key], 3, true, example));
    const len = (key: string) => need(key, () => this.value(`${w}.${key}`, x[key], true));
    const points = (key: string, example: string) =>
      need(key, () => {
        const p = x[key];
        if (!Array.isArray(p) || p.length < 3) return void this.say(`${w}.${key}`, `needs a list of at least 3 points, like ${example}`);
        if (p.length > BUILD_LIMITS.points) return void this.say(`${w}.${key}`, `has ${p.length} points; ${BUILD_LIMITS.points} at most`);
        const out = p.map((q, i) => this.vector(`${w}.${key}[${i}]`, q, 2, true, '[10, 20]'));
        return out.every((q) => q) ? (out as Value[][]) : undefined;
      });
    switch (type) {
      case 'box':
        v3('from');
        v3('to', '[100, 50, 20]');
        break;
      case 'cylinder':
        v3('base');
        need('axis', () => this.axis(`${w}.axis`, x.axis, 'z'));
        len('radius');
        len('length');
        sides(24);
        break;
      case 'extrude':
        need('plane', () => (x.plane === 'xy' || x.plane === 'xz' || x.plane === 'yz' ? x.plane : void this.say(`${w}.plane`, 'must be "xy" (flat, pushed up), "xz" (upright facing front, pushed back) or "yz" (upright facing the side, pushed right)')));
        need('at', () => (x.at === undefined ? { length: true, e: { k: 'num', v: 0 }, where: w } : this.value(`${w}.at`, x.at, true)));
        points('outline', '[[0, 0], [100, 0], [100, 50], [0, 50]]');
        len('depth');
        break;
      case 'taper':
        v3('base');
        need('bottom', () => this.vector(`${w}.bottom`, x.bottom, 2, true, '[300, 300] (width, depth)'));
        need('top', () => this.vector(`${w}.top`, x.top, 2, true, '[150, 150] (width, depth)'));
        len('height');
        break;
      case 'lathe':
        v3('centre');
        points('profile', '[[0, 0], [50, 0], [40, 100], [0, 100]] (radius, height)');
        sides(24);
        break;
      case 'sphere':
        v3('centre');
        len('radius');
        sides(24);
        break;
    }
    const rotate = this.rotate(`${w}.rotate`, x.rotate);
    const move = x.move === undefined ? undefined : this.vector(`${w}.move`, x.move, 3, true, '[100, 0, 0]');
    const when = x.when === undefined ? undefined : this.value(`${w}.when`, x.when, false);
    let repeat: Shape['repeat'];
    if (x.repeat !== undefined) {
      const r = x.repeat;
      if (!isObject(r) || (r.step === undefined) === (r.rotate === undefined))
        this.say(`${w}.repeat`, 'must be like { "count": 4, "step": [200, 0, 0] } (in a row) or { "count": 6, "rotate": { "axis": "z", "degrees": 60 } } (round a centre)');
      else {
        const count = this.value(`${w}.repeat.count`, r.count, false);
        const step = r.step === undefined ? undefined : this.vector(`${w}.repeat.step`, r.step, 3, true, '[200, 0, 0]');
        const turn = r.rotate === undefined ? undefined : this.rotate(`${w}.repeat.rotate`, r.rotate)?.[0];
        if (count) repeat = { count, step, rotate: turn };
      }
    }
    for (const key of Object.keys(x)) if (!known.has(key)) this.say(w, `has "${key}", which a ${type} does not use`);
    return { type, where: w, values, rotate: rotate ?? [], move, when, repeat };
  }

  colour(where: string, x: Record<string, unknown>): { paint: Paint; colour?: PaintFields } {
    const c = x.colour ?? x.color;
    const opacity = x.opacity;
    if (opacity !== undefined && (typeof opacity !== 'number' || opacity < 0.05 || opacity > 1)) this.say(`${where}.opacity`, 'must be a number from 0.05 (nearly clear) to 1 (solid)');
    if (c === undefined) return { paint: 'lightGrey' };
    if (typeof c === 'string' && has(PAINTS, c) && opacity === undefined) return { paint: c as Paint };
    if (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) return { paint: 'lightGrey', colour: { name: `Colour ${c.toUpperCase()}`, color: c.toLowerCase(), opacity: typeof opacity === 'number' ? opacity : 1 } };
    if (typeof c === 'string' && has(PAINTS, c)) {
      const p = PAINTS[c as Paint];
      return { paint: c as Paint, colour: { name: p.name, color: p.color, opacity: typeof opacity === 'number' ? opacity : 1 } };
    }
    this.say(`${where}.colour`, `must be a colour like "#8b5a2b", or one of ${Object.keys(PAINTS).map(quote).join(', ')}`);
    return { paint: 'lightGrey' };
  }
}

/** A short, stable id for some text (FNV-1a). */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Read and check a build file (the text pasted, or the parsed JSON). Throws `BuildError` listing every problem. */
export function readBuild(input: string | unknown): BuildDesign {
  const data = typeof input === 'string' ? extractJson(input) : input;
  const r = new Reader();
  if (!isObject(data)) throw new BuildError(['The design must be a JSON object: { "format": "vormcraft-build", … }.']);
  if (data.format !== BUILD_FORMAT) r.say('format', `must be "${BUILD_FORMAT}"`);
  if (typeof data.version === 'number' && data.version > BUILD_VERSION) throw new BuildError([`This design is for a newer VormCraft (build format version ${data.version}). Update VormCraft to open it.`]);
  if (data.version !== BUILD_VERSION) r.say('version', `must be ${BUILD_VERSION}`);
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 60) : 'AI design';
  const units = data.units ?? 'mm';
  if (typeof units !== 'string' || !has(UNIT_MM, units)) r.say('units', `must be one of ${Object.keys(UNIT_MM).map(quote).join(', ')}`);
  const scale = UNIT_MM[units as string] ?? 1;
  const known = new Set(['format', 'version', 'name', 'description', 'units', 'hangs', 'settings', 'parts']);
  for (const key of Object.keys(data)) if (!known.has(key)) r.say(key, 'is not part of the format (leave it out)');
  if (data.hangs !== undefined && typeof data.hangs !== 'boolean') r.say('hangs', 'must be true or false');

  // Settings first: formulas may use them.
  const params: LibraryParam[] = [];
  const rawSettings = data.settings ?? [];
  if (!Array.isArray(rawSettings)) r.say('settings', 'must be a list');
  else
    rawSettings.forEach((s, i) => {
      const w = `settings[${i}]${isObject(s) && typeof s.id === 'string' ? ` (${s.id})` : ''}`;
      if (!isObject(s)) return r.say(w, 'must be like { "id": "width", "name": "Width", "kind": "length", "value": 800, "min": 300, "max": 2000 }');
      const id = s.id;
      if (typeof id !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return r.say(`${w}.id`, 'must be a name of letters, digits and _, starting with a letter, like "legHeight"');
      if (r.names.has(id) || has(FUNCTIONS, id) || has(CONSTANTS, id)) return r.say(`${w}.id`, `"${id}" is used twice, or is the name of a function`);
      const kind = s.kind ?? 'length';
      if (!['length', 'angle', 'count', 'toggle', 'choice'].includes(kind as string)) return r.say(`${w}.kind`, 'must be "length", "angle", "count", "toggle" or "choice"');
      const isLength = kind === 'length';
      const k = isLength ? scale : 1;
      const num = (key: string, required: boolean): number | undefined => {
        const v = s[key];
        if (v === undefined && !required) return undefined;
        if (typeof v !== 'number' || !Number.isFinite(v)) return void r.say(`${w}.${key}`, 'must be a plain number (no formula)');
        return v * k;
      };
      const value = num('value', true);
      let min = num('min', kind === 'length' || kind === 'angle' || kind === 'count');
      let max = num('max', kind === 'length' || kind === 'angle' || kind === 'count');
      const choices = s.choices;
      if (kind === 'choice' && (!Array.isArray(choices) || choices.length < 2 || choices.length > 20 || !choices.every((c) => typeof c === 'string' && c.trim()))) r.say(`${w}.choices`, 'must list 2 to 20 names, like ["Square", "Round"]');
      if (kind === 'toggle' || kind === 'choice') [min, max] = [undefined, undefined];
      if (value !== undefined && min !== undefined && max !== undefined && !(min <= value && value <= max)) r.say(w, '"value" must be between "min" and "max"');
      r.names.add(id);
      if (isLength) r.lengthNames.add(id);
      params.push({
        id,
        name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 60) : id,
        kind: kind as LibraryParam['kind'],
        value: value ?? 0,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(kind === 'choice' && Array.isArray(choices) ? { choices: choices.map(String) } : {}),
        ...(typeof s.note === 'string' && s.note.trim() ? { note: s.note.trim().slice(0, 160) } : {}),
      });
    });

  const parts: PartSpec[] = [];
  const rawParts = data.parts;
  if (!Array.isArray(rawParts) || !rawParts.length) r.say('parts', 'is missing: list the parts, each with its "shapes"');
  else if (rawParts.length > BUILD_LIMITS.parts) r.say('parts', `has ${rawParts.length} parts; ${BUILD_LIMITS.parts} at most (shapes with the same colour can share a part)`);
  else
    rawParts.forEach((p, i) => {
      const w = `parts[${i}]${isObject(p) && typeof p.name === 'string' ? ` (${p.name})` : ''}`;
      if (!isObject(p)) return r.say(w, 'must be like { "name": "Top", "colour": "oak", "shapes": [ … ] }');
      for (const key of Object.keys(p)) if (!['name', 'colour', 'color', 'opacity', 'shapes', 'cuts'].includes(key)) r.say(w, `has "${key}", which a part does not use`);
      const list = (key: 'shapes' | 'cuts'): Shape[] => {
        const raw = p[key];
        if (raw === undefined && key === 'cuts') return [];
        if (!Array.isArray(raw) || (key === 'shapes' && !raw.length)) {
          r.say(`${w}.${key}`, key === 'shapes' ? 'is missing: a part needs at least one shape' : 'must be a list of shapes');
          return [];
        }
        return raw.map((x, j) => r.shape(`${w}.${key}[${j}]`, x)).filter((x): x is Shape => !!x);
      };
      parts.push({ name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : `Part ${i + 1}`, where: w, ...r.colour(w, p), shapes: list('shapes'), cuts: list('cuts') });
    });
  if (r.problems.length) throw new BuildError(r.problems);
  return {
    name,
    ...(typeof data.description === 'string' ? { description: data.description.slice(0, 300) } : {}),
    hangs: data.hangs === true,
    params,
    scale,
    parts,
    id: hashOf(JSON.stringify(data)),
  };
}

// ——— Making the design ———

class Maker {
  problems: string[] = [];
  shapes = 0;

  constructor(
    private readonly env: Readonly<Record<string, number>>,
    private readonly scale: number,
  ) {}

  /** A value worked out: lengths in mm. */
  num(v: Value): number {
    const x = evaluate(v.e, this.env);
    if (!Number.isFinite(x)) throw new Error(`${v.where}: works out to ${x} (a division by zero?)`);
    const mm = v.length ? x * this.scale : x;
    if (v.length && Math.abs(mm) > BUILD_LIMITS.size) throw new Error(`${v.where}: ${Math.round(mm)} mm is too far (${BUILD_LIMITS.size / 1000} m at most)`);
    return mm;
  }

  vec(v: Value[]): number[] {
    return v.map((x) => this.num(x));
  }

  vec3(v: Value[], times = 1): Vec3 {
    const [a, b, c] = this.vec(v);
    return [a * times, b * times, c * times];
  }

  turn(r: { axis: Axis; degrees: Value; about: Value[] }, times = 1): Affine {
    const axis: Vec3 = r.axis === 'x' ? [1, 0, 0] : r.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    return rotation(this.vec3(r.about), axis, this.num(r.degrees) * deg * times);
  }

  positive(x: number, where: string, what: string): number {
    if (!(x > 0.01)) throw new Error(`${where}: ${what} must be more than 0 (it works out to ${Math.round(x * 1000) / 1000} mm)`);
    return x;
  }

  /** The models a shape makes (several when repeated, none when switched off). */
  models(s: Shape): Model[] {
    if (s.when && !this.num(s.when)) return [];
    const one = this.model(s);
    let place: Affine = IDENTITY;
    for (const r of s.rotate) place = composeAffine(this.turn(r), place);
    if (s.move) place = composeAffine(translation(this.vec3(s.move)), place);
    const count = s.repeat ? Math.round(this.num(s.repeat.count)) : 1;
    if (count < 1 || count > BUILD_LIMITS.repeat) throw new Error(`${s.where}.repeat.count: must be from 1 to ${BUILD_LIMITS.repeat} (it is ${count})`);
    this.shapes += count;
    if (this.shapes > BUILD_LIMITS.shapes) throw new Error(`The design has more than ${BUILD_LIMITS.shapes} shapes: make it simpler`);
    const out: Model[] = [];
    for (let i = 0; i < count; i++) {
      let a = place;
      if (s.repeat?.step) a = composeAffine(translation(this.vec3(s.repeat.step, i)), a);
      if (s.repeat?.rotate) a = composeAffine(this.turn(s.repeat.rotate, i), a);
      const m = i === count - 1 ? one : one.clone();
      transformModel(m, a);
      out.push(m);
    }
    return out;
  }

  private model(s: Shape): Model {
    const v = s.values;
    const p3 = (k: string) => this.vec3(v[k] as Value[]);
    const sides = Number(v.sides);
    switch (s.type) {
      case 'box': {
        const [a, b] = [p3('from'), p3('to')];
        for (let i = 0; i < 3; i++) this.positive(Math.abs(b[i] - a[i]), s.where, `its ${'xyz'[i]} size ("to" − "from")`);
        return shapeModels.box(a, b);
      }
      case 'cylinder':
        return shapeModels.cylinder(v.axis as Axis, p3('base'), this.positive(this.num(v.radius as Value), s.where, '"radius"'), this.positive(this.num(v.length as Value), s.where, '"length"'), sides);
      case 'sphere': {
        const r = this.positive(this.num(v.radius as Value), s.where, '"radius"');
        const steps = Math.max(2, Math.round(sides / 2));
        const profile = Array.from({ length: steps + 1 }, (_, i): [number, number] => {
          const a = -Math.PI / 2 + (Math.PI * i) / steps;
          return [i === 0 || i === steps ? 0 : r * Math.cos(a), r * Math.sin(a)];
        });
        return shapeModels.lathe(p3('centre'), profile, sides);
      }
      case 'taper': {
        const [bw, bd] = this.vec(v.bottom as Value[]);
        const [tw, td] = this.vec(v.top as Value[]);
        for (const [x, what] of [[bw, 'the bottom width'], [bd, 'the bottom depth'], [tw, 'the top width'], [td, 'the top depth']] as const) this.positive(x, s.where, what);
        const h = this.num(v.height as Value);
        this.positive(Math.abs(h), s.where, '"height"');
        const base = p3('base');
        // A negative height grows downwards: the same shape stood on its top.
        return h > 0 ? shapeModels.frustum(base, [bw / 2, bd / 2], [tw / 2, td / 2], h) : shapeModels.frustum([base[0], base[1], base[2] + h], [tw / 2, td / 2], [bw / 2, bd / 2], -h);
      }
      case 'extrude': {
        const at = this.num(v.at as Value);
        const ring = (v.outline as Value[][]).map((q) => this.vec(q) as [number, number]);
        checkOutline(ring, `${s.where}.outline`);
        const depth = this.num(v.depth as Value);
        this.positive(Math.abs(depth), s.where, '"depth"');
        const plane = v.plane as string;
        const pts: Vec3[] = ring.map(([a, b]) => (plane === 'xy' ? [a, b, at] : plane === 'xz' ? [a, at, b] : [at, a, b]));
        const along: Vec3 = plane === 'xy' ? [0, 0, depth] : plane === 'xz' ? [0, depth, 0] : [depth, 0, 0];
        return shapeModels.prism(pts, along);
      }
      case 'lathe': {
        const profile = (v.profile as Value[][]).map((q) => this.vec(q) as [number, number]);
        if (profile.some(([r]) => r < -1e-9)) throw new Error(`${s.where}.profile: a radius (the first number of each point) is below 0`);
        checkOutline(profile, `${s.where}.profile`);
        // Turned the right way round (anticlockwise in radius, height), whichever way it was written.
        const area = profile.reduce((sum, [x, y], i) => {
          const [nx, ny] = profile[(i + 1) % profile.length];
          return sum + x * ny - nx * y;
        }, 0);
        if (!profile.some(([r]) => r > 0.01)) throw new Error(`${s.where}.profile: every radius is 0, so there is nothing to turn`);
        return shapeModels.lathe(p3('centre'), area > 0 ? profile : [...profile].reverse(), sides);
      }
    }
  }
}

/** An outline must enclose an area and not cross itself. */
function checkOutline(ring: [number, number][], where: string): void {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const [nx, ny] = ring[(i + 1) % ring.length];
    area += x * ny - nx * y;
    if (Math.hypot(nx - x, ny - y) < 0.01) throw new Error(`${where}: points ${i} and ${(i + 1) % ring.length} are in the same place`);
  }
  const cross = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n]];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) throw new Error(`${where}: the outline crosses itself (between points ${i}–${i + 1} and ${j}–${(j + 1) % n})`);
    }
  }
  if (Math.abs(area / 2) < 0.01) throw new Error(`${where}: the points are all in a line, so there is no area`);
}

/**
 * Make a design with these settings (mm for lengths, as `LibraryParam`s keep them). Throws
 * `BuildError` with what went wrong in each part.
 */
export function makeBuild(design: BuildDesign, values: ParamValues): LibraryPart[] {
  // Formulas are written in the file's units: lengths are given to them in those units.
  const env: Record<string, number> = {};
  for (const p of design.params) env[p.id] = p.kind === 'length' ? values[p.id] / design.scale : values[p.id];
  const maker = new Maker(env, design.scale);
  const out: LibraryPart[] = [];
  const problems: string[] = [];
  let faces = 0;
  for (const spec of design.parts) {
    const part = new Part(spec.name, spec.paint, spec.colour);
    let solid = 0;
    try {
      for (const s of spec.shapes)
        for (const m of maker.models(s)) {
          part.add(m);
          solid++;
        }
      for (const s of spec.cuts) for (const m of maker.models(s)) part.add(m, true);
    } catch (err) {
      problems.push((err as Error).message);
      continue;
    }
    // Every shape may be switched off by its "when": then the part is left out.
    if (!solid) continue;
    let built: LibraryPart;
    try {
      built = part.build();
    } catch (err) {
      problems.push(`${spec.where}: its shapes could not be joined (${(err as Error).message}). Shapes in one part should overlap where they meet, by a millimetre or more.`);
      continue;
    }
    if (!built.model.faces.size) {
      problems.push(`${spec.where}: nothing is left once the cuts are taken away`);
      continue;
    }
    if (!checkWatertight(built.model).watertight)
      problems.push(`${spec.where}: its shapes do not join into closed solids. Where shapes in one part meet, make them overlap by a millimetre or more instead of just touching along an edge or at a corner.`);
    faces += built.model.faces.size;
    out.push(built);
  }
  if (faces > BUILD_LIMITS.faces) problems.push(`The design has ${faces.toLocaleString('en-GB')} faces; ${BUILD_LIMITS.faces.toLocaleString('en-GB')} at most. Use fewer sides on round shapes, or fewer shapes.`);
  if (!problems.length && !out.length) problems.push('Nothing is made with these settings: every shape is switched off by its "when".');
  if (problems.length) throw new BuildError(problems);
  return out;
}

/**
 * A build file as a Library item, to place (and customise, when it has settings) like any other.
 * Building with impossible settings throws `BuildError`.
 */
export function buildItem(design: BuildDesign): LibraryItem {
  return customisable({
    id: `ai-${design.id}`,
    name: design.name,
    category: 'AI designs',
    subcategory: 'AI designs',
    rooms: [],
    tags: [],
    hangs: design.hangs,
    params: design.params,
    make: (values) => makeBuild(design, values),
  });
}
