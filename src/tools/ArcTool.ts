import { toPlane2D, type Plane } from '../core/math/plane';
import { TOL } from '../core/math/tolerance';
import { add, distance, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import { arcAroundCenter, arcFromBulge, arcPoints, arcThroughPoints, DEFAULT_ARC_SEGMENTS, drawArc, drawPie, type Arc } from '../core/ops/arcs';
import type { DocumentSnapshot } from '../doc/Document';
import { pointOnPlane } from './geom';
import { lineColor } from './LineTool';
import { placementAt } from './placement';
import type { InferenceHints, Preview, PreviewLines, Snap, Tool, ToolContext, ToolEvent, ToolId } from './types';
import { formatLength, parseLength, parseSegments } from './units';

export type ArcMode = 'arc2' | 'arc3' | 'arc' | 'pie';

const NAMES: Record<ArcMode, string> = { arc2: '2-Point Arc', arc3: '3-Point Arc', arc: 'Arc', pie: 'Pie' };

/**
 * The three arc tools.
 * - 2-Point Arc: click the start, click the end (or type the chord length), then move to set the
 *   bulge and click (or type it).
 * - 3-Point Arc: click the start, a point the arc passes through, and the end.
 * - Arc: click the centre, click the start (or type the radius), then click the end (or type the
 *   angle in degrees).
 * - Pie: as Arc, and the two radii close it into a slice-shaped face.
 * Type e.g. "16s" at any time to set the number of segments. Typing after finishing changes the
 * arc just drawn. Arcs keep their true radius (for STEP and fine STL export).
 */
export class ArcTool implements Tool {
  readonly name: string;
  readonly dragIsClick = true;
  segments = DEFAULT_ARC_SEGMENTS;
  private plane: Plane | null = null;
  private points: Vec3[] = [];
  private cursor: Vec3 | null = null;
  private snap: Snap | null = null;
  /** For the centre arc: the sweep followed continuously, so it can pass 180°. */
  private sweep = 0;
  private last: { base: DocumentSnapshot; plane: Plane; points: Vec3[]; value: number; segments: number } | null = null;

  constructor(
    private readonly ctx: ToolContext,
    readonly mode: ArcMode,
  ) {
    this.name = NAMES[mode];
  }

  get id(): ToolId {
    return this.mode;
  }

  /** Arc and Pie start from the centre. */
  private get centred(): boolean {
    return this.mode === 'arc' || this.mode === 'pie';
  }

  hint(): string {
    const n = this.points.length;
    const segs = ` Type e.g. ${this.segments}s to change the segments.`;
    if (this.mode === 'arc2') {
      return ['Click the start of the arc.', 'Click the end, or type the chord length.', 'Move to set the bulge and click, or type it.'][n] + segs;
    }
    if (this.mode === 'arc3') return ['Click the start of the arc.', 'Click a point the arc passes through.', 'Click the end of the arc.'][n] + segs;
    return ['Click the centre.', 'Click the start of the arc, or type the radius.', 'Click the end, or type the angle in degrees.'][n] + segs;
  }

  vcbLabel(): string {
    const n = this.points.length;
    if (this.mode === 'arc2') return n === 2 || (n === 0 && this.last) ? 'Bulge' : n === 1 ? 'Length' : 'Segments';
    if (this.centred) return n === 2 || (n === 0 && this.last) ? 'Angle' : n === 1 ? 'Radius' : 'Segments';
    return 'Segments';
  }

  vcbValue(): string {
    const n = this.points.length;
    if (n === 1 && this.cursor) return formatLength(distance(this.points[0], this.cursor));
    if (n === 2 && this.mode === 'arc2') return formatLength(Math.abs(this.bulgeAt()));
    if (n === 2 && this.centred) return `${Math.round((this.sweep * 180) / Math.PI * 10) / 10}°`;
    if (n === 0 && this.last) return this.centred ? `${Math.round(((this.last.value * 180) / Math.PI) * 10) / 10}°` : this.mode === 'arc2' ? formatLength(Math.abs(this.last.value)) : String(this.segments);
    return String(this.segments);
  }

  inference(): InferenceHints {
    const n = this.points.length;
    if (n === 0) return {};
    // 3-point arcs are not tied to one plane; the others stay on the plane of their first click.
    if (this.mode === 'arc3') return { reference: this.points[n - 1] };
    return n === 1 ? { reference: this.points[0], plane: this.plane! } : { plane: this.plane! };
  }

  /** Where the cursor is, kept on the arc's plane when it has one. */
  private pointFor(e: ToolEvent): Vec3 | null {
    if (this.mode === 'arc3' || !this.plane) return e.snap?.point ?? null;
    return pointOnPlane(e.snap?.point, e.ray, this.plane);
  }

  pointerMove(e: ToolEvent): void {
    this.snap = e.snap;
    const p = this.pointFor(e);
    if (!p) return;
    if (this.centred && this.points.length === 2 && this.cursor) {
      // Follow the angle continuously from the previous cursor position.
      const step = this.angleOf(p) - this.angleOf(this.cursor);
      this.sweep += Math.atan2(Math.sin(step), Math.cos(step));
    }
    this.cursor = p;
  }

  private angleOf(p: Vec3): number {
    const [x, y] = toPlane2D({ ...this.plane!, origin: this.points[0] }, p);
    return Math.atan2(y, x);
  }

  /** Signed distance of the cursor from the chord (positive to its left): the 2-point bulge. */
  private bulgeAt(): number {
    const [a, b] = this.points;
    if (!this.cursor) return 0;
    const pl = this.plane!;
    const A = toPlane2D(pl, a);
    const B = toPlane2D(pl, b);
    const C = toPlane2D(pl, this.cursor);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    return ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / len;
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
    if (!p || distance(p, this.points[n - 1]) <= TOL) return;
    if (n === 1) {
      this.points.push(p);
      this.sweep = 0;
      if (this.centred) this.cursor = p;
      return;
    }
    const arc = this.arcFor(p);
    const value = this.mode === 'arc2' ? this.bulgeAt() : arc.sweep;
    if (this.mode === 'arc3') this.points.push(p);
    this.commit(arc, value);
  }

  /** The arc the third click (or the cursor) defines. */
  private arcFor(p: Vec3): Arc {
    const [a, b] = this.points;
    if (this.mode === 'arc3') return arcThroughPoints(a, b, p);
    if (this.mode === 'arc2') {
      this.cursor = p;
      return arcFromBulge(this.plane!, a, b, this.bulgeAt());
    }
    return arcAroundCenter(this.plane!, a, b, this.sweep);
  }

  /** Draw the arc. `value` is what typing re-dimensions later: the bulge (2-point) or sweep (centre). */
  private commit(arc: Arc, value: number, base?: DocumentSnapshot): void {
    const plane = this.plane ?? arc.plane;
    const points = [...this.points];
    this.points = [];
    this.plane = null;
    const before = this.ctx.apply(() => (this.mode === 'pie' ? drawPie : drawArc)(this.ctx.doc.model, arc, this.segments), base);
    this.last = { base: before, plane, points, value, segments: this.segments };
  }

  typed(text: string): void {
    const segs = parseSegments(text);
    if (segs !== undefined) {
      if (segs < 1 || segs > 999) throw new Error('Segments must be between 1 and 999');
      this.segments = segs;
      if (this.points.length === 0 && this.last) this.redo(this.last.value);
      return;
    }
    const n = this.points.length;
    if (this.mode === 'arc3') throw new Error('Click the three points; type e.g. 16s to change the segments');
    if (n === 1) {
      // Chord length (2-point) or radius (centre), in the direction of the mouse.
      const len = parseLength(text);
      if (len === undefined || len <= TOL) throw new Error(this.mode === 'arc2' ? 'Type the chord length' : 'Type the radius');
      const dir = this.cursor && distance(this.cursor, this.points[0]) > TOL ? normalize(sub(this.cursor, this.points[0])) : this.plane!.u;
      this.points.push(add(this.points[0], scale(dir, len)));
      this.sweep = 0;
      return;
    }
    const value = this.parseValue(text);
    if (n === 2) {
      if (this.mode === 'arc2') {
        const bulge = (Math.sign(this.bulgeAt()) || 1) * Math.abs(value);
        this.commit(arcFromBulge(this.plane!, this.points[0], this.points[1], bulge), bulge);
      } else {
        const sweep = ((Math.sign(this.sweep) || 1) * Math.abs(value) * Math.PI) / 180;
        this.commit(arcAroundCenter(this.plane!, this.points[0], this.points[1], sweep), sweep);
      }
      return;
    }
    if (this.last) {
      this.redo(this.mode === 'arc2' ? Math.sign(this.last.value) * Math.abs(value) : (Math.sign(this.last.value) * Math.abs(value) * Math.PI) / 180);
      return;
    }
    throw new Error('Click the first point of the arc');
  }

  private parseValue(text: string): number {
    if (this.centred) {
      const deg = Number(text.replace(/°|deg$/i, '').trim());
      if (!Number.isFinite(deg) || deg === 0 || Math.abs(deg) > 360) throw new Error('Type the angle in degrees (e.g. 90)');
      return deg;
    }
    const v = parseLength(text);
    if (v === undefined || Math.abs(v) <= TOL) throw new Error('Type the bulge (e.g. 20)');
    return v;
  }

  /** Re-draw the last arc with a new bulge / sweep (or new segment count). */
  private redo(value: number): void {
    const last = this.last!;
    this.plane = last.plane;
    this.points = [...last.points];
    const arc =
      this.mode === 'arc2'
        ? arcFromBulge(last.plane, last.points[0], last.points[1], value)
        : this.centred
          ? arcAroundCenter(last.plane, last.points[0], last.points[1], value)
          : arcThroughPoints(last.points[0], last.points[1], last.points[2]);
    this.commit(arc, value, last.base);
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
    const lines: PreviewLines[] = [];
    if (n === 1) {
      lines.push({ points: [this.points[0], this.cursor], color: this.centred ? 'preview' : lineColor(this.snap), dashed: this.centred, width: 2 });
      return { lines };
    }
    try {
      const arc = this.centred ? arcAroundCenter(this.plane!, this.points[0], this.points[1], this.sweep) : this.arcPreview();
      if (Math.abs(arc.sweep) > 1e-6) {
        const pts = arcPoints(arc, this.segments);
        lines.push({ points: pts.slice(1).flatMap((p, i) => [pts[i], p]), color: 'preview', width: 2 });
        if (this.mode === 'pie') lines.push({ points: [this.points[0], pts[0], this.points[0], pts[pts.length - 1]], color: 'preview', width: 2 });
      }
      if (this.centred) lines.push({ points: [this.points[0], this.points[1]], color: 'preview', dashed: true });
    } catch {
      // Not an arc yet (e.g. no bulge): show the chord.
      lines.push({ points: [this.points[0], this.mode === 'arc3' ? this.cursor : this.points[1]], color: 'preview', dashed: true });
    }
    return { lines };
  }

  private arcPreview(): Arc {
    if (this.mode === 'arc3') return arcThroughPoints(this.points[0], this.points[1], this.cursor!);
    return arcFromBulge(this.plane!, this.points[0], this.points[1], this.bulgeAt());
  }
}
