import { makePlane, toPlane2D, type Plane } from '../core/math/plane';
import { signedDistance } from '../core/math/plane';
import { TOL } from '../core/math/tolerance';
import { add, distance, scale, type Vec3 } from '../core/math/vec3';
import { rotation } from '../core/ops/transform';
import type { DocumentSnapshot } from '../doc/Document';
import { AXES, pointOnPlane } from './geom';
import { applyToTargets, parseArray, previewEdges, targetsAt, type Targets } from './targets';
import type { AxisLock, InferenceHints, Preview, PreviewLines, Tool, ToolContext, ToolEvent } from './types';

const SNAP_STEP = Math.PI / 12; // 15°
const SNAP_WITHIN = (2 * Math.PI) / 180; // 2°
const deg = (rad: number) => Math.round(((rad * 180) / Math.PI) * 10) / 10 + 0;
const AXIS_NAMES = ['red', 'green', 'blue'];

/**
 * Rotate: click the centre (the face you click on sets the rotation axis, else the blue axis;
 * arrow keys pick the red/green/blue axis instead), click a point to measure the angle from,
 * then move and click, or type the angle in degrees. The angle snaps to 15° steps. Press Ctrl to
 * copy (copy mode ends with the copy); after a copy type "4x" for 4 copies at that angle each, or
 * "/4" to spread 4 over it.
 */
export class RotateTool implements Tool {
  readonly id = 'rotate';
  readonly name = 'Rotate';
  readonly dragIsClick = true;
  private copy = false;
  private axisLock: Vec3 | null = null;
  /** ↓ set the axis along a line (rather than a red/green/blue axis). */
  private lineLock = false;
  private targets: Targets | null = null;
  private center: Vec3 | null = null;
  private plane: Plane | null = null;
  private ref: Vec3 | null = null;
  private cursor: Vec3 | null = null;
  /** Angle followed continuously (can pass 180°), and the angle shown/used after 15° snapping. */
  private rawAngle = 0;
  private angle = 0;
  private last: { base: DocumentSnapshot; targets: Targets; center: Vec3; axis: Vec3; angle: number; copy: boolean; count: number; divide: boolean } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    const mode = this.copy ? 'Copy mode (Ctrl to switch off). ' : '';
    if (!this.center) return `${mode}Click the centre of rotation (arrow keys pick the axis; ↓ rotates about the last line pointed at). Press Ctrl to copy.`;
    if (!this.ref) return `${mode}Click a point to measure the angle from.`;
    return `${mode}Move and click to rotate, or type the angle in degrees.`;
  }

  vcbLabel(): string {
    return 'Angle';
  }

  vcbValue(): string {
    if (this.ref) return `${deg(this.angle)}°`;
    if (this.last) return this.last.copy && this.last.count > 1 ? `${this.last.divide ? '/' : ''}${this.last.count}${this.last.divide ? '' : 'x'}` : `${deg(this.last.angle)}°`;
    return '';
  }

  inference(): InferenceHints {
    if (!this.plane || !this.center) return { centres: true };
    return this.ref ? { plane: this.plane, centres: true } : { reference: this.center, plane: this.plane, centres: true };
  }

  toggleCopy(): boolean {
    this.copy = !this.copy;
    return this.copy;
  }

  copying(): boolean {
    return this.copy;
  }

  lockAxis(lock: AxisLock, edgeDir?: Vec3 | null): string | null {
    if (lock === 'perpendicular' || this.ref) return null;
    if (lock === 'parallel') {
      // ↓: about the last line pointed at, at whatever angle it runs.
      const was = this.lineLock;
      if (!was && !edgeDir) return 'Point at a line first, then press ↓ to rotate about it';
      this.lineLock = !was;
      this.axisLock = was ? null : edgeDir!;
      if (this.center) this.plane = makePlane(this.center, this.axisLock ?? this.plane!.normal);
      return was ? 'Rotation axis unlocked' : 'Rotating about the line you pointed at (press ↓ again to unlock)';
    }
    const i = { x: 0, y: 1, z: 2 }[lock];
    const same = this.axisLock === AXES[i];
    this.lineLock = false;
    this.axisLock = same ? null : AXES[i];
    if (this.center) this.plane = makePlane(this.center, this.axisLock ?? this.plane!.normal);
    return same ? 'Rotation axis unlocked' : `Rotating about the ${AXIS_NAMES[i]} axis`;
  }

  private angleOf(p: Vec3): number {
    const [x, y] = toPlane2D(this.plane!, p);
    return Math.atan2(y, x);
  }

  pointerMove(e: ToolEvent): void {
    if (!this.plane) return;
    const p = pointOnPlane(e.snap?.point, e.ray, this.plane);
    if (!p) return;
    if (this.ref && this.cursor) {
      const step = this.angleOf(p) - this.angleOf(this.cursor);
      this.rawAngle += Math.atan2(Math.sin(step), Math.cos(step));
      const snapped = Math.round(this.rawAngle / SNAP_STEP) * SNAP_STEP;
      // Hovering a real point (a corner, say) means "rotate to there": no 15° snapping then.
      const pointSnap = e.snap && ['endpoint', 'midpoint', 'centre', 'guidePoint', 'guideIntersection'].includes(e.snap.kind);
      this.angle = !pointSnap && Math.abs(snapped - this.rawAngle) <= SNAP_WITHIN ? snapped : this.rawAngle;
    }
    this.cursor = p;
  }

  pointerDown(e: ToolEvent): void {
    const p = e.snap?.point;
    if (!p) return;
    if (!this.center) {
      this.targets = targetsAt(this.ctx, e);
      const model = this.ctx.doc.model;
      const onFace = e.face !== null && Math.abs(signedDistance(model.facePlane(e.face), p)) <= TOL;
      const axis = this.axisLock ?? (onFace ? model.face(e.face!).normal : AXES[2]);
      this.center = p;
      this.plane = makePlane(p, axis);
      this.cursor = p;
      return;
    }
    const q = pointOnPlane(e.snap?.point, e.ray, this.plane!);
    if (!q) return;
    if (!this.ref) {
      if (distance(q, this.center) <= TOL) return;
      // Measure from here: rotate the plane's basis so angle 0 points at the reference.
      this.plane = makePlane(this.center, this.plane!.normal, sub3(q, this.center));
      this.ref = this.cursor = q;
      this.rawAngle = this.angle = 0;
      return;
    }
    this.pointerMove(e);
    if (Math.abs(this.angle) <= 1e-9) return;
    this.commit(this.targets!, this.center, this.plane!.normal, this.angle, this.copy, 1, false);
  }

  private commit(targets: Targets, center: Vec3, axis: Vec3, angle: number, copy: boolean, count: number, divide: boolean, base?: DocumentSnapshot): void {
    this.center = this.plane = this.ref = this.cursor = null;
    this.targets = null;
    const steps = Array.from({ length: copy ? count : 1 }, (_, i) => rotation(center, axis, angle * (divide ? (i + 1) / count : i + 1)));
    const before = this.ctx.apply(() => applyToTargets(this.ctx.doc, targets, steps, copy), base);
    this.last = { base: before, targets, center, axis, angle, copy, count, divide };
    this.copy = false;
  }

  typed(text: string): void {
    const array = parseArray(text);
    if (array) {
      if (!this.last?.copy || this.center) throw new Error('Make a copy first (press Ctrl, then rotate), then type 4x or /4');
      const l = this.last;
      this.commit(l.targets, l.center, l.axis, l.angle, true, array.count, array.divide, l.base);
      return;
    }
    const d = Number(text.replace(/°|deg$/i, '').trim());
    if (!Number.isFinite(d) || d === 0) throw new Error('Type the angle in degrees (e.g. 90, or -45)');
    const angle = (d * Math.PI) / 180;
    if (this.center && this.ref) this.commit(this.targets!, this.center, this.plane!.normal, angle, this.copy, 1, false);
    else if (this.center) throw new Error('Click a point to measure the angle from, then type the angle');
    else if (this.last) this.commit(this.last.targets, this.last.center, this.last.axis, angle, this.last.copy, this.last.count, this.last.divide, this.last.base);
    else throw new Error('Click the centre of rotation first');
  }

  cancel(): void {
    this.center = this.plane = this.ref = this.cursor = null;
    this.targets = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
    this.copy = false;
  }

  preview(): Preview {
    if (!this.center || !this.plane || !this.cursor) return {};
    const { u, v, normal } = this.plane;
    const c = this.center;
    // A protractor in the rotation plane, sized to the reference (or cursor) distance: a ring with
    // tick marks every 15° (longer at 45° and 90°), the 0° line, and the angle turned as an arc
    // with its value beside it.
    const r = Math.max(distance(this.ref ?? this.cursor, c), 10);
    const at = (t: number, k: number) => add(c, add(scale(u, k * r * Math.cos(t)), scale(v, k * r * Math.sin(t))));
    const ring: Vec3[] = [];
    for (let i = 0; i <= 72; i++) ring.push(at((2 * Math.PI * i) / 72, 1));
    const ticks: Vec3[] = [];
    for (let deg = 0; deg < 360; deg += 15) {
      const inner = deg % 90 === 0 ? 0.78 : deg % 45 === 0 ? 0.85 : 0.92;
      const t = (deg * Math.PI) / 180;
      ticks.push(at(t, inner), at(t, 1));
    }
    const color = (['axisX', 'axisY', 'axisZ'] as const)[AXES.findIndex((a) => Math.abs(a[0] * normal[0] + a[1] * normal[1] + a[2] * normal[2]) > 1 - 1e-9)] ?? 'preview';
    const lines: PreviewLines[] = [
      { points: ring.slice(1).flatMap((p, i) => [ring[i], p]), color, width: 1.5 },
      { points: ticks, color, width: 1.5 },
    ];
    if (!this.ref) {
      // Choosing where 0° is: a line from the centre to the cursor.
      lines.push({ points: [c, this.cursor], color: 'preview', dashed: true, width: 1.5 });
      return { lines };
    }
    const a = this.angle;
    lines.push({ points: [c, at(0, 1.08), c, at(a, 1.08)], color: 'preview', width: 2 });
    const labels: { at: Vec3; text: string }[] = [];
    if (Math.abs(a) > 1e-9) {
      const arc: Vec3[] = [];
      const n = Math.max(2, Math.ceil(Math.abs(a) / (Math.PI / 36)));
      for (let i = 0; i <= n; i++) arc.push(at((a * i) / n, 0.42));
      lines.push({ points: arc.slice(1).flatMap((p, i) => [arc[i], p]), color: 'select', width: 3 });
      labels.push({ at: at(a / 2, 0.6), text: `${Math.round(((a * 180) / Math.PI) * 10) / 10}°` });
      if (this.targets) lines.push({ points: previewEdges(this.ctx.doc, this.targets, rotation(c, normal, a)).flat(), color: 'select', width: 1.5 });
    }
    return { lines, labels };
  }

}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
