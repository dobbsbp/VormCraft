import { TOL } from '../core/math/tolerance';
import { add, distance, dot, length, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import type { DocumentSnapshot } from '../doc/Document';
import type { InferenceHints, Preview, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

type Measure =
  /** From an edge or guide line: makes a parallel guide line through the cursor. */
  | { mode: 'line'; from: Vec3; linePoint: Vec3; dir: Vec3; to: Vec3 | null }
  /** From a point: makes a guide point at the cursor. */
  | { mode: 'point'; from: Vec3; to: Vec3 | null };

/**
 * Tape Measure (guides): click an edge and move to the side for a parallel guide line, or click a
 * point and move for a guide point; click to place, or type the distance + Enter. Typing after
 * placing moves the last guide.
 */
export class TapeMeasureTool implements Tool {
  readonly id = 'tape';
  readonly name = 'Tape Measure';
  readonly dragIsClick = true;
  private m: Measure | null = null;
  private last: { base: DocumentSnapshot; m: Measure } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    if (!this.m) return 'Click an edge to start a parallel guide, or a point to start a guide point.';
    return this.m.mode === 'line'
      ? 'Move to the side and click to place the guide line, or type the distance and press Enter.'
      : 'Move and click to place a guide point, or type the distance and press Enter.';
  }

  vcbLabel(): string {
    return 'Length';
  }

  vcbValue(): string {
    const m = this.m ?? this.last?.m;
    return m?.to ? formatLength(measured(m)) : '';
  }

  inference(): InferenceHints {
    return this.m ? { reference: this.m.from } : {};
  }

  pointerMove(e: ToolEvent): void {
    if (this.m && e.snap) this.m.to = e.snap.point;
  }

  pointerDown(e: ToolEvent): void {
    const s = e.snap;
    if (!this.m) {
      if (!s) return;
      const model = this.ctx.doc.model;
      if (s.kind === 'onEdge' && s.edge !== undefined) {
        const a = model.pos(model.he(s.edge).origin);
        const b = model.pos(model.dest(s.edge));
        this.m = { mode: 'line', from: s.point, linePoint: a, dir: normalize(sub(b, a)), to: null };
      } else if (s.kind === 'onGuide' && s.guide !== undefined) {
        const g = this.ctx.doc.guides.items.get(s.guide);
        if (g?.kind === 'line') this.m = { mode: 'line', from: s.point, linePoint: g.point, dir: g.dir, to: null };
      } else {
        this.m = { mode: 'point', from: s.point, to: null };
      }
      return;
    }
    if (s) this.m.to = s.point;
    if (!this.m.to || measured(this.m) <= TOL) return;
    this.commit(this.m);
  }

  typed(text: string): void {
    const d = parseLength(text);
    if (d === undefined || Math.abs(d) <= TOL) throw new Error('Type a distance (e.g. 50)');
    const m = this.m ?? this.last?.m;
    if (!m?.to || measured(m) <= TOL) throw new Error('Move the mouse to show the direction first');
    const resized = withLength(m, d);
    if (this.m) this.commit(resized);
    else this.commit(resized, this.last!.base);
  }

  private commit(m: Measure, base?: DocumentSnapshot): void {
    this.m = null;
    const guides = this.ctx.doc.guides;
    const before = this.ctx.apply(() => {
      if (m.mode === 'line') guides.addLine(add(m.linePoint, offsetOf(m)), m.dir);
      else guides.addPoint(m.to!);
    }, base);
    this.last = { base: before, m };
  }

  cancel(): void {
    this.m = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    const m = this.m;
    if (!m?.to) return {};
    if (m.mode === 'point') return { lines: [{ points: [m.from, m.to], color: 'guide', dashed: true, width: 2 }] };
    const off = offsetOf(m);
    const foot = add(m.from, off);
    const span = Math.max(1000, length(off) * 20);
    const center = add(m.linePoint, add(off, scale(m.dir, dot(sub(m.from, m.linePoint), m.dir))));
    return {
      lines: [
        { points: [add(center, scale(m.dir, -span)), add(center, scale(m.dir, span))], color: 'guide', dashed: true },
        { points: [m.from, foot], color: 'guide', width: 2 },
      ],
    };
  }
}

/** Perpendicular offset from the source line to the cursor. */
function offsetOf(m: Extract<Measure, { mode: 'line' }>): Vec3 {
  const v = sub(m.to!, m.linePoint);
  return sub(v, scale(m.dir, dot(v, m.dir)));
}

function measured(m: Measure): number {
  return m.mode === 'line' ? length(offsetOf(m)) : distance(m.from, m.to!);
}

/** The same measurement in the same direction, with a typed length. */
function withLength(m: Measure, d: number): Measure {
  if (m.mode === 'line') {
    const off = offsetOf(m);
    const along = sub(m.to!, add(m.linePoint, off));
    return { ...m, to: add(add(m.linePoint, scale(normalize(off), d)), along) };
  }
  return { ...m, to: add(m.from, scale(normalize(sub(m.to!, m.from)), d)) };
}
