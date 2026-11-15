import { dot, length, scale, sub, type Vec3 } from '../core/math/vec3';
import { modelBounds } from '../core/ops/group';
import { planeFrame } from '../core/ops/section';
import type { Document } from '../doc/Document';
import type { SectionId } from '../doc/Sections';
import { closestRaySegment } from './geom';
import type { Projector, Ray } from './types';

/** The rectangle each section plane is drawn as (four corners), sized to cover the whole model. */
export function sectionFrames(doc: Document): Map<SectionId, Vec3[]> {
  const b = modelBounds(doc.allModels()) ?? { min: [-1000, -1000, 0] as Vec3, max: [1000, 1000, 1000] as Vec3 };
  const out = new Map<SectionId, Vec3[]>();
  for (const s of doc.sections.items.values()) out.set(s.id, planeFrame(s.point, s.normal, b.min, b.max));
  return out;
}

/**
 * The section plane whose outline is under the cursor (within `tolerancePx` of one of its four
 * sides on screen), or null. Planes can only be picked while they are shown.
 */
export function sectionAt(doc: Document, projector: Projector, cursor: [number, number], tolerancePx = 7): SectionId | null {
  if (!doc.sections.visible || !doc.sections.items.size) return null;
  let best: SectionId | null = null;
  let bestPx = tolerancePx;
  for (const [id, c] of sectionFrames(doc)) {
    const s = c.map((p) => projector.toScreen(p));
    for (let i = 0; i < 4; i++) {
      const a = s[i];
      const b = s[(i + 1) % 4];
      if (!a || !b) continue;
      const d = distToSegment(cursor, a, b);
      if (d <= bestPx) {
        bestPx = d;
        best = id;
      }
    }
  }
  return best;
}

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Where on a section plane's outline the cursor ray passes closest: the point a drag of the plane
 * starts from. Null when the plane is gone.
 */
export function sectionGrab(doc: Document, id: SectionId, ray: Ray): Vec3 | null {
  const c = sectionFrames(doc).get(id);
  if (!c) return null;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (let i = 0; i < 4; i++) {
    const p = closestRaySegment(ray, c[i], c[(i + 1) % 4]);
    if (!p) continue;
    const w = sub(p, ray.origin);
    const t = dot(w, ray.dir);
    const d = length(sub(w, scale(ray.dir, t)));
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
