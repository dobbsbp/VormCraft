import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, pushPull, type Vec3 } from '../src/core';
import { Guides } from '../src/doc/Guides';
import { guideAt } from '../src/tools/guidePick';
import { Navigator } from '../src/view/navigation';
import { cameraProjector, screenRay } from '../src/view/projector';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

const VIEWPORT = { width: 1000, height: 800 };

function camera() {
  const cam = new THREE.PerspectiveCamera(35, VIEWPORT.width / VIEWPORT.height, 0.1, 1e5);
  const nav = new Navigator(cam);
  cam.position.set(-150, -250, 200);
  nav.lookAt(new THREE.Vector3(50, 50, 10));
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

/** Pick a guide with the cursor a few pixels from where `target` appears on screen. */
function pickAt(model: Model, guides: Guides, target: Vec3, nudge: [number, number] = [2, 2], hitFace: number | null = null) {
  const cam = camera();
  const proj = cameraProjector(cam, VIEWPORT);
  const s = proj.toScreen(target)!;
  const cursor: [number, number] = [s[0] + nudge[0], s[1] + nudge[1]];
  const ray = screenRay(cam, cursor, VIEWPORT);
  // Where the ray really meets the face under the cursor (as the viewer's raycast would report).
  let faceHit: Parameters<typeof guideAt>[0]['faceHit'] = null;
  if (hitFace !== null) {
    const plane = model.facePlane(hitFace);
    const t = ((plane.origin[0] - ray.origin[0]) * plane.normal[0] + (plane.origin[1] - ray.origin[1]) * plane.normal[1] + (plane.origin[2] - ray.origin[2]) * plane.normal[2]) /
      (ray.dir[0] * plane.normal[0] + ray.dir[1] * plane.normal[1] + ray.dir[2] * plane.normal[2]);
    faceHit = { face: hitFace, point: [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t], distance: t };
  }
  return guideAt({ model, guides, projector: proj, cursor, ray, faceHit });
}

describe('picking guides', () => {
  it('finds guide lines and guide points near the cursor; points win', () => {
    const guides = new Guides();
    const line = guides.addLine([0, 40, 0], [1, 0, 0]);
    const point = guides.addPoint([30, 40, 0]);
    const m = new Model();
    expect(pickAt(m, guides, [-20, 40, 0])).toEqual({ id: line, kind: 'line' });
    expect(pickAt(m, guides, [30, 40, 0])).toEqual({ id: point, kind: 'point' });
    expect(pickAt(m, guides, [-20, 80, 0], [0, 0])).toBeNull();
  });

  it('hidden guides, and guides behind a solid, are not picked', () => {
    const m = new Model();
    pushPull(m, drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 50);
    const guides = new Guides();
    guides.addLine([50, 50, 10], [0, 0, 1]); // a vertical guide running inside the box
    const top = findFaceAt(m, [50, 50, 50])!;
    // Cursor over the top face where the guide comes out: below the top it is inside the box.
    expect(pickAt(m, guides, [50, 50, 30], [0, 0], top)).toBeNull();
    // The same guide where it sticks out above the box is pickable.
    expect(pickAt(m, guides, [50, 50, 80], [0, 0])).not.toBeNull();
    guides.visible = false;
    expect(pickAt(new Model(), guides, [50, 50, 30])).toBeNull();
  });
});

describe('selecting, deleting, erasing guides', () => {
  const click = (H: ReturnType<typeof harness>, o: Parameters<typeof ev>[2]) => {
    const e = ev(H.doc, [0, 0, 0], o);
    H.controller.tool.pointerDown(e);
    H.controller.tool.pointerUp!(e, false);
  };

  it('click selects a guide; Shift adds and removes; Delete removes it and undo brings it back', () => {
    const H = harness();
    const a = H.doc.guides.addLine([0, 10, 0], [1, 0, 0]);
    const b = H.doc.guides.addPoint([5, 5, 5]);
    use(H.controller, 'select');
    click(H, { face: null, guide: { id: a, kind: 'line' } });
    expect([...H.controller.selection.guides]).toEqual([a]);
    expect(H.controller.hint()).toMatch(/1 guide/);
    click(H, { face: null, shift: true, guide: { id: b, kind: 'point' } });
    expect(H.controller.selection.guides.size).toBe(2);
    click(H, { face: null, shift: true, guide: { id: a, kind: 'line' } });
    expect([...H.controller.selection.guides]).toEqual([b]);
    H.controller.deleteSelection();
    expect(H.doc.guides.items.has(b)).toBe(false);
    expect(H.doc.guides.items.has(a)).toBe(true);
    H.controller.undo();
    expect(H.doc.guides.items.has(b)).toBe(true);
  });

  it('an edge under the cursor beats a guide line, but a guide point beats the edge', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    const edge = [...H.model.edges()][0];
    const line = H.doc.guides.addLine([0, 0, 0], [1, 0, 0]);
    const point = H.doc.guides.addPoint([5, 0, 0]);
    use(H.controller, 'select');
    click(H, { face: null, edge, guide: { id: line, kind: 'line' } });
    expect([...H.controller.selection.edges]).toEqual([edge]);
    expect(H.controller.selection.guides.size).toBe(0);
    click(H, { face: null, edge, guide: { id: point, kind: 'point' } });
    expect([...H.controller.selection.guides]).toEqual([point]);
  });

  it('hovering a guide highlights it', () => {
    const H = harness();
    const g = H.doc.guides.addLine([0, 10, 0], [1, 0, 0]);
    const t = use(H.controller, 'select');
    t.pointerMove(ev(H.doc, [0, 10, 0], { face: null, guide: { id: g, kind: 'line' } }));
    expect(t.preview().guides).toEqual([g]);
  });

  it('box selection: crossing takes guide lines it crosses, window takes guide points inside', () => {
    const H = harness();
    const line = H.doc.guides.addLine([0, 20, 0], [1, 0, 0]);
    const point = H.doc.guides.addPoint([5, 5, 0]);
    const t = use(H.controller, 'select');
    const box = (from: Vec3, to: Vec3) => {
      t.pointerDown(ev(H.doc, from, { face: null }));
      t.pointerMove(ev(H.doc, to, { face: null, down: true }));
      t.pointerUp!(ev(H.doc, to, { face: null }), true);
    };
    // Window (left → right) around the point; screen y = -world y.
    box([0, 30, 0], [10, 0, 0]);
    expect([...H.controller.selection.guides]).toEqual([point]);
    // Crossing (right → left) over both.
    box([10, 30, 0], [0, 0, 0]);
    expect([...H.controller.selection.guides].sort()).toEqual([line, point].sort());
  });

  it('the Eraser erases a guide it is clicked on (one undo step)', () => {
    const H = harness();
    const g = H.doc.guides.addLine([0, 10, 0], [1, 0, 0]);
    const t = use(H.controller, 'eraser');
    const e = ev(H.doc, [0, 10, 0], { face: null, guide: { id: g, kind: 'line' } });
    t.pointerMove(e);
    t.pointerDown(e);
    t.pointerUp!(e, false);
    expect(H.doc.guides.items.size).toBe(0);
    H.controller.undo();
    expect(H.doc.guides.items.size).toBe(1);
  });
});

describe('moving and rotating guides', () => {
  it('Move moves a selected guide by a typed vector', () => {
    const H = harness();
    const g = H.doc.guides.addLine([0, 10, 0], [1, 0, 0]);
    H.controller.selection.set([], [], [g]);
    use(H.controller, 'move');
    H.controller.tool.pointerDown(ev(H.doc, [0, 10, 0], { face: null }));
    H.controller.typed('0,25,5');
    const moved = H.doc.guides.items.get(g)!;
    expect(moved.kind === 'line' && moved.point).toEqual([0, 35, 5]);
  });

  it('with nothing selected, Move on a guide moves just that guide, not the object under it', () => {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 10);
    const top = findFaceAt(H.model, [50, 50, 10])!;
    const g = H.doc.guides.addLine([0, 50, 10], [1, 0, 0]); // lying on the top face
    use(H.controller, 'move');
    H.controller.tool.pointerDown(ev(H.doc, [50, 50, 10], { face: top, guide: { id: g, kind: 'line' } }));
    H.controller.typed('0,20,0');
    const moved = H.doc.guides.items.get(g)!;
    expect(moved.kind === 'line' && moved.point[1]).toBeCloseTo(70);
    expect(H.model.findVertex([0, 0, 0])).toBeDefined(); // the box did not move
  });

  it('Ctrl-copy and 3x make a row of guides', () => {
    const H = harness();
    const g = H.doc.guides.addPoint([0, 0, 0]);
    H.controller.selection.set([], [], [g]);
    use(H.controller, 'move');
    H.controller.toggleCopy();
    H.controller.tool.pointerDown(ev(H.doc, [0, 0, 0], { face: null }));
    H.controller.typed('10,0,0');
    H.controller.typed('3x');
    const xs = H.doc.guides.points().map((p) => p.pos[0]).sort((a, b) => a - b);
    expect(xs).toEqual([0, 10, 20, 30]);
  });

  it('Rotate turns a guide line about the axis', () => {
    const H = harness();
    const g = H.doc.guides.addLine([10, 0, 0], [1, 0, 0]);
    H.controller.selection.set([], [], [g]);
    use(H.controller, 'rotate');
    H.controller.toggleLock('z');
    H.controller.tool.pointerDown(ev(H.doc, [0, 0, 0], { face: null }));
    H.controller.tool.pointerMove(ev(H.doc, [20, 0, 0], { face: null }));
    H.controller.tool.pointerDown(ev(H.doc, [20, 0, 0], { face: null }));
    H.controller.typed('90');
    const r = H.doc.guides.items.get(g)!;
    if (r.kind !== 'line') throw new Error('expected a line');
    expect(r.point[0]).toBeCloseTo(0);
    expect(r.point[1]).toBeCloseTo(10);
    expect(Math.abs(r.dir[1])).toBeCloseTo(1);
  });
});
