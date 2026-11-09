import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkWatertight, distance, drawRectangle, GROUND_PLANE, initBooleanKernel, pushPull, volume, type Vec3 } from '../src/core';
import { drawEdges } from '../src/core/ops/edges';
import { isPoint, pointCopies } from '../src/core/ops/points';
import type { Model } from '../src/core/model/Model';
import { Document } from '../src/doc/Document';
import { ToolController } from '../src/tools/ToolController';
import { Navigator } from '../src/view/navigation';
import { cameraProjector } from '../src/view/projector';
import { ev, harness, topDown, use } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

type H = ReturnType<typeof harness>;

/** A 10 x 20 x 30 box. */
function boxH(): H {
  const H = harness();
  pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [0, 0, 0], 10, 20).inner!, 30);
  return H;
}

const vertexAt = (m: Model, p: Vec3) => [...m.vertices.values()].find((v) => distance(v.pos, p) < 1e-6)?.id;
const hasVertex = (m: Model, p: Vec3) => vertexAt(m, p) !== undefined;
/** A half-edge from a to b. */
const edgeAt = (m: Model, a: Vec3, b: Vec3) => [...m.halfEdges.values()].find((h) => distance(m.pos(h.origin), a) < 1e-6 && distance(m.pos(m.dest(h.id)), b) < 1e-6)!.id;

/** A click with the Select tool, the cursor at `p` (top-down: 1 px per mm) over `edge`. */
function selectClick(H: H, p: Vec3, edge: number | null, shift = false) {
  const tool = H.controller.tool;
  const e = ev(H.doc, p, { edge, shift, face: null });
  tool.pointerMove(e);
  tool.pointerDown(e);
  tool.pointerUp!(e, false);
}

const sample = (p: Vec3) => ({ screen: topDown.toScreen(p)!, ray: { origin: [p[0], p[1], p[2] + 1000] as Vec3, dir: [0, 0, -1] as Vec3 }, faceHit: null, edge: null, shift: false, ctrl: false, down: false });

describe('Points', () => {
  it('a point is where two or more lines meet; the loose end of one line is not', () => {
    const H = boxH();
    expect(isPoint(H.model, vertexAt(H.model, [10, 20, 30])!)).toBe(true);
    drawEdges(H.model, [[50, 0, 0], [60, 0, 0]]);
    expect(isPoint(H.model, vertexAt(H.model, [60, 0, 0])!)).toBe(false);
    drawEdges(H.model, [[60, 0, 0], [60, 10, 0]]);
    expect(isPoint(H.model, vertexAt(H.model, [60, 0, 0])!)).toBe(true);
    expect(isPoint(H.model, vertexAt(H.model, [60, 10, 0])!)).toBe(false);
  });

  it('clicking near a corner selects the point; the middle of an edge still selects the edge; Shift adds and removes', () => {
    const H = boxH();
    use(H.controller, 'select');
    const top = edgeAt(H.model, [0, 20, 30], [10, 20, 30]);
    const corner = vertexAt(H.model, [10, 20, 30])!;
    selectClick(H, [8, 20, 30], top); // 2 px from the corner
    expect([...H.controller.selection.points]).toEqual([corner]);
    expect(H.controller.selection.edges.size).toBe(0);
    expect(H.controller.hint()).toMatch(/1 point/);
    selectClick(H, [10, 10, 30], edgeAt(H.model, [10, 0, 30], [10, 20, 30]));
    expect(H.controller.selection.points.size).toBe(0);
    expect(H.controller.selection.edges.size).toBe(1);
    selectClick(H, [10, 19, 30], edgeAt(H.model, [10, 0, 30], [10, 20, 30]));
    selectClick(H, [0, 1, 30], edgeAt(H.model, [0, 0, 30], [0, 20, 30]), true);
    expect(H.controller.selection.points.size).toBe(2);
    selectClick(H, [10, 19, 30], edgeAt(H.model, [10, 0, 30], [10, 20, 30]), true);
    expect([...H.controller.selection.points]).toEqual([vertexAt(H.model, [0, 0, 30])]);
  });

  it('with a real camera at an angle: a few pixels from the corner picks it; farther along the edge picks the edge', () => {
    const viewport = { width: 800, height: 600 };
    const cam = new THREE.PerspectiveCamera(35, viewport.width / viewport.height, 0.1, 1e5);
    cam.position.set(-150, -250, 200);
    new Navigator(cam).lookAt(new THREE.Vector3(5, 10, 15));
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const proj = cameraProjector(cam, viewport);
    const doc = new Document();
    pushPull(doc.model, drawRectangle(doc.model, GROUND_PLANE, [0, 0, 0], 10, 20).inner!, 30);
    const controller = new ToolController(doc, () => proj);
    controller.setTool('select');
    const edge = edgeAt(doc.model, [0, 0, 30], [10, 0, 30]);
    const at = (p: Vec3, nudge: [number, number]) => {
      const s = proj.toScreen(p)!;
      const e = { ...ev(doc, p, { edge, face: null }), screen: [s[0] + nudge[0], s[1] + nudge[1]] as [number, number] };
      controller.tool.pointerDown(e);
      controller.tool.pointerUp!(e, false);
    };
    at([10, 0, 30], [3, -2]);
    expect([...controller.selection.points]).toEqual([vertexAt(doc.model, [10, 0, 30])]);
    at([5, 0, 30], [0, 0]);
    expect(controller.selection.points.size).toBe(0);
    expect(controller.selection.edges.size).toBe(1);
  });

  it('the loose end of a single line selects the line', () => {
    const H = harness();
    drawEdges(H.model, [[0, 0, 0], [50, 0, 0]]);
    use(H.controller, 'select');
    selectClick(H, [49, 0, 0], edgeAt(H.model, [0, 0, 0], [50, 0, 0]));
    expect(H.controller.selection.points.size).toBe(0);
    expect(H.controller.selection.edges.size).toBe(1);
  });

  it('moving a selected corner up stretches and folds the faces around it; undo puts it back', () => {
    const H = boxH();
    H.controller.selection.set([], [], [], [], [vertexAt(H.model, [10, 20, 30])!]);
    use(H.controller, 'move');
    H.controller.tool.pointerDown(ev(H.doc, [10, 20, 30], { kind: 'endpoint', face: null }));
    H.controller.tool.pointerMove(ev(H.doc, [10, 20, 31], { face: null }));
    H.controller.typed('5');
    expect(hasVertex(H.model, [10, 20, 35])).toBe(true);
    for (const p of [[0, 0, 30], [10, 0, 30], [0, 20, 30]] as Vec3[]) expect(hasVertex(H.model, p)).toBe(true);
    expect(checkWatertight(H.model).watertight).toBe(true);
    expect(volume(H.model)).toBeCloseTo(6000 + (0.5 * 10 * 20 * 5) / 3);
    // The point stays selected for another move.
    expect(H.controller.selection.points.size).toBe(1);
    H.controller.typed('0,0,-10');
    expect(hasVertex(H.model, [10, 20, 20])).toBe(true);
    H.controller.undo();
    expect(hasVertex(H.model, [10, 20, 30])).toBe(true);
    expect(volume(H.model)).toBeCloseTo(6000);
  });

  it('an arrow key holds the move on an axis, wherever the mouse goes', () => {
    const H = boxH();
    H.controller.selection.set([], [], [], [], [vertexAt(H.model, [10, 20, 30])!]);
    use(H.controller, 'move');
    H.controller.pointerDown(sample([10, 20, 30]));
    H.controller.toggleLock('x');
    expect(H.controller.lock).toBe('x');
    // The cursor wanders off the red line (y 26); the point stays on it.
    H.controller.pointerMove(sample([17, 26, 30]));
    H.controller.pointerDown(sample([17, 26, 30]));
    expect(hasVertex(H.model, [17, 20, 30])).toBe(true);
    expect(hasVertex(H.model, [10, 20, 30])).toBe(false);
    expect(hasVertex(H.model, [10, 0, 30])).toBe(true);
    expect(checkWatertight(H.model).watertight).toBe(true);
  });

  it('a move that would fold a face over onto itself is refused and changes nothing', () => {
    const H = boxH();
    H.controller.selection.set([], [], [], [], [vertexAt(H.model, [10, 20, 30])!]);
    use(H.controller, 'move');
    H.controller.tool.pointerDown(ev(H.doc, [10, 20, 30], { kind: 'endpoint', face: null }));
    H.controller.typed('0,0,-60'); // through the bottom
    expect(H.controller.error).toMatch(/fold|collapse/);
    expect(hasVertex(H.model, [10, 20, 30])).toBe(true);
    expect(volume(H.model)).toBeCloseTo(6000);
  });

  it('a point on loose lines moves just those lines', () => {
    const H = harness();
    drawEdges(H.model, [[0, 0, 0], [50, 0, 0]]);
    drawEdges(H.model, [[50, 0, 0], [50, 40, 0]]);
    H.controller.selection.set([], [], [], [], [vertexAt(H.model, [50, 0, 0])!]);
    use(H.controller, 'move');
    H.controller.tool.pointerDown(ev(H.doc, [50, 0, 0], { kind: 'endpoint' }));
    H.controller.typed('0,-10,0');
    expect(hasVertex(H.model, [50, -10, 0])).toBe(true);
    expect(hasVertex(H.model, [0, 0, 0])).toBe(true);
    expect(hasVertex(H.model, [50, 40, 0])).toBe(true);
  });

  it('a corner shared by touching boxes moves both copies, so they stay together', () => {
    const H = boxH();
    pushPull(H.model, drawRectangle(H.model, GROUND_PLANE, [10, 20, 0], 10, 20).inner!, 30);
    const corner = vertexAt(H.model, [10, 20, 30])!;
    expect(pointCopies(H.model, corner)).toHaveLength(2);
    H.controller.selection.set([], [], [], [], [corner]);
    use(H.controller, 'move');
    H.controller.tool.pointerDown(ev(H.doc, [10, 20, 30], { kind: 'endpoint', face: null }));
    H.controller.typed('0,0,5');
    expect([...H.model.vertices.values()].filter((v) => distance(v.pos, [10, 20, 35]) < 1e-6)).toHaveLength(2);
    expect(hasVertex(H.model, [10, 20, 30])).toBe(false);
    expect(checkWatertight(H.model).watertight).toBe(true);
  });

  it('Delete erases the lines that meet at the point and the faces they bound', () => {
    const H = boxH();
    H.controller.selection.set([], [], [], [], [vertexAt(H.model, [10, 20, 30])!]);
    H.controller.deleteSelection();
    expect(hasVertex(H.model, [10, 20, 30])).toBe(false);
    expect(H.model.faces.size).toBe(3);
    H.controller.undo();
    expect(H.model.faces.size).toBe(6);
  });
});
