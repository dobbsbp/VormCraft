import * as THREE from 'three';

export type StandardView = 'iso' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

/** Viewing direction (camera → scene) for each standard view, Z up. */
const VIEW_DIRECTIONS: Record<StandardView, THREE.Vector3> = {
  iso: new THREE.Vector3(0.55, 1, -0.75).normalize(),
  top: new THREE.Vector3(0, 0, -1),
  bottom: new THREE.Vector3(0, 0, 1),
  front: new THREE.Vector3(0, 1, 0),
  back: new THREE.Vector3(0, -1, 0),
  left: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(-1, 0, 0),
};

const Z = new THREE.Vector3(0, 0, 1);
/** Keep the view direction this far (as |sin of elevation|) from straight up/down while orbiting. */
const MAX_ELEVATION = 0.999;

/**
 * SketchUp-style camera navigation for a Z-up perspective camera: turntable orbit about a pivot
 * (usually the point under the cursor), pan that keeps the grabbed point under the cursor, and
 * zoom toward the cursor. Pure camera math, so it is testable without a renderer.
 *
 * In parallel projection the same camera gives the position and direction, and `height` is how
 * much of the world (in millimetres) the view shows top to bottom; zooming shrinks it in step with
 * the camera's move, so the point under the cursor stays put either way.
 */
export class Navigator {
  /** Radians of orbit per pixel dragged. */
  orbitSpeed = 0.006;
  projection: 'perspective' | 'parallel' = 'perspective';
  /** View height in millimetres (parallel projection). */
  height = 1000;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.up.copy(Z);
  }

  forward(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  lookAt(target: THREE.Vector3): void {
    this.camera.up.copy(Z);
    const dir = target.clone().sub(this.camera.position).normalize();
    // Straight up/down views need an explicit up vector; use +Y so the plan view reads naturally.
    this.camera.up.copy(Math.abs(dir.z) > MAX_ELEVATION ? new THREE.Vector3(0, Math.sign(-dir.z) || 1, 0) : Z);
    this.camera.lookAt(target);
    this.camera.up.copy(Z);
    this.camera.updateMatrixWorld();
  }

  /** Orbit by a mouse drag of (dx, dy) pixels around `pivot`. */
  orbit(dx: number, dy: number, pivot: THREE.Vector3): void {
    const cam = this.camera;
    const yaw = -dx * this.orbitSpeed;
    let pitch = -dy * this.orbitSpeed;

    // Limit pitch so the camera never flips over the pole.
    const elevation = Math.asin(THREE.MathUtils.clamp(this.forward().z, -1, 1));
    const limit = Math.asin(MAX_ELEVATION);
    pitch = THREE.MathUtils.clamp(elevation + pitch, -limit, limit) - elevation;

    const qYaw = new THREE.Quaternion().setFromAxisAngle(Z, yaw);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    right.z = 0;
    if (right.lengthSq() < 1e-12) right.set(1, 0, 0);
    right.normalize();
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, pitch);
    const q = qYaw.multiply(qPitch);

    cam.position.sub(pivot).applyQuaternion(q).add(pivot);
    cam.quaternion.premultiply(q);
    cam.updateMatrixWorld();
  }

  /** World units per screen pixel at a given distance in front of the camera. */
  unitsPerPixel(depth: number, viewportHeight: number): number {
    if (this.projection === 'parallel') return this.height / viewportHeight;
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2)) / viewportHeight;
  }

  /** Pan by a drag of (dx, dy) pixels, keeping a point at `depth` under the cursor. */
  pan(dx: number, dy: number, depth: number, viewportHeight: number): void {
    const k = this.unitsPerPixel(depth, viewportHeight);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.camera.updateMatrixWorld();
  }

  /**
   * Where the camera must be for `point` to sit in the middle of the screen, keeping the view
   * direction and the point's depth (a sideways slide, like SketchUp's re-centre).
   */
  recenterPosition(point: THREE.Vector3): THREE.Vector3 {
    const f = this.forward();
    const depth = point.clone().sub(this.camera.position).dot(f);
    const onAxis = this.camera.position.clone().addScaledVector(f, depth);
    return this.camera.position.clone().add(point.clone().sub(onAxis));
  }

  /** Slide the camera so `point` is in the middle of the screen. */
  recenterOn(point: THREE.Vector3): void {
    this.camera.position.copy(this.recenterPosition(point));
    this.camera.updateMatrixWorld();
  }

  /**
   * Zoom toward `focus` (the point under the cursor). `steps` > 0 zooms in, < 0 out; each step
   * covers 20% of the remaining distance.
   */
  zoomToward(focus: THREE.Vector3, steps: number): void {
    const t = 1 - Math.pow(0.8, steps);
    const offset = focus.clone().sub(this.camera.position);
    this.camera.position.addScaledVector(offset, t);
    this.height *= 1 - t;
    this.camera.updateMatrixWorld();
  }

  /**
   * Zoom Window: `target` is the point under the middle of the box, `fraction` how much of the
   * screen the box covers (its larger share of width or height). The camera keeps its direction
   * and moves so the box fills the view, centred on the target.
   */
  zoomWindow(target: THREE.Vector3, fraction: number): void {
    const f = this.forward();
    const depth = Math.max(target.clone().sub(this.camera.position).dot(f), this.camera.near);
    const k = THREE.MathUtils.clamp(fraction, 1e-4, 1);
    this.camera.position.copy(target).addScaledVector(f, -depth * k);
    this.height *= k;
    this.camera.updateMatrixWorld();
  }

  state(): CameraState {
    return { position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone() };
  }

  setState(s: CameraState): void {
    this.camera.position.copy(s.position);
    this.camera.quaternion.copy(s.quaternion);
    this.camera.up.copy(Z);
    this.camera.updateMatrixWorld();
  }

  /** Move back along the current view direction until the sphere fills the view. */
  zoomExtents(sphere: THREE.Sphere, aspect = this.camera.aspect): void {
    const vFov = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const hFov = Math.atan(Math.tan(vFov) * aspect);
    const radius = Math.max(sphere.radius, 1);
    const distance = (radius / Math.sin(Math.min(vFov, hFov))) * 1.05;
    this.camera.position.copy(sphere.center).addScaledVector(this.forward(), -distance);
    this.height = (2 * radius * 1.05) / Math.min(1, aspect);
    this.camera.updateMatrixWorld();
  }

  setView(view: StandardView, sphere: THREE.Sphere): void {
    this.camera.position.copy(sphere.center).addScaledVector(VIEW_DIRECTIONS[view], -1);
    this.lookAt(sphere.center);
    this.zoomExtents(sphere);
  }

  /** The view height that matches the perspective view at `depth` (switching to parallel without a jump). */
  heightAt(depth: number): number {
    return 2 * Math.max(depth, 1e-3) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
  }

  /**
   * Set up an orthographic camera for parallel projection: looking the same way, drawn back far
   * enough that everything in `sphere` is in front of it, showing `height`.
   */
  syncParallel(ortho: THREE.OrthographicCamera, sphere: THREE.Sphere): void {
    const cam = this.camera;
    const reach = cam.position.distanceTo(sphere.center) + sphere.radius + 1;
    ortho.position.copy(cam.position).addScaledVector(this.forward(), -reach);
    ortho.quaternion.copy(cam.quaternion);
    const h = this.height / 2;
    Object.assign(ortho, { top: h, bottom: -h, left: -h * cam.aspect, right: h * cam.aspect, near: Math.max(reach / 1e4, 0.01), far: reach * 2 + sphere.radius * 2 + 1 });
    ortho.updateProjectionMatrix();
    ortho.updateMatrixWorld();
  }

  /** Near/far planes that bracket the scene tightly enough for good depth precision. */
  fitClipping(sphere: THREE.Sphere): void {
    const d = this.camera.position.distanceTo(sphere.center);
    const far = d + sphere.radius * 2 + 1;
    this.camera.far = far;
    this.camera.near = Math.max(far / 1e5, Math.min(d - sphere.radius, far / 50), 0.01);
    this.camera.updateProjectionMatrix();
  }
}

/** Where the camera is and which way it looks. */
export interface CameraState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Earlier camera positions for Previous View: one is recorded before each navigation. */
export class ViewHistory {
  private readonly states: CameraState[] = [];

  constructor(readonly limit = 50) {}

  get size(): number {
    return this.states.length;
  }

  /** Remember a view (unless it is the same as the last one remembered). */
  push(s: CameraState): void {
    const top = this.states[this.states.length - 1];
    if (top && top.position.distanceTo(s.position) < 1e-6 && Math.abs(top.quaternion.dot(s.quaternion)) > 1 - 1e-9) return;
    this.states.push({ position: s.position.clone(), quaternion: s.quaternion.clone() });
    if (this.states.length > this.limit) this.states.shift();
  }

  pop(): CameraState | undefined {
    return this.states.pop();
  }
}

export type DragMode = 'orbit' | 'pan' | 'zoom';

/**
 * Which camera drag a mouse button starts: middle-drag orbits, right-drag pans. The left button
 * belongs to the active tool, so it only navigates when that tool is Orbit, Pan or Zoom
 * (`leftTool`).
 */
export function dragModeFor(button: number, leftTool: DragMode | null): DragMode | null {
  if (button === 0) return leftTool;
  if (button === 1) return 'orbit';
  if (button === 2) return 'pan';
  return null;
}
