/**
 * Touch navigation for Viewer mode, as pure maths (no DOM, no Three.js), so it can be tested.
 * One finger pans. Two fingers do two things at once: spreading or pinching them zooms toward the
 * point between them, and moving them together orbits. A flick keeps the view gliding for a
 * moment after the fingers lift (Glide).
 */

export type ScreenPoint = readonly [number, number];

/** What a two-finger move does: zoom steps for `Navigator.zoomToward` and an orbit drag in pixels. */
export interface TwoFingerStep {
  zoomSteps: number;
  orbit: [number, number];
}

/** How far a pinch zooms: each `Navigator.zoomToward` step covers 20% of the distance (×0.8). */
const STEP_FACTOR = 0.8;

export const midpoint = (a: ScreenPoint, b: ScreenPoint): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * The step between two positions of the same two fingers. The pinch follows the fingers: spreading
 * them to twice as far apart makes the model look twice as big. The orbit is how far the point
 * between them moved.
 */
export function twoFingerStep(before: readonly [ScreenPoint, ScreenPoint], after: readonly [ScreenPoint, ScreenPoint]): TwoFingerStep {
  const spread = (p: readonly [ScreenPoint, ScreenPoint]) => Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]);
  const d0 = spread(before);
  const d1 = spread(after);
  // Fingers on top of each other give no usable spread: no zoom then.
  const zoomSteps = d0 > 1 && d1 > 1 ? Math.log(d0 / d1) / Math.log(STEP_FACTOR) : 0;
  const m0 = midpoint(...before);
  const m1 = midpoint(...after);
  return { zoomSteps, orbit: [m1[0] - m0[0], m1[1] - m0[1]] };
}

/** Recent movement older than this (ms) does not count toward a flick. */
const SAMPLE_WINDOW = 100;
/** How quickly a glide slows down: its speed falls to 1/e in this many ms. */
const GLIDE_TIME = 325;
/** Below this speed (px/ms) there is no glide, or it stops. */
const MIN_SPEED = 0.02;

/**
 * Momentum after a flick. Feed it the movement while dragging (`move`), call `release` when the
 * fingers lift, then call `step` every frame for how far to keep moving, until it returns null.
 */
export class Glide {
  private samples: { t: number; dx: number; dy: number }[] = [];
  private velocity: [number, number] | null = null;
  private last = 0;

  /** Movement by (dx, dy) pixels at time t (ms). */
  move(dx: number, dy: number, t: number): void {
    this.velocity = null;
    this.samples.push({ t, dx, dy });
    while (this.samples.length && t - this.samples[0].t > SAMPLE_WINDOW) this.samples.shift();
  }

  /** Forget the drag (a new gesture started, or it changed kind). */
  reset(): void {
    this.samples = [];
    this.velocity = null;
  }

  /** The fingers lifted at time t: start gliding if they were moving fast enough. Returns whether it glides. */
  release(t: number): boolean {
    const recent = this.samples.filter((s) => t - s.t <= SAMPLE_WINDOW);
    this.samples = [];
    if (recent.length < 2) return false;
    const span = Math.max(t - recent[0].t, 16);
    const vx = recent.slice(1).reduce((s, r) => s + r.dx, 0) / span;
    const vy = recent.slice(1).reduce((s, r) => s + r.dy, 0) / span;
    if (Math.hypot(vx, vy) < MIN_SPEED) return false;
    this.velocity = [vx, vy];
    this.last = t;
    return true;
  }

  get gliding(): boolean {
    return this.velocity !== null;
  }

  /** How far to move this frame (time t), or null when the glide has run out. */
  step(t: number): [number, number] | null {
    if (!this.velocity) return null;
    const dt = Math.min(t - this.last, 50);
    this.last = t;
    const decay = Math.exp(-dt / GLIDE_TIME);
    const [vx, vy] = this.velocity;
    // Distance covered while the speed falls from v to v·decay.
    const k = GLIDE_TIME * (1 - decay);
    const out: [number, number] = [vx * k, vy * k];
    this.velocity = [vx * decay, vy * decay];
    if (Math.hypot(vx * decay, vy * decay) < MIN_SPEED) this.velocity = null;
    return out;
  }
}

/** Two taps this close in time (ms) and space (px) make a double-tap. */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;
/** A touch that moves less than this (px) before lifting is a tap. */
export const TAP_SLOP_PX = 10;
