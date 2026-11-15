import { beforeAll, describe, expect, it } from 'vitest';
import { drawCircle, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, Model, pushPull, sectionCut, type Vec3 } from '../src/core';
import { planeFrame } from '../src/core/ops/section';
import { ALL_PARTS, applyScene, captureScene, DEFAULT_STYLE, type CameraView, type DisplayStyle, type SceneView } from '../src/doc/Scenes';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { contextMenuItems, type MenuEntry } from '../src/tools/contextMenu';
import { sectionAt, sectionFrames } from '../src/tools/sectionPick';
import { rotation } from '../src/core/ops/transform';
import { rescaleDocument } from '../src/tools/TapeMeasureTool';
import { applyToTargets, targetsAt } from '../src/tools/targets';
import { ev, harness, sideRay, topDown, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A w × w × h box on the ground at the origin. */
function box(m: Model, w = 100, h = 100): void {
  const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], w, w).inner!;
  pushPull(m, f, m.face(f).normal[2] > 0 ? h : -h);
}

/** Area of filled triangles (three points each). */
function fillArea(pts: Vec3[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 3) {
    const [p, q, r] = [pts[i], pts[i + 1], pts[i + 2]];
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return a;
}

describe('cutting a model with a section plane', () => {
  it('a level cut through a box: its outline, filled', () => {
    const m = new Model();
    box(m);
    const cut = sectionCut(m, [0, 0, 50], [0, 0, 1]);
    expect(cut.segments).toHaveLength(4);
    expect(cut.loops).toBe(1);
    expect(cut.open).toBe(0);
    expect(fillArea(cut.fill)).toBeCloseTo(100 * 100, 6);
    for (const p of cut.fill) expect(p[2]).toBeCloseTo(50, 9);
  });

  it('an upright cut through a box with a hole shows the hole', () => {
    const m = new Model();
    box(m, 300, 100);
    const top = findFaceAt(m, [150, 150, 100])!;
    const hole = drawCircle(m, { ...GROUND_PLANE, origin: [0, 0, 100] }, [150, 150, 100], 50, 24, top).inner!;
    pushPull(m, hole, -100);
    // Across the middle of the hole, along red.
    const cut = sectionCut(m, [0, 150, 0], [0, 1, 0]);
    expect(cut.loops).toBe(2);
    expect(fillArea(cut.fill)).toBeCloseTo(300 * 100 - 100 * 100, 3);
  });

  it('a cut level with corners counts them once, and an open sheet gives lines only', () => {
    const m = new Model();
    box(m);
    // Through the bottom face's plane: the box's bottom outline.
    const bottom = sectionCut(m, [0, 0, 0], [0, 0, 1]);
    expect(bottom.loops).toBe(1);
    expect(fillArea(bottom.fill)).toBeCloseTo(1e4, 6);
    const sheet = new Model();
    drawRectangle(sheet, { ...GROUND_PLANE, origin: [0, 0, 0] }, [0, 0, 0], 100, 100);
    const across = sectionCut(sheet, [50, 0, 0], [1, 0, 0]);
    expect(across.segments).toHaveLength(1);
    expect(across.open).toBe(1);
    expect(across.fill).toHaveLength(0);
  });

  it('a section plane is drawn as a rectangle covering the model, on the plane', () => {
    const c = planeFrame([0, 0, 50], [0, 0, 1], [0, 0, 0], [100, 200, 100]);
    expect(c).toHaveLength(4);
    for (const p of c) expect(p[2]).toBeCloseTo(50, 9);
    const xs = c.map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(100);
  });
});

describe('the Section Plane tool and section commands', () => {
  function withBox() {
    const h = harness();
    box(h.model);
    return h;
  }

  it('clicking a face places a cut there; typing moves it, as one undo step', () => {
    const h = withBox();
    const tool = use(h.controller, 'section');
    expect(h.controller.hint()).toMatch(/Click a face to cut the model/);
    const top = findFaceAt(h.model, [50, 50, 100])!;
    tool.pointerMove(ev(h.doc, [50, 50, 100], { face: top }));
    expect(tool.preview().lines?.[0].points).toHaveLength(8);
    tool.pointerDown(ev(h.doc, [50, 50, 100], { face: top }));
    const s = h.doc.sections;
    expect(s.items.size).toBe(1);
    expect(s.activePlane()!.normal).toEqual([0, 0, 1]);
    expect(s.activePlane()!.point[2]).toBeCloseTo(100, 9);
    h.controller.typed('-40');
    expect(s.items.size).toBe(1);
    expect(s.activePlane()!.point[2]).toBeCloseTo(60, 9);
    expect(tool.vcbValue()).toMatch(/-40/);
    expect(h.controller.history.undoLabel).toBe('Section plane');
    h.controller.undo();
    expect(s.items.size).toBe(0);
    expect(s.active).toBeNull();
  });

  it('a click in empty space cuts level with the ground', () => {
    const h = harness();
    const tool = use(h.controller, 'section');
    tool.pointerDown(ev(h.doc, [500, 500, 0], { face: null }));
    expect(h.doc.sections.activePlane()!.normal).toEqual([0, 0, 1]);
  });

  it('Reverse, off and on, next, hide planes and delete; each says what to do with no plane', () => {
    const h = withBox();
    h.controller.toggleSectionCut();
    expect(h.controller.error).toMatch(/no section plane yet/);
    const tool = use(h.controller, 'section');
    tool.pointerDown(ev(h.doc, [50, 50, 100]));
    tool.pointerDown(ev(h.doc, [500, 500, 0], { face: null }));
    const s = h.doc.sections;
    const [first, second] = [...s.items.keys()];
    expect(s.active).toBe(second);
    h.controller.nextSection();
    expect(s.active).toBe(first);
    h.controller.reverseSection();
    expect(s.get(first)!.normal[2]).toBe(-1);
    h.controller.toggleSectionCut();
    expect(s.active).toBeNull();
    h.controller.toggleSectionCut();
    expect(s.active).toBe(second); // the newest, when none was cutting
    h.controller.toggleSectionPlanes();
    expect(s.visible).toBe(false);
    h.controller.deleteSection();
    expect(s.items.size).toBe(1);
    expect(s.active).toBeNull();
    h.controller.undo();
    expect(s.items.size).toBe(2);
  });

  it('the right-click menu has the section commands once there is a plane', () => {
    const h = withBox();
    const labels = (entries: MenuEntry[]): string[] => entries.flatMap((e) => (e === 'separator' ? [] : [e.label, ...labels(e.items ?? [])]));
    const host = { entityInfo: () => {}, mergeShapes: () => {} };
    expect(labels(contextMenuItems(h.controller, host))).not.toContain('Reverse Cut');
    use(h.controller, 'section').pointerDown(ev(h.doc, [50, 50, 100]));
    const items = labels(contextMenuItems(h.controller, host));
    expect(items).toEqual(expect.arrayContaining(['Section', 'Turn Cut Off', 'Reverse Cut', 'Hide Section Planes', 'Delete Section Plane']));
  });

  it('section planes and the active cut are saved; a scene remembers its cut', () => {
    const h = withBox();
    const tool = use(h.controller, 'section');
    tool.pointerDown(ev(h.doc, [50, 50, 100]));
    h.controller.typed('-50');
    const view: SceneView & { cam: CameraView; style: DisplayStyle } = {
      cam: { position: [1, 1, 1], target: [0, 0, 0], fov: 50, projection: 'perspective', height: 100 },
      style: { ...DEFAULT_STYLE },
      cameraView() {
        return this.cam;
      },
      setCameraView(v) {
        this.cam = v;
      },
      displayStyle() {
        return this.style;
      },
      setDisplayStyle(s) {
        this.style = s;
      },
    };
    const cut = h.doc.scenes.add({ name: 'Cut', parts: ALL_PARTS, ...captureScene(view, h.doc.groups, h.doc.guides, h.doc.sections) });
    h.doc.sections.active = null;
    const whole = h.doc.scenes.add({ name: 'Whole', parts: ALL_PARTS, ...captureScene(view, h.doc.groups, h.doc.guides, h.doc.sections) });
    const again = parseDocument(serializeDocument(h.doc));
    expect(again.sections.items.size).toBe(1);
    expect(again.sections.active).toBeNull();
    applyScene(again.scenes.get(cut)!, view, again.groups, again.guides, 0, again.sections);
    expect(again.sections.activePlane()!.point[2]).toBeCloseTo(50, 9);
    applyScene(again.scenes.get(whole)!, view, again.groups, again.guides, 0, again.sections);
    expect(again.sections.active).toBeNull();
  });

  describe('selecting and deleting a section plane', () => {
    /** A box with a level cut half way up; the cursor (top-down, 1 px per mm) on the middle of the plane's front side. */
    function cut() {
      const h = withBox();
      use(h.controller, 'section').pointerDown(ev(h.doc, [50, 50, 100]));
      h.controller.typed('-50');
      const id = h.doc.sections.active!;
      const c = sectionFrames(h.doc).get(id)!;
      const onOutline: Vec3 = [(c[0][0] + c[1][0]) / 2, c[0][1], 50];
      return { ...h, id, onOutline };
    }
    const at = (h: ReturnType<typeof cut>, p: Vec3) => ({ ...ev(h.doc, p, { face: null }), section: sectionAt(h.doc, topDown, topDown.toScreen(p)!) });

    it('the outline under the cursor is found; inside the plane, or with planes hidden, nothing is', () => {
      const h = cut();
      expect(sectionAt(h.doc, topDown, topDown.toScreen(h.onOutline)!)).toBe(h.id);
      expect(sectionAt(h.doc, topDown, [50, -50])).toBeNull();
      h.doc.sections.visible = false;
      expect(sectionAt(h.doc, topDown, topDown.toScreen(h.onOutline)!)).toBeNull();
    });

    it('Select: click its outline to select it (highlighted on hover), then Delete removes it', () => {
      const h = cut();
      const tool = use(h.controller, 'select');
      tool.pointerMove(at(h, h.onOutline));
      expect(tool.preview().sections).toEqual([h.id]);
      tool.pointerDown(at(h, h.onOutline));
      tool.pointerUp!(at(h, h.onOutline), false);
      expect([...h.controller.selection.sections]).toEqual([h.id]);
      expect(h.controller.hint()).toBe('Selected: 1 section plane. Delete erases, Esc clears. Move or the Section Plane tool moves it.');
      h.controller.deleteSelection();
      expect(h.doc.sections.items.size).toBe(0);
      expect(h.doc.sections.active).toBeNull();
      expect(h.controller.history.undoLabel).toBe('Erase');
      h.controller.undo();
      expect(h.doc.sections.items.size).toBe(1);
    });

    it('the Eraser erases a plane it is clicked on', () => {
      const h = cut();
      const tool = use(h.controller, 'eraser');
      tool.pointerMove(at(h, h.onOutline));
      expect(tool.preview().sections).toEqual([h.id]);
      tool.pointerDown(at(h, h.onOutline));
      tool.pointerUp!(at(h, h.onOutline), false);
      expect(h.doc.sections.items.size).toBe(0);
    });

    it('right-clicking the outline selects that plane, and the menu acts on it (Erase or Delete Section Plane)', () => {
      const h = cut();
      // A second, upright plane (the newest and the active one).
      h.controller.editDocument('Section plane', () => (h.doc.sections.active = h.doc.sections.add([0, 0, 0], [1, 0, 0])));
      expect(h.doc.sections.active).not.toBe(h.id);
      h.controller.contextPick({ screen: topDown.toScreen(h.onOutline)!, ray: { origin: [h.onOutline[0], h.onOutline[1], 1000], dir: [0, 0, -1] }, faceHit: null, edge: null, shift: false, ctrl: false, down: false });
      expect([...h.controller.selection.sections]).toEqual([h.id]);
      h.controller.deleteSection();
      expect(h.doc.sections.items.has(h.id)).toBe(false);
      expect(h.doc.sections.items.size).toBe(1);
    });
  });

  describe('moving a section plane', () => {
    /** The level cut at z = 50 from above, and an event on its outline seen from the side, at height z. */
    function cut() {
      const h = withBox();
      use(h.controller, 'section').pointerDown(ev(h.doc, [50, 50, 100]));
      h.controller.typed('-50');
      const id = h.doc.sections.active!;
      const c = sectionFrames(h.doc).get(id)!;
      const x = (c[0][0] + c[1][0]) / 2;
      const y = c[0][1];
      const side = (z: number, o: Parameters<typeof ev>[2] = {}) => ({ ...ev(h.doc, [x, y, z], { face: null, ray: sideRay([x, y, z]), ...o }), section: z === 50 ? id : null });
      return { ...h, id, side, z: () => h.doc.sections.get(id)!.point[2] };
    }

    it('the Section Plane tool drags a plane by its outline along its direction, as one undo step', () => {
      const h = cut();
      const tool = use(h.controller, 'section');
      tool.pointerMove(h.side(50));
      expect(tool.preview().sections).toEqual([h.id]);
      expect(h.controller.hint()).toMatch(/Drag the outline/);
      tool.pointerDown(h.side(50, { down: true }));
      tool.pointerMove(h.side(80, { down: true }));
      expect(tool.vcbValue()).toMatch(/30/);
      // The view cuts at the plane's new place while it is dragged.
      const live = tool.preview().sectionMove!;
      expect(live.id).toBe(h.id);
      expect(live.point[2]).toBeCloseTo(80, 9);
      expect(live.normal).toEqual([0, 0, 1]);
      expect(h.z()).toBeCloseTo(50, 9); // nothing changes until it is let go
      tool.pointerUp!(h.side(80), true);
      expect(h.z()).toBeCloseTo(80, 9);
      expect(h.doc.sections.items.size).toBe(1);
      expect(h.controller.history.undoLabel).toBe('Move section plane');
      // Typing straight after changes the move.
      h.controller.typed('10');
      expect(h.z()).toBeCloseTo(60, 9);
      h.controller.undo();
      expect(h.z()).toBeCloseTo(50, 9);
    });

    it('click, move, click works too; it snaps to the model\'s points; typing while moving sets the distance; Esc puts it back', () => {
      const h = cut();
      const tool = use(h.controller, 'section');
      const snapTop = { kind: 'endpoint' as const, snap: { point: [0, 0, 100] as Vec3 } };
      tool.pointerDown(h.side(50));
      tool.pointerUp!(h.side(50), false);
      tool.pointerMove(h.side(70, snapTop));
      expect(tool.vcbValue()).toMatch(/50/);
      tool.pointerDown(h.side(70, snapTop));
      expect(h.z()).toBeCloseTo(100, 9);
      h.controller.undo();
      expect(h.z()).toBeCloseTo(50, 9);

      tool.pointerDown(h.side(50));
      h.controller.typed('-20');
      expect(h.z()).toBeCloseTo(30, 9);
      h.controller.undo();

      tool.pointerDown(h.side(50));
      tool.pointerMove(h.side(90));
      h.controller.escape();
      expect(h.z()).toBeCloseTo(50, 9);
      expect(h.doc.sections.items.size).toBe(1);
    });

    it('the Move tool moves a selected plane, or the one it starts on; with Ctrl it makes a copy', () => {
      const h = cut();
      h.controller.selection.toggleSection(h.id, false);
      const move = use(h.controller, 'move');
      move.pointerDown(h.side(50));
      expect(move.preview().lines?.length).toBeUndefined();
      expect(h.controller.hint()).toMatch(/straight along its direction/);
      move.pointerMove(h.side(75));
      expect(move.preview().lines?.[0].points.length).toBe(8);
      expect(move.preview().sectionMove?.point[2]).toBeCloseTo(75, 9); // the cut follows the mouse
      move.pointerDown(h.side(75));
      expect(h.z()).toBeCloseTo(75, 9);

      h.controller.selection.clear();
      const m2 = use(h.controller, 'move');
      m2.toggleCopy!();
      m2.pointerDown(h.side(50));
      m2.pointerMove(h.side(-25));
      expect(m2.preview().sectionMove).toBeUndefined(); // a copy: the original keeps cutting
      m2.pointerDown(h.side(-25));
      expect(h.doc.sections.items.size).toBe(2);
      const copy = [...h.doc.sections.items.values()].find((s) => s.id !== h.id)!;
      expect(copy.point[2]).toBeCloseTo(0, 9);
      expect(copy.normal).toEqual([0, 0, 1]);
    });

    it('Move takes a plane up into the cut-away side, where the cursor only finds the ground beyond', () => {
      const h = cut();
      h.controller.selection.toggleSection(h.id, false);
      const move = use(h.controller, 'move');
      move.pointerDown(h.side(50));
      // Above the cut nothing can be picked: the snap is the ground far behind, the ray passes at z = 90.
      const up = h.side(90, { kind: 'ground', snap: { point: [0, 5000, 0] } });
      move.pointerMove(up);
      expect(move.vcbValue()).toMatch(/40/);
      move.pointerDown(up);
      expect(h.z()).toBeCloseTo(90, 9);
      expect(h.doc.sections.get(h.id)!.point[1]).toBeCloseTo(50, 9); // straight up, not off to the side
      // A typed distance goes along the plane's direction too.
      h.controller.typed('-20');
      expect(h.z()).toBeCloseTo(30, 9);
    });

    it('Rotate turns a plane and its direction; rescaling the design moves planes with it', () => {
      const h = cut();
      h.controller.selection.toggleSection(h.id, false);
      h.controller.editDocument('Rotate', () => applyToTargets(h.doc, targetsAt(h.ctx, ev(h.doc, [0, 0, 0])), [rotation([0, 0, 50], [1, 0, 0], Math.PI / 2)], false));
      const p = h.doc.sections.get(h.id)!;
      expect(p.normal[1]).toBeCloseTo(-1, 9);
      expect(p.normal[2]).toBeCloseTo(0, 9);
      const before = [...p.point];
      rescaleDocument(h.doc, 2);
      expect(p.point).toEqual(before.map((v) => v * 2));
    });

    it('the tool has tips that say how to move and remove planes', () => {
      const h = withBox();
      const tips = use(h.controller, 'section').tips!();
      expect(tips.label).toBe('Section tips');
      expect(tips.text).toMatch(/Moving a cut/);
      expect(tips.text).toMatch(/press Delete/);
    });
  });
});
