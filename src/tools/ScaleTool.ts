import { TOL } from '../core/math/tolerance';
import { add, distance, dot, normalize, scale, sub, type Vec3 } from '../core/math/vec3';
import type { VertexId } from '../core/model/Model';
import { connectedVertices, scalePieces } from '../core/ops/scale';
import type { DocumentSnapshot } from '../doc/Document';
import { parseLength, parseLengths } from './units';
import type { InferenceHints, Preview, Tool, ToolContext, ToolEvent } from './types';

/**
 * Scale: works on the selection (or, with nothing selected, on the object you click), always on
 * whole connected objects. Click the base point (it stays put), click a reference point, then move
 * and click: the object grows by how far you moved along that direction. Or type a factor ("1.5"),
 * per-axis factors ("2,1,1" for red, green, blue), or a length ("300mm") for the new size of the
 * reference distance. Negative factors mirror. Typing after finishing changes the last scale.
 */
export class ScaleTool implements Tool {
  readonly id = 'scale';
  readonly name = 'Scale';
  readonly dragIsClick = true;
  private targets: Set<VertexId> | null = null;
  private base: Vec3 | null = null;
  private ref: Vec3 | null = null;
  private factor = 1;
  private last: { snapshot: DocumentSnapshot; targets: Set<VertexId>; base: Vec3; refLength: number; factors: Vec3 } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    if (!this.base) return 'Click the base point (stays fixed) on the selection, or on the object to scale.';
    if (!this.ref) return 'Click a reference point, or type a factor (2 or 2,1,1).';
    return 'Move and click to scale, or type a factor (2 or 2,1,1) or a new length (300mm). Negative mirrors.';
  }

  vcbLabel(): string {
    return 'Scale';
  }

  vcbValue(): string {
    if (this.ref) return `${Math.round(this.factor * 1000) / 1000}`;
    if (this.last) return this.last.factors.map((f) => Math.round(f * 1000) / 1000).join(', ');
    return '';
  }

  inference(): InferenceHints {
    return this.base ? { reference: this.ref ?? this.base } : {};
  }

  pointerMove(e: ToolEvent): void {
    if (!this.base || !this.ref || !e.snap) return;
    const d = sub(this.ref, this.base);
    this.factor = dot(sub(e.snap.point, this.base), normalize(d)) / Math.hypot(...d);
  }

  pointerDown(e: ToolEvent): void {
    const p = e.snap?.point;
    if (!p) return;
    if (!this.base) {
      const { selection, doc } = this.ctx;
      let targets: Set<VertexId>;
      if (selection.faces.size || selection.edges.size) targets = connectedVertices(doc.model, selection.faces, selection.edges);
      else if (e.face !== null) targets = connectedVertices(doc.model, [e.face], []);
      else if (e.edge !== null) targets = connectedVertices(doc.model, [], [e.edge]);
      else throw new Error('Select something to scale, or click on the object to scale');
      this.targets = targets;
      this.base = p;
      return;
    }
    if (!this.ref) {
      if (distance(p, this.base) <= TOL) return;
      this.ref = p;
      this.factor = 1;
      return;
    }
    this.pointerMove(e);
    if (Math.abs(this.factor) <= 1e-6 || Math.abs(this.factor - 1) <= 1e-9) return;
    this.commit([this.factor, this.factor, this.factor]);
  }

  private commit(factors: Vec3, base?: DocumentSnapshot): void {
    const targets = base ? this.last!.targets : this.targets!;
    const basePoint = base ? this.last!.base : this.base!;
    const refLength = base ? this.last!.refLength : this.ref ? distance(this.ref, this.base!) : 0;
    this.targets = this.base = this.ref = null;
    const snapshot = this.ctx.apply(() => scalePieces(this.ctx.doc.model, targets, basePoint, factors), base);
    this.last = { snapshot, targets, base: basePoint, refLength, factors };
  }

  /** "2" → uniform factor; "2,1,1" → per axis; "300mm" → reference distance becomes 300 mm. */
  private parse(text: string, refLength: number): Vec3 {
    if (/[a-z'"]/i.test(text)) {
      const len = parseLength(text);
      if (len === undefined || refLength <= TOL) throw new Error('Click a reference point before typing a length');
      const f = len / refLength;
      return [f, f, f];
    }
    const v = parseLengths(text);
    if (!v || v.some((x) => x === undefined || x === 0)) throw new Error('Type a factor (e.g. 2) or factors per axis (e.g. 2,1,1)');
    if (v.length === 1) return [v[0]!, v[0]!, v[0]!];
    if (v.length === 3) return [v[0]!, v[1]!, v[2]!];
    throw new Error('Type one factor, or three (red, green, blue)');
  }

  typed(text: string): void {
    if (this.base) {
      const refLength = this.ref ? distance(this.ref, this.base) : 0;
      this.commit(this.parse(text, refLength));
    } else if (this.last) {
      this.commit(this.parse(text, this.last.refLength), this.last.snapshot);
    } else throw new Error('Click the base point first');
  }

  cancel(): void {
    this.targets = this.base = this.ref = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    if (!this.targets || !this.base) return {};
    const model = this.ctx.doc.model;
    const f = this.ref ? this.factor : 1;
    const at = (p: Vec3) => add(this.base!, scale(sub(p, this.base!), f));
    const pts: Vec3[] = [];
    for (const e of model.edges()) {
      const a = model.he(e).origin;
      const b = model.dest(e);
      if (this.targets.has(a) && this.targets.has(b)) pts.push(at(model.pos(a)), at(model.pos(b)));
    }
    const lines: Preview['lines'] = [{ points: pts, color: 'select', width: 1.5 }];
    if (this.ref) lines.push({ points: [this.base, this.ref], color: 'preview', dashed: true });
    return { lines };
  }
}
