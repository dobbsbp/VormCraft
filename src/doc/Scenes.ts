import type { Vec3 } from '../core/math/vec3';
import type { GroupId, Groups } from './Groups';
import type { Guides } from './Guides';

export type SceneId = number;

/** Where the camera is and how it sees: what a scene stores of the view. */
export interface CameraView {
  position: Vec3;
  /** A point the camera looks at (straight ahead). */
  target: Vec3;
  /** Vertical field of view in degrees (perspective). */
  fov: number;
  projection: 'perspective' | 'parallel';
  /** Height of the view in millimetres at the target (parallel projection). */
  height: number;
}

/** How faces are drawn. */
export type FaceStyle = 'textured' | 'shaded' | 'wireframe' | 'xray';

/** Display settings a scene stores (the style). */
export interface DisplayStyle {
  faces: FaceStyle;
  /** Edges hidden behind faces drawn dashed. */
  backEdges: boolean;
  guides: boolean;
  /** Background colour, '#rrggbb'. */
  background: string;
}

/** The parts of the view a scene saves and restores (each can be switched off). */
export interface SceneParts {
  camera: boolean;
  /** Which groups are hidden. */
  hidden: boolean;
  style: boolean;
}

export interface Scene {
  readonly id: SceneId;
  name: string;
  parts: SceneParts;
  camera: CameraView;
  /** Hidden groups. */
  hidden: GroupId[];
  style: DisplayStyle;
}

export const DEFAULT_STYLE: DisplayStyle = { faces: 'textured', backEdges: false, guides: true, background: '#d8dadd' };
export const ALL_PARTS: SceneParts = { camera: true, hidden: true, style: true };

/** The live view, as scenes see it: the app's viewport (or a stand-in in tests). */
export interface SceneView {
  cameraView(): CameraView;
  /** Move the camera, gliding there over `seconds` (0: at once). */
  setCameraView(view: CameraView, seconds: number): void;
  displayStyle(): DisplayStyle;
  setDisplayStyle(style: DisplayStyle): void;
}

/**
 * Scenes: saved views of the model (camera, hidden groups, display style), in order. Like the rest
 * of the document they are saved and undoable. `transition` is how long the camera glides between
 * scenes, `delay` how long the slideshow stays on each.
 */
export class Scenes {
  items: Scene[] = [];
  transition = 1;
  delay = 1;
  private nextId = 1;

  add(fields: Omit<Scene, 'id'>, id?: SceneId): SceneId {
    const sid = id ?? this.nextId;
    if (this.get(sid)) throw new Error(`Scene id ${sid} is in use`);
    this.nextId = Math.max(this.nextId, sid + 1);
    this.items.push({ ...fields, id: sid, parts: { ...fields.parts }, hidden: [...fields.hidden] });
    return sid;
  }

  get(id: SceneId): Scene | undefined {
    return this.items.find((s) => s.id === id);
  }

  indexOf(id: SceneId): number {
    return this.items.findIndex((s) => s.id === id);
  }

  /** "Scene 3": the first name of that form not in use. */
  nextName(): string {
    for (let i = 1; ; i++) if (!this.items.some((s) => s.name === `Scene ${i}`)) return `Scene ${i}`;
  }

  update(id: SceneId, changes: Partial<Omit<Scene, 'id'>>): void {
    const s = this.get(id);
    if (!s) throw new Error('That scene no longer exists');
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('A scene needs a name');
    Object.assign(s, changes);
  }

  delete(id: SceneId): void {
    this.items = this.items.filter((s) => s.id !== id);
  }

  /** Move a scene to `index` in the order (clamped). */
  move(id: SceneId, index: number): void {
    const from = this.indexOf(id);
    if (from < 0) return;
    const [s] = this.items.splice(from, 1);
    this.items.splice(Math.max(0, Math.min(this.items.length, index)), 0, s);
  }

  clone(): Scenes {
    const c = new Scenes();
    c.nextId = this.nextId;
    c.transition = this.transition;
    c.delay = this.delay;
    c.items = this.items.map((s) => cloneScene(s));
    return c;
  }

  copyFrom(other: Scenes): void {
    const c = other.clone();
    this.nextId = c.nextId;
    this.transition = c.transition;
    this.delay = c.delay;
    this.items = c.items;
  }
}

function cloneScene(s: Scene): Scene {
  return { ...s, parts: { ...s.parts }, camera: { ...s.camera, position: [...s.camera.position], target: [...s.camera.target] }, hidden: [...s.hidden], style: { ...s.style } };
}

/** The live state as scene fields (everything is captured; `parts` says what gets restored). */
export function captureScene(view: SceneView, groups: Groups, guides: Guides): Omit<Scene, 'id' | 'name' | 'parts'> {
  return {
    camera: view.cameraView(),
    hidden: [...groups.items.values()].filter((g) => g.hidden).map((g) => g.id),
    style: { ...view.displayStyle(), guides: guides.visible },
  };
}

/**
 * Show a scene: its style and hidden groups take effect at once, then the camera glides to the
 * scene's view over `seconds`. Only the parts the scene saves are changed.
 */
export function applyScene(scene: Scene, view: SceneView, groups: Groups, guides: Guides, seconds: number): void {
  if (scene.parts.style) {
    view.setDisplayStyle(scene.style);
    guides.visible = scene.style.guides;
  }
  if (scene.parts.hidden) {
    const hidden = new Set(scene.hidden);
    for (const g of groups.items.values()) {
      if (hidden.has(g.id)) g.hidden = true;
      else delete g.hidden;
    }
  }
  if (scene.parts.camera) view.setCameraView(scene.camera, seconds);
}
