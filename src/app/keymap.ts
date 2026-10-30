import type { AxisLock, ToolId } from '../tools/types';

/** What a key does. Keys for tools that are not built yet say so instead of doing nothing. */
export type KeyAction =
  | { type: 'tool'; tool: ToolId }
  | { type: 'zoomExtents' }
  | { type: 'previousView' }
  | { type: 'backEdges' }
  | { type: 'search' }
  | { type: 'lock'; lock: AxisLock }
  | { type: 'unavailable'; name: string; reason: string };

export interface KeyBinding {
  /** As shown to the user, e.g. "Shift+Z", "Space", "→". */
  label: string;
  /** Matching key: `KeyboardEvent.key` lower-cased (" " for Space, "arrowright", ...). */
  key: string;
  shift: boolean;
  name: string;
  action: KeyAction;
}

const NOT_YET = 'not built yet';
const OUT_OF_SCOPE = 'planned for a later version (out of scope for v1)';

const bind = (label: string, key: string, shift: boolean, name: string, action: KeyAction): KeyBinding => ({ label, key, shift, name, action });
const tool = (label: string, key: string, name: string, id: ToolId) => bind(label, key, false, name, { type: 'tool', tool: id });
const shiftTool = (key: string, name: string, id: ToolId) => bind(`Shift+${key.toUpperCase()}`, key, true, name, { type: 'tool', tool: id });
const missing = (label: string, key: string, shift: boolean, name: string, reason = NOT_YET) =>
  bind(label, key, shift, name, { type: 'unavailable', name, reason });

/** The keyboard map (SketchUp-style defaults). */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  // Drawing & basic tools
  tool('L', 'l', 'Line', 'line'),
  tool('R', 'r', 'Rectangle', 'rectangle'),
  shiftTool('r', 'Rotated Rectangle', 'rectangle3'),
  tool('C', 'c', 'Circle', 'circle'),
  shiftTool('c', 'Polygon', 'polygon'),
  tool('A', 'a', '2-Point Arc', 'arc2'),
  shiftTool('a', 'Pie', 'pie'),
  tool('P', 'p', 'Push/Pull', 'pushpull'),
  tool('M', 'm', 'Move', 'move'),
  tool('Q', 'q', 'Rotate', 'rotate'),
  tool('S', 's', 'Scale', 'scale'),
  tool('F', 'f', 'Offset', 'offset'),
  shiftTool('p', 'Follow Me', 'followMe'),
  tool('E', 'e', 'Eraser', 'eraser'),
  tool('B', 'b', 'Paint Bucket', 'paint'),
  tool('T', 't', 'Tape Measure', 'tape'),
  // Selection & editing
  tool('Space', ' ', 'Select', 'select'),
  bind('Shift+Space', ' ', true, 'Lasso Select', { type: 'tool', tool: 'lasso' }),
  missing('G', 'g', false, 'Make Component', OUT_OF_SCOPE),
  bind('Shift+S', 's', true, 'Search', { type: 'search' }),
  // View & navigation
  tool('O', 'o', 'Orbit', 'orbit'),
  tool('H', 'h', 'Pan', 'pan'),
  tool('Z', 'z', 'Zoom', 'zoom'),
  bind('Shift+Z', 'z', true, 'Zoom Extents', { type: 'zoomExtents' }),
  // Not SketchUp defaults (it has none for these, and its Ctrl+Shift+W closes a browser window).
  shiftTool('w', 'Zoom Window', 'zoomWindow'),
  bind('Shift+V', 'v', true, 'Previous View', { type: 'previousView' }),
  bind('K', 'k', false, 'Back Edges', { type: 'backEdges' }),
  missing('I', 'i', false, 'Photo Matching'),
  // Axis locking while using a tool
  bind('→', 'arrowright', false, 'Lock to red axis', { type: 'lock', lock: 'x' }),
  bind('←', 'arrowleft', false, 'Lock to green axis', { type: 'lock', lock: 'y' }),
  bind('↑', 'arrowup', false, 'Lock to blue axis', { type: 'lock', lock: 'z' }),
  bind('↓', 'arrowdown', false, 'Lock parallel, then perpendicular, to the last edge', { type: 'lock', lock: 'parallel' }),
];

/** The binding for a key press (Ctrl/Cmd/Alt combinations are handled elsewhere). */
export function bindingFor(key: string, shift: boolean): KeyBinding | undefined {
  const k = key.toLowerCase();
  return KEY_BINDINGS.find((b) => b.key === k && b.shift === shift);
}

/** "Rectangle (R)" for tooltips. */
export function withShortcut(name: string, toolId?: ToolId): string {
  const b = KEY_BINDINGS.find((x) => (toolId ? x.action.type === 'tool' && x.action.tool === toolId : x.name === name));
  return b ? `${name} (${b.label})` : name;
}
