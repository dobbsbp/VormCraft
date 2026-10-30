import type { Plane } from '../core/math/plane';
import { TOL } from '../core/math/tolerance';
import { add, cross, distance, dot, length, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import { drawEdges } from '../core/ops/edges';
import type { DocumentSnapshot } from '../doc/Document';
import { pointOnPlane } from './geom';
import { lineColor } from './LineTool';
import { placementAt } from './placement';
import { closedSegments } from './RectangleTool';
import type { InferenceHints, Preview, Snap, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

/** A rectangle by its first edge (a → b) and the side from b to the third corner. */
interface Rect {
  a: Vec3;
  b: Vec3;
  side: Vec3;
}

const corners = (r: Rect): Vec3[] => [r.a, r.b, add(r.b, r.side), add(r.a, r.side)];

/**
 * Rotated Rectangle: click the first corner, click the second (the first edge, in the plane of
 * the first click; or type its length), then swing the rectangle around that edge and click
 * the third corner, at any angle. Type "length" or "length,angle" for the last step: the angle is
 * measured from the drawing plane (0 = flat on it, 90 = standing up). Typing after finishing
 * changes the rectangle just drawn.
 */
export class RotatedRectangleTool implements Tool {
  readonly id = 'rectangle3';
  readonly name = 'Rotated Rectangle';
  readonly dragIsClick = true;
  private plane: Plane | null = null;
  private points: Vec3[] = [];
  private cursor: Vec3 | null = null;
  private snap: Snap | null = null;
  private last: { base: DocumentSnapshot; plane: Plane; rect: Rect } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return [
      'Click the first corner on a face or on the ground.',
      'Click the second corner (the first edge), or type its length.',
      'Swing the rectangle around the first edge and click, or type length or length,angle.',
    ][this.points.length];
  }

  vcbLabel(): string {
    return this.points.length === 1 ? 'Length' : this.points.length === 2 || this.last ? 'Length, Angle' : 'Length';
  }

  vcbValue(): string {
    if (this.points.length === 1 && this.cursor) return formatLength(distance(this.points[0], this.cursor));
    const rect = this.points.length === 2 ? this.rectAt() : this.points.length === 0 ? this.last?.rect : null;
    const plane = this.points.length === 2 ? this.plane : this.last?.plane;
    if (!rect || !plane) return '';
    return `${formatLength(length(rect.side))}, ${Math.round(angleOf(rect, plane) * 10) / 10}°`;
  }

  inference(): InferenceHints {
    const [a, b] = this.points;
    if (this.points.length === 1) return { reference: a, plane: this.plane! };
    // The third corner swings around the first edge: keep it on the plane through b square to it.
    if (this.points.length === 2) return { reference: b, lockPlane: { normal: normalize(sub(b, a)) } };
    return {};
  }

  pointerMove(e: ToolEvent): void {
    this.snap = e.snap;
    const p = this.pointFor(e);
    if (p) this.cursor = p;
  }

  private pointFor(e: ToolEvent): Vec3 | null {
    if (this.points.length === 1) return pointOnPlane(e.snap?.point, e.ray, this.plane!);
    return e.snap?.point ?? null;
  }

  pointerDown(e: ToolEvent): void {
    this.pointerMove(e);
    const n = this.points.length;
    if (n === 0) {
      const at = placementAt(this.ctx.doc.model, e);
      if (!at) return;
      this.plane = at.plane;
      this.points = [at.point];
      this.cursor = at.point;
      return;
    }
    const p = this.pointFor(e);
    if (!p) return;
    if (n === 1) {
      if (distance(p, this.points[0]) > TOL) this.points.push(p);
      return;
    }
    const rect = this.rectAt();
    if (rect && length(rect.side) > TOL) this.commit(rect);
  }

  /** The rectangle the cursor gives in the third step: the cursor's offset square to the first edge. */
  private rectAt(): Rect | null {
    const [a, b] = this.points;
    if (!this.cursor || !b) return null;
    const dir = normalize(sub(b, a));
    const v = sub(this.cursor, b);
    return { a, b, side: sub(v, scale(dir, dot(v, dir))) };
  }

  typed(text: string): void {
    const n = this.points.length;
    if (n === 1) {
      const len = parseLength(text);
      if (len === undefined || len <= TOL) throw new Error('Type the length of the first edge');
      const dir = this.cursor && distance(this.cursor, this.points[0]) > TOL ? normalize(sub(this.cursor, this.points[0])) : this.plane!.u;
      this.points.push(add(this.points[0], scale(dir, len)));
      this.cursor = this.points[1];
      return;
    }
    const parts = text.split(/[,;]/).map((x) => x.trim());
    const len = parts[0] ? parseLength(parts[0]) : undefined;
    const typedAngle = parts[1] ? Number(parts[1].replace(/°|deg$/i, '').trim()) : undefined;
    if (parts.length > 2 || (parts[0] && len === undefined) || (typedAngle !== undefined && !Number.isFinite(typedAngle)) || (len === undefined && typedAngle === undefined)) {
      throw new Error('Type length, or length,angle (e.g. 200,45)');
    }
    const current = n === 2 ? this.rectAt() : n === 0 ? this.last?.rect : null;
    const plane = n === 2 ? this.plane : this.last?.plane;
    if (!current || !plane) throw new Error('Click the first two corners, then type length,angle');
    const side = len ?? length(current.side);
    if (Math.abs(side) <= TOL) throw new Error('The length must be more than zero');
    const angle = typedAngle ?? angleOf(current, plane);
    const rect = withSide(current, plane, side, angle);
    if (n === 2) this.commit(rect);
    else this.commit(rect, this.last!.base);
  }

  private commit(rect: Rect, base?: DocumentSnapshot): void {
    const plane = this.plane ?? this.last!.plane;
    this.points = [];
    this.plane = null;
    const pts = corners(rect);
    const before = this.ctx.apply(() => drawEdges(this.ctx.doc.model, [...pts, pts[0]]), base);
    this.last = { base: before, plane, rect };
  }

  cancel(): void {
    this.points = [];
    this.plane = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    const n = this.points.length;
    if (n === 0 || !this.cursor) return {};
    if (n === 1) return { lines: [{ points: [this.points[0], this.cursor], color: lineColor(this.snap), width: 2 }] };
    const rect = this.rectAt();
    if (!rect || length(rect.side) <= TOL) return { lines: [{ points: [this.points[0], this.points[1]], color: 'preview', width: 2 }] };
    return { lines: [{ points: closedSegments(corners(rect)), color: 'preview', width: 2 }] };
  }
}

/** In-plane direction square to the first edge, on the side the rectangle swings toward. */
function flatSide(rect: Rect, plane: Plane): Vec3 {
  const w = normalize(cross(plane.normal, sub(rect.b, rect.a)));
  return dot(rect.side, w) < -TOL ? scale(w, -1) : w;
}

/** Angle (degrees) the rectangle is turned up out of the drawing plane: 0 flat, 90 square to it. */
function angleOf(rect: Rect, plane: Plane): number {
  const w = flatSide(rect, plane);
  return (Math.atan2(dot(rect.side, plane.normal), dot(rect.side, w)) * 180) / Math.PI;
}

/** The same first edge, with the side `len` long and turned `angle` degrees out of the plane. */
function withSide(rect: Rect, plane: Plane, len: number, angle: number): Rect {
  const w = flatSide(rect, plane);
  const t = (angle * Math.PI) / 180;
  return { ...rect, side: scale(add(scale(w, Math.cos(t)), scale(plane.normal, Math.sin(t))), len) };
}
