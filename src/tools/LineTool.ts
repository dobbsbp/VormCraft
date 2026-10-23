import { TOL } from '../core/math/tolerance';
import { add, distance, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import { drawEdges } from '../core/ops/edges';
import type { DocumentSnapshot } from '../doc/Document';
import type { InferenceHints, Preview, PreviewColor, Snap, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

/** Colour of the rubber-band line: the axis it is inferred along, if any. */
export function lineColor(snap: Snap | null): PreviewColor {
  if (snap?.kind === 'axis') return (['axisX', 'axisY', 'axisZ'] as const)[snap.axis ?? 0];
  if (snap?.kind === 'parallel') return 'parallel';
  return 'preview';
}

/**
 * Line: click to start, click each next point (lines chain on). Type a length + Enter to set the
 * current segment exactly (in the direction of the mouse); typing after a click changes the last
 * segment. Lines split the faces they cross; closing a loop makes a face and ends the chain.
 * Arrow keys lock the direction to an axis. Double-click or Esc ends the chain.
 */
export class LineTool implements Tool {
  readonly id = 'line';
  readonly name = 'Line';
  readonly dragIsClick = true;
  private first: Vec3 | null = null;
  private start: Vec3 | null = null;
  private current: Vec3 | null = null;
  private snap: Snap | null = null;
  private last: { base: DocumentSnapshot; from: Vec3; to: Vec3; first: Vec3 } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return this.start
      ? 'Click the next point, or type a length and press Enter. Arrow keys lock an axis. Double-click or Esc to finish.'
      : 'Click to start a line.';
  }

  vcbLabel(): string {
    return 'Length';
  }

  vcbValue(): string {
    if (this.start && this.current) return formatLength(distance(this.start, this.current));
    return this.last ? formatLength(distance(this.last.from, this.last.to)) : '';
  }

  inference(): InferenceHints {
    return this.start ? { reference: this.start } : {};
  }

  pointerMove(e: ToolEvent): void {
    this.snap = e.snap;
    if (e.snap) this.current = e.snap.point;
  }

  pointerDown(e: ToolEvent): void {
    const p = e.snap?.point;
    if (!p) return;
    if (!this.start) {
      this.first = this.start = this.current = p;
      return;
    }
    if (distance(p, this.start) <= TOL) return;
    this.commit(this.start, p, this.first ?? this.start);
  }

  private commit(from: Vec3, to: Vec3, first: Vec3, base?: DocumentSnapshot): void {
    let closed = false;
    const before = this.ctx.apply(() => {
      closed = drawEdges(this.ctx.doc.model, [from, to]).faces.length > 0;
    }, base);
    this.last = { base: before, from, to, first };
    // A face closed, or back at the start of the chain: the shape is done.
    if (closed || distance(to, first) <= TOL) {
      this.first = this.start = null;
    } else {
      this.first = first;
      this.start = this.current = to;
    }
  }

  typed(text: string): void {
    const len = parseLength(text);
    if (len === undefined || Math.abs(len) <= TOL) throw new Error('Type a length (e.g. 250)');
    if (this.start && this.current && distance(this.current, this.start) > TOL) {
      const dir = normalize(sub(this.current, this.start));
      this.commit(this.start, add(this.start, scale(dir, len)), this.first ?? this.start);
    } else if (this.last) {
      const dir = normalize(sub(this.last.to, this.last.from));
      this.commit(this.last.from, add(this.last.from, scale(dir, len)), this.last.first, this.last.base);
    } else throw new Error('Click a start point and move the mouse in the direction of the line first');
  }

  doubleClick(): void {
    this.first = this.start = null;
  }

  cancel(): void {
    this.first = this.start = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    if (!this.start || !this.current || distance(this.start, this.current) <= TOL) return {};
    return { lines: [{ points: [this.start, this.current], color: lineColor(this.snap), width: 2 }] };
  }
}
