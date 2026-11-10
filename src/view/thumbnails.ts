import * as THREE from 'three';
import type { Model } from '../core/model/Model';
import { facesWithCurveEdges, isSoftEdge } from '../core/model/surfaces';
import { modelBounds } from '../core/ops/group';
import { triangulateFaces } from '../core/triangulate';

/** A part to draw: geometry and its paint. */
export interface ThumbnailPart {
  model: Model;
  color: string;
  opacity?: number;
}

let renderer: THREE.WebGLRenderer | null = null;

/**
 * A small picture of some parts (a library item), seen from the front left and above, on a
 * see-through background, as a data URL. Uses one small renderer of its own, made on first use.
 */
export function renderThumbnail(parts: readonly ThumbnailPart[], size = 160): string {
  const bounds = modelBounds(parts.map((p) => p.model));
  if (!bounds) return '';
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
  }
  renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-0.6, -1, 1.4);
  scene.add(sun);
  const disposables: { dispose(): void }[] = [];

  for (const p of parts) {
    const tri = triangulateFaces(p.model);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(tri.positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(tri.indices, 1));
    const flat = geometry.toNonIndexed();
    flat.computeVertexNormals();
    geometry.dispose();
    const opacity = p.opacity ?? 1;
    const material = new THREE.MeshLambertMaterial({
      color: p.color,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      depthWrite: opacity >= 1,
    });
    scene.add(new THREE.Mesh(flat, material));
    disposables.push(flat, material);

    const m = p.model;
    const curved = facesWithCurveEdges(m);
    const pts: number[] = [];
    for (const e of m.edges()) {
      if (isSoftEdge(m, e, curved)) continue;
      pts.push(...m.pos(m.he(e).origin), ...m.pos(m.dest(e)));
    }
    const lines = new THREE.BufferGeometry();
    lines.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x2b2f36, transparent: true, opacity: 0.55 });
    scene.add(new THREE.LineSegments(lines, lineMaterial));
    disposables.push(lines, lineMaterial);
  }

  const center = new THREE.Vector3((bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2);
  const radius = Math.max(1, Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2);
  const camera = new THREE.PerspectiveCamera(30, 1, radius / 100, radius * 100);
  camera.up.set(0, 0, 1);
  const dir = new THREE.Vector3(-0.75, -1.6, 0.95).normalize();
  camera.position.copy(center).addScaledVector(dir, radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02);
  camera.lookAt(center);

  renderer.render(scene, camera);
  for (const d of disposables) d.dispose();
  const canvas = renderer.domElement;
  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}
