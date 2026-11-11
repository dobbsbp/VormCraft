import { describe, expect, it } from 'vitest';
import { ev, harness, use } from './helpers/tools';

describe('erasing text labels', () => {
  it('a label placed with the Text tool is selected, so Delete erases it', () => {
    const { doc, controller } = harness();
    const text = use(controller, 'text');
    text.pointerDown(ev(doc, [0, 0, 0]));
    text.pointerDown(ev(doc, [100, 100, 0]));
    expect(doc.labels.items.size).toBe(1);
    expect(controller.selection.labels.size).toBe(1);
    controller.deleteSelection();
    expect(doc.labels.items.size).toBe(0);
  });

  it('clicking a label with the Text tool selects it for Delete as well as editing it', () => {
    const { doc, controller } = harness();
    const id = doc.labels.add([0, 0, 0], [50, 50, 0], 'Hello');
    use(controller, 'text');
    controller.labelClicked(id, false);
    expect(controller.selection.labels.has(id)).toBe(true);
    controller.deleteSelection();
    expect(doc.labels.items.has(id)).toBe(false);
  });

  it('the Eraser erases a clicked label, as one undo step', () => {
    const { doc, controller } = harness();
    const id = doc.labels.add([0, 0, 0], [50, 50, 0], 'Hello');
    use(controller, 'eraser');
    controller.labelClicked(id, false);
    expect(doc.labels.items.has(id)).toBe(false);
    controller.undo();
    expect(doc.labels.items.has(id)).toBe(true);
  });

  it('box selection takes labels inside the box; right-click selects the label for the menu', () => {
    const { doc, controller } = harness();
    const inside = doc.labels.add([0, 0, 0], [50, -50, 0], 'In');
    const outside = doc.labels.add([0, 0, 0], [500, -500, 0], 'Out');
    const select = use(controller, 'select');
    select.pointerDown(ev(doc, [0, 0, 0]));
    select.pointerMove({ ...ev(doc, [100, -100, 0]), down: true });
    select.pointerUp!(ev(doc, [100, -100, 0]), true);
    expect([...controller.selection.labels]).toEqual([inside]);
    controller.labelContextPick(outside);
    expect([...controller.selection.labels]).toEqual([outside]);
  });
});
