import { fromPlane2D, signedDistance, toPlane2D, type Plane } from '../core/math/plane';
import { TOL } from '../core/math/tolerance';
import { scale, sub, type Vec3 } from '../core/math/vec3';
import { findFaceAt } from '../core/model/query';
import { drawRectangle, rectanglePoints } from '../core/ops/draw';
import type { DocumentSnapshot } from '../doc/Document';
import { AXES, drawingPlane, pointOnPlane } from './geom';
import { placementAt, type Placement } from './placement';
import type { AxisLock, InferenceHints, Preview, SnapKind, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLengths } from './units';

const AXIS_NAMES = ['red', 'green', 'blue'];
/** Snaps on real geometry (not just where the cursor meets a plane). */
const GEOMETRY: ReadonlySet<SnapKind> = new Set(['endpoint', 'midpoint', 'onEdge', 'origin', 'guidePoint', 'guideIntersection', 'onGuide', 'onFace']);

/**
 * Rectangle: click a corner, click the opposite corner (or type "width,length" + Enter). Drawn on
 * the face under the first click (splitting it) or on the ground. Snapping the second corner to a
 * point off that plane turns the rectangle upright (into the red/green/blue plane holding both
 * corners), as in SketchUp; the arrow keys fix the plane instead (→ faces red, ← green, ↑ flat).
 * Typing after finishing resizes the rectangle just drawn.
 */
export class RectangleTool implements Tool {
  readonly id = 'rectangle';
  readonly name = 'Rectangle';
  readonly dragIsClick = true;
  /** Where the first click landed, and (`start`) the plane the rectangle is being drawn on now. */
  private origin: Placement | null = null;
  private start: Placement | null = null;
  /** Arrow keys: the normal of the plane to draw on. */
  private axisLock: Vec3 | null = null;
  private size: [number, number] = [0, 0];
  private last: { base: DocumentSnapshot; at: Placement; size: [number, number] } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return this.start
      ? 'Click the opposite corner, or type width,length and press Enter.'
      : 'Click the first corner on a face or on the ground.';
  }

  vcbLabel(): string {
    return 'Dimensions';
  }

  vcbValue(): string {
    const s = this.start ? this.size : this.last?.size;
    return s ? `${formatLength(Math.abs(s[0]))}, ${formatLength(Math.abs(s[1]))}` : '';
  }

  inference(): InferenceHints {
    if (!this.start) return {};
    // Free snapping (so the second corner can pick a point off the plane) unless the plane is fixed.
    return this.axisLock ? { plane: this.start.plane } : { reference: this.start.point };
  }

  lockAxis(lock: AxisLock): string | null {
    if (lock === 'parallel' || lock === 'perpendicular') return null;
    const i = { x: 0, y: 1, z: 2 }[lock];
    const same = this.axisLock === AXES[i];
    this.axisLock = same ? null : AXES[i];
    if (this.origin) this.start = this.axisLock ? this.placementOn(drawingPlane(this.origin.point, this.axisLock)) : this.origin;
    if (same) return `${this.name}: plane unlocked (it follows the faces and points you click)`;
    return `${this.name}: drawn ${i === 2 ? 'flat' : 'upright'}, facing the ${AXIS_NAMES[i]} axis (press the arrow again to unlock)`;
  }

  /** Drawing on `plane` from the first corner: on a face there if there is one (it gets split). */
  private placementOn(plane: Plane): Placement {
    const point = this.origin!.point;
    const host = findFaceAt(this.ctx.doc.model, point, plane.normal) ?? findFaceAt(this.ctx.doc.model, point, scale(plane.normal, -1));
    return { point, plane, host };
  }

  /**
   * The red/green/blue plane holding both corners, when the second corner is a point on the model
   * off the current plane (a rectangle up a wall, or across an open end). Null if they are not in
   * one such plane.
   */
  private uprightPlane(p: Vec3): Plane | null {
    const d = sub(p, this.origin!.point);
    const sizes = d.map(Math.abs);
    const i = sizes.indexOf(Math.min(...sizes));
    if (sizes[i] > TOL || sizes.filter((x) => x > TOL).length < 2) return null;
    return drawingPlane(this.origin!.point, AXES[i]);
  }

  pointerMove(e: ToolEvent): void {
    if (!this.start || !this.origin) return;
    const s = e.snap;
    if (!this.axisLock && s && GEOMETRY.has(s.kind) && Math.abs(signedDistance(this.start.plane, s.point)) > TOL) {
      // Off the plane: back on the first click's plane if the point is on it, else upright.
      if (Math.abs(signedDistance(this.origin.plane, s.point)) <= TOL) this.start = this.origin;
      else {
        const upright = this.uprightPlane(s.point);
        if (upright) this.start = this.placementOn(upright);
      }
    }
    // A snapped point still off the plane: follow the mouse on the plane instead.
    const onPlane = s && Math.abs(signedDistance(this.start.plane, s.point)) <= TOL ? s.point : undefined;
    const p = pointOnPlane(onPlane, e.ray, this.start.plane) ?? (s ? pointOnPlane(s.point, e.ray, this.start.plane) : null);
    if (!p) return;
    const [x0, y0] = toPlane2D(this.start.plane, this.start.point);
    const [x1, y1] = toPlane2D(this.start.plane, p);
    this.size = [x1 - x0, y1 - y0];
  }

  pointerDown(e: ToolEvent): void {
    if (!this.start) {
      this.origin = placementAt(this.ctx.doc.model, e);
      this.start = this.origin && this.axisLock ? this.placementOn(drawingPlane(this.origin.point, this.axisLock)) : this.origin;
      this.size = [0, 0];
      return;
    }
    this.pointerMove(e);
    if (Math.abs(this.size[0]) <= TOL || Math.abs(this.size[1]) <= TOL) return; // same spot / a line: keep going
    this.commit(this.start, this.size);
  }

  typed(text: string): void {
    const v = parseLengths(text);
    if (!v || v.length > 2 || v.every((x) => x === undefined)) throw new Error('Type width,length (e.g. 300,200)');
    const current = this.start ? this.size : this.last?.size;
    const at = this.start ?? this.last?.at;
    if (!current || !at) throw new Error('Click the first corner, then type width,length');
    // Typed values are sizes; keep the direction the mouse is drawing in.
    const dim = (i: number) => {
      const typedValue = v[i];
      if (typedValue === undefined) return current[i];
      return Math.abs(typedValue) * (current[i] < 0 ? -1 : 1) * (typedValue < 0 ? -1 : 1);
    };
    const size: [number, number] = [dim(0), dim(1)];
    if (Math.abs(size[0]) <= TOL || Math.abs(size[1]) <= TOL) throw new Error('Width and length must be more than zero');
    if (this.start) this.commit(this.start, size);
    else this.commit(this.last!.at, size, this.last!.base);
  }

  private commit(at: Placement, size: [number, number], base?: DocumentSnapshot): void {
    this.start = this.origin = null;
    const before = this.ctx.apply(() => drawRectangle(this.ctx.doc.model, at.plane, at.point, size[0], size[1], at.host), base);
    this.last = { base: before, at, size };
  }

  cancel(): void {
    this.start = this.origin = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    if (!this.start) return {};
    const { plane, point } = this.start;
    const [w, l] = this.size;
    if (Math.abs(w) <= TOL && Math.abs(l) <= TOL) return {};
    const pts = Math.abs(w) > TOL && Math.abs(l) > TOL ? rectanglePoints(plane, point, w, l) : [point, fromPlane2D(plane, add2(toPlane2D(plane, point), [w, l]))];
    return { lines: [{ points: closedSegments(pts), color: 'preview', width: 2 }] };
  }
}

const add2 = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];

/** Segment pairs around a closed loop (or the single segment for two points). */
export function closedSegments<T>(pts: readonly T[]): T[] {
  if (pts.length === 2) return [pts[0], pts[1]];
  return pts.flatMap((p, i) => [p, pts[(i + 1) % pts.length]]);
}
