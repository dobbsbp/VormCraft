import { create, parseSkp, type SkpModel } from 'openskp';
import { describe, expect, it } from 'vitest';
import { checkWatertight, volume } from '../src/core';
import { convertSkp, placementMatrix, summarizeSkp, type SkpPart } from '../src/io/skpImport';

const INCH = 25.4;
type P3 = [number, number, number];

/** The six faces of a w × d × h box at `o` (inches), each wound outward. */
function boxFaces(w: number, d: number, h: number, o: P3 = [0, 0, 0]): P3[][] {
  const c = (i: number): P3 => [o[0] + (i & 1 ? w : 0), o[1] + (i & 2 ? d : 0), o[2] + (i & 4 ? h : 0)];
  return [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ].map((q) => q.map(c));
}

/** Build a file with OpenSKP's writer and read it back, as an import would. */
function roundTrip(build: (b: ReturnType<typeof create>) => void): SkpModel {
  const b = create();
  build(b);
  const bytes = b.toBytes();
  return parseSkp(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

const allParts = (p: SkpPart): SkpPart[] => [p, ...p.children.flatMap(allParts)];
const bounds = (p: SkpPart) => {
  const ps = [...p.model.vertices.values()].map((v) => v.pos);
  return { min: [0, 1, 2].map((i) => Math.min(...ps.map((q) => q[i]))), max: [0, 1, 2].map((i) => Math.max(...ps.map((q) => q[i]))) };
};

describe('SketchUp files', () => {
  it('a box drawn at the top level comes in as a closed solid, inches turned into millimetres', () => {
    const skp = roundTrip((b) => boxFaces(10, 20, 30).forEach((f) => b.addFace(f)));
    const r = convertSkp(skp, { name: 'Box' });
    expect(r.root.name).toBe('Box');
    expect(r.root.model.faces.size).toBe(6);
    expect(checkWatertight(r.root.model).watertight).toBe(true);
    expect(Math.abs(volume(r.root.model))).toBeCloseTo(10 * 20 * 30 * INCH ** 3, -2);
    expect(bounds(r.root).max).toEqual([254, 508, 762].map((x) => expect.closeTo(x, 6)));
    expect(r.faces).toEqual({ total: 6, turned: 0, detached: 0, skipped: 0 });
  });

  it('groups and components are placed where they belong, each placement its own group', () => {
    const skp = roundTrip((b) => {
      // (The writer wants groups before anything else.)
      b.addGroup((g) => boxFaces(30, 10, 1).forEach((f) => g.addFace(f)), { translation: [0, 0, 10], name: 'Top' });
      const leg = b.addComponentDefinition('Leg', (def) => boxFaces(1, 1, 10).forEach((f) => def.addFace(f)));
      b.addInstance(leg, { translation: [0, 0, 0] });
      b.addInstance(leg, { translation: [20, 0, 0], name: 'Second leg' });
    });
    const stats = summarizeSkp(skp);
    expect(stats.placements).toBe(3);
    expect(stats.placedFaces).toBe(18);
    const r = convertSkp(skp, { name: 'Table' });
    const names = r.root.children.map((c) => c.name).sort();
    expect(names).toEqual(['Leg', 'Second leg', 'Top'].sort());
    const second = r.root.children.find((c) => c.name === 'Second leg')!;
    expect(bounds(second).min[0]).toBeCloseTo(20 * INCH, 6);
    const top = r.root.children.find((c) => c.name === 'Top')!;
    expect(bounds(top).min[2]).toBeCloseTo(10 * INCH, 6);
    for (const p of r.root.children) expect(checkWatertight(p.model).watertight).toBe(true);
  });

  it('a mirrored placement still faces outward; a rotated one turns', () => {
    const skp = roundTrip((b) => {
      const box = b.addComponentDefinition('Box', (def) => boxFaces(10, 10, 10).forEach((f) => def.addFace(f)));
      b.addInstance(box, { matrix3x3: [-1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [50, 0, 0], name: 'Mirrored' });
      b.addInstance(box, { matrix3x3: [0, -1, 0, 1, 0, 0, 0, 0, 1], name: 'Turned' });
    });
    const r = convertSkp(skp, { name: 'M' });
    const mirrored = r.root.children.find((c) => c.name === 'Mirrored')!;
    expect(volume(mirrored.model)).toBeGreaterThan(0);
    expect(bounds(mirrored).min[0]).toBeCloseTo(40 * INCH, 6);
    const turned = r.root.children.find((c) => c.name === 'Turned')!;
    expect(volume(turned.model)).toBeGreaterThan(0);
  });

  it('paint on faces and on whole groups, with colour and transparency', () => {
    const skp = roundTrip((b) => {
      const red = b.addMaterial('Red', [200, 20, 10], 1);
      const glass = b.addMaterial('Glass', [150, 200, 230], 0.4);
      b.addGroup((g) => g.addFace([[20, 0, 0], [30, 0, 0], [30, 10, 0], [20, 10, 0]]), { material: glass, name: 'Pane' });
      b.addFace([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]], { material: red });
    });
    const r = convertSkp(skp, { name: 'Paint' });
    const face = [...r.root.model.faces.values()][0];
    expect(r.materials.get(face.material!)).toMatchObject({ name: 'Red', color: '#c8140a', opacity: 1 });
    const pane = r.root.children[0];
    expect(r.materials.get(pane.material!)).toMatchObject({ name: 'Glass', opacity: expect.closeTo(0.4, 2) });
  });

  it('a circle keeps its true radius', () => {
    const skp = roundTrip((b) => b.addCircle([0, 0, 0], [0, 0, 1], 5));
    const r = convertSkp(skp, { name: 'Circle' });
    const curves = [...r.root.model.curves.values()];
    expect(curves).toHaveLength(1);
    expect(curves[0].radius).toBeCloseTo(5 * INCH, 6);
    expect([...r.root.model.halfEdges.values()].every((h) => h.curve === curves[0].id)).toBe(true);
  });

  it('a face turned the wrong way from its neighbours is turned round to fit', () => {
    const faces = boxFaces(10, 10, 10);
    faces[1] = [...faces[1]].reverse(); // the top, inside out
    const skp = roundTrip((b) => faces.forEach((f) => b.addFace(f)));
    const r = convertSkp(skp, { name: 'Flipped' });
    expect(r.faces.turned + r.faces.detached).toBeGreaterThan(0);
    expect(r.root.model.faces.size).toBe(6);
    r.root.model.validate();
  });

  it('guides come in when asked for', () => {
    const skp = roundTrip((b) => {
      b.addFace([[0, 0, 0], [10, 0, 0], [10, 10, 0]]);
      b.addConstructionLine([0, 0, 0], { direction: [1, 0, 0] });
      b.addConstructionPoint([1, 2, 3]);
    });
    expect(convertSkp(skp, { name: 'G' }).guides.lines).toHaveLength(0);
    const r = convertSkp(skp, { name: 'G', guides: true });
    expect(r.guides.lines).toHaveLength(1);
    expect(r.guides.lines[0].dir[0]).toBeCloseTo(1, 9);
    expect(r.guides.points[0]).toEqual([25.4, 50.8, 76.2].map((x) => expect.closeTo(x, 6)));
  });

  it('scenes become VormCraft scenes (camera only)', () => {
    const skp = roundTrip((b) => b.addFace([[0, 0, 0], [10, 0, 0], [10, 10, 0]]));
    skp.pages.push({ name: 'Plan', eye: [0, 0, 100], target: [0, 0, 0], up: [0, 1, 0], fov: 30, parallel: true, orthoHeight: 40, hiddenLayers: [] });
    const r = convertSkp(skp, { name: 'S', scenes: true });
    expect(r.scenes).toHaveLength(1);
    expect(r.scenes[0]).toMatchObject({ name: 'Plan', parts: { camera: true, hidden: false, style: false } });
    expect(r.scenes[0].camera).toMatchObject({ projection: 'parallel', fov: 30, height: expect.closeTo(40 * INCH, 6), position: [0, 0, expect.closeTo(2540, 6)] });
  });
});

describe('placement transforms', () => {
  it('13 numbers: 3×3, translation, overall scale', () => {
    const m = placementMatrix([2, 0, 0, 0, 2, 0, 0, 0, 2, 1, 2, 3, 0.5]);
    expect(m).toEqual([1, 0, 0, 0.5, 0, 1, 0, 1, 0, 0, 1, 1.5, 0, 0, 0, 1]);
  });
});
