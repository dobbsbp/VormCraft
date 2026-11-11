import { afterEach, describe, expect, it } from 'vitest';
import { drawRectangle, GROUND_PLANE, type Vec3 } from '../src/core';
import { Document } from '../src/doc/Document';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { dimensionDragPoint, dimensionLayout } from '../src/tools/dimension';
import { ev, harness, use } from './helpers/tools';

type H = ReturnType<typeof harness>;
const click = (h: H, p: Vec3, o: Parameters<typeof ev>[2] = {}) => {
  h.controller.tool.pointerMove(ev(h.doc, p, o));
  h.controller.tool.pointerDown(ev(h.doc, p, o));
};
const down = (p: Vec3) => ({ origin: [p[0], p[1], p[2] + 1000] as Vec3, dir: [0, 0, -1] as Vec3 });

/** A 100 × 50 rectangle on the ground, and the edge along its front (y = 0). */
function rectangle(h: H) {
  const f = drawRectangle(h.model, GROUND_PLANE, [0, 0, 0], 100, 50).inner!;
  const edge = h.model.faceHalfEdges(f).find((e) => h.model.pos(h.model.he(e).origin)[1] === 0 && h.model.pos(h.model.dest(e))[1] === 0)!;
  return edge;
}

describe('dimension layout', () => {
  it('runs parallel to the measured line, moved square to it', () => {
    const l = dimensionLayout([0, 0, 0], [100, 0, 0], [80, -30, 7]);
    expect(l.length).toBe(100);
    expect(l.offset).toEqual([0, -30, 7]);
    expect(l.from).toEqual([0, -30, 7]);
    expect(l.to).toEqual([100, -30, 7]);
    expect(l.mid).toEqual([50, -30, 7]);
  });

  it('is dragged on the plane through the line that faces the viewer', () => {
    expect(dimensionDragPoint([0, 0, 0], [100, 0, 0], down([40, -25, 0]))).toEqual([40, -25, 0]);
    // Looking along the line itself there is no such plane.
    expect(dimensionDragPoint([0, 0, 0], [100, 0, 0], { origin: [-100, 0, 0], dir: [1, 0, 0] })).toBeNull();
  });
});

describe('Dimension tool', () => {
  afterEach(() => {
    harness(); // millimetres again for the other tests
  });

  it('measures a clicked line end to end; the dimension sits where it is clicked out to, selected', () => {
    const h = harness();
    const edge = rectangle(h);
    use(h.controller, 'dimension');
    click(h, [30, 0, 0], { kind: 'onEdge', edge });
    h.controller.tool.pointerMove(ev(h.doc, [70, -40, 0], { ray: down([70, -40, 0]) }));
    expect(h.controller.tool.vcbValue()).toBe('40 mm');
    expect(h.controller.tool.preview().lines?.[0].dashed).toBe(true);
    click(h, [70, -40, 0], { ray: down([70, -40, 0]) });
    const [d] = h.doc.labels.items.values();
    expect([d.anchor, d.end].map((p) => p![0]).sort((a, b) => a - b)).toEqual([0, 100]);
    expect(d.position).toEqual([50, -40, 0]);
    expect(d.text).toBe('');
    expect([...h.controller.selection.labels]).toEqual([d.id]);
    expect(h.controller.history.undoLabel).toBe('Dimension');
  });

  it('measures between two clicked points; typing places it that far out', () => {
    const h = harness();
    rectangle(h);
    use(h.controller, 'dimension');
    click(h, [0, 0, 0], { kind: 'endpoint' });
    h.controller.tool.pointerMove(ev(h.doc, [100, 50, 0], { kind: 'endpoint' }));
    expect(h.controller.tool.vcbLabel()).toBe('Length');
    click(h, [100, 50, 0], { kind: 'endpoint' });
    expect(h.controller.tool.vcbLabel()).toBe('Offset');
    expect(() => h.controller.tool.typed('abc')).toThrow();
    h.controller.tool.pointerMove(ev(h.doc, [0, 50, 0], { ray: down([0, 50, 0]) }));
    h.controller.tool.typed('20');
    const [d] = h.doc.labels.items.values();
    expect(d.end).toEqual([100, 50, 0]);
    const l = dimensionLayout(d.anchor, d.end!, d.position);
    expect(Math.hypot(...l.offset)).toBeCloseTo(20, 9);
    // Out toward the side the mouse was on (up and to the left of the diagonal).
    expect(l.offset[1]).toBeGreaterThan(0);
  });

  it('dragging moves it out from the line as one undo step', () => {
    const h = harness();
    const edge = rectangle(h);
    use(h.controller, 'dimension');
    click(h, [30, 0, 0], { kind: 'onEdge', edge });
    click(h, [50, -20, 0], { ray: down([50, -20, 0]) });
    const [d] = h.doc.labels.items.values();
    h.controller.setTool('select');
    h.controller.dragLabel(d.id, down([10, -60, 0]), false);
    expect(d.position).toEqual([50, -60, 0]);
    h.controller.dragLabel(d.id, down([90, -70, 0]), true);
    // Only out from the line: it stays centred on what it measures.
    expect(d.position).toEqual([50, -70, 0]);
    expect(h.controller.history.undoLabel).toBe('Move dimension');
    h.controller.undo();
    expect(h.doc.labels.items.get(d.id)!.position).toEqual([50, -20, 0]);
  });

  it('own text replaces the value; empty or the measured length shows the measured length again', () => {
    const h = harness();
    const id = h.doc.labels.add([0, 0, 0], [500, -100, 0], '', [1000, 0, 0]);
    h.controller.setLabelText(id, 'Wall');
    expect(h.doc.labels.items.get(id)!.text).toBe('Wall');
    h.controller.setLabelText(id, '1000 mm');
    expect(h.doc.labels.items.get(id)!.text).toBe('');
    h.controller.setLabelText(id, 'Wall');
    h.controller.setLabelText(id, '  ');
    expect(h.doc.labels.items.get(id)!.text).toBe('');
    expect(h.controller.history.undoLabel).toBe('Edit dimension');
  });

  it('is saved with the design, moved with Move, and erased like a label', () => {
    const doc = new Document();
    doc.labels.add([0, 0, 0], [50, -20, 0], 'Front', [100, 0, 0]);
    const [d] = parseDocument(serializeDocument(doc)).labels.items.values();
    expect(d.end).toEqual([100, 0, 0]);
    expect(d.text).toBe('Front');

    const h = harness();
    const id = h.doc.labels.add([0, 0, 0], [50, -20, 0], '', [100, 0, 0]);
    h.controller.selection.set([], [], [], [], [], [id]);
    use(h.controller, 'move');
    click(h, [0, 0, 0], { kind: 'endpoint', face: null });
    click(h, [0, 0, 30], { kind: 'endpoint', face: null });
    const moved = h.doc.labels.items.get(id)!;
    expect(moved.end).toEqual([100, 0, 30]);
    expect(moved.anchor).toEqual([0, 0, 30]);
    h.controller.setTool('select');
    h.controller.selection.set([], [], [], [], [], [id]);
    h.controller.deleteSelection();
    expect(h.doc.labels.items.size).toBe(0);
  });
});
