import { TOL } from '../core/math/tolerance';
import { add, dot, scale, sub, type Vec3 } from '../core/math/vec3';
import type { FaceId } from '../core/model/Model';
import { pushPull } from '../core/ops/pushPull';
import type { DocumentSnapshot } from '../doc/Document';
import { closestRayLine } from './geom';
import type { Preview, PreviewLines, Tool, ToolContext, ToolEvent } from './types';
import { formatLength, parseLength } from './units';

/**
 * Push/Pull: click a face, move along its normal, click to finish, or type a distance + Enter
 * (positive = out, adds material; negative = in, removes it). Moving onto other geometry snaps the
 * distance to it, which is how you push exactly flush to the far side for a through-hole.
 * Double-click a face to repeat the last distance. Typing after finishing changes the last push.
 */
export class PushPullTool implements Tool {
  readonly id = 'pushpull';
  readonly name = 'Push/Pull';
  readonly dragIsClick = true;
  private hover: FaceId | null = null;
  private active: { face: FaceId; normal: Vec3; start: Vec3; distance: number } | null = null;
  private last: { base: DocumentSnapshot; face: FaceId; distance: number } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    return this.active
      ? 'Move to set the distance and click, or type it and press Enter (negative pushes in).'
      : 'Click a face to push or pull it. Double-click a face to repeat the last distance.';
  }

  vcbLabel(): string {
    return 'Distance';
  }

  vcbValue(): string {
    if (this.active) return formatLength(this.active.distance);
    return this.last ? formatLength(this.last.distance) : '';
  }

  inference() {
    return {};
  }

  pointerMove(e: ToolEvent): void {
    if (!this.active) {
      this.hover = e.face;
      return;
    }
    this.active.distance = this.distanceAt(e);
  }

  /** Signed distance along the face normal for the cursor: snapped geometry if any, else the ray. */
  private distanceAt(e: ToolEvent): number {
    const a = this.active!;
    const s = e.snap;
    const snapsToGeometry = s && s.kind !== 'ground' && s.kind !== 'onPlane' && !(s.kind === 'onFace' && s.face === a.face);
    if (snapsToGeometry) return dot(sub(s.point, a.start), a.normal);
    const r = closestRayLine(e.ray, a.start, a.normal);
    return r ? r.s : a.distance;
  }

  pointerDown(e: ToolEvent): void {
    if (!this.active) {
      if (e.face === null) return;
      const model = this.ctx.doc.model;
      this.active = { face: e.face, normal: model.face(e.face).normal, start: e.facePoint ?? e.snap?.point ?? model.pos(model.faceVertexLoops(e.face)[0][0]), distance: 0 };
      return;
    }
    this.active.distance = this.distanceAt(e);
    if (Math.abs(this.active.distance) <= TOL) {
      this.active = null; // clicked without moving: nothing to do
      return;
    }
    this.commit(this.active.face, this.active.distance);
  }

  doubleClick(e: ToolEvent): void {
    if (this.active || e.face === null || !this.last) return;
    this.commit(e.face, this.last.distance);
  }

  typed(text: string): void {
    const d = parseLength(text);
    if (d === undefined || Math.abs(d) <= TOL) throw new Error('Type a distance (e.g. 20, or -20 to push in)');
    if (this.active) this.commit(this.active.face, d);
    else if (this.last) this.commit(this.last.face, d, this.last.base);
    else throw new Error('Click a face first, then type the distance');
  }

  private commit(face: FaceId, distance: number, base?: DocumentSnapshot): void {
    this.active = null;
    const before = this.ctx.apply(() => pushPull(this.ctx.doc.model, face, distance), base);
    this.last = { base: before, face, distance };
  }

  cancel(): void {
    this.active = null;
  }

  reset(): void {
    this.cancel();
    this.last = null;
  }

  preview(): Preview {
    if (!this.active) return this.hover !== null && this.ctx.doc.model.faces.has(this.hover) ? { faces: [this.hover] } : {};
    const { face, normal, distance } = this.active;
    const model = this.ctx.doc.model;
    const lines: PreviewLines[] = [];
    if (Math.abs(distance) > TOL) {
      const shift = scale(normal, distance);
      const pts: Vec3[] = [];
      for (const ring of model.faceVertexLoops(face)) {
        ring.forEach((v, i) => {
          const a = model.pos(v);
          const b = model.pos(ring[(i + 1) % ring.length]);
          pts.push(add(a, shift), add(b, shift), a, add(a, shift));
        });
      }
      lines.push({ points: pts, color: 'preview', width: 2 });
    }
    return { faces: [face], lines };
  }
}
