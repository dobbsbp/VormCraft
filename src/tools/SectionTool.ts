import { TOL } from '../core/math/tolerance';
import { add, dot, scale, sub, type Vec3 } from '../core/math/vec3';
import { modelBounds } from '../core/ops/group';
import { planeFrame } from '../core/ops/section';
import type { DocumentSnapshot } from '../doc/Document';
import type { SectionId } from '../doc/Sections';
import { closestRayLine } from './geom';
import { sectionGrab } from './sectionPick';
import type { InferenceHints, Preview, PreviewLines, Tool, ToolContext, ToolEvent, ToolTips } from './types';
import { formatLength, parseLength } from './units';

/** Looking almost straight along a plane's direction, the cursor says nothing about how far. */
const HEAD_ON = Math.cos((5 * Math.PI) / 180);

/**
 * Section Plane: click a face to cut the model there. What lies in front of the face (the side it
 * faces) is cut away, so the inside shows; empty space gives a flat cut at the ground. The new
 * plane becomes the active cut. Typing a distance afterwards moves it along its direction (a minus
 * distance goes into the shape), as one step with the placing.
 *
 * Over a plane's outline the tool picks the plane up instead: drag it (or click, move, click) to
 * slide it along its direction, snapping to the model's points, or type how far. Typing after
 * that changes the move.
 */
export class SectionTool implements Tool {
  readonly id = 'section';
  readonly name = 'Section Plane';
  private hover: { point: Vec3; normal: Vec3 } | null = null;
  /** The plane outline under the cursor (a press picks it up). */
  private hoverSection: SectionId | null = null;
  /** A plane being slid: where it was, the grab point on its outline, and how far it has gone. */
  private moving: { id: SectionId; point: Vec3; normal: Vec3; grab: Vec3; distance: number } | null = null;
  /** The last plane placed or moved, which typing moves: where it started, and the document before. */
  private last: { base: DocumentSnapshot; id: SectionId; point: Vec3; normal: Vec3; moved: number } | null = null;

  constructor(private readonly ctx: ToolContext) {}

  hint(): string {
    if (this.moving) return 'Move the mouse to slide the section plane (it snaps to points on the model) and click to drop it, or type how far to move it.';
    if (this.hoverSection !== null) return 'Drag the outline to slide this section plane, or click it, move and click again. Type a distance to move it exactly.';
    if (this.last) return 'Type how far to move the cut (a minus distance goes into the shape), drag a plane\'s outline to move it, or click another face for a new section plane.';
    return 'Click a face to cut the model there: what is in front of the face is cut away. Drag a plane\'s outline to move it.';
  }

  tips(): ToolTips {
    return SECTION_TIPS;
  }

  vcbLabel(): string {
    return 'Distance';
  }

  vcbValue(): string {
    if (this.moving) return formatLength(this.moving.distance);
    return this.last ? formatLength(this.last.moved) : '';
  }

  inference(): InferenceHints {
    return {};
  }

  pointerMove(e: ToolEvent): void {
    if (this.moving) {
      this.moving.distance = this.distanceAt(e);
      return;
    }
    this.hoverSection = this.outlineAt(e);
    this.hover = this.hoverSection === null ? this.target(e) : null;
  }

  pointerDown(e: ToolEvent): void {
    if (this.moving) {
      this.moving.distance = this.distanceAt(e);
      this.drop();
      return;
    }
    const picked = this.outlineAt(e);
    if (picked !== null) {
      const s = this.ctx.doc.sections.get(picked)!;
      const grab = sectionGrab(this.ctx.doc, picked, e.ray) ?? s.point;
      this.moving = { id: picked, point: [...s.point], normal: [...s.normal], grab, distance: 0 };
      this.hover = null;
      return;
    }
    const t = this.target(e);
    if (!t) return;
    let id: SectionId = 0;
    const base = this.ctx.apply(
      () => {
        const s = this.ctx.doc.sections;
        id = s.add(t.point, t.normal);
        s.active = id;
        s.visible = true;
      },
      undefined,
      'Section plane',
    );
    this.last = { base, id, point: t.point, normal: t.normal, moved: 0 };
  }

  /** A drag of the outline ends where it is let go (a click without dragging keeps it moving). */
  pointerUp(e: ToolEvent, dragged: boolean): void {
    if (!this.moving || !dragged) return;
    this.moving.distance = this.distanceAt(e);
    this.drop();
  }

  typed(text: string): void {
    const d = parseLength(text);
    if (d === undefined) throw new Error('Type a distance, e.g. 1200 or -300');
    if (this.moving) {
      this.moving.distance = d;
      this.drop();
      return;
    }
    const last = this.last;
    if (!last) throw new Error('Click a face to place a section plane, or click a plane\'s outline to move it');
    this.ctx.apply(() => this.place(last.id, last.point, last.normal, d), last.base, 'Section plane');
    last.moved = d;
  }

  cancel(): void {
    this.hover = null;
    this.moving = null;
  }

  reset(): void {
    this.hover = null;
    this.hoverSection = null;
    this.moving = null;
    this.last = null;
  }

  preview(): Preview {
    const m = this.moving;
    if (m) {
      // The view draws the plane, and cuts the model, where it would go.
      const to = add(m.grab, scale(m.normal, m.distance));
      return {
        sectionMove: { id: m.id, point: add(m.point, scale(m.normal, m.distance)), normal: m.normal },
        lines: [{ points: [m.grab, to], color: 'section', dashed: true, width: 1.5 }],
      };
    }
    if (this.hoverSection !== null) return { sections: [this.hoverSection] };
    const h = this.hover;
    if (!h) return {};
    return { lines: [this.frame(h.point, h.normal)] };
  }

  private frame(point: Vec3, normal: Vec3): PreviewLines {
    const b = modelBounds(this.ctx.doc.allModels()) ?? { min: [-1000, -1000, 0] as Vec3, max: [1000, 1000, 1000] as Vec3 };
    const c = planeFrame(point, normal, b.min, b.max);
    return { points: [c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]], color: 'section', width: 2 };
  }

  /** Put the plane `distance` along its direction from `point` (adding it when it is not there), as the cut. */
  private place(id: SectionId, point: Vec3, normal: Vec3, distance: number): void {
    const s = this.ctx.doc.sections;
    const at = add(point, scale(normal, distance));
    const p = s.items.get(id);
    if (p) p.point = at;
    else s.add(at, normal, id);
    s.active = id;
    s.visible = true;
  }

  /** Finish sliding a plane, as one undo step that typing can change. */
  private drop(): void {
    const m = this.moving!;
    this.moving = null;
    if (Math.abs(m.distance) <= TOL) return; // picked up and put back
    const base = this.ctx.apply(() => this.place(m.id, m.point, m.normal, m.distance), undefined, 'Move section plane');
    this.last = { base, id: m.id, point: m.point, normal: m.normal, moved: m.distance };
  }

  /** The plane outline under the cursor, unless a model edge is right there. */
  private outlineAt(e: ToolEvent): SectionId | null {
    return e.section != null && e.edge === null && this.ctx.doc.sections.items.has(e.section) ? e.section : null;
  }

  /** How far along its direction the plane being slid goes: to a snapped point, else along the cursor ray. */
  private distanceAt(e: ToolEvent): number {
    const m = this.moving!;
    const s = e.snap;
    if (s && s.kind !== 'ground' && s.kind !== 'onPlane' && s.kind !== 'onFace') return dot(sub(s.point, m.point), m.normal);
    if (Math.abs(dot(e.ray.dir, m.normal)) > HEAD_ON) return m.distance;
    const r = closestRayLine(e.ray, m.grab, m.normal);
    return r ? r.s : m.distance;
  }

  /** Where a click would put the plane: on the face under the cursor, else flat on the ground. */
  private target(e: ToolEvent): { point: Vec3; normal: Vec3 } | null {
    if (e.face !== null && e.facePoint) return { point: e.facePoint, normal: this.ctx.doc.model.face(e.face).normal };
    if (e.snap?.normal) return { point: e.snap.point, normal: e.snap.normal };
    if (e.snap) return { point: [e.snap.point[0], e.snap.point[1], 0], normal: [0, 0, 1] };
    return null;
  }
}

/** How to place, move and remove section planes. */
const SECTION_TIPS: ToolTips = {
  label: 'Section tips',
  title: 'Section planes',
  text: `A section plane cuts the model so you can see inside it, as in a floor plan or a cut through a wall.

Placing a cut:
• Click a face: everything in front of the face is cut away.
• Click the ground (or empty space) for a level cut, then type a height, such as 1200, for a floor plan.
• Straight after placing, type a distance to move the cut. A minus distance goes into the shape.

Moving a cut:
• With the Section Plane tool, point at a plane's outline (it lights up) and drag it. Or click it, move the mouse and click again. It slides straight along its direction, cutting the model as it goes, and snaps to points on the model, so you can line it up with a window sill or a floor.
• While moving, or straight after, type a distance to move it exactly, such as 300 or -300. Undo puts it back.
• The Move tool moves a plane too: start Move on its outline, or select the outline first. It moves straight along the plane's direction, up or down. Rotate turns it.

Removing a cut:
• With Select, click the plane's outline and press Delete. The Eraser works on the outline too.
• Right-click → Section → Delete Section Plane deletes the cut that is on.

Good to know:
• Only one plane cuts at a time. Right-click → Section to reverse it, turn it off or on, go to the next plane, or hide the planes.
• Scenes remember which cut is on, so one scene can show a plan and another a cut through the house.
• Planes are picked by their outline, so clicking inside one still reaches the model behind it.
• Hidden planes cannot be picked: right-click → Section → Show Section Planes first.`,
};
