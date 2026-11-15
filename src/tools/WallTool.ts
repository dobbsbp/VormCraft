import { TOL } from '../core/math/tolerance';
import { add, distance, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import { buildWalls, wallFootprint, type WallAlign } from '../core/ops/wall';
import type { GroupId } from '../doc/Groups';
import { lineColor } from './LineTool';
import type { InferenceHints, Preview, Snap, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

const ALIGN_NAMES: Record<WallAlign, string> = { centre: 'centred on the line', left: 'to the left of the line', right: 'to the right of the line' };
const NEXT_ALIGN: Record<WallAlign, WallAlign> = { centre: 'left', left: 'right', right: 'centre' };

/**
 * Wall: click along the floor to draw a run of walls (each click a corner; type a length for the
 * wall being drawn). Double-click or Enter ends the run (Esc cancels it); clicking the first corner again
 * closes it into a room. The walls are made as one closed solid in a group of their own ("Walls"),
 * standing on the height of the first click. Type "thickness, height" (e.g. 150, 2700) at any time
 * to set them; Ctrl switches the walls between centred on the line, to its left and to its right.
 */
export class WallTool implements Tool {
  readonly id = 'wall';
  readonly name = 'Wall';
  readonly dragIsClick = true;
  thickness = 150;
  height = 2700;
  align: WallAlign = 'centre';
  private points: Vec3[] = [];
  private current: Vec3 | null = null;
  private snap: Snap | null = null;
  private message: string | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    const size = `${formatLength(this.thickness)} thick, ${formatLength(this.height)} high, ${ALIGN_NAMES[this.align]}`;
    if (!this.points.length) return `Click to start the walls (${size}). Type thickness and height, e.g. 150, 2700. Ctrl: which side of the line.`;
    return `Click each corner, or type a length. Click the first corner to close a room; double-click or Enter to finish (Esc cancels). Walls ${size}.`;
  }

  vcbLabel(): string {
    return this.points.length ? 'Length' : 'Thickness, height';
  }

  vcbValue(): string {
    const start = this.points[this.points.length - 1];
    if (start && this.current) return formatLength(distance(start, this.flat(this.current)));
    return `${formatLength(this.thickness)}, ${formatLength(this.height)}`;
  }

  inference(): InferenceHints {
    const last = this.points[this.points.length - 1];
    return last ? { reference: last, points: this.points } : {};
  }

  notice(): string | null {
    const m = this.message;
    this.message = null;
    return m;
  }

  pointerMove(e: ToolEvent): void {
    this.snap = e.snap;
    if (e.snap) this.current = e.snap.point;
  }

  pointerDown(e: ToolEvent): void {
    const p = e.snap?.point;
    if (!p) return;
    this.addPoint(this.points.length ? this.flat(p) : p);
  }

  doubleClick(): void {
    this.finish();
  }

  enter(): void {
    this.finish();
  }

  typed(text: string): void {
    const parts = text.split(/[,;]/).map((s) => s.trim());
    if (parts.length === 2) {
      const t = parseLength(parts[0]);
      const h = parseLength(parts[1]);
      if (t === undefined || h === undefined || !(t > TOL) || !(h > TOL)) throw new Error('Type the wall thickness and height, e.g. 150, 2700');
      this.thickness = t;
      this.height = h;
      return;
    }
    const last = this.points[this.points.length - 1];
    if (!last) throw new Error('Type the wall thickness and height, e.g. 150, 2700, or click to start the walls');
    const d = parseLength(text);
    if (d === undefined || !(d > TOL)) throw new Error('Type a length for this wall, or thickness and height (e.g. 150, 2700)');
    const to = this.current ? this.flat(this.current) : null;
    if (!to || distance(to, last) <= TOL) throw new Error('Point the way the wall goes first, then type its length');
    this.addPoint(add(last, scale(normalize(sub(to, last)), d)));
  }

  /** Ctrl: the walls go centred on the line, to its left, then to its right. */
  toggleCopy(): boolean {
    this.align = NEXT_ALIGN[this.align];
    this.message = `Walls ${ALIGN_NAMES[this.align]}`;
    return false;
  }

  cancel(): void {
    this.points = [];
    this.current = null;
  }

  reset(): void {
    this.points = [];
    this.current = null;
    this.snap = null;
  }

  preview(): Preview {
    if (!this.points.length) return {};
    const run = [...this.points];
    if (this.current && distance(this.flat(this.current), run[run.length - 1]) > TOL) run.push(this.flat(this.current));
    const lines: Preview['lines'] = [{ points: [run[run.length - 2] ?? run[0], run[run.length - 1]], color: lineColor(this.snap) }];
    const box = this.outline(run, false);
    if (box) lines.push({ points: box, color: 'preview', width: 1.2, dashed: true });
    return { lines };
  }

  /** On the floor of the run: the height of its first corner. */
  private flat(p: Vec3): Vec3 {
    const z = this.points[0]?.[2] ?? p[2];
    return [p[0], p[1], z];
  }

  private addPoint(p: Vec3): void {
    const pts = this.points;
    if (pts.length && distance(p, pts[pts.length - 1]) <= TOL) return;
    // Back at the first corner: close the room.
    if (pts.length >= 3 && distance(p, pts[0]) <= Math.max(TOL, this.thickness * 0.01)) {
      this.make(pts, true);
      return;
    }
    // Check the walls still fit before taking the corner, so a bad click is refused at once.
    if (pts.length >= 1) wallFootprint([...pts, p].map((q): [number, number] => [q[0], q[1]]), this.thickness, this.align, false);
    pts.push(p);
  }

  private finish(): void {
    if (this.points.length >= 2) this.make(this.points, false);
    else this.reset();
  }

  private make(points: Vec3[], closed: boolean): void {
    const pts = [...points];
    this.reset();
    let id: GroupId | null = null;
    this.ctx.apply(
      () => {
        const { model } = buildWalls(pts, this.thickness, this.height, this.align, closed);
        id = this.ctx.doc.groups.add(model, this.ctx.doc.editing, { name: 'Walls' });
      },
      undefined,
      'Walls',
    );
    // The new walls are selected, so they can be moved or opened at once.
    if (id !== null) this.ctx.selection.set([], [], [], [id]);
  }

  /** The walls' outline at the bottom and top, with upright corners, as segment pairs (null if they do not fit). */
  private outline(run: Vec3[], closed: boolean): Vec3[] | null {
    if (run.length < 2) return null;
    let fp;
    try {
      fp = wallFootprint(
        run.map((q): [number, number] => [q[0], q[1]]),
        this.thickness,
        this.align,
        closed,
      );
    } catch {
      return null;
    }
    const z = run[0][2];
    const out: Vec3[] = [];
    for (const loop of [fp.outer, ...(fp.inner ? [fp.inner] : [])]) {
      loop.forEach((p, i) => {
        const q = loop[(i + 1) % loop.length];
        for (const h of [z, z + this.height]) out.push([p[0], p[1], h], [q[0], q[1], h]);
        out.push([p[0], p[1], z], [p[0], p[1], z + this.height]);
      });
    }
    return out;
  }
}
