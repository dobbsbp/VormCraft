import type { SnapKind } from '../tools/types';

/** Viewport colours (our own palette; front faces warm white, back faces blue-grey as a cue). */
export const THEME = {
  background: 0xd8dadd,
  faceFront: 0xf4f2ee,
  faceBack: 0x9fabc0,
  edge: 0x1d1f23,
  hover: 0x2f6fe4,
  select: 0x1f5fd6,
  preview: 0x23262b,
  guide: 0x4d5562,
  axisX: 0xd63a3a,
  axisY: 0x2e9b45,
  axisZ: 0x3550d0,
  parallel: 0xc026d3,
} as const;

/** Tooltip text for the snap cue. */
export const SNAP_LABELS: Partial<Record<SnapKind, string>> = {
  endpoint: 'Endpoint',
  origin: 'Origin',
  midpoint: 'Midpoint',
  onEdge: 'On Edge',
  onFace: 'On Face',
  guidePoint: 'Guide Point',
  guideIntersection: 'Intersection',
  onGuide: 'On Guide',
  parallel: 'Parallel to Edge',
  perpendicular: 'Perpendicular to Edge',
};
