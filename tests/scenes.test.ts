import { describe, expect, it } from 'vitest';
import { drawRectangle, GROUND_PLANE, Model } from '../src/core';
import { Document } from '../src/doc/Document';
import { DEFAULT_STYLE, Scenes, type CameraView, type DisplayStyle, type SceneView } from '../src/doc/Scenes';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { harness } from './helpers/tools';

/** A stand-in viewport: remembers the camera and style it was given. */
class FakeView implements SceneView {
  cam: CameraView = { position: [1000, -1000, 800], target: [0, 0, 0], fov: 35, projection: 'perspective', height: 1000 };
  st: DisplayStyle = { ...DEFAULT_STYLE };
  lastSeconds = -1;
  cameraView() {
    return { ...this.cam };
  }
  setCameraView(v: CameraView, seconds: number) {
    this.cam = { ...v };
    this.lastSeconds = seconds;
  }
  displayStyle() {
    return { ...this.st };
  }
  setDisplayStyle(s: DisplayStyle) {
    this.st = { ...s };
  }
}

/** A harness with a fake view and two groups. */
function setup() {
  const h = harness();
  const view = new FakeView();
  h.controller.sceneView = view;
  const a = new Model();
  drawRectangle(a, GROUND_PLANE, [0, 0, 0], 100, 100);
  const b = new Model();
  drawRectangle(b, GROUND_PLANE, [300, 0, 0], 100, 100);
  const ga = h.doc.groups.add(a, null);
  const gb = h.doc.groups.add(b, null);
  return { ...h, view, ga, gb };
}

describe('scenes', () => {
  it('a new scene captures camera, style and hidden groups, named in order, as one undo step', () => {
    const h = setup();
    h.doc.groups.get(h.gb)!.hidden = true;
    h.view.st.faces = 'xray';
    const id = h.controller.addScene()!;
    const s = h.doc.scenes.get(id)!;
    expect(s.name).toBe('Scene 1');
    expect(s.camera.position).toEqual([1000, -1000, 800]);
    expect(s.style.faces).toBe('xray');
    expect(s.hidden).toEqual([h.gb]);
    expect(h.controller.history.undoLabel).toBe('Add scene');
    expect(h.doc.scenes.get(h.controller.addScene()!)!.name).toBe('Scene 2');
    h.controller.undo();
    expect(h.doc.scenes.items).toHaveLength(1);
  });

  it('going to a scene restores everything it saves; the camera glides for the transition time', () => {
    const h = setup();
    h.doc.scenes.transition = 2.5;
    const id = h.controller.addScene()!;
    // Change the view, then go back.
    h.view.cam = { ...h.view.cam, position: [0, 0, 5000], projection: 'parallel' };
    h.view.st = { ...h.view.st, faces: 'wireframe', background: '#000000' };
    h.doc.groups.get(h.ga)!.hidden = true;
    h.doc.guides.visible = false;
    h.controller.goToScene(id);
    expect(h.view.cam.position).toEqual([1000, -1000, 800]);
    expect(h.view.cam.projection).toBe('perspective');
    expect(h.view.lastSeconds).toBe(2.5);
    expect(h.view.st.faces).toBe('textured');
    expect(h.view.st.background).toBe('#d8dadd');
    expect(h.doc.groups.get(h.ga)!.hidden).toBeUndefined();
    expect(h.doc.guides.visible).toBe(true);
    expect(h.controller.currentScene).toBe(id);
    // Showing a scene is not an undo step.
    expect(h.controller.history.undoLabel).toBe('Add scene');
  });

  it('a scene restores only the parts ticked for it', () => {
    const h = setup();
    const id = h.controller.addScene()!;
    h.controller.setSceneParts(id, { camera: false, hidden: false });
    h.view.cam = { ...h.view.cam, position: [0, 0, 5000] };
    h.view.st = { ...h.view.st, faces: 'shaded' };
    h.doc.groups.get(h.ga)!.hidden = true;
    h.controller.goToScene(id);
    expect(h.view.cam.position).toEqual([0, 0, 5000]);
    expect(h.doc.groups.get(h.ga)!.hidden).toBe(true);
    expect(h.view.st.faces).toBe('textured');
  });

  it('update overwrites the view but keeps the name, place and ticked parts', () => {
    const h = setup();
    const a = h.controller.addScene()!;
    h.controller.addScene();
    h.controller.renameScene(a, 'Front porch');
    h.controller.setSceneParts(a, { hidden: false });
    h.view.cam = { ...h.view.cam, position: [1, 2, 3] };
    h.controller.updateScene(a);
    const s = h.doc.scenes.get(a)!;
    expect(s.camera.position).toEqual([1, 2, 3]);
    expect(s.name).toBe('Front porch');
    expect(s.parts.hidden).toBe(false);
    expect(h.doc.scenes.indexOf(a)).toBe(0);
  });

  it('reorder, delete, and step through scenes (wrapping round)', () => {
    const h = setup();
    const [a, b, c] = [h.controller.addScene()!, h.controller.addScene()!, h.controller.addScene()!];
    h.controller.moveScene(c, 0);
    expect(h.doc.scenes.items.map((s) => s.id)).toEqual([c, a, b]);
    h.controller.goToScene(b);
    h.controller.stepScene(1);
    expect(h.controller.currentScene).toBe(c);
    h.controller.stepScene(-1);
    expect(h.controller.currentScene).toBe(b);
    h.controller.deleteScene(b);
    expect(h.controller.currentScene).toBeNull();
    expect(h.doc.scenes.items.map((s) => s.id)).toEqual([c, a]);
    expect(() => h.doc.scenes.update(a, { name: '  ' })).toThrow(/name/);
  });

  it('bad timings are refused', () => {
    const h = setup();
    h.controller.setSceneTimings(-1, 2);
    expect(h.controller.error).toMatch(/seconds/);
    h.controller.setSceneTimings(0.5, 3);
    expect([h.doc.scenes.transition, h.doc.scenes.delay]).toEqual([0.5, 3]);
  });
});

describe('hiding groups', () => {
  it('hide the selected groups and unhide all, undoably; hidden groups cannot stay selected', () => {
    const h = setup();
    h.controller.selection.set([], [], [], [h.ga]);
    h.controller.hideSelection();
    expect(h.doc.groups.get(h.ga)!.hidden).toBe(true);
    expect(h.controller.selection.groups.size).toBe(0);
    h.controller.selectAll();
    expect([...h.controller.selection.groups]).toEqual([h.gb]);
    h.controller.unhideAll();
    expect(h.doc.groups.get(h.ga)!.hidden).toBeUndefined();
    h.controller.undo();
    expect(h.doc.groups.get(h.ga)!.hidden).toBe(true);
  });

  it('a group inside a hidden group counts as hidden', () => {
    const h = setup();
    const inner = h.doc.groups.add(new Model(), h.ga);
    h.doc.groups.get(h.ga)!.hidden = true;
    expect(h.doc.groups.isHidden(inner)).toBe(true);
    expect(h.doc.groups.isHidden(h.gb)).toBe(false);
  });
});

describe('saving scenes', () => {
  it('scenes, their settings and hidden groups are saved and opened again', () => {
    const doc = new Document();
    const g = doc.groups.add(new Model(), null);
    doc.groups.get(g)!.hidden = true;
    doc.scenes.transition = 0.25;
    doc.scenes.delay = 4;
    const id = doc.scenes.add({
      name: 'Plan',
      parts: { camera: true, hidden: false, style: true },
      camera: { position: [0, 0, 9000], target: [0, 0, 0], fov: 40, projection: 'parallel', height: 3000 },
      hidden: [g],
      style: { faces: 'xray', backEdges: true, guides: false, background: '#ffffff' },
    });
    const back = parseDocument(serializeDocument(doc));
    expect(back.scenes.get(id)).toEqual(doc.scenes.get(id));
    expect([back.scenes.transition, back.scenes.delay]).toEqual([0.25, 4]);
    expect(back.groups.get(g)!.hidden).toBe(true);
    expect(back.scenes.add({ ...doc.scenes.get(id)!, name: 'x' })).toBeGreaterThan(id);
  });

  it('scenes copy independently (undo snapshots are not shared)', () => {
    const s = new Scenes();
    const id = s.add({ name: 'A', parts: { camera: true, hidden: true, style: true }, camera: { position: [0, 0, 0], target: [1, 0, 0], fov: 35, projection: 'perspective', height: 1 }, hidden: [], style: { ...DEFAULT_STYLE } });
    const c = s.clone();
    c.get(id)!.camera.position = [99, 0, 0];
    c.get(id)!.parts.camera = false;
    expect(s.get(id)!.camera.position[0]).toBe(0);
    expect(s.get(id)!.parts.camera).toBe(true);
  });
});
