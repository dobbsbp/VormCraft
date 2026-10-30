import { add, findFaceAt, type FaceId, type HalfEdgeId, type Vec3 } from '../../src/core';
import { Document } from '../../src/doc/Document';
import { ToolController } from '../../src/tools/ToolController';
import type { Projector, Ray, Snap, SnapKind, Tool, ToolEvent, ToolId } from '../../src/tools/types';

/** Top-down projector: 1 screen pixel per mm, y flipped (good enough for box selection tests). */
export const topDown: Projector = { toScreen: (p) => [p[0], -p[1]] };

export function harness() {
  const doc = new Document();
  const controller = new ToolController(doc, () => topDown);
  return { doc, model: doc.model, controller, ctx: controller.ctx };
}

export interface EventOptions {
  kind?: SnapKind;
  face?: FaceId | null;
  edge?: HalfEdgeId | null;
  ray?: Ray;
  /** A guide under the cursor. */
  guide?: { id: number; kind: 'line' | 'point' } | null;
  /** A group under the cursor (in front of `face`). */
  group?: number | null;
  shift?: boolean;
  down?: boolean;
  /** Snap point if different from the cursor point. */
  snap?: Partial<Snap> | null;
}

/**
 * A tool event for the cursor over `p`. By default the snap is "on face" (the face containing p)
 * or "ground", and the ray looks straight down onto p.
 */
export function ev(doc: Document, p: Vec3, o: EventOptions = {}): ToolEvent {
  const face = o.face !== undefined ? o.face : (findFaceAt(doc.model, p) ?? null);
  const ray = o.ray ?? { origin: add(p, [0, 0, 1000]), dir: [0, 0, -1] };
  const snap: Snap | null =
    o.snap === null ? null : { kind: o.kind ?? (face !== null ? 'onFace' : 'ground'), point: p, ...(face !== null ? { face } : {}), ...(o.snap ?? {}) };
  return {
    snap,
    guide: o.guide ?? null,
    group: o.group ?? null,
    outside: false,
    face,
    facePoint: face !== null ? p : null,
    edge: o.edge ?? null,
    ray,
    screen: topDown.toScreen(p)!,
    shift: o.shift ?? false,
    ctrl: false,
    down: o.down ?? false,
  };
}

/** A horizontal ray toward a point from the side (for push/pull distances along Z). */
export function sideRay(target: Vec3): Ray {
  return { origin: add(target, [0, -1000, 0]), dir: [0, 1, 0] };
}

/** Make a tool the active one (so typed input and Escape reach it) and return it. */
export function use(controller: ToolController, id: ToolId): Tool {
  controller.setTool(id);
  return controller.tool;
}
