import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkWatertight } from '../src/core/check/watertight';
import { volume } from '../src/core/check/measure';
import { normalizeNurbs, nurbsPoint } from '../src/core/math/nurbs';
import { TOL } from '../src/core/math/tolerance';
import { distance, type Vec3 } from '../src/core/math/vec3';
import { curveToPaths, fitArc, type DrawingCurve } from '../src/core/ops/drawingCurves';
import { importLayers, importLines } from '../src/core/ops/importLines';
import { pushPull } from '../src/core/ops/pushPull';
import type { Model } from '../src/core/model/Model';
import { decodeDxf, DxfError, mtextPlain, parseDxf, plainText } from '../src/io/dxfFile';
import { convertDxf, countSegments, defaultLayers, drawingBounds, type DxfChoice } from '../src/io/dxfImport';

const sample = (name: string) => parseDxf(decodeDxf(readFileSync(`tests/fixtures/dxf/${name}`)));
const detail = { circleSegments: 24, tolerance: 0.05, arcs: true };
const choose = (d: ReturnType<typeof sample>, more: Partial<DxfChoice> = {}): DxfChoice => ({ unit: d.units ?? 'mm', detail, faces: true, layers: defaultLayers(d), ...more });
const layer = (r: ReturnType<typeof convertDxf>, name: string) => r.root.children.find((c) => c.name === name)!.model;
/** Area of an n-sided polygon in a circle of radius r. */
const polygonArea = (r: number, n: number) => (n * r * r * Math.sin((2 * Math.PI) / n)) / 2;
/** The plate sample at 24 segments a circle: rounded corners (r 10), four 6 mm holes, one of 25, and a 10 × 80 slot with round ends. */
const PLATE_AREA = 200 * 120 - 4 * (100 - polygonArea(10, 24) / 4) - 4 * polygonArea(6, 24) - polygonArea(25, 24) - (80 * 10 + polygonArea(5, 24));
const area = (m: Model, f: number) => {
  // Shoelace in XY over every loop (holes run the other way, so they subtract).
  let a = 0;
  for (const ring of m.faceVertexLoops(f)) {
    const p = ring.map((v) => m.pos(v));
    for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  }
  return Math.abs(a / 2);
};

/** A minimal DXF with these entity records (each a list of [code, value]). */
function dxf(entities: (string | number)[][][], units = 4): string {
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(units), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const e of entities) for (const [c, v] of e) lines.push(String(c), String(v));
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return lines.join('\n');
}
const LINE = (a: Vec3, b: Vec3, layer = '0') => [[0, 'LINE'], [8, layer], [10, a[0]], [20, a[1]], [30, a[2]], [11, b[0]], [21, b[1]], [31, b[2]]];

describe('NURBS curves', () => {
  it('a rational quadratic spline is an exact circle', () => {
    const w = Math.SQRT1_2;
    const sq = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0]];
    const c = normalizeNurbs({ degree: 2, knots: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1], points: sq.map(([x, y]) => [10 * x, 10 * y, 0] as Vec3), weights: [1, w, 1, w, 1, w, 1, w, 1] });
    for (let t = 0; t <= 1; t += 0.01) expect(Math.hypot(...nurbsPoint(c, t))).toBeCloseTo(10, 9);
    expect(nurbsPoint(c, 0)).toEqual([10, 0, 0]);
  });

  it('starts and ends at its end points, and makes a knot vector if the file has none', () => {
    const c = normalizeNurbs({ degree: 3, knots: [], points: [[0, 0, 0], [1, 2, 0], [3, 2, 0], [4, 0, 0]] });
    expect(c.knots).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(distance(nurbsPoint(c, 0), [0, 0, 0])).toBeLessThan(1e-12);
    expect(distance(nurbsPoint(c, 1), [4, 0, 0])).toBeLessThan(1e-12);
  });
});

describe('curves to edges', () => {
  /** A quarter circle as a cubic Bézier spline (how Rhino's Make2D writes arcs). */
  const quarter = (r: number, a0: number): DrawingCurve => {
    const k = (4 / 3) * Math.tan(Math.PI / 8) * r;
    const a1 = a0 + Math.PI / 2;
    const p0: Vec3 = [r * Math.cos(a0), r * Math.sin(a0), 0];
    const p3: Vec3 = [r * Math.cos(a1), r * Math.sin(a1), 0];
    return { kind: 'spline', degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1], points: [p0, [p0[0] - k * Math.sin(a0), p0[1] + k * Math.cos(a0), 0], [p3[0] + k * Math.sin(a1), p3[1] - k * Math.cos(a1), 0], p3] };
  };

  it('a circle gets the segments asked for, and keeps its true radius', () => {
    const c: DrawingCurve = { kind: 'conic', center: [5, 5, 0], u: [20, 0, 0], v: [0, 20, 0], start: 0, end: 2 * Math.PI };
    for (const n of [12, 24, 96]) {
      const [p] = curveToPaths(c, { ...detail, circleSegments: n });
      expect(p.points).toHaveLength(n + 1);
      expect(p.points[n]).toEqual(p.points[0]);
      expect(p.curve).toMatchObject({ radius: 20, segments: n });
    }
    // A quarter arc gets a quarter of them.
    expect(curveToPaths({ ...c, end: Math.PI / 2 }, detail)[0].points).toHaveLength(7);
  });

  it('finds arcs drawn as splines, ends kept exact so neighbours still meet', () => {
    const q = quarter(40, 0);
    const [p] = curveToPaths(q, detail);
    expect(p.curve!.radius).toBeCloseTo(40, 1);
    expect(p.points).toHaveLength(7);
    expect(p.points[0]).toEqual([40, 0, 0]);
    expect(distance(p.points[6], [0, 40, 0])).toBeLessThan(1e-12);
    // Switched off: just segments within the gap allowed, no true circle.
    const plain = curveToPaths(q, { ...detail, arcs: false });
    expect(plain[0].curve).toBeUndefined();
    const fine = curveToPaths(q, { ...detail, arcs: false, tolerance: 0.001 })[0].points.length;
    expect(fine).toBeGreaterThan(plain[0].points.length);
  });

  it('four quarter splines of one circle become one true circle', () => {
    const paths = [0, 1, 2, 3].flatMap((i) => curveToPaths(quarter(40, (i * Math.PI) / 2), detail));
    const r = importLines(paths);
    expect(r.model.curves.size).toBe(1);
    expect(r.model.faces.size).toBe(1);
    expect(r.edges).toBe(24);
  });

  it('a straight spline is one edge; a free-form one follows the curve within the gap', () => {
    expect(curveToPaths({ kind: 'spline', degree: 2, knots: [], points: [[0, 0, 0], [5, 0, 0], [10, 0, 0]] }, detail)[0].points).toHaveLength(2);
    const s: DrawingCurve = { kind: 'spline', degree: 3, knots: [], points: [[0, 0, 0], [30, 40, 0], [60, -40, 0], [90, 40, 0], [120, -40, 0], [150, 0, 0]] };
    const [p] = curveToPaths(s, detail);
    expect(p.curve).toBeUndefined();
    const c = normalizeNurbs(s as never);
    // Every curve point is within the gap of the segments.
    for (let t = 0; t <= 1; t += 0.002) {
      const q = nurbsPoint(c, t);
      let best = Infinity;
      for (let i = 0; i + 1 < p.points.length; i++) {
        const a = p.points[i];
        const b = p.points[i + 1];
        const d = [b[0] - a[0], b[1] - a[1]];
        const s2 = Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2)));
        best = Math.min(best, Math.hypot(a[0] + d[0] * s2 - q[0], a[1] + d[1] * s2 - q[1]));
      }
      expect(best).toBeLessThan(0.05 + 1e-9);
    }
  });

  it('an ellipse is followed within the gap', () => {
    const [p] = curveToPaths({ kind: 'conic', center: [0, 0, 0], u: [50, 0, 0], v: [0, 25, 0], start: 0, end: 2 * Math.PI }, { ...detail, tolerance: 0.01 });
    expect(p.curve).toBeUndefined();
    expect(p.points[p.points.length - 1]).toEqual(p.points[0]);
    for (const q of p.points) expect((q[0] / 50) ** 2 + (q[1] / 25) ** 2).toBeCloseTo(1, 9);
    expect(p.points.length).toBeGreaterThan(40);
  });

  it('points that are not on a circle are not taken for one', () => {
    const wave = Array.from({ length: 20 }, (_, i) => [i, Math.sin(i / 3) * 4, 0] as Vec3);
    expect(fitArc(wave)).toBeNull();
    expect(fitArc(Array.from({ length: 10 }, (_, i) => [i, 0, 0] as Vec3))).toBeNull();
  });
});

describe('lines to faces', () => {
  it('splits lines where they cross and where one ends on another', () => {
    const r = importLines([{ points: [[0, 0, 0], [10, 10, 0]] }, { points: [[0, 10, 0], [10, 0, 0]] }, { points: [[5, 5, 0], [5, 20, 0]] }]);
    expect(r.model.vertices.size).toBe(6);
    expect(r.edges).toBe(5);
  });

  it('a square with a diagonal is two faces; a square inside another is a hole and a face', () => {
    const sq = (s: number, o = 0): Vec3[] => [[o, o, 0], [o + s, o, 0], [o + s, o + s, 0], [o, o + s, 0], [o, o, 0]];
    const a = importLines([{ points: sq(10) }, { points: [[0, 0, 0], [10, 10, 0]] }]);
    expect(a.faces).toBe(2);
    const b = importLines([{ points: sq(10) }, { points: sq(4, 3) }]);
    expect(b.faces).toBe(2);
    const outer = [...b.model.faces.values()].find((f) => f.holes.length === 1)!;
    expect(area(b.model, outer.id)).toBeCloseTo(84);
    // Every face faces up, like a drawn one.
    for (const f of b.model.faces.values()) expect(f.normal[2]).toBe(1);
  });

  it('a line joining two shapes stays a line, the shapes still get faces', () => {
    const r = importLines([
      { points: [[0, 0, 0], [5, 0, 0], [5, 5, 0], [0, 5, 0], [0, 0, 0]] },
      { points: [[10, 0, 0], [15, 0, 0], [15, 5, 0], [10, 5, 0], [10, 0, 0]] },
      { points: [[5, 2, 0], [10, 2, 0]] },
    ]);
    expect(r.faces).toBe(2);
  });

  it('a wireframe box becomes a closed solid facing outwards', () => {
    const d = sample('wireframe-box.dxf');
    const m = layer(convertDxf(d, choose(d), 'box'), 'Wireframe');
    const box = [...m.faces.keys()].filter((f) => m.faceVertexLoops(f)[0].every((v) => m.pos(v)[0] <= 100 + TOL));
    expect(box).toHaveLength(6);
    expect(checkWatertight(m, box).watertight).toBe(true);
    expect(volume(m, box)).toBeCloseTo(100 * 60 * 40, 3);
    // The tilted triangle beside it is a face too.
    expect(m.faces.size).toBe(7);
  });

  it('no faces when asked for none', () => {
    expect(importLines([{ points: [[0, 0, 0], [5, 0, 0], [5, 5, 0], [0, 0, 0]] }], { faces: false }).faces).toBe(0);
  });

  it('faces found across layers go to the layer most of their outline is on', () => {
    const r = importLayers([[{ points: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 0]] }], [{ points: [[3, 3, 0], [6, 3, 0], [6, 6, 0], [3, 6, 0], [3, 3, 0]] }]]);
    expect(r.models[0].faces.size).toBe(1);
    expect([...r.models[0].faces.values()][0].holes).toHaveLength(1);
    expect(r.models[1].faces.size).toBe(1);
  });
});

describe('DXF files', () => {
  it('refuses DWG, binary DXF and other files', () => {
    expect(() => decodeDxf(new TextEncoder().encode('AC1032 rest of a dwg'))).toThrow(DxfError);
    expect(() => decodeDxf(new TextEncoder().encode('AutoCAD Binary DXF\r\n'))).toThrow(/binary/);
    expect(() => parseDxf('hello\nworld')).toThrow(DxfError);
    expect(decodeDxf(new Uint8Array([0x30, 0x0a, 0xe9]))).toBe('0\né');
  });

  it('cleans up text codes', () => {
    expect(mtextPlain('{\\fArial|b1;Big}\\PLine two\\~x \\S1/2;')).toBe('Big\nLine two x 1/2');
    expect(plainText('%%c12 %%d %%p \\U+00E9')).toBe('Ø12 ° ± é');
  });

  it('plate: units, layers, a face with its six holes, true circles, texts and dimensions', () => {
    const d = sample('plate.dxf');
    expect(d.units).toBe('mm');
    expect(d.layers.map((l) => l.name)).toEqual(['Outline', 'Holes', 'Dimensions', 'Notes']);
    const r = convertDxf(d, choose(d), 'plate');
    expect(r.root.name).toBe('plate');
    expect(r.root.children.map((c) => c.name)).toEqual(['Outline', 'Holes']);
    const outline = layer(r, 'Outline');
    const [plate] = [...outline.faces.values()];
    expect(plate.holes).toHaveLength(6);
    expect(area(outline, plate.id)).toBeCloseTo(PLATE_AREA, 3);
    expect(r.circles).toBe(11);
    expect(layer(r, 'Holes').faces.size).toBe(6);
    const texts = r.labels.filter((l) => !l.end).map((l) => l.text);
    expect(texts).toEqual(['Plate, 6 mm aluminium', 'Bracket\nDrill Ø12 ± 0.1', 'R25']);
    const dims = r.labels.filter((l) => l.end);
    expect(dims.map((l) => +distance(l.anchor, l.end!).toFixed(6))).toEqual([200, 120, +Math.hypot(160, 80).toFixed(6)]);
    // The horizontal one sits on its dimension line, 15 below.
    expect(dims[0].position).toEqual([100, -15, 0]);
  });

  it('plate: pushed up, it is a closed solid with holes through it', () => {
    const d = sample('plate.dxf');
    const m = layer(convertDxf(d, choose(d), 'plate'), 'Outline');
    const [plate] = [...m.faces.keys()];
    pushPull(m, plate, 6);
    expect(checkWatertight(m).watertight).toBe(true);
    expect(volume(m)).toBeCloseTo(PLATE_AREA * 6, 0);
  });

  it('curve detail changes the edge count, not the size', () => {
    const d = sample('plate.dxf');
    const at = (n: number) => countSegments(d, { unit: 'mm', detail: { ...detail, circleSegments: n }, layers: ['Holes'] });
    // Twice the segments on every curve; the slot's two straight sides stay one each.
    expect(at(48) - 2).toBe(2 * (at(24) - 2));
    const m = layer(convertDxf(d, choose(d, { detail: { ...detail, circleSegments: 48 } }), 'plate'), 'Holes');
    for (const c of m.curves.values()) expect(c.segments).toBe(48);
  });

  it('Rhino-style splines: arcs and circles found, hidden lines left out by default', () => {
    const d = sample('rhino-splines.dxf');
    expect(defaultLayers(d)).toEqual(['Make2D$Visible$Curves']);
    const r = convertDxf(d, choose(d), 'curves');
    expect(r.root.children.map((c) => c.name)).toEqual(['Make2D$Visible$Curves']);
    const radii = [...layer(r, 'Make2D$Visible$Curves').curves.values()].map((c) => Math.round(c.radius * 100) / 100).sort((a, b) => a - b);
    expect(radii).toEqual([12, 12, 12, 12, 30, 40]);
    // Circle, rounded rectangle, rational circle and ellipse closed into faces; the S curve stays a line.
    expect(r.faces).toBe(4);
    // Not looking for arcs: every spline is just segments (the ellipse never was a circle).
    expect(convertDxf(d, choose(d, { detail: { ...detail, arcs: false } }), 'curves').circles).toBe(0);
  });

  it('blocks in inches: placed, turned, scaled, mirrored and arrayed, texts inside them too', () => {
    const d = sample('blocks-inches.dxf');
    expect(d.units).toBe('in');
    const r = convertDxf(d, choose(d), 'blocks');
    const parts = layer(r, 'Parts');
    const radii = [...parts.curves.values()].map((c) => +c.radius.toFixed(4)).sort((a, b) => a - b);
    // 4 single bolts (one at half size, one at double), 2 in the tables, 6 in the array.
    expect(radii).toEqual([3.175, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 6.35, 12.7]);
    // The mirrored table runs from x = 140 back to 80 inches; its bolt is mirrored with it.
    const xs = [...parts.vertices.values()].map((v) => v.pos[0] / 25.4);
    expect(Math.min(...xs.filter((x) => x > 70))).toBeCloseTo(80);
    expect([...parts.curves.values()].some((c) => Math.abs(c.center[0] / 25.4 - 135) < 1e-6 && Math.abs(c.center[1] / 25.4 - 15) < 1e-6)).toBe(true);
    expect(r.labels.map((l) => l.text)).toEqual(['Table', 'Table']);
    // 3D faces come in as a surface group: a closed pyramid.
    const pyramid = layer(r, 'Surfaces (surfaces)');
    expect(pyramid.faces.size).toBe(5);
    expect(Math.abs(volume(pyramid))).toBeCloseTo((254 * 254 * 203.2) / 3, 0);
    // The 3D polyline is a path of edges.
    expect(layer(r, 'Paths').halfEdges.size / 2).toBe(48);
  });

  it('floor plan in metres: walls become a ring face, rooms faces; a layer off in the file is left out', () => {
    const d = sample('floor-plan.dxf');
    expect(d.units).toBe('m');
    expect(d.layers.find((l) => l.name === 'Furniture')!.off).toBe(true);
    expect(defaultLayers(d)).not.toContain('Furniture');
    const r = convertDxf(d, choose(d), 'plan');
    const walls = layer(r, 'Walls');
    const ring = [...walls.faces.values()].find((f) => f.holes.length === 1)!;
    expect(area(walls, ring.id)).toBeCloseTo(8000 * 6000 - 7600 * 5600, -2);
    expect(r.labels.filter((l) => !l.end).map((l) => l.text)).toEqual(['Living', 'Kitchen']);
    expect(r.labels.filter((l) => l.end).map((l) => Math.round(distance(l.anchor, l.end!)))).toEqual([8000, 6000]);
    const b = drawingBounds(d, defaultLayers(d))!;
    expect(b.max[0] - b.min[0]).toBeCloseTo(8);
  });

  it('small DXFs: lines in 3D, arcs with bulges, and things left out counted', () => {
    // A closed polyline with a half-circle end (bulge 1) and a hatch.
    const text = dxf([
      [[0, 'LWPOLYLINE'], [8, 'A'], [90, 3], [70, 1], [10, 0], [20, 0], [10, 10], [20, 0], [42, 1], [10, 10], [20, 10]],
      [[0, 'HATCH'], [8, 'A']],
      LINE([0, 0, 0], [0, 0, 5], 'B'),
    ]);
    const d = parseDxf(text);
    expect(d.skipped.get('hatches')).toBe(1);
    const r = convertDxf(d, choose(d), 'small');
    const a = layer(r, 'A');
    const [c] = [...a.curves.values()];
    expect(c.radius).toBeCloseTo(5);
    expect(c.center).toEqual([10, 5, 0]);
    // The half circle bulges out to x = 15 (anticlockwise from (10, 0) to (10, 10)).
    expect(Math.max(...[...a.vertices.values()].map((v) => v.pos[0]))).toBeCloseTo(15);
    expect(a.faces.size).toBe(1);
    expect(layer(r, 'B').halfEdges.size).toBe(2);
  });
});
