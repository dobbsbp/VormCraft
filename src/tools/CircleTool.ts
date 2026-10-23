import { TOL } from '../core/math/tolerance';
import { distance } from '../core/math/vec3';
import { circlePoints, DEFAULT_CIRCLE_SEGMENTS, drawCircle } from '../core/ops/draw';
import type { DocumentSnapshot } from '../doc/Document';
import { pointOnPlane } from './geom';
import { placementAt, type Placement } from './placement';
import { closedSegments } from './RectangleTool';
import type { InferenceHints, Preview, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength, parseSegments } from './units';

/**
 * Circle: click the centre, click to set the radius (or type it + Enter). Type "32s" at any time
 * to set the number of segments. Typing after finishing changes the circle just drawn.
 */
export class CircleTool implements Tool {
  readonly id = 'circle';
  readonly name = 'Circle';
  readonly dragIsClick = true;
  segments = DEFAULT_CIRCLE_SEGMENTS;
  private center: Placement | null = null;
  private radius = 0;
  private last: { base: DocumentSnapshot; at: Placement; radius: number; segments: number } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return this.center
      ? 'Click to set the radius, or type it and press Enter. Type 32s to change the segment count.'
      : `Click the centre on a face or on the ground. Segments: ${this.segments} (type e.g. 32s to change).`;
  }

  vcbLabel(): string {
    return this.center || this.last ? 'Radius' : 'Segments';
  }

  vcbValue(): string {
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
    if (p) this.radius = distance(p, this.center.point);
  }

  pointerDown(e: ToolEvent): void {
    if (!this.center) {
      this.center = placementAt(this.ctx.doc.model, e);
      this.radius = 0;
      return;
    }
    this.pointerMove(e);
    if (this.radius > TOL) this.commit(this.center, this.radius, this.segments);
  }

  typed(text: string): void {
    const segs = parseSegments(text);
    if (segs !== undefined) {
      if (segs < 3 || segs > 999) throw new Error('Segments must be between 3 and 999');
      this.segments = segs;
      if (!this.center && this.last) this.commit(this.last.at, this.last.radius, segs, this.last.base);
      return;
    }
    const r = parseLength(text);
    if (r === undefined || r <= TOL) throw new Error('Type a radius (e.g. 25) or a segment count (e.g. 32s)');
    if (this.center) this.commit(this.center, r, this.segments);
    else if (this.last) this.commit(this.last.at, r, this.last.segments, this.last.base);
    else throw new Error('Click the centre first, then type the radius');
  }

  private commit(at: Placement, radius: number, segments: number, base?: DocumentSnapshot): void {
    this.center = null;
    const before = this.ctx.apply(() => drawCircle(this.ctx.doc.model, at.plane, at.point, radius, segments, at.host), base);
    this.last = { base: before, at, radius, segments };
  }

  cancel(): void {
    this.center = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    if (!this.center || this.radius <= TOL) return {};
    const pts = circlePoints(this.center.plane, this.center.point, this.radius, this.segments);
    return {
      lines: [
        { points: closedSegments(pts), color: 'preview', width: 2 },
        { points: [this.center.point, pts[0]], color: 'preview', dashed: true },
      ],
    };
  }
}
