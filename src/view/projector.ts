import * as THREE from 'three';
import type { Vec3 } from '../core/math/vec3';
import type { Projector, Ray } from '../tools/types';

export interface Viewport {
  width: number;
  height: number;
}

/** World → CSS pixels for a camera (null for points behind it). */
export function cameraProjector(camera: THREE.Camera, viewport: Viewport): Projector {
  const v = new THREE.Vector3();
  const toView = new THREE.Vector3();
  return {
    toScreen(p: Vec3) {
      toView.set(p[0], p[1], p[2]).applyMatrix4(camera.matrixWorldInverse);
      if (toView.z >= 0) return null;
      v.set(p[0], p[1], p[2]).project(camera);
      return [((v.x + 1) / 2) * viewport.width, ((1 - v.y) / 2) * viewport.height];
    },
  };
}

export function screenToNdc(screen: [number, number], viewport: Viewport): THREE.Vector2 {
  return new THREE.Vector2((screen[0] / viewport.width) * 2 - 1, -(screen[1] / viewport.height) * 2 + 1);
}

/** The pick ray through a screen point. */
export function screenRay(camera: THREE.Camera, screen: [number, number], viewport: Viewport): Ray {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(screenToNdc(screen, viewport), camera);
  const { origin, direction } = rc.ray;
  return { origin: [origin.x, origin.y, origin.z], dir: [direction.x, direction.y, direction.z] };
}
