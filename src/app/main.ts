import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initBooleanKernel } from '../core';
import { Document } from '../doc/Document';
import { ToolController } from '../tools/ToolController';
import type { ToolId } from '../tools/types';
import type { StandardView } from '../view/navigation';
import { Viewer } from '../view/Viewer';
import { FileCommands } from './fileCommands';
import { createFileHost, isTauri } from './files';
import { ICONS } from './icons';
import type { Command } from './commands';
import { bindingFor, KEY_BINDINGS, withShortcut } from './keymap';
import { SearchBox } from './searchBox';

const NAV_HINT = 'Orbit: right-drag · Re-centre: double right-click · Pan: middle-drag · Zoom: wheel · Lock axis: arrow keys';

/** Palette order (pairs per row, like the reference layout). Shortcuts come from the keymap. */
const TOOLS: { id: ToolId; icon: string; label: string }[] = [
  { id: 'select', icon: ICONS.select, label: 'Select' },
  { id: 'lasso', icon: ICONS.lasso, label: 'Lasso Select' },
  { id: 'eraser', icon: ICONS.eraser, label: 'Eraser' },
  { id: 'line', icon: ICONS.line, label: 'Line' },
  { id: 'rectangle', icon: ICONS.rectangle, label: 'Rectangle' },
  { id: 'circle', icon: ICONS.circle, label: 'Circle' },
  { id: 'arc', icon: ICONS.arc, label: 'Arc (centre)' },
  { id: 'arc2', icon: ICONS.arc2, label: '2-Point Arc' },
  { id: 'arc3', icon: ICONS.arc3, label: '3-Point Arc' },
  { id: 'pushpull', icon: ICONS.pushpull, label: 'Push/Pull' },
  { id: 'offset', icon: ICONS.offset, label: 'Offset' },
  { id: 'move', icon: ICONS.move, label: 'Move' },
  { id: 'rotate', icon: ICONS.rotate, label: 'Rotate' },
  { id: 'scale', icon: ICONS.scale, label: 'Scale' },
  { id: 'tape', icon: ICONS.tape, label: 'Tape Measure' },
  { id: 'text', icon: ICONS.text, label: 'Text' },
  { id: 'orbit', icon: ICONS.orbit, label: 'Orbit' },
  { id: 'pan', icon: ICONS.pan, label: 'Pan' },
  { id: 'zoom', icon: ICONS.zoom, label: 'Zoom' },
];

async function start(): Promise<void> {
  await initBooleanKernel({ wasmUrl });
  const doc = new Document();
  const viewer = new Viewer(document.getElementById('viewport')!, doc.model, doc.guides, doc.labels);
  const controller = new ToolController(doc, () => viewer.projector());
  const files = new FileCommands(await createFileHost(), controller);
  if (import.meta.env.DEV) Object.assign(window, { __app: { doc, viewer, controller, files } });

  const hint = document.getElementById('status-hint')!;
  const nav = document.getElementById('status-hover')!;
  const vcb = document.getElementById('measurements') as HTMLInputElement;
  const vcbLabel = document.getElementById('measurements-label')!;
  nav.textContent = NAV_HINT;

  /** Text being typed into the Measurements box, or null when it shows the tool's value. */
  let typing: string | null = null;
  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  let undoButton: HTMLButtonElement | undefined;
  let redoButton: HTMLButtonElement | undefined;

  const updateTitle = async () => {
    document.title = files.title();
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setTitle(files.title());
    }
  };
  files.onTitleChange = () => void updateTitle();

  let lastDirty = controller.dirty;
  const update = () => {
    const tool = controller.tool;
    hint.textContent = controller.hint();
    hint.classList.toggle('is-error', controller.error !== null);
    vcbLabel.textContent = tool.vcbLabel() || 'Measurements';
    vcb.disabled = tool.vcbLabel() === '';
    if (typing === null) vcb.value = tool.vcbValue();
    for (const [id, b] of toolButtons) b.setAttribute('aria-pressed', String(id === tool.id));
    viewer.leftDragNavigation = tool.id === 'orbit' || tool.id === 'pan' || tool.id === 'zoom' ? tool.id : null;
    const { undoLabel, redoLabel } = controller.history;
    if (undoButton) {
      undoButton.disabled = !undoLabel;
      undoButton.title = undoLabel ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)';
    }
    if (redoButton) {
      redoButton.disabled = !redoLabel;
      redoButton.title = redoLabel ? `Redo ${redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)';
    }
    if (controller.dirty !== lastDirty) {
      lastDirty = controller.dirty;
      void updateTitle();
    }
    viewer.setOverlay({
      selectedFaces: controller.selection.faces,
      selectedEdges: controller.selection.edges,
      selectedLabels: controller.selection.labels,
      selectedGuides: controller.selection.guides,
      preview: controller.preview(),
      snap: tool.id === 'select' || tool.id === 'lasso' ? null : controller.snap,
    });
  };
  controller.onUpdate = update;
  controller.onModelChanged = () => viewer.refresh();

  viewer.onLabelClick = (id, shift) => {
    typing = null;
    controller.labelClicked(id, shift);
  };
  viewer.onPointer = (kind, sample) => {
    if (kind === 'move') controller.pointerMove(sample);
    else if (kind === 'down') controller.pointerDown(sample);
    else if (kind === 'up') controller.pointerUp(sample);
    else controller.doubleClick(sample);
  };

  const setTool = (id: ToolId) => {
    typing = null;
    controller.setTool(id);
  };

  buildPalette(toolButtons, setTool);
  const search = new SearchBox(document.getElementById('viewport')!, () => commandList(viewer, controller, files, setTool));
  ({ undoButton, redoButton } = buildToolbar(viewer, controller, files));

  const submitTyped = () => {
    const text = typing ?? vcb.value;
    typing = null;
    controller.typed(text);
    vcb.blur();
    update();
  };
  vcb.addEventListener('input', () => (typing = vcb.value));
  vcb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitTyped();
    else if (e.key === 'Escape') {
      typing = null;
      vcb.blur();
      update();
    }
    e.stopPropagation();
  });

  // Ctrl tapped on its own (pressed and released with no other key) toggles copy mode, as in
  // SketchUp; Ctrl+Z and friends must not toggle it.
  let ctrlAlone = false;
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control' && ctrlAlone) controller.toggleCopy();
    if (e.key === 'Control') ctrlAlone = false;
  });
  window.addEventListener('pointerdown', () => (ctrlAlone = false), true);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
    const key = e.key;
    ctrlAlone = key === 'Control' && !e.repeat;
    if (key === 'Control') return;
    const lower = key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      const command: Record<string, () => void> = {
        z: () => (e.shiftKey ? controller.redo() : controller.undo()),
        y: () => controller.redo(),
        s: () => void files.save(e.shiftKey),
        o: () => void files.open(),
        n: () => void files.newDocument(),
      };
      if (command[lower]) {
        e.preventDefault();
        typing = null;
        command[lower]();
      }
      return;
    }
    if (e.altKey) return;
    // Typing a value goes straight to the Measurements box, as in SketchUp: digits and signs start
    // it; once started, everything printable (units, commas) goes there too.
    // While a tool takes text (editing a label), every printable key is text.
    const startsValue = /^[0-9.,;\-+'"]$/.test(key) || !!controller.tool.acceptsText?.();
    if (!vcb.disabled && key.length === 1 && (typing !== null || startsValue)) {
      typing = (typing ?? '') + key;
      vcb.value = typing;
      e.preventDefault();
      return;
    }
    if (typing !== null && key === 'Backspace') {
      typing = typing.slice(0, -1) || null;
      vcb.value = typing ?? controller.tool.vcbValue();
      e.preventDefault();
      return;
    }
    if (key === 'Enter' && typing !== null) {
      submitTyped();
      e.preventDefault();
      return;
    }
    if (key === 'Escape') {
      typing = null;
      controller.escape();
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      controller.deleteSelection();
      e.preventDefault();
      return;
    }
    const binding = bindingFor(key, e.shiftKey);
    if (!binding) return;
    e.preventDefault();
    const action = binding.action;
    if (action.type === 'tool') setTool(action.tool);
    else if (action.type === 'zoomExtents') viewer.zoomExtents();
    else if (action.type === 'backEdges') controller.notify(viewer.toggleBackEdges() ? 'Back edges shown (K to hide)' : 'Back edges hidden');
    else if (action.type === 'search') search.open();
    else if (action.type === 'lock') controller.toggleLock(action.lock);
    else controller.notify(`${action.name} (${binding.label}) is ${action.reason}.`);
  });

  await guardUnsavedChanges(controller, files);
  void updateTitle();
  update();
}

/** Warn before closing the window/tab with unsaved changes. */
async function guardUnsavedChanges(controller: ToolController, files: FileCommands): Promise<void> {
  if (!isTauri()) {
    // Not in the dev server: Vite reloads the page on every code change, and the prompt would
    // block those reloads.
    if (import.meta.env.DEV) return;
    window.addEventListener('beforeunload', (e) => {
      if (controller.dirty) e.preventDefault();
    });
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    if (!(await files.confirmDiscard())) event.preventDefault();
  });
}

/** Everything the Search box can run: all tools, then file, edit, view and guide actions. */
function commandList(viewer: Viewer, controller: ToolController, files: FileCommands, setTool: (id: ToolId) => void): Command[] {
  const keyOf = (pred: (b: (typeof KEY_BINDINGS)[number]) => boolean) => KEY_BINDINGS.find(pred)?.label;
  const tools: Command[] = TOOLS.map((t) => ({
    id: `tool:${t.id}`,
    name: t.label,
    keywords: ['tool'],
    shortcut: keyOf((b) => b.action.type === 'tool' && b.action.tool === t.id),
    run: () => setTool(t.id),
  }));
  const views = (['iso', 'top', 'front', 'right', 'back', 'left'] as const).map((v) => ({
    id: `view:${v}`,
    name: `${v[0].toUpperCase()}${v.slice(1)} View`,
    keywords: ['camera', 'standard view'],
    run: () => viewer.setView(v),
  }));
  return [
    ...tools,
    { id: 'file:new', name: 'New', keywords: ['file', 'document'], shortcut: 'Ctrl+N', run: () => void files.newDocument() },
    { id: 'file:open', name: 'Open…', keywords: ['file', 'load'], shortcut: 'Ctrl+O', run: () => void files.open() },
    { id: 'file:save', name: 'Save', keywords: ['file'], shortcut: 'Ctrl+S', run: () => void files.save() },
    { id: 'file:saveas', name: 'Save As…', keywords: ['file'], shortcut: 'Ctrl+Shift+S', run: () => void files.save(true) },
    { id: 'file:stl', name: 'Export STL…', keywords: ['export', '3d print', 'mesh'], run: () => void files.exportStl() },
    { id: 'file:obj', name: 'Export OBJ…', keywords: ['export', 'mesh'], run: () => void files.exportObj() },
    { id: 'edit:undo', name: 'Undo', keywords: ['edit'], shortcut: 'Ctrl+Z', run: () => controller.undo() },
    { id: 'edit:redo', name: 'Redo', keywords: ['edit'], shortcut: 'Ctrl+Y', run: () => controller.redo() },
    { id: 'edit:selectall', name: 'Select All', keywords: ['edit', 'selection'], run: () => controller.selectAll() },
    { id: 'edit:delete', name: 'Delete Selection', keywords: ['edit', 'erase', 'remove'], shortcut: 'Delete', run: () => controller.deleteSelection() },
    { id: 'view:extents', name: 'Zoom Extents', keywords: ['camera', 'fit'], shortcut: 'Shift+Z', run: () => viewer.zoomExtents() },
    ...views,
    { id: 'view:backedges', name: 'Back Edges', keywords: ['hidden', 'x-ray', 'view'], shortcut: 'K', run: () => controller.notify(viewer.toggleBackEdges() ? 'Back edges shown (K to hide)' : 'Back edges hidden') },
    { id: 'guides:toggle', name: 'Show/Hide Guides', keywords: ['guide', 'construction'], run: () => controller.toggleGuides() },
    { id: 'guides:delete', name: 'Delete All Guides', keywords: ['guide', 'construction'], run: () => controller.deleteGuides() },
  ];
}

function buildPalette(buttons: Map<ToolId, HTMLButtonElement>, setTool: (id: ToolId) => void): void {
  const palette = document.getElementById('palette')!;
  for (const t of TOOLS) {
    const b = iconButton(t.icon, withShortcut(t.label, t.id), () => setTool(t.id));
    buttons.set(t.id, b);
    palette.append(b);
  }
}

function buildToolbar(viewer: Viewer, controller: ToolController, files: FileCommands) {
  const bar = document.getElementById('toolbar')!;
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'Benup';
  bar.append(brand);
  const sep = () => bar.append(Object.assign(document.createElement('span'), { className: 'sep' }));

  bar.append(
    iconButton(ICONS.newDoc, 'New (Ctrl+N)', () => void files.newDocument()),
    iconButton(ICONS.open, 'Open (Ctrl+O)', () => void files.open()),
    iconButton(ICONS.save, 'Save (Ctrl+S) · Save As (Ctrl+Shift+S)', () => void files.save()),
  );
  sep();
  const undoButton = iconButton(ICONS.undo, 'Undo (Ctrl+Z)', () => controller.undo());
  const redoButton = iconButton(ICONS.redo, 'Redo (Ctrl+Y)', () => controller.redo());
  bar.append(undoButton, redoButton);
  sep();
  bar.append(
    textButton(ICONS.exportFile, 'STL', 'Export STL (binary, for 3D printing)', () => void files.exportStl()),
    textButton(ICONS.exportFile, 'OBJ', 'Export OBJ', () => void files.exportObj()),
  );
  sep();
  bar.append(iconButton(ICONS.zoomExtents, withShortcut('Zoom Extents'), () => viewer.zoomExtents()));
  const views: [Exclude<StandardView, 'bottom'>, string][] = [
    ['iso', 'Iso'],
    ['top', 'Top'],
    ['front', 'Front'],
    ['right', 'Right'],
    ['back', 'Back'],
    ['left', 'Left'],
  ];
  for (const [view, label] of views) bar.append(iconButton(ICONS[view], `${label} view`, () => viewer.setView(view)));
  sep();
  const guidesButton = iconButton(ICONS.guides, 'Show/hide guides', () => {
    controller.toggleGuides();
    guidesButton.setAttribute('aria-pressed', String(controller.doc.guides.visible));
  });
  guidesButton.setAttribute('aria-pressed', 'true');
  bar.append(guidesButton, iconButton(ICONS.guidesDelete, 'Delete all guides', () => controller.deleteGuides()));
  return { undoButton, redoButton };
}

function iconButton(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-button';
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = icon;
  b.addEventListener('click', () => {
    onClick();
    b.blur(); // keep keyboard input going to the viewport / Measurements box
  });
  return b;
}

function textButton(icon: string, text: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = iconButton(icon, title, onClick);
  b.classList.add('with-text');
  b.append(Object.assign(document.createElement('span'), { textContent: text }));
  return b;
}

start().catch((err: unknown) => {
  console.error(err);
  document.getElementById('status-hint')!.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
