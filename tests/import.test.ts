import { describe, expect, it } from 'vitest';
import { checkWatertight, importMesh, volume, type Vec3 } from '../src/core';
import { exportObj, exportStl } from '../src/io/export';
import { convertMesh, MeshFileError, parseMeshFile, parseObj, parseStl } from '../src/io/meshFiles';
import { drawCircle, drawRectangle, GROUND_PLANE, initBooleanKernel, Model, pushPull } from '../src/core';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A w × d × h box as 12 triangles, wound outward. */
function boxTriangles(w = 100, d = 100, h = 100, at: Vec3 = [0, 0, 0]): Vec3[][] {
  const [x, y, z] = at;
  const c = (i: number): Vec3 => [x + (i & 1 ? w : 0), y + (i & 2 ? d : 0), z + (i & 4 ? h : 0)];
  const quads = [
    [0, 2, 3, 1], // bottom (−z)
    [4, 5, 7, 6], // top
    [0, 1, 5, 4], // front (−y)
    [2, 6, 7, 3], // back
    [0, 4, 6, 2], // left (−x)
    [1, 3, 7, 5], // right
  ];
  return quads.flatMap(([a, b, cc, dd]) => [
    [c(a), c(b), c(cc)],
    [c(a), c(cc), c(dd)],
  ]);
}

/** A solid as a mesh file would hold it: our STL export, read back. */
function solidStl(): Uint8Array {
  const m = new Model();
  const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 200, 100).inner!;
  pushPull(m, f, m.face(f).normal[2] > 0 ? 50 : -50);
  return new Uint8Array(exportStl(m).data);
}

describe('triangles into faces', () => {
  it('a triangulated box comes in as six faces, closed, with the right volume', () => {
    const r = importMesh(boxTriangles());
    expect(r.model.faces.size).toBe(6);
    expect([...r.model.edges()]).toHaveLength(12);
    expect(r.skipped).toBe(0);
    expect(checkWatertight(r.model).watertight).toBe(true);
    expect(volume(r.model)).toBeCloseTo(1e6, 3);
  });

  it('a flat ring of triangles becomes one face with a hole', () => {
    // A 300 square with a 100 square hole, as 8 triangles.
    const o: Vec3[] = [
      [0, 0, 0],
      [300, 0, 0],
      [300, 300, 0],
      [0, 300, 0],
    ];
    const i: Vec3[] = [
      [100, 100, 0],
      [200, 100, 0],
      [200, 200, 0],
      [100, 200, 0],
    ];
    const tris: Vec3[][] = [];
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      tris.push([o[k], o[n], i[n]], [o[k], i[n], i[k]]);
    }
    const r = importMesh(tris);
    expect(r.model.faces.size).toBe(1);
    expect(r.model.face([...r.model.faces.keys()][0]).holes).toHaveLength(1);
  });

  it('curved surfaces are softened; sharp edges stay', () => {
    const m = new Model();
    const disc = drawCircle(m, GROUND_PLANE, [0, 0, 0], 50, 24).inner!;
    pushPull(m, disc, m.face(disc).normal[2] > 0 ? 100 : -100);
    const stl = new Uint8Array(exportStl(m).data);
    const r = importMesh(parseStl(stl)[0].polygons, { smoothAngle: 20 });
    expect(r.model.faces.size).toBe(26); // 24 sides + 2 ends
    const soft = [...r.model.halfEdges.values()].filter((h) => h.soft).length / 2;
    expect(soft).toBe(24); // the seams between the sides; the rims stay sharp
    expect(checkWatertight(r.model).watertight).toBe(true);
  });

  it('a doubled triangle is absorbed; a flipped copy is skipped and the rest still comes in', () => {
    const doubled = boxTriangles();
    doubled.push(doubled[0]);
    const d = importMesh(doubled);
    expect(d.skipped).toBe(0);
    expect(d.model.faces.size).toBe(6);
    const flipped = boxTriangles();
    flipped.push([...flipped[0]].reverse());
    const r = importMesh(flipped);
    expect(r.skipped).toBe(1);
    expect(r.model.faces.size).toBe(6);
    expect(checkWatertight(r.model).watertight).toBe(true);
    r.model.validate();
  });

  it('degenerate triangles (no area) are skipped', () => {
    const r = importMesh([
      [
        [0, 0, 0],
        [10, 0, 0],
        [20, 0, 0],
      ],
      [
        [0, 0, 0],
        [0, 0, 0],
        [1, 1, 0],
      ],
    ]);
    expect(r.skipped).toBe(2);
    expect(r.model.faces.size).toBe(0);
  });
});

describe('STL files', () => {
  it('binary STL: a solid comes back as the same solid', () => {
    const [obj] = parseStl(solidStl(), 'C:/models/Plate.stl');
    expect(obj.name).toBe('Plate');
    expect(obj.polygons).toHaveLength(12);
    const r = importMesh(obj.polygons);
    expect(r.model.faces.size).toBe(6);
    expect(volume(r.model)).toBeCloseTo(200 * 100 * 50, 1);
  });

  it('text STL', () => {
    const text = `solid cube\n${boxTriangles()
      .map((t) => `facet normal 0 0 0\n outer loop\n${t.map((p) => `  vertex ${p.join(' ')}`).join('\n')}\n endloop\nendfacet`)
      .join('\n')}\nendsolid cube\n`;
    const [obj] = parseStl(new TextEncoder().encode(text));
    expect(obj.polygons).toHaveLength(12);
    expect(importMesh(obj.polygons).model.faces.size).toBe(6);
  });

  it('not an STL file', () => {
    expect(() => parseStl(new TextEncoder().encode('hello'))).toThrow(MeshFileError);
  });
});

describe('OBJ files', () => {
  it('quads, v/vt/vn indices, negative indices, and one group per object', () => {
    const text = [
      '# two squares',
      'o First',
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'vt 0 0',
      'vn 0 0 1',
      'f 1/1/1 2/1/1 3/1/1 4/1/1',
      'o Second',
      'v 2 0 0',
      'v 3 0 0',
      'v 3 1 0',
      'f -3 -2 -1',
    ].join('\n');
    const objs = parseObj(text, 'squares.obj');
    expect(objs.map((o) => o.name)).toEqual(['First', 'Second']);
    expect(objs[0].polygons[0]).toHaveLength(4);
    expect(objs[1].polygons[0][0]).toEqual([2, 0, 0]);
  });

  it('without objects, groups split the file; a missing vertex is reported', () => {
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\ng A\nf 1 2 3\ng B\nf 3 2 1\n').map((o) => o.name)).toEqual(['A', 'B']);
    expect(() => parseObj('v 0 0 0\nf 1 2 9\n')).toThrow(/does not exist/);
  });

  it('our own OBJ export comes back in as a closed solid', () => {
    const m = new Model();
    const f = drawRectangle(m, GROUND_PLANE, [0, 0, 0], 100, 100).inner!;
    pushPull(m, f, m.face(f).normal[2] > 0 ? 100 : -100);
    const objs = parseMeshFile('box.obj', new TextEncoder().encode(exportObj(m)));
    const r = importMesh(objs[0].polygons);
    expect(r.model.faces.size).toBe(6);
    expect(checkWatertight(r.model).watertight).toBe(true);
  });
});

describe('units and axes', () => {
  it('scaled to millimetres; Y-up files turned so Z is up (still a proper solid)', () => {
    const [box] = convertMesh([{ name: 'b', polygons: boxTriangles(1, 2, 3) }], 'm', true);
    const r = importMesh(box.polygons);
    const zs = [...r.model.vertices.values()].map((v) => v.pos[2]);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2000, 6); // Y (2 m) became Z
    expect(volume(r.model)).toBeCloseTo(6e9, -3); // not turned inside out
  });

  it('only OBJ and STL', () => {
    expect(() => parseMeshFile('model.skp', new Uint8Array())).toThrow(/obj and \.stl/);
  });
});
