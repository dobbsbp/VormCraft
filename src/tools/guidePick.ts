import type { Vec3 } from '../core/math/vec3';
import type { Model } from '../core/model/Model';
import type { GuideId, Guides } from '../doc/Guides';
import { closestRayLine } from './geom';
import { visibilityTest, type InferenceInput } from './inference';
import type { Projector, Ray } from './types';

export interface GuideHit {
  id: GuideId;
  kind: 'line' | 'point';
}

/**
 * The guide under the cursor, for selecting, erasing and moving guides. Guide points win over
 * guide lines; guides hidden behind the face under the cursor are not picked.
 */
export function guideAt(input: {
  model: Model;
  guides: Guides;
  projector: Projector;
  cursor: [number, number];
  ray: Ray;
  faceHit: InferenceInput['faceHit'];
  pointTolerancePx?: number;
  lineTolerancePx?: number;
}): GuideHit | null {
  const { guides, projector, cursor, ray } = input;
  if (!guides.visible || guides.items.size === 0) return null;
  const visible = visibilityTest(input.model, ray, input.faceHit);
  const px = (p: Vec3) => {
    const s = projector.toScreen(p);
    return s ? Math.hypot(s[0] - cursor[0], s[1] - cursor[1]) : Infinity;
  };
  let best: GuideHit | null = null;
  let bestPx = input.pointTolerancePx ?? 8;
  for (const g of guides.points()) {
    const d = px(g.pos);
    if (d <= bestPx && visible(g.pos)) {
      bestPx = d;
      best = { id: g.id, kind: 'point' };
    }
  }
  if (best) return best;
  bestPx = input.lineTolerancePx ?? 6;
  for (const g of guides.lines()) {
    const on = closestRayLine(ray, g.point, g.dir);
    if (!on || on.t <= 0) continue;
    const d = px(on.point);
    if (d <= bestPx && visible(on.point)) {
      bestPx = d;
      best = { id: g.id, kind: 'line' };
    }
  }
  return best;
}
