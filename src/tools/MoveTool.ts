import { TOL } from '../core/math/tolerance';
import { add, distance, dot, length, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import { translation } from '../core/ops/transform';
import type { DocumentSnapshot } from '../doc/Document';
import { closestRayLine } from './geom';
import { lineColor } from './LineTool';
import { applyToTargets, parseArray, previewLines, targetsAt, type Targets } from './targets';
import type { InferenceHints, Preview, Snap, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength, parseLengths } from './units';

/**
 * Move: click a start point on the selection (or on an object, with nothing selected), then the
 * point to move it to; or type a distance (along the mouse direction) or "dx,dy,dz". Press Ctrl to
 * copy instead (the copy follows the mouse; copy mode ends with the copy, as in SketchUp); after a
 * copy type "3x" for a row of 3 copies, or "/3" to spread 3 copies
 * over the distance. Arrow keys lock the direction to an axis. Typing after finishing changes
 * the last move. Near the middle of a face it snaps to the face's centre (a small ×), to move
 * shapes centre to centre.
 *
 * Section planes alone move straight along their direction (sliding one along itself changes
 * nothing), following the cursor ray: the cut-away side cannot be pointed at, so a free move
 * could never go that way.
 */

/** Looking almost straight along a plane's direction, the cursor says nothing about how far. */
const HEAD_ON = Math.cos((5 * Math.PI) / 180);
export class MoveTool implements Tool {
  readonly id = 'move';
  readonly name = 'Move';
  readonly dragIsClick = true;
  private copy = false;
  private targets: Targets | null = null;
  private from: Vec3 | null = null;
  private to: Vec3 | null = null;
  private snap: Snap | null = null;
  private last: { base: DocumentSnapshot; targets: Targets; vector: Vec3; copy: boolean; count: number; divide: boolean } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    const mode = this.copy ? 'Copy mode (Ctrl to switch off). ' : '';
    if (!this.from) return `${mode}Click the point to move from (on the selection, or on an object). Press Ctrl to copy.`;
    if (this.planeNormal()) return `${mode}Click where the section plane goes (it moves straight along its direction), or type a distance.`;
    return `${mode}Click where it goes, or type a distance or dx,dy,dz. Arrow keys lock an axis.`;
  }

  vcbLabel(): string {
    return 'Distance';
  }

  vcbValue(): string {
    if (this.from && this.to) return formatLength(distance(this.from, this.to));
    if (this.last) return this.last.copy && this.last.count > 1 ? `${this.last.divide ? '/' : ''}${this.last.count}${this.last.divide ? '' : 'x'}` : formatLength(length(this.last.vector));
    return '';
  }

  inference(): InferenceHints {
    return this.from ? { reference: this.from, centres: true } : { centres: true };
  }

  toggleCopy(): boolean {
    this.copy = !this.copy;
    return this.copy;
  }

  copying(): boolean {
    return this.copy;
  }

  pointerMove(e: ToolEvent): void {
    this.snap = e.snap;
    if (!this.from) return;
    const p = this.pointAt(e);
    if (p) this.to = p;
  }

  pointerDown(e: ToolEvent): void {
    const p = this.from ? this.pointAt(e) : e.snap?.point;
    if (!p) return;
    if (!this.from) {
      this.targets = targetsAt(this.ctx, e);
      this.from = this.to = p;
      return;
    }
    if (distance(p, this.from) <= TOL) return;
    this.commit(this.targets!, sub(p, this.from), this.copy, 1, false);
  }

  /**
   * The direction section planes move in when they are all that moves (and all face the same
   * way, or the opposite way), else null.
   */
  private planeNormal(): Vec3 | null {
    const t = this.targets;
    if (!t || !t.sections.length || t.vertices.size || t.groups.length || t.labels.length || t.guides.length) return null;
    const planes = t.sections.map((id) => this.ctx.doc.sections.get(id)).filter((s) => s !== undefined);
    if (!planes.length) return null;
    const n = planes[0].normal;
    return planes.every((s) => Math.abs(Math.abs(dot(s.normal, n)) - 1) < 1e-6) ? n : null;
  }

  /** Where the move goes for the cursor: the snapped point, or for section planes a point along their direction. */
  private pointAt(e: ToolEvent): Vec3 | null {
    const n = this.planeNormal();
    const from = this.from;
    if (!n || !from) return e.snap?.point ?? null;
    const s = e.snap;
    if (s && s.kind !== 'ground' && s.kind !== 'onPlane' && s.kind !== 'onFace') return add(from, scale(n, dot(sub(s.point, from), n)));
    if (Math.abs(dot(e.ray.dir, n)) > HEAD_ON) return this.to;
    const r = closestRayLine(e.ray, from, n);
    return r ? r.point : this.to;
  }

  private commit(targets: Targets, vector: Vec3, copy: boolean, count: number, divide: boolean, base?: DocumentSnapshot): void {
    this.from = this.to = null;
    this.targets = null;
    const steps = Array.from({ length: copy ? count : 1 }, (_, i) => translation(scale(vector, divide ? (i + 1) / count : i + 1)));
    const before = this.ctx.apply(() => applyToTargets(this.ctx.doc, targets, steps, copy), base);
    this.last = { base: before, targets, vector, copy, count, divide };
    this.copy = false;
  }

  typed(text: string): void {
    const array = parseArray(text);
    if (array) {
      if (!this.last?.copy || this.from) throw new Error('Make a copy first (press Ctrl, then move), then type 3x or /3');
      const l = this.last;
      this.commit(l.targets, l.vector, true, array.count, array.divide, l.base);
      return;
    }
    const vector = this.parseVector(text);
    // A copy at no distance would sit exactly on the original (faces back to back, lines doubled).
    if (length(vector) <= TOL) throw new Error('Type a distance other than 0');
    if (this.from) this.commit(this.targets!, vector, this.copy, 1, false);
    else if (this.last) this.commit(this.last.targets, vector, this.last.copy, this.last.count, this.last.divide, this.last.base);
    else throw new Error('Click the point to move from first');
  }

  /** "dx,dy,dz" → that vector; a single length → along the current (or last) direction. */
  private parseVector(text: string): Vec3 {
    const parts = parseLengths(text);
    if (parts && parts.length === 3 && parts.every((x) => x !== undefined)) return [parts[0]!, parts[1]!, parts[2]!];
    const len = parseLength(text);
    if (len === undefined) throw new Error('Type a distance (e.g. 100) or a vector (e.g. 100,0,50)');
    const dir = this.from && this.to && distance(this.from, this.to) > TOL ? sub(this.to, this.from) : this.last?.vector;
    if (!dir || length(dir) <= TOL) throw new Error('Move the mouse in the direction to move first');
    return scale(normalize(dir), len);
  }

  cancel(): void {
    this.from = this.to = null;
    this.targets = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
    this.copy = false;
  }

  preview(): Preview {
    if (!this.targets || !this.from || !this.to || distance(this.from, this.to) <= TOL) return {};
    // Moving the plane that cuts (not a copy of it): the cut follows the mouse.
    const active = this.ctx.doc.sections.activePlane();
    const sectionMove = !this.copy && active && this.targets.sections.includes(active.id) ? { id: active.id, point: add(active.point, sub(this.to, this.from)), normal: active.normal } : undefined;
    return {
      ...(sectionMove ? { sectionMove } : {}),
      lines: [
        ...previewLines(this.ctx.doc, this.targets, translation(sub(this.to, this.from))),
        { points: [this.from, this.to], color: lineColor(this.snap), dashed: true, width: 1.5 },
      ],
    };
  }
}
