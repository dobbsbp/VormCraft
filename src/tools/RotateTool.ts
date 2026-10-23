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
 * then move and click, or type the angle in degrees. The angle snaps to 15° steps. Tap Ctrl to
 * copy; after a copy type "4x" for 4 copies at that angle each, or "/4" to spread 4 over it.
 */
export class RotateTool implements Tool {
  readonly id = 'rotate';
  readonly name = 'Rotate';
  readonly dragIsClick = true;
  private copy = false;
  private axisLock: Vec3 | null = null;
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
    if (!this.center) return `${mode}Click the centre of rotation (arrow keys pick the axis). Tap Ctrl to copy.`;
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
    if (!this.plane || !this.center) return {};
    return this.ref ? { plane: this.plane } : { reference: this.center, plane: this.plane };
  }

  toggleCopy(): boolean {
    this.copy = !this.copy;
    return this.copy;
  }

  lockAxis(lock: AxisLock): string | null {
    if (lock === 'parallel' || lock === 'perpendicular' || this.ref) return null;
    const i = { x: 0, y: 1, z: 2 }[lock];
    const same = this.axisLock === AXES[i];
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
      const pointSnap = e.snap && ['endpoint', 'midpoint', 'guidePoint', 'guideIntersection'].includes(e.snap.kind);
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
  }

  typed(text: string): void {
    const array = parseArray(text);
    if (array) {
      if (!this.last?.copy || this.center) throw new Error('Make a copy first (tap Ctrl, then rotate), then type 4x or /4');
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
  }

  preview(): Preview {
    if (!this.center || !this.plane || !this.cursor) return {};
    const lines: PreviewLines[] = [];
    // A protractor: a ring in the rotation plane, sized to the reference or cursor distance.
    const r = Math.max(distance(this.ref ?? this.cursor, this.center), 10);
    const ring: Vec3[] = [];
    for (let i = 0; i <= 48; i++) {
      const t = (2 * Math.PI * i) / 48;
      ring.push(add(this.center, add(scale(this.plane.u, r * Math.cos(t)), scale(this.plane.v, r * Math.sin(t)))));
    }
    const color = (['axisX', 'axisY', 'axisZ'] as const)[AXES.findIndex((a) => Math.abs(a[0] * this.plane!.normal[0] + a[1] * this.plane!.normal[1] + a[2] * this.plane!.normal[2]) > 1 - 1e-9)] ?? 'preview';
    lines.push({ points: ring.slice(1).flatMap((p, i) => [ring[i], p]), color, width: 1.5 });
    if (this.ref) {
      const a = this.angle;
      const end = add(this.center, add(scale(this.plane.u, r * Math.cos(a)), scale(this.plane.v, r * Math.sin(a))));
      lines.push({ points: [this.center, this.ref, this.center, end], color: 'preview', dashed: true, width: 1.5 });
      if (this.targets && Math.abs(a) > 1e-9) lines.push({ points: previewEdges(this.ctx.doc, this.targets, rotation(this.center, this.plane.normal, a)).flat(), color: 'select', width: 1.5 });
    }
    return { lines };
  }
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
