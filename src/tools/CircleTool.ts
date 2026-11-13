import { toPlane2D } from '../core/math/plane';
import { ANGLE_TOL, TOL } from '../core/math/tolerance';
import { distance, dot, type Vec3 } from '../core/math/vec3';
import { circlePoints, DEFAULT_CIRCLE_SEGMENTS, DEFAULT_POLYGON_SIDES, drawCircle, drawRegularPolygon } from '../core/ops/draw';
import type { DocumentSnapshot } from '../doc/Document';
import { AXES, drawingPlane, pointOnPlane } from './geom';
import { placementAt, type Placement } from './placement';
import { closedSegments } from './RectangleTool';
import type { AxisLock, InferenceHints, Preview, Tool, ToolContext, ToolEvent, ToolId } from './types';
import { formatLength, parseLength, parseSegments } from './units';

export type RoundShape = 'circle' | 'polygon';

const AXIS_NAMES = ['red', 'green', 'blue'];

/**
 * Circle and Polygon: click the centre, click to set the radius (or type it + Enter). Type "32s"
 * at any time to set the number of sides. Both ask for their sides first: after the centre click,
 * type a number + Enter (or just Enter to keep the count shown), then the radius + Enter; a
 * radius with a unit ("10cm") or a decimal goes straight to the radius.
 * A circle keeps its true radius; a polygon is plain straight edges, with a corner toward the
 * cursor. Typing after finishing changes the shape just drawn. Arrow keys stand it upright or lay it
 * flat whatever is under the cursor (→ faces red, ← faces green, ↑ flat), as for a Follow Me profile.
 */
export class CircleTool implements Tool {
  readonly name: string;
  readonly dragIsClick = true;
  segments: number;
  private center: Placement | null = null;
  /** After the centre click: the Measurements box asks for the sides before the radius. */
  private askingSides = false;
  private radius = 0;
  /** Polygon: angle of the first corner from the plane's u axis (toward the cursor). */
  private angle = 0;
  private last: { base: DocumentSnapshot; at: Placement; radius: number; segments: number; angle: number } | null = null;
  /** The direction an arrow key made it face (null: it lies on the face clicked, or the ground). */
  private axisLock: Vec3 | null = null;
  /** ↓ set it facing along a line (rather than an axis). */
  private lineLock = false;

  constructor(
    private readonly ctx: ToolContext,
    readonly shape: RoundShape = 'circle',
  ) {
    this.name = shape === 'circle' ? 'Circle' : 'Polygon';
    this.segments = shape === 'circle' ? DEFAULT_CIRCLE_SEGMENTS : DEFAULT_POLYGON_SIDES;
  }

  get id(): ToolId {
    return this.shape;
  }

  hint(): string {
    const example = this.shape === 'circle' ? '32s' : '8s';
    if (this.askingSides) return `Type the number of sides and press Enter (Enter keeps ${this.segments}), or click to set the radius.`;
    return this.center
      ? `Click to set the radius, or type it and press Enter. Type ${example} to change the sides.`
      : `Click the centre on a face or on the ground. Sides: ${this.segments} (type e.g. ${example} to change). Arrow keys stand it upright (→ ←) or lay it flat (↑); ↓ stands it square across the last line pointed at.`;
  }

  vcbLabel(): string {
    if (this.askingSides) return 'Sides';
    return this.center || this.last ? 'Radius' : 'Sides';
  }

  vcbValue(): string {
    if (this.askingSides) return String(this.segments);
    if (this.center) return formatLength(this.radius);
    if (this.last) return formatLength(this.last.radius);
    return String(this.segments);
  }

  inference(): InferenceHints {
    return this.center ? { plane: this.center.plane } : {};
  }

  pointerMove(e: ToolEvent): void {
    if (!this.center) return;
    const p = pointOnPlane(e.snap?.point, e.ray, this.center.plane);
    if (!p) return;
    this.radius = distance(p, this.center.point);
    if (this.radius > TOL) {
      const [x, y] = toPlane2D({ ...this.center.plane, origin: this.center.point }, p);
      this.angle = Math.atan2(y, x);
    }
  }

  pointerDown(e: ToolEvent): void {
    if (!this.center) {
      this.center = this.locked(placementAt(this.ctx.doc.model, e));
      this.askingSides = true;
      this.radius = 0;
      this.angle = 0;
      return;
    }
    this.pointerMove(e);
    if (this.radius > TOL) this.commit(this.center, this.radius, this.segments, this.angle);
  }

  typed(text: string): void {
    const segs = parseSegments(text) ?? (this.askingSides && /^\d+$/.test(text.trim()) ? Number(text) : undefined);
    // Not a whole number while the sides are asked for (a radius with a unit, a decimal): the radius.
    if (segs === undefined) this.askingSides = false;
    if (segs !== undefined) {
      if (segs < 3 || segs > 999) throw new Error('Sides must be between 3 and 999');
      this.segments = segs;
      this.askingSides = false;
      if (!this.center && this.last) this.commit(this.last.at, this.last.radius, segs, this.last.angle, this.last.base);
      return;
    }
    const r = parseLength(text);
    if (r === undefined || r <= TOL) throw new Error(`Type a radius (e.g. 25) or a number of sides (e.g. ${this.shape === 'circle' ? '32s' : '8s'})`);
    if (this.center) this.commit(this.center, r, this.segments, this.angle);
    else if (this.last) this.commit(this.last.at, r, this.last.segments, this.last.angle, this.last.base);
    else throw new Error('Click the centre first, then type the radius');
  }

  enter(): void {
    this.askingSides = false;
  }

  lockAxis(lock: AxisLock, edgeDir?: Vec3 | null): string | null {
    if (lock === 'perpendicular') return null;
    if (lock === 'parallel') {
      // ↓: square across the last line pointed at, at whatever angle it runs.
      if (this.lineLock) {
        this.lineLock = false;
        this.axisLock = null;
      } else {
        if (!edgeDir) return `${this.name}: point at a line first, then press ↓ to stand it square across that line`;
        this.lineLock = true;
        this.axisLock = edgeDir;
      }
      if (this.center) this.center = this.locked(this.center);
      return this.lineLock ? `${this.name}: standing square across the line you pointed at (press ↓ again to unlock)` : `${this.name}: plane unlocked (it lies on the face you click)`;
    }
    const i = { x: 0, y: 1, z: 2 }[lock];
    const same = this.axisLock === AXES[i];
    this.lineLock = false;
    this.axisLock = same ? null : AXES[i];
    if (this.center) this.center = this.locked(this.center);
    if (same) return `${this.name}: plane unlocked (it lies on the face you click)`;
    return `${this.name}: drawn ${i === 2 ? 'flat' : 'upright'}, facing the ${AXIS_NAMES[i]} axis (press the arrow again to unlock)`;
  }

  /** The placement turned to face the locked direction; it splits the face clicked only if it lies on it. */
  private locked(at: Placement | null): Placement | null {
    if (!at || !this.axisLock) return at;
    const model = this.ctx.doc.model;
    const onHost = at.host !== undefined && model.faces.has(at.host) && Math.abs(dot(model.face(at.host).normal, this.axisLock)) > 1 - ANGLE_TOL;
    return { point: at.point, plane: drawingPlane(at.point, this.axisLock), host: onHost ? at.host : undefined };
  }

  private commit(at: Placement, radius: number, segments: number, angle: number, base?: DocumentSnapshot): void {
    this.center = null;
    this.askingSides = false;
    const model = this.ctx.doc.model;
    const before = this.ctx.apply(
      () => (this.shape === 'circle' ? drawCircle(model, at.plane, at.point, radius, segments, at.host) : drawRegularPolygon(model, at.plane, at.point, radius, segments, angle, at.host)),
      base,
    );
    this.last = { base: before, at, radius, segments, angle };
  }

  cancel(): void {
    this.center = null;
    this.askingSides = false;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    if (!this.center || this.radius <= TOL) return {};
    const pts = circlePoints(this.center.plane, this.center.point, this.radius, this.segments, this.shape === 'polygon' ? this.angle : 0);
    return {
      lines: [
        { points: closedSegments(pts), color: 'preview', width: 2 },
        { points: [this.center.point, pts[0]], color: 'preview', dashed: true },
      ],
    };
  }
}
