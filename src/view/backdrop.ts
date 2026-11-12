import * as THREE from 'three';
import type { Backdrop } from '../doc/Backdrop';

const SKY = { clear: 0, clouds: 1 } as const;
const GROUND = { none: 0, plain: 1, grass: 2, paving: 3, sand: 4 } as const;

const vertexShader = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

/**
 * Per pixel: the ray through it (works for perspective and parallel views). Ground where the ray
 * meets the ground plane (z = 0) ahead, or where the pixel itself is below it looking level or down
 * (a parallel front view); sky elsewhere. Patterns are drawn in millimetres on the ground and fade
 * to their average colour where they would shimmer, and the ground fades into haze at the horizon.
 */
const fragmentShader = /* glsl */ `
uniform mat4 invViewProj;
uniform vec3 skyColor;
uniform vec3 horizonColor;
uniform vec3 groundColor;
uniform int skyKind;
uniform int groundKind;
uniform float parallelHalfHeight;
varying vec2 vNdc;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return v;
}

vec3 skyAt(vec3 d, vec3 p) {
  // How high in the sky: the ray's elevation, or (parallel views, level rays) the height on screen.
  float e = parallelHalfHeight > 0.0 ? clamp(p.z / (2.0 * parallelHalfHeight), 0.0, 1.0) : max(d.z, 0.0);
  vec3 c = mix(horizonColor, skyColor, pow(clamp(e, 0.0, 1.0), 0.55));
  if (skyKind == 1 && d.z > 0.0) {
    // Soft clouds on a dome, fixed in the world (they turn with the view), thinning towards the horizon.
    vec2 uv = d.xy / (d.z + 0.18) * 1.6;
    float n = fbm(uv + vec2(3.7, 1.3));
    float cloud = smoothstep(0.48, 0.78, n) * smoothstep(0.02, 0.3, d.z);
    c = mix(c, mix(vec3(1.0), horizonColor, 0.25), cloud * 0.85);
  }
  return c;
}

vec3 groundAt(vec2 xy) {
  vec3 c = groundColor;
  if (groundKind == 1) return c;
  // Pattern detail fades out where one pixel covers more than the pattern's scale (no shimmer).
  vec2 w = fwidth(xy);
  float px = max(w.x, w.y);
  if (groundKind == 2) {
    float big = fbm(xy / 2400.0);
    float fine = noise(xy / 60.0);
    float detail = 1.0 - smoothstep(20.0, 120.0, px);
    return c * (0.82 + 0.3 * big + detail * 0.16 * (fine - 0.5));
  }
  if (groundKind == 3) {
    vec2 tile = xy / 600.0;
    vec2 f = fract(tile);
    float joint = step(f.x, 0.02) + step(f.y, 0.02);
    float detail = 1.0 - smoothstep(6.0, 30.0, px);
    float shade = 0.92 + 0.12 * hash(floor(tile));
    return c * mix(0.97, shade * (1.0 - 0.28 * min(joint, 1.0)), detail);
  }
  float grain = noise(xy / 25.0);
  float ripple = fbm(xy / 1800.0);
  float detail = 1.0 - smoothstep(8.0, 60.0, px);
  return c * (0.9 + 0.15 * ripple + detail * 0.12 * (grain - 0.5));
}

void main() {
  vec4 n = invViewProj * vec4(vNdc, -1.0, 1.0);
  vec4 f = invViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 p = n.xyz / n.w;
  vec3 d = normalize(f.xyz / f.w - p);
  vec3 c;
  if (groundKind > 0 && d.z < 0.0 && p.z >= 0.0) {
    vec2 hit = p.xy + d.xy * (-p.z / d.z);
    // Haze: the ground lightens into the horizon colour towards the distance, so even a view
    // looking down (Iso) shows depth.
    float haze = parallelHalfHeight > 0.0 ? 1.0 : 0.25 + 0.75 * smoothstep(0.0, 0.55, -d.z);
    c = mix(mix(horizonColor, groundColor, 0.35), groundAt(hit), haze);
  } else if (groundKind > 0 && p.z < 0.0 && d.z <= 1e-4) {
    c = groundColor;
  } else {
    c = skyAt(d, p);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * The sky and ground behind the model: one screen-filling layer drawn first, so it never hides
 * anything. When the backdrop is off the scene's plain background colour shows instead.
 */
export class BackdropLayer {
  /** Add this to the scene: a group, because groups are drawn in their own order before loose objects. */
  readonly object = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        invViewProj: { value: new THREE.Matrix4() },
        skyColor: { value: new THREE.Color() },
        horizonColor: { value: new THREE.Color() },
        groundColor: { value: new THREE.Color() },
        skyKind: { value: 0 },
        groundKind: { value: 0 },
        parallelHalfHeight: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.object.add(this.mesh);
    // First of all, before the axes (a group drawn at -1) and everything else.
    this.object.renderOrder = -1000;
  }

  set(b: Backdrop): void {
    const u = this.material.uniforms;
    this.mesh.visible = b.on;
    (u.skyColor.value as THREE.Color).set(b.skyColor);
    (u.horizonColor.value as THREE.Color).set(b.horizonColor);
    (u.groundColor.value as THREE.Color).set(b.groundColor);
    u.skyKind.value = SKY[b.sky];
    u.groundKind.value = GROUND[b.ground];
  }

  /** Follow the camera (before each frame). */
  update(camera: THREE.Camera): void {
    const u = this.material.uniforms;
    camera.updateMatrixWorld();
    (u.invViewProj.value as THREE.Matrix4).multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse);
    u.parallelHalfHeight.value = camera instanceof THREE.OrthographicCamera ? (camera.top - camera.bottom) / 2 / camera.zoom : 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
