import type { FaceId, MaterialId } from '../core/model/Model';
import { smoothSurface } from '../core/model/surfaces';
import { paintFaces } from '../core/ops/materials';
import type { Preview, Tool, ToolContext, ToolEvent } from './types';

/**
 * Paint Bucket: click a face to paint it with the current material (a whole curved surface at
 * once; all the selected faces when the clicked face is selected). Shift paints every face that
 * has the clicked face's paint, Ctrl the connected ones; Alt picks up the clicked face's paint.
 */
export class PaintTool implements Tool {
  readonly id = 'paint';
  readonly name = 'Paint Bucket';
  private hover: FaceId[] = [];

  constructor(
    private readonly ctx: ToolContext,
    private readonly current: () => MaterialId | undefined,
    private readonly pickUp: (material: MaterialId | undefined) => void,
  ) {}

  hint(): string {
    return 'Click a face to paint it. Shift: every face with the same paint. Ctrl: connected faces with the same paint. Alt: pick up a face’s paint.';
  }

  vcbLabel(): string {
    return '';
  }

  vcbValue(): string {
    return '';
  }

  inference() {
    return {};
  }

  /** The faces a click on `face` paints. */
  private targets(face: FaceId, e: ToolEvent): FaceId[] {
    const model = this.ctx.doc.model;
    const paint = model.face(face).material;
    if (e.alt) return [face];
    if (e.shift) return [...model.faces.values()].filter((f) => f.material === paint).map((f) => f.id);
    if (e.ctrl) return [...model.connectedFaces(face)].filter((f) => model.face(f).material === paint);
    if (this.ctx.selection.faces.has(face)) return [...this.ctx.selection.faces].filter((f) => model.faces.has(f));
    return smoothSurface(model, face);
  }

  pointerMove(e: ToolEvent): void {
    this.hover = e.face !== null && this.ctx.doc.model.faces.has(e.face) ? this.targets(e.face, e) : [];
  }

  pointerDown(e: ToolEvent): void {
    if (e.face === null || !this.ctx.doc.model.faces.has(e.face)) return;
    if (e.alt) {
      this.pickUp(this.ctx.doc.model.face(e.face).material);
      return;
    }
    const material = this.current();
    if (material !== undefined && !this.ctx.doc.materials.get(material)) throw new Error('That material no longer exists: pick another');
    const faces = this.targets(e.face, e);
    this.ctx.apply(() => paintFaces(this.ctx.doc.model, faces, material), undefined, 'Paint');
  }

  typed(): void {
    throw new Error('Paint Bucket takes no typed value: click a face');
  }

  cancel(): void {}

  reset(): void {}

  preview(): Preview {
    return { faces: this.hover.filter((f) => this.ctx.doc.model.faces.has(f)) };
  }
}
