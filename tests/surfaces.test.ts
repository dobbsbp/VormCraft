import { beforeAll, describe, expect, it } from 'vitest';
import { drawCircle, drawRectangle, findFaceAt, GROUND_PLANE, initBooleanKernel, pushPull, smoothSurface, surfaceOutline, type FaceId } from '../src/core';
import { ev, harness, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A cylinder r = 10, h = 20, 24 facets, standing on the ground at the origin. */
function cylinderH() {
  const H = harness();
  pushPull(H.model, drawCircle(H.model, GROUND_PLANE, [0, 0, 0], 10, 24).inner!, 20);
  const wall = [...H.model.faces.values()].find((f) => Math.abs(f.normal[2]) < 0.1)!.id;
  return { H, wall };
}

describe('smooth surfaces', () => {
  it('a cylinder wall facet belongs to a 24-facet surface; caps and box faces stand alone', () => {
    const { H, wall } = cylinderH();
    expect(smoothSurface(H.model, wall)).toHaveLength(24);
    const top = findFaceAt(H.model, [0, 0, 20])!;
    expect(smoothSurface(H.model, top)).toEqual([top]);
    const B = harness();
    pushPull(B.model, drawRectangle(B.model, GROUND_PLANE, [0, 0, 0], 10, 10).inner!, 10);
    const side = findFaceAt(B.model, [5, 0, 5])!;
    expect(smoothSurface(B.model, side)).toEqual([side]);
  });

  it('the wall of a hole through a box is one surface, separate from the box faces', () => {
    const H = harness();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 100, 100).inner!, 20);
    const top = findFaceAt(H.model, [1, 1, 20])!;
    pushPull(H.model, drawCircle(H.model, H.model.facePlane(top), [50, 50, 20], 10, 16, top).inner!, -20);
    const wall = [...H.model.faces.values()].find((f) => Math.abs(f.normal[2]) < 0.1 && Math.hypot(f.normal[0], f.normal[1]) > 0.99 && Math.abs(Math.abs(f.normal[0]) - 1) > 1e-6 && Math.abs(Math.abs(f.normal[1]) - 1) > 1e-6)!.id;
    const surface = smoothSurface(H.model, wall);
    expect(surface).toHaveLength(16);
    expect(surface).not.toContain(top);
  });

  it('the outline of a cylinder wall is its two rims, without the seams', () => {
    const { H, wall } = cylinderH();
    const outline = surfaceOutline(H.model, smoothSurface(H.model, wall));
    expect(outline).toHaveLength(48);
    expect(outline.every((e) => H.model.he(e).curve !== null)).toBe(true);
  });
});

describe('Select tool on curved surfaces', () => {
  const clickFace = (H: ReturnType<typeof harness>, face: FaceId, shift = false) => {
    const t = H.controller.tool;
    const e = ev(H.doc, [0, 0, 0], { face, shift });
    t.pointerDown(e);
    t.pointerUp!(e, false);
  };

  it('clicking one facet selects the whole wall; hover highlights the whole wall', () => {
    const { H, wall } = cylinderH();
    const t = use(H.controller, 'select');
    t.pointerMove(ev(H.doc, [10, 0, 10], { face: wall }));
    expect(t.preview().faces).toHaveLength(24);
    clickFace(H, wall);
    expect(H.controller.selection.faces.size).toBe(24);
  });

  it('Shift-click adds and removes the wall as one unit', () => {
    const { H, wall } = cylinderH();
    use(H.controller, 'select');
    const top = findFaceAt(H.model, [0, 0, 20])!;
    clickFace(H, top);
    clickFace(H, wall, true);
    expect(H.controller.selection.faces.size).toBe(25);
    clickFace(H, wall, true);
    expect([...H.controller.selection.faces]).toEqual([top]);
  });

  it('double-click selects the wall and its rims, not the hidden seams', () => {
    const { H, wall } = cylinderH();
    const t = use(H.controller, 'select');
    t.doubleClick!(ev(H.doc, [10, 0, 10], { face: wall }));
    expect(H.controller.selection.faces.size).toBe(24);
    expect(H.controller.selection.edges.size).toBe(48);
  });
});

describe('Lasso Select', () => {
  /** Drive the lasso with a closed loop of screen points (top-down projector: screen = (x, -y)). */
  function lasso(H: ReturnType<typeof harness>, loop: [number, number][]) {
    const t = use(H.controller, 'lasso');
    const at = (p: [number, number], down: boolean) => ev(H.doc, [p[0], -p[1], 0], { face: null, down });
    t.pointerDown(at(loop[0], true));
    for (const p of [...loop.slice(1), loop[0]]) t.pointerMove(at(p, true));
    // The loop closes where it started: the controller would call this a click (not dragged).
    t.pointerUp!(at(loop[0], false), false);
  }

  it('a clockwise loop that ends where it started selects what is fully inside (regression)', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    drawRectangle(H.model, GROUND_PLANE, [100, 0, 0], 10, 10);
    // Screen y is down: (x, -y). Clockwise on screen around the first square.
    lasso(H, [
      [-5, -15],
      [15, -15],
      [15, 5],
      [-5, 5],
    ]);
    expect(H.controller.selection.faces.size).toBe(1);
    expect(H.controller.selection.edges.size).toBe(4);
  });

  it('a counter-clockwise loop also takes what it touches', () => {
    const H = harness();
    drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 10);
    drawRectangle(H.model, GROUND_PLANE, [100, 0, 0], 10, 10);
    lasso(H, [
      [-5, 5],
      [105, 5],
      [105, -5],
      [-5, -5],
    ]);
    expect(H.controller.selection.faces.size).toBe(2);
  });
});
