import type { Plane } from '../core/math/plane';
import type { Vec3 } from '../core/math/vec3';
import type { FaceId, HalfEdgeId } from '../core/model/Model';
import type { Document, DocumentSnapshot } from '../doc/Document';
import type { GuideId } from '../doc/Guides';
import type { Selection } from './Selection';

export type SnapKind =
  | 'endpoint'
  | 'origin'
  | 'midpoint'
  | 'guideIntersection'
  | 'guidePoint'
  | 'axis'
  | 'parallel'
  | 'perpendicular'
  | 'onEdge'
  | 'onGuide'
  | 'onFace'
  | 'onPlane'
  | 'ground';

/** An inferred point: where the cursor "really" is, and why. */
export interface Snap {
  kind: SnapKind;
  point: Vec3;
  face?: FaceId;
  edge?: HalfEdgeId;
  guide?: GuideId;
  /** For axis inference: 0 = red (X), 1 = green (Y), 2 = blue (Z), and the point it runs from. */
  axis?: 0 | 1 | 2;
  from?: Vec3;
  /** Set when the point is held on a line by an arrow-key lock. */
  locked?: boolean;
}

export type Vec3Pair = [Vec3, Vec3];

export interface Ray {
  origin: Vec3;
  /** Unit direction. */
  dir: Vec3;
}

/** World → screen (CSS pixels); null when the point is behind the camera. */
export interface Projector {
  toScreen(p: Vec3): [number, number] | null;
}

/** A pointer event after picking and inference. Tools never see DOM events or Three.js objects. */
export interface ToolEvent {
  snap: Snap | null;
  /** Face under the cursor (ignoring edges) and where the ray hits it. */
  face: FaceId | null;
  facePoint: Vec3 | null;
  /** Edge under the cursor (within the pick tolerance), if any. */
  edge: HalfEdgeId | null;
  /** Guide under the cursor (guide points win over guide lines), if any. */
  guide: { id: GuideId; kind: 'line' | 'point' } | null;
  ray: Ray;
  screen: [number, number];
  shift: boolean;
  ctrl: boolean;
  /** Left button held (dragging). */
  down: boolean;
}

/**
 * Arrow-key inference lock: red, green or blue axis, or parallel / perpendicular to the last
 * hovered edge (↓ cycles parallel → perpendicular → off).
 */
export type AxisLock = 'x' | 'y' | 'z' | 'parallel' | 'perpendicular';

/** What a tool asks of the inference engine for its next point. */
export interface InferenceHints {
  /** Offer red/green/blue axis lines through this point. */
  reference?: Vec3;
  /**
   * Keep the point on the line through `reference` in this direction (arrow-key lock). Point snaps
   * are projected onto the line. `axis` is set when it is a model axis.
   */
  lock?: { dir: Vec3; axis?: 0 | 1 | 2 };
  /** Keep the point on the plane through `reference` with this normal (perpendicular-to-edge lock). */
  lockPlane?: { normal: Vec3 };
  /** Keep the inferred point on this plane (projecting snapped points onto it). */
  plane?: Plane;
}

export type PreviewColor = 'preview' | 'axisX' | 'axisY' | 'axisZ' | 'parallel' | 'guide' | 'select';

export interface PreviewLines {
  /** Segment endpoint pairs. */
  points: Vec3[];
  color: PreviewColor;
  dashed?: boolean;
  width?: number;
}

/** Transient drawing a tool wants on screen (in addition to selection, guides and snap cue). */
export interface Preview {
  lines?: PreviewLines[];
  /** Faces to tint (e.g. the face under the Push/Pull cursor). */
  faces?: FaceId[];
  edges?: HalfEdgeId[];
  /** Guides to highlight (e.g. the one under the Select cursor). */
  guides?: GuideId[];
  /** Screen-space selection rectangle (Select tool box drag). */
  box?: { from: [number, number]; to: [number, number]; crossing: boolean };
  /** Screen-space lasso path (Lasso Select). */
  lasso?: { points: [number, number][]; crossing: boolean };
}

export interface ToolContext {
  readonly doc: Document;
  readonly selection: Selection;
  /**
   * Make a model change as one step. If `base` is given the document is first restored to it
   * (used to re-dimension the last operation). On error the document is left exactly as it was
   * and the error is thrown. Returns the snapshot from before the change. `label` names the step
   * for undo/redo (the tool's name by default).
   */
  apply(change: () => void, base?: DocumentSnapshot, label?: string): DocumentSnapshot;
  /**
   * Ask the user to confirm (a dialog in the app) and run `action` if they agree. In tests the
   * answer is yes, immediately. Errors from `action` are reported like any tool error.
   */
  confirm(message: string, action: () => void): void;
  projector(): Projector;
}

export type ToolId =
  | 'select'
  | 'lasso'
  | 'line'
  | 'arc2'
  | 'arc3'
  | 'arc'
  | 'rectangle'
  | 'rectangle3'
  | 'circle'
  | 'polygon'
  | 'pie'
  | 'pushpull'
  | 'offset'
  | 'scale'
  | 'move'
  | 'rotate'
  | 'tape'
  | 'text'
  | 'eraser'
  | 'orbit'
  | 'pan'
  | 'zoom'
  | 'zoomWindow';

export interface Tool {
  readonly id: ToolId;
  readonly name: string;
  /** Status bar instructions for the current step. */
  hint(): string;
  /** Measurements box label and current value. */
  vcbLabel(): string;
  vcbValue(): string;
  inference(): InferenceHints;
  pointerMove(e: ToolEvent): void;
  pointerDown(e: ToolEvent): void;
  /** Mouse released; `dragged` when it moved more than a few pixels since the press. */
  pointerUp?(e: ToolEvent, dragged: boolean): void;
  doubleClick?(e: ToolEvent): void;
  /** Value typed in the Measurements box (Enter). Throws with a message for bad input. */
  typed(text: string): void;
  /** Escape: abandon the current operation. */
  cancel(): void;
  /**
   * Cancel and forget the last finished operation, so typing can no longer re-dimension it. Called
   * when anything else changes the document (another tool, undo, opening a file).
   */
  reset(): void;
  preview(): Preview;
  /** Drawing tools treat press-drag-release like two clicks. */
  readonly dragIsClick?: boolean;
  /** True while every typed key is text for the tool (e.g. editing a label), not a shortcut. */
  acceptsText?(): boolean;
  /** Ctrl tapped: toggle copy mode (Move/Rotate). Returns the new state. */
  toggleCopy?(): boolean;
  /** Arrow key: a tool-specific axis lock (Rotate picks its rotation axis). Returns a status message, or null to fall back to the normal inference lock. */
  lockAxis?(lock: AxisLock): string | null;
}
