/**
 * What is drawn behind the model: a sky above the horizon and a ground below it, or (when off) the
 * plain background colour. Each device keeps its own (a preference); a scene can carry one too.
 * The ground is only a background: it never hides or covers the model.
 */
export type SkyKind = 'clear' | 'clouds';
export type GroundKind = 'none' | 'plain' | 'grass' | 'paving' | 'sand';

export interface Backdrop {
  /** Sky and ground; off shows the plain background colour (`DisplayStyle.background`). */
  on: boolean;
  sky: SkyKind;
  /** The sky overhead, '#rrggbb'. */
  skyColor: string;
  /** The sky at the horizon (also the haze the ground fades into), '#rrggbb'. */
  horizonColor: string;
  ground: GroundKind;
  /** The ground's colour (a texture is tinted with it), '#rrggbb'. */
  groundColor: string;
}

export const SKY_KINDS: readonly { kind: SkyKind; label: string }[] = [
  { kind: 'clear', label: 'Clear' },
  { kind: 'clouds', label: 'Soft clouds' },
];

/** Ground kinds, with the colour each starts with when chosen. */
export const GROUND_KINDS: readonly { kind: GroundKind; label: string; color: string }[] = [
  { kind: 'plain', label: 'Plain', color: '#b4b1a2' },
  { kind: 'grass', label: 'Grass', color: '#7f9a5c' },
  { kind: 'paving', label: 'Paving', color: '#a9a59c' },
  { kind: 'sand', label: 'Sand', color: '#d3c39b' },
  { kind: 'none', label: 'None (sky all round)', color: '#b4b1a2' },
];

/** A light sky over plain ground: easy on the eyes while modelling. */
export const DEFAULT_BACKDROP: Backdrop = { on: true, sky: 'clear', skyColor: '#8fb8de', horizonColor: '#e3ebf2', ground: 'plain', groundColor: '#b4b1a2' };

/** A few ready-made looks (kept few on purpose). */
export const BACKDROP_PRESETS: readonly { label: string; backdrop: Backdrop }[] = [
  { label: 'Day', backdrop: DEFAULT_BACKDROP },
  { label: 'Soft clouds', backdrop: { on: true, sky: 'clouds', skyColor: '#7eaedb', horizonColor: '#e6edf3', ground: 'grass', groundColor: '#7f9a5c' } },
  { label: 'Evening', backdrop: { on: true, sky: 'clouds', skyColor: '#3d4f7a', horizonColor: '#e8b48a', ground: 'plain', groundColor: '#6e6a62' } },
  { label: 'Plain', backdrop: { ...DEFAULT_BACKDROP, on: false } },
];

const COLOR = /^#[0-9a-f]{6}$/i;

/** The backdrop as given if it is valid (from a file or a device setting), else undefined. */
export function validBackdrop(v: unknown): Backdrop | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const b = v as Partial<Backdrop>;
  if (typeof b.on !== 'boolean') return undefined;
  if (!SKY_KINDS.some((s) => s.kind === b.sky) || !GROUND_KINDS.some((g) => g.kind === b.ground)) return undefined;
  if (![b.skyColor, b.horizonColor, b.groundColor].every((c) => typeof c === 'string' && COLOR.test(c))) return undefined;
  return { on: b.on, sky: b.sky!, skyColor: b.skyColor!, horizonColor: b.horizonColor!, ground: b.ground!, groundColor: b.groundColor! };
}

export const sameBackdrop = (a: Backdrop, b: Backdrop): boolean => JSON.stringify(validBackdrop(a)) === JSON.stringify(validBackdrop(b));
