import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Vec3 } from '../core/math/vec3';
import type { FaceId, HalfEdgeId, Model } from '../core/model/Model';
import type { Guide, GuideId, Guides } from '../doc/Guides';
import type { LabelId, Labels } from '../doc/Labels';
import type { PointerSample } from '../tools/ToolController';
import type { Preview, PreviewColor, PreviewLines, Projector, Snap } from '../tools/types';
import { surfaceOutline } from '../core/model/surfaces';
import { buildDisplayData, edgeSegment, faceTriangles, type DisplayData } from './displayData';
import { dragModeFor, Navigator, type DragMode, type StandardView } from './navigation';
import { pickHits } from './picking';
import { cameraProjector, screenRay } from './projector';
import { SNAP_LABELS, THEME } from './theme';

export type PointerKind = 'move' | 'down' | 'up' | 'dblclick';

/** Everything drawn on top of the model, rebuilt by the app whenever it changes. */
export interface Overlay {
  selectedFaces: Iterable<FaceId>;
  selectedEdges: Iterable<HalfEdgeId>;
  selectedLabels: Iterable<LabelId>;
  selectedGuides: Iterable<GuideId>;
  preview: Preview;
  snap: Snap | null;
}

const PREVIEW_COLORS: Record<PreviewColor, number> = {
  preview: THEME.preview,
  axisX: THEME.axisX,
  axisY: THEME.axisY,
  axisZ: THEME.axisZ,
  parallel: THEME.parallel,
  guide: THEME.guide,
  select: THEME.select,
};

/**
 * The 3D viewport. It draws a display copy of the model (rebuilt by `refresh()` after every model
 * change), handles navigation (middle/right mouse, wheel), forwards left-button input to the tools
 * as picked samples, and draws the tools' overlay.
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(35, 1, 1, 1e5);
  readonly nav = new Navigator(this.camera);

  /** Left-button pointer input for the tools, already picked. */
  onPointer: (kind: PointerKind, sample: PointerSample) => void = () => {};
  /** A text label was clicked (Shift held or not). */
  onLabelClick: (id: LabelId, shift: boolean) => void = () => {};
  /** When set (Orbit/Pan/Zoom tools), the left button navigates instead of going to the tools. */
  leftDragNavigation: DragMode | null = null;

  private data: DisplayData | null = null;
  private readonly frontMesh: THREE.Mesh;
  private readonly backMesh: THREE.Mesh;
  private readonly edges: THREE.LineSegments;
  /** The same edges drawn through faces, dashed (Back Edges view, K). */
  private readonly backEdges: THREE.LineSegments;
  private readonly overlayGroup = new THREE.Group();
  private readonly guideGroup = new THREE.Group();
  private readonly lineMaterials: LineMaterial[] = [];
  private readonly svg: SVGSVGElement;
  private readonly boxEl: HTMLDivElement;
  private overlay: Overlay = { selectedFaces: [], selectedEdges: [], selectedLabels: [], selectedGuides: [], preview: {}, snap: null };
  private readonly labelLayer: HTMLDivElement;
  private readonly labelEls = new Map<LabelId, HTMLDivElement>();
  private readonly headlight = new THREE.DirectionalLight(0xffffff, 1.6);

  private drag: { mode: DragMode; x: number; y: number; pivot: THREE.Vector3; depth: number; pointerId: number } | null = null;
  private leftDown = false;
  /** Last right-button press, to detect a double right-click (re-centre). */
  private lastOrbitPress: { time: number; x: number; y: number } | null = null;
  private recenterAnimation = 0;
  private renderQueued = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private model: Model,
    private guides: Guides,
    private labels: Labels,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.domElement.classList.add('viewport-canvas');
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(THEME.background);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.4));
    this.camera.add(this.headlight);
    this.headlight.position.set(-0.4, 0.6, 1);
    this.scene.add(this.camera);

    const geometry = new THREE.BufferGeometry();
    const faceMaterial = (color: number, side: THREE.Side) =>
      new THREE.MeshLambertMaterial({ color, side, flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.frontMesh = new THREE.Mesh(geometry, faceMaterial(THEME.faceFront, THREE.FrontSide));
    this.backMesh = new THREE.Mesh(geometry, faceMaterial(THEME.faceBack, THREE.BackSide));
    this.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: THEME.edge }));
    this.backEdges = new THREE.LineSegments(
      this.edges.geometry,
      new THREE.LineDashedMaterial({ color: THEME.edge, dashSize: 4, gapSize: 3, transparent: true, opacity: 0.45, depthTest: false }),
    );
    this.backEdges.visible = false;
    this.backEdges.renderOrder = -1;
    this.scene.add(this.frontMesh, this.backMesh, this.edges, this.backEdges, buildAxes(), this.guideGroup, this.overlayGroup);

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.classList.add('viewport-overlay');
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'selection-box';
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    container.append(this.svg, this.labelLayer, this.boxEl);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.bindInput();
    this.resize();
    this.refresh();
    this.setView('iso');
  }

  /** Rebuild the display copy from the model and guides. Call after every model change. */
  refresh(): void {
    const data = buildDisplayData(this.model);
    this.data = data;
    const g = this.frontMesh.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    const eg = this.edges.geometry;
    eg.setAttribute('position', new THREE.BufferAttribute(data.edgePositions, 3));
    eg.computeBoundingSphere();
    this.backEdges.computeLineDistances();
    const dash = Math.max(this.sceneSphere().radius / 120, 0.5);
    Object.assign(this.backEdges.material as THREE.LineDashedMaterial, { dashSize: dash, gapSize: dash * 0.75 });
    this.rebuildGuides();
    this.rebuildOverlay();
  }

  setOverlay(overlay: Overlay): void {
    this.overlay = overlay;
    this.rebuildOverlay();
  }

  /** Bounding sphere of the model, or a default working area around the origin when empty. */
  sceneSphere(): THREE.Sphere {
    const s = this.frontMesh.geometry.boundingSphere;
    if (!s || this.data?.indices.length === 0 || !Number.isFinite(s.radius)) return new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1000);
    return s.clone();
  }

  /** Show edges hidden behind faces as dashed lines. Returns the new state. */
  toggleBackEdges(): boolean {
    this.backEdges.visible = !this.backEdges.visible;
    this.requestRender();
    return this.backEdges.visible;
  }

  /** Smoothly slide the camera so `point` ends up in the middle of the screen. */
  recenterOn(point: THREE.Vector3): void {
    const from = this.camera.position.clone();
    const to = this.nav.recenterPosition(point);
    const start = performance.now();
    const id = ++this.recenterAnimation;
    const step = () => {
      if (id !== this.recenterAnimation) return; // a newer re-centre took over
      const t = Math.min(1, (performance.now() - start) / 180);
      const ease = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(from, to, ease);
      this.camera.updateMatrixWorld();
      this.requestRender();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setView(view: StandardView): void {
    this.nav.setView(view, this.sceneSphere());
    this.requestRender();
  }

  zoomExtents(): void {
    this.nav.zoomExtents(this.sceneSphere());
    this.requestRender();
  }

  viewport() {
    return { width: this.renderer.domElement.clientWidth || 1, height: this.renderer.domElement.clientHeight || 1 };
  }

  projector(): Projector {
    return cameraProjector(this.camera, this.viewport());
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.nav.fitClipping(this.sceneSphere().union(new THREE.Sphere(new THREE.Vector3(), 1000)));
      this.renderer.render(this.scene, this.camera);
      this.drawScreenOverlay();
    });
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.svg.remove();
    this.boxEl.remove();
    this.labelLayer.remove();
  }

  // ------------------------------------------------------------------ overlay

  private lineMaterial(color: number, width: number, opts: { dashed?: boolean; onTop?: boolean } = {}): LineMaterial {
    const { width: w, height: h } = this.viewport();
    const m = new LineMaterial({ color, linewidth: width, dashed: !!opts.dashed, depthTest: !opts.onTop, transparent: !!opts.onTop });
    m.resolution.set(w, h);
    if (opts.dashed) {
      const size = Math.max(this.sceneSphere().radius / 60, 1);
      m.dashSize = size;
      m.gapSize = size * 0.8;
    }
    this.lineMaterials.push(m);
    return m;
  }

  private lines(positions: Float32Array | number[], material: LineMaterial, order: number): LineSegments2 {
    const geo = new LineSegmentsGeometry().setPositions(positions instanceof Float32Array ? positions : Float32Array.from(positions));
    const obj = new LineSegments2(geo, material);
    if (material.dashed) obj.computeLineDistances();
    obj.renderOrder = order;
    return obj;
  }

  private tint(faces: FaceId[], color: number, opacity: number): THREE.Mesh | null {
    const parts = faces.filter((f) => this.model.faces.has(f)).map((f) => faceTriangles(this.model, f));
    if (!parts.length) return null;
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(all, 3)),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }),
    );
    mesh.renderOrder = 1;
    return mesh;
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      const obj = child as THREE.Mesh;
      obj.geometry?.dispose();
      const mat = obj.material as THREE.Material | undefined;
      if (mat) {
        mat.dispose();
        const i = this.lineMaterials.indexOf(mat as LineMaterial);
        if (i >= 0) this.lineMaterials.splice(i, 1);
      }
    }
  }

  private rebuildOverlay(): void {
    this.clearGroup(this.overlayGroup);
    const { preview, snap } = this.overlay;
    const m = this.model;
    const add = (o: THREE.Object3D | null) => o && this.overlayGroup.add(o);

    const selectedFaces = [...this.overlay.selectedFaces].filter((f) => m.faces.has(f));
    add(this.tint(selectedFaces, THEME.select, 0.32));
    const selectedEdges = [...this.overlay.selectedEdges].filter((e) => m.halfEdges.has(e));
    if (selectedEdges.length) add(this.lines(concat(selectedEdges.map((e) => edgeSegment(m, e))), this.lineMaterial(THEME.select, 3), 2));

    const hoverFaces = (preview.faces ?? []).filter((f) => m.faces.has(f));
    add(this.tint(hoverFaces, THEME.hover, 0.22));
    // Outline only the visible edges, so a curved surface is not striped with its hidden seams.
    const hoverLines = [...surfaceOutline(m, hoverFaces), ...(preview.edges ?? []).filter((e) => m.halfEdges.has(e))].map((e) => edgeSegment(m, e));
    if (hoverLines.length) add(this.lines(concat(hoverLines), this.lineMaterial(THEME.hover, 2.5), 2));

    // Selected and hovered guide lines, drawn over the normal dashed guides.
    const selectedGuides = new Set(this.overlay.selectedGuides);
    const hoveredGuides = new Set(preview.guides ?? []);
    for (const [ids, color, width] of [
      [selectedGuides, THEME.select, 2.5],
      [hoveredGuides, THEME.hover, 2],
    ] as const) {
      const pts: number[] = [];
      for (const id of ids) {
        const g = this.guides.items.get(id);
        if (g?.kind === 'line') pts.push(...this.guideSpan(g));
      }
      if (pts.length) add(this.lines(pts, this.lineMaterial(color, width, { dashed: true }), 2));
    }

    const previewLines: PreviewLines[] = [...(preview.lines ?? [])];
    if ((snap?.kind === 'axis' || snap?.kind === 'parallel' || snap?.kind === 'perpendicular') && snap.from) {
      const color = snap.kind === 'axis' ? (['axisX', 'axisY', 'axisZ'] as const)[snap.axis ?? 0] : 'parallel';
      // A locked direction is drawn solid and thicker than a passing inference.
      previewLines.push({ points: [snap.from, snap.point], color, dashed: !snap.locked, width: snap.locked ? 3 : 2 });
    }
    for (const l of previewLines) {
      if (l.points.length < 2) continue;
      add(this.lines(l.points.flatMap((p) => [...p]), this.lineMaterial(PREVIEW_COLORS[l.color], l.width ?? 1.5, { dashed: l.dashed, onTop: true }), 3));
    }

    const box = preview.box;
    if (box) {
      const x = Math.min(box.from[0], box.to[0]);
      const y = Math.min(box.from[1], box.to[1]);
      Object.assign(this.boxEl.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${Math.abs(box.to[0] - box.from[0])}px`, height: `${Math.abs(box.to[1] - box.from[1])}px` });
      this.boxEl.classList.toggle('crossing', box.crossing);
    } else this.boxEl.style.display = 'none';
    this.requestRender();
  }

  private rebuildGuides(): void {
    this.clearGroup(this.guideGroup);
    if (!this.guides.visible) return;
    const pts = this.guides.lines().flatMap((g) => this.guideSpan(g));
    if (pts.length) this.guideGroup.add(this.lines(pts, this.lineMaterial(THEME.guide, 1.2, { dashed: true }), 0));
  }

  /** A long stretch of an (infinite) guide line, centred near the model, as flat xyz pairs. */
  private guideSpan(g: Extract<Guide, { kind: 'line' }>): number[] {
    const sphere = this.sceneSphere();
    const span = Math.max(sphere.radius, 1000) * 4;
    const c: Vec3 = [sphere.center.x, sphere.center.y, sphere.center.z];
    const t = (c[0] - g.point[0]) * g.dir[0] + (c[1] - g.point[1]) * g.dir[1] + (c[2] - g.point[2]) * g.dir[2];
    return [t - span, t + span].flatMap((s) => [g.point[0] + g.dir[0] * s, g.point[1] + g.dir[1] * s, g.point[2] + g.dir[2] * s]);
  }

  /** Screen-space parts of the overlay (snap cue, guide points), re-projected every frame. */
  private drawScreenOverlay(): void {
    const proj = this.projector();
    const parts: string[] = [];
    if (this.guides.visible) {
      const selected = new Set(this.overlay.selectedGuides);
      const hovered = new Set(this.overlay.preview.guides ?? []);
      for (const g of this.guides.points()) {
        const s = proj.toScreen(g.pos);
        if (!s) continue;
        const color = selected.has(g.id) ? '#1f5fd6' : hovered.has(g.id) ? '#2f6fe4' : '#3c4048';
        parts.push(cross(s, selected.has(g.id) || hovered.has(g.id) ? 6.5 : 5, color));
      }
    }
    const snap = this.overlay.snap;
    if (snap && snap.kind !== 'ground' && snap.kind !== 'onPlane') {
      const s = proj.toScreen(snap.point);
      if (s) {
        parts.push(marker(snap, s));
        const label = snap.kind === 'axis' ? ['On Red Axis', 'On Green Axis', 'On Blue Axis'][snap.axis ?? 0] : SNAP_LABELS[snap.kind];
        const text = snap.locked && label ? `${label} (locked)` : label;
        if (text) parts.push(`<text x="${s[0] + 12}" y="${s[1] + 22}" class="snap-label">${text}</text>`);
      }
    }
    parts.push(...this.drawLabels(proj));
    const lasso = this.overlay.preview.lasso;
    if (lasso) {
      const pts = lasso.points.map((p) => p.join(',')).join(' ');
      parts.push(`<polygon points="${pts}" class="lasso${lasso.crossing ? ' crossing' : ''}"/>`);
    }
    this.svg.innerHTML = parts.join('');
  }

  /** Position the label elements and return their leader lines (SVG). */
  private drawLabels(proj: Projector): string[] {
    const leaders: string[] = [];
    const selected = new Set(this.overlay.selectedLabels);
    for (const [id, el] of this.labelEls) {
      if (!this.labels.items.has(id)) {
        el.remove();
        this.labelEls.delete(id);
      }
    }
    for (const label of this.labels.items.values()) {
      let el = this.labelEls.get(label.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'model-label';
        const id = label.id;
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          this.onLabelClick(id, e.shiftKey);
        });
        this.labelLayer.append(el);
        this.labelEls.set(label.id, el);
      }
      const a = proj.toScreen(label.anchor);
      const p = proj.toScreen(label.position);
      if (!a || !p) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      if (el.textContent !== label.text) el.textContent = label.text;
      el.classList.toggle('selected', selected.has(label.id));
      // The text sits at the label position, on the side away from the anchor.
      const left = p[0] < a[0];
      el.style.transform = `translate(${p[0]}px, ${p[1]}px) translate(${left ? '-100%' : '0'}, -50%)`;
      leaders.push(`<path d="M${a[0]} ${a[1]}L${p[0]} ${p[1]}" class="leader"/><circle cx="${a[0]}" cy="${a[1]}" r="2.5" class="leader-dot"/>`);
    }
    return leaders;
  }

  // ------------------------------------------------------------------ input

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(w, h);
    this.requestRender();
  }

  private local(e: MouseEvent): [number, number] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  /** Face and edge under a viewport position (model ids and hit points). */
  private hitsAt(screen: [number, number]) {
    if (!this.data) return { face: null, edge: null };
    const viewport = this.viewport();
    const ndc = new THREE.Vector2((screen[0] / viewport.width) * 2 - 1, -(screen[1] / viewport.height) * 2 + 1);
    return pickHits({ camera: this.camera, ndc, viewport, faceObjects: [this.frontMesh, this.backMesh], data: this.data });
  }

  /** Pick at a viewport position and package it for the tools. */
  sample(screen: [number, number], e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, down: boolean): PointerSample {
    const ray = screenRay(this.camera, screen, this.viewport());
    const hits = this.hitsAt(screen);
    const face: PointerSample['faceHit'] = hits.face ? { face: hits.face.face, point: hits.face.point, distance: hits.face.distance } : null;
    return { screen, ray, faceHit: face, edge: hits.edge?.edge ?? null, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, down };
  }

  /**
   * The point under the cursor for navigation (orbit pivot, zoom and re-centre target): the edge
   * under the cursor if there is one in front (so corners and silhouettes count, where the ray
   * just misses the faces), else the face hit, else the ground plane, else a point at the
   * scene's depth.
   */
  private focusPoint(screen: [number, number]): THREE.Vector3 {
    const hits = this.hitsAt(screen);
    if (hits.edge && (!hits.face || hits.edge.distance <= hits.face.distance * (1 + 1e-3))) return new THREE.Vector3(...hits.edge.point);
    if (hits.face) return new THREE.Vector3(...hits.face.point);
    const r = screenRay(this.camera, screen, this.viewport());
    const ray = new THREE.Ray(new THREE.Vector3(...r.origin), new THREE.Vector3(...r.dir));
    const ground = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
    const sphere = this.sceneSphere();
    const sceneDepth = Math.max(this.camera.position.distanceTo(sphere.center), sphere.radius);
    if (ground && ground.distanceTo(this.camera.position) < sceneDepth * 20) return ground;
    return ray.at(sceneDepth, new THREE.Vector3());
  }

  private bindInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      const screen = this.local(e);
      if (e.button === 0 && !this.leftDragNavigation) {
        this.leftDown = true;
        capturePointer(el, e.pointerId, true);
        this.onPointer('down', this.sample(screen, e, true));
        return;
      }
      // Double-click with the orbit (right) button: re-centre on the point under the cursor.
      // Browsers only report dblclick for the left button, so detect two quick presses here.
      if (e.button === 2) {
        const now = performance.now();
        const last = this.lastOrbitPress;
        this.lastOrbitPress = { time: now, x: e.clientX, y: e.clientY };
        if (last && now - last.time < 500 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) {
          e.preventDefault();
          this.lastOrbitPress = null;
          this.recenterOn(this.focusPoint(screen));
          return;
        }
      }
      const mode = dragModeFor(e.button, this.leftDragNavigation);
      if (!mode) return;
      e.preventDefault();
      const pivot = this.focusPoint(screen);
      const depth = Math.max(pivot.clone().sub(this.camera.position).dot(this.nav.forward()), this.camera.near);
      this.drag = { mode, x: e.clientX, y: e.clientY, pivot, depth, pointerId: e.pointerId };
      capturePointer(el, e.pointerId, true);
      el.classList.add(mode === 'orbit' ? 'is-orbiting' : mode === 'zoom' ? 'is-zooming' : 'is-panning');
    });

    el.addEventListener('pointermove', (e) => {
      if (this.drag && e.pointerId === this.drag.pointerId) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        if (this.drag.mode === 'orbit') this.nav.orbit(dx, dy, this.drag.pivot);
        else if (this.drag.mode === 'zoom') this.nav.zoomToward(this.drag.pivot, -dy / 40);
        else this.nav.pan(dx, dy, this.drag.depth, el.clientHeight);
        this.requestRender();
        return;
      }
      this.onPointer('move', this.sample(this.local(e), e, this.leftDown));
    });

    const endDrag = (e: PointerEvent) => {
      if (e.button === 0 && this.leftDown) {
        this.leftDown = false;
        capturePointer(el, e.pointerId, false);
        this.onPointer('up', this.sample(this.local(e), e, false));
        return;
      }
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      capturePointer(el, e.pointerId, false);
      el.classList.remove('is-orbiting', 'is-panning', 'is-zooming');
      this.onPointer('move', this.sample(this.local(e), e, false));
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('dblclick', (e) => {
      if (e.button === 0) this.onPointer('dblclick', this.sample(this.local(e), e, false));
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        // Normalise lines/pages to pixels, then about one zoom step per notch (100px).
        const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY;
        const screen = this.local(e);
        this.nav.zoomToward(this.focusPoint(screen), -px / 100);
        this.requestRender();
        this.onPointer('move', this.sample(screen, e, this.leftDown));
      },
      { passive: false },
    );
  }
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const cross = ([x, y]: [number, number], r: number, color: string) =>
  `<path d="M${x - r} ${y - r}L${x + r} ${y + r}M${x - r} ${y + r}L${x + r} ${y - r}" stroke="${color}" stroke-width="1.5"/>`;

/** The snap cue: a distinct shape and colour per kind of inference. */
function marker(snap: Snap, [x, y]: [number, number]): string {
  switch (snap.kind) {
    case 'endpoint':
    case 'origin':
      return `<circle cx="${x}" cy="${y}" r="5.5" class="snap snap-endpoint"/>`;
    case 'midpoint':
      return `<circle cx="${x}" cy="${y}" r="5.5" class="snap snap-midpoint"/>`;
    case 'onEdge':
      return `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" class="snap snap-edge"/>`;
    case 'onFace':
      return `<path d="M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z" class="snap snap-face"/>`;
    case 'axis':
      return `<circle cx="${x}" cy="${y}" r="4.5" class="snap snap-axis-${snap.axis ?? 0}"/>`;
    case 'parallel':
    case 'perpendicular':
      return `<circle cx="${x}" cy="${y}" r="4.5" class="snap snap-parallel"/>`;
    case 'guideIntersection':
    case 'guidePoint':
      return cross([x, y], 6, '#1d1f23');
    case 'onGuide':
      return `<rect x="${x - 4}" y="${y - 4}" width="8" height="8" class="snap snap-guide"/>`;
    default:
      return '';
  }
}

/** Pointer capture keeps a drag alive outside the canvas; it is optional, so never let it throw. */
function capturePointer(el: Element, pointerId: number, on: boolean): void {
  try {
    if (on) el.setPointerCapture(pointerId);
    else if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // Pointer already gone (or synthetic); dragging still works while the cursor is over the canvas.
  }
}

/** Red/green/blue axes: solid on the positive side, dotted on the negative side. */
function buildAxes(): THREE.Group {
  const group = new THREE.Group();
  const L = 1e6;
  const axes: [THREE.Vector3, number][] = [
    [new THREE.Vector3(1, 0, 0), THEME.axisX],
    [new THREE.Vector3(0, 1, 0), THEME.axisY],
    [new THREE.Vector3(0, 0, 1), THEME.axisZ],
  ];
  for (const [dir, color] of axes) {
    const pos = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(L)]), new THREE.LineBasicMaterial({ color }));
    const neg = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(-L)]),
      new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 6, scale: 1 }),
    );
    neg.computeLineDistances();
    group.add(pos, neg);
  }
  group.renderOrder = -1;
  return group;
}
