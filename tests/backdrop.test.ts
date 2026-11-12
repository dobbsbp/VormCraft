import { describe, expect, it } from 'vitest';
import { BACKDROP_PRESETS, DEFAULT_BACKDROP, GROUND_KINDS, sameBackdrop, validBackdrop, type Backdrop } from '../src/doc/Backdrop';
import { Document } from '../src/doc/Document';
import { ALL_PARTS, applyScene, captureScene, DEFAULT_STYLE, type DisplayStyle, type SceneView } from '../src/doc/Scenes';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';

const clouds: Backdrop = { on: true, sky: 'clouds', skyColor: '#112233', horizonColor: '#445566', ground: 'grass', groundColor: '#778899' };

/** A view that only keeps its style (enough for applying scenes). */
function styleView(start: DisplayStyle): SceneView & { style: DisplayStyle } {
  const v = {
    style: { ...start },
    displayStyle: () => ({ ...v.style }),
    setDisplayStyle: (s: DisplayStyle) => {
      v.style = { ...v.style, ...Object.fromEntries(Object.entries(s).filter(([, x]) => x !== undefined)) };
    },
    cameraView: () => ({ position: [0, 0, 0], target: [0, 0, 1], fov: 50, projection: 'perspective', height: 1 }),
    setCameraView: () => {},
  };
  return v as unknown as SceneView & { style: DisplayStyle };
}

describe('sky and ground', () => {
  it('the default and every preset are valid; presets are few', () => {
    expect(validBackdrop(DEFAULT_BACKDROP)).toEqual(DEFAULT_BACKDROP);
    expect(DEFAULT_BACKDROP.on).toBe(true);
    for (const p of BACKDROP_PRESETS) expect(validBackdrop(p.backdrop)).toEqual(p.backdrop);
    expect(BACKDROP_PRESETS.length).toBeLessThanOrEqual(4);
    expect(BACKDROP_PRESETS.some((p) => !p.backdrop.on)).toBe(true);
    for (const g of GROUND_KINDS) expect(g.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('only known kinds and proper colours are accepted', () => {
    expect(validBackdrop({ ...clouds, sky: 'stars' })).toBeUndefined();
    expect(validBackdrop({ ...clouds, ground: 'lava' })).toBeUndefined();
    expect(validBackdrop({ ...clouds, skyColor: 'blue' })).toBeUndefined();
    expect(validBackdrop({ ...clouds, on: 'yes' })).toBeUndefined();
    expect(validBackdrop(null)).toBeUndefined();
    expect(validBackdrop({ ...clouds, extra: 1 })).toEqual(clouds);
    expect(sameBackdrop(clouds, { ...clouds })).toBe(true);
    expect(sameBackdrop(clouds, DEFAULT_BACKDROP)).toBe(false);
  });

  it('a scene keeps its own sky and ground through saving; a damaged one is dropped', () => {
    const doc = new Document();
    const view = styleView({ ...DEFAULT_STYLE, backdrop: clouds });
    doc.scenes.add({ name: 'Evening', parts: ALL_PARTS, ...captureScene(view, doc.groups, doc.guides) });
    const again = parseDocument(serializeDocument(doc));
    expect(again.scenes.items[0].style.backdrop).toEqual(clouds);
    const text = JSON.parse(serializeDocument(doc));
    text.scenes.items[0].style.backdrop = { on: true, sky: 'stars' };
    expect(parseDocument(JSON.stringify(text)).scenes.items[0].style.backdrop).toBeUndefined();
  });

  it('going to a scene shows its sky and ground; a scene from before them leaves the view as it is', () => {
    const doc = new Document();
    const view = styleView({ ...DEFAULT_STYLE, backdrop: clouds });
    doc.scenes.add({ name: 'With', parts: ALL_PARTS, ...captureScene(view, doc.groups, doc.guides) });
    const old = doc.scenes.add({ name: 'Old', parts: ALL_PARTS, ...captureScene(view, doc.groups, doc.guides) });
    delete doc.scenes.get(old)!.style.backdrop;
    view.style.backdrop = DEFAULT_BACKDROP;
    applyScene(doc.scenes.items[0], view, doc.groups, doc.guides, 0);
    expect(view.style.backdrop).toEqual(clouds);
    view.style.backdrop = DEFAULT_BACKDROP;
    applyScene(doc.scenes.get(old)!, view, doc.groups, doc.guides, 0);
    expect(view.style.backdrop).toEqual(DEFAULT_BACKDROP);
  });
});
