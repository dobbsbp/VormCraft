import { fromPlane2D, toPlane2D } from '../core/math/plane';
import { TOL } from '../core/math/tolerance';
import { drawRectangle, rectanglePoints } from '../core/ops/draw';
import type { DocumentSnapshot } from '../doc/Document';
import { pointOnPlane } from './geom';
import { placementAt, type Placement } from './placement';
import type { InferenceHints, Preview, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLengths } from './units';

/**
 * Rectangle: click a corner, click the opposite corner (or type "width,length" + Enter). Drawn on
 * the face under the first click (splitting it) or on the ground. Typing after finishing resizes
 * the rectangle just drawn.
 */
export class RectangleTool implements Tool {
  readonly id = 'rectangle';
  readonly name = 'Rectangle';
  readonly dragIsClick = true;
  private start: Placement | null = null;
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
    return this.start ? { plane: this.start.plane } : {};
  }

  pointerMove(e: ToolEvent): void {
    if (!this.start) return;
    const p = pointOnPlane(e.snap?.point, e.ray, this.start.plane);
    if (!p) return;
    const [x0, y0] = toPlane2D(this.start.plane, this.start.point);
    const [x1, y1] = toPlane2D(this.start.plane, p);
    this.size = [x1 - x0, y1 - y0];
  }

  pointerDown(e: ToolEvent): void {
    if (!this.start) {
      this.start = placementAt(this.ctx.doc.model, e);
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
    this.start = null;
    const before = this.ctx.apply(() => drawRectangle(this.ctx.doc.model, at.plane, at.point, size[0], size[1], at.host), base);
    this.last = { base: before, at, size };
  }

  cancel(): void {
    this.start = null;
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
