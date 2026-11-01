import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initBooleanKernel } from '../core';
import { Document } from '../doc/Document';
import { ToolController } from '../tools/ToolController';
import type { ToolId } from '../tools/types';
import type { StandardView } from '../view/navigation';
import { Viewer } from '../view/Viewer';
import { FileCommands } from './fileCommands';
import { confirmDialog } from './dialogs';
import { createFileHost, isTauri } from './files';
import { ICONS } from './icons';
import type { Command } from './commands';
import { bindingFor, KEY_BINDINGS, withShortcut } from './keymap';
import { MaterialsPanel } from './materialsPanel';
import { ScenePlayer } from './scenePlayer';
import { ScenesPanel } from './scenesPanel';
import { ContextMenu } from './contextMenuView';
import { EntityInfoPanel } from './entityInfoPanel';
import { contextMenuItems } from '../tools/contextMenu';
import { createBackupStore } from './backups';
import { HistoryPanel } from './historyPanel';
import { helpMenu, LINKS, openLink, showShortcuts } from './help';
import { Lifecycle } from './lifecycle';
import type { FaceStyle } from '../doc/Scenes';
import { SearchBox } from './searchBox';

const NAV_HINT = 'Orbit: middle-drag · Pan: right-drag · Re-centre: double right-click · Zoom: wheel · Lock axis: arrow keys';

/** Palette order (pairs per row, like the reference layout). Shortcuts come from the keymap. */
const TOOLS: { id: ToolId; icon: string; label: string }[] = [
  { id: 'select', icon: ICONS.select, label: 'Select' },
  { id: 'lasso', icon: ICONS.lasso, label: 'Lasso Select' },
  { id: 'eraser', icon: ICONS.eraser, label: 'Eraser' },
  { id: 'line', icon: ICONS.line, label: 'Line' },
  { id: 'rectangle', icon: ICONS.rectangle, label: 'Rectangle' },
  { id: 'rectangle3', icon: ICONS.rectangle3, label: 'Rotated Rectangle' },
  { id: 'circle', icon: ICONS.circle, label: 'Circle' },
  { id: 'polygon', icon: ICONS.polygon, label: 'Polygon' },
  { id: 'arc', icon: ICONS.arc, label: 'Arc (centre)' },
  { id: 'arc2', icon: ICONS.arc2, label: '2-Point Arc' },
  { id: 'arc3', icon: ICONS.arc3, label: '3-Point Arc' },
  { id: 'pie', icon: ICONS.pie, label: 'Pie' },
  { id: 'pushpull', icon: ICONS.pushpull, label: 'Push/Pull' },
  { id: 'offset', icon: ICONS.offset, label: 'Offset' },
  { id: 'followMe', icon: ICONS.followMe, label: 'Follow Me' },
  { id: 'paint', icon: ICONS.paint, label: 'Paint Bucket' },
  { id: 'move', icon: ICONS.move, label: 'Move' },
  { id: 'rotate', icon: ICONS.rotate, label: 'Rotate' },
  { id: 'scale', icon: ICONS.scale, label: 'Scale' },
  { id: 'tape', icon: ICONS.tape, label: 'Tape Measure' },
  { id: 'text', icon: ICONS.text, label: 'Text' },
  { id: 'orbit', icon: ICONS.orbit, label: 'Orbit' },
  { id: 'pan', icon: ICONS.pan, label: 'Pan' },
  { id: 'zoom', icon: ICONS.zoom, label: 'Zoom' },
  { id: 'zoomWindow', icon: ICONS.zoomWindow, label: 'Zoom Window' },
];

async function start(): Promise<void> {
  await initBooleanKernel({ wasmUrl });
  const doc = new Document();
  const viewer = new Viewer(document.getElementById('viewport')!, doc);
  const controller = new ToolController(doc, () => viewer.projector());
  // Settings, autosave, recovery and updates (Lifecycle), and the file commands that use them.
  let lifecycle!: Lifecycle;
  const backups = await createBackupStore(() => lifecycle.settings.backupFolder);
  lifecycle = new Lifecycle(controller, viewer, backups);
  const files = new FileCommands(await createFileHost(), controller, {
    settings: () => lifecycle.settings,
    autosave: lifecycle.autosave,
    onNewerFile: () => void lifecycle.checkForUpdates(),
  });
  lifecycle.attach(files);
  const materials = new MaterialsPanel(document.getElementById('materials-panel')!, controller, () => setTool('paint'));
  controller.sceneView = viewer;
  const player = new ScenePlayer(controller);
  const scenes = new ScenesPanel(document.getElementById('scenes-panel')!, controller, player);
  player.onChange = () => update();
  const info = new EntityInfoPanel(document.getElementById('info-panel')!, controller);
  const history = new HistoryPanel(
    document.getElementById('history-panel')!,
    controller,
    () => lifecycle.settings.history,
    (id) => controller.restoreVersion(id, lifecycle.historyLimit),
  );
  const menu = new ContextMenu();
  menu.onDone = () => update();
  if (import.meta.env.DEV) Object.assign(window, { __app: { doc, viewer, controller, files, materials, scenes, player, history, lifecycle } });

  const hint = document.getElementById('status-hint')!;
  const nav = document.getElementById('status-hover')!;
  const vcb = document.getElementById('measurements') as HTMLInputElement;
  const vcbLabel = document.getElementById('measurements-label')!;
  const contextBadge = document.getElementById('context-badge')!;
  contextBadge.addEventListener('click', () => controller.exitGroup());
  const autosaved = document.getElementById('status-saved')!;
  // While looking at an earlier version: what it is, Restore, Back to now.
  const previewBar = document.getElementById('preview-bar')!;
  const previewText = document.createElement('span');
  const restoreButton = Object.assign(document.createElement('button'), { type: 'button', className: 'primary', textContent: 'Restore this version' });
  const backButton = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Back to now' });
  restoreButton.addEventListener('click', () => controller.previewing && controller.restoreVersion(controller.previewing.id, lifecycle.historyLimit));
  backButton.addEventListener('click', () => controller.endPreview());
  previewBar.append(previewText, restoreButton, backButton);
  viewer.onGraphicsReset = (state) => controller.notify(state === 'lost' ? 'The graphics driver reset: redrawing…' : 'Graphics restored');
  nav.textContent = NAV_HINT;

  /** Text being typed into the Measurements box, or null when it shows the tool's value. */
  let typing: string | null = null;
  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  let undoButton: HTMLButtonElement | undefined;
  let redoButton: HTMLButtonElement | undefined;
  let materialsButton: HTMLButtonElement | undefined;
  let viewButtons: ViewButtons | undefined;
  const tabs = document.getElementById('scene-tabs')!;
  let tabsShown = '';
  /** The quick-access tabs along the top of the viewport, one per scene. */
  const renderTabs = () => {
    const items = controller.doc.scenes.items;
    const key = JSON.stringify([items.map((s) => [s.id, s.name]), controller.currentScene]);
    if (key === tabsShown) return;
    tabsShown = key;
    tabs.hidden = items.length === 0;
    tabs.replaceChildren(
      ...items.map((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'scene-tab';
        b.textContent = s.name;
        b.title = `Go to ${s.name} (Page Up / Page Down step through scenes)`;
        b.setAttribute('aria-pressed', String(s.id === controller.currentScene));
        b.addEventListener('click', () => {
          player.stop();
          controller.goToScene(s.id);
          b.blur();
        });
        return b;
      }),
    );
  };

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
    materials.render();
    scenes.render();
    info.render();
    history.render();
    const viewing = controller.previewing ? controller.doc.versions.get(controller.previewing.id) : undefined;
    previewBar.hidden = !viewing;
    if (viewing) previewText.textContent = `Looking at the version from ${new Date(viewing.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${viewing.label} (read-only)`;
    autosaved.textContent = lifecycle.lastAutosave ? `Autosaved ${new Date(lifecycle.lastAutosave).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '';
    viewButtons?.history.setAttribute('aria-pressed', String(history.isOpen));
    renderTabs();
    if (viewButtons) {
      const style = viewer.displayStyle();
      for (const [f, b] of viewButtons.styles) b.setAttribute('aria-pressed', String(style.faces === f));
      viewButtons.projection.innerHTML = viewer.projection === 'parallel' ? ICONS.parallel : ICONS.perspective;
      viewButtons.projection.title = viewer.projection === 'parallel' ? 'Parallel projection (click for perspective)' : 'Perspective (click for parallel projection)';
      viewButtons.scenes.setAttribute('aria-pressed', String(scenes.isOpen));
    }
    const editing = controller.editingName;
    contextBadge.hidden = editing === null;
    if (editing !== null) contextBadge.textContent = `Editing ${editing} · Close`;
    materialsButton?.setAttribute('aria-pressed', String(materials.isOpen));
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
      selectedGroups: controller.selection.groups,
      preview: controller.preview(),
      snap: ['select', 'lasso', 'zoomWindow', 'paint', 'followMe'].includes(tool.id) ? null : controller.snap,
    });
  };
  controller.onUpdate = update;
  controller.onModelChanged = () => viewer.refresh();
  controller.onZoomWindow = (from, to) => viewer.zoomWindow(from, to);
  controller.onZoomTo = (min, max) => viewer.zoomTo(min, max);
  controller.ask = (message) => confirmDialog('Resize model', message, 'Resize');

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

  // One side panel at a time.
  const panels = { materials, scenes, info, history };
  const togglePanel = (which: keyof typeof panels, open = !panels[which].isOpen) => {
    for (const [k, p] of Object.entries(panels)) if (k !== which && open) p.toggle(false);
    panels[which].toggle(open);
    update();
  };
  const setTool = (id: ToolId) => {
    typing = null;
    if (id === 'paint' && !materials.isOpen) togglePanel('materials', true);
    controller.setTool(id);
  };
  const toggleMaterials = () => togglePanel('materials');
  const toggleScenes = () => togglePanel('scenes');
  const showEntityInfo = () => togglePanel('info', true);
  const keep: KeepActions = {
    toggleHistory: () => togglePanel('history'),
    settings: () => void lifecycle.openSettings(),
    checkUpdates: () => void lifecycle.checkForUpdates(),
    about: () => void lifecycle.about(),
    saveCopy: () => void files.saveCopyWithoutHistory(),
    help: (anchor) => {
      const r = anchor.getBoundingClientRect();
      menu.open(helpMenu({ checkForUpdates: keep.checkUpdates, about: keep.about }), r.left - 2, r.bottom);
    },
  };

  // Right-click: select what is under the cursor (unless already selected), then the menu.
  viewer.onContextMenu = (sample, [x, y]) => {
    typing = null;
    player.stop();
    controller.contextPick(sample);
    menu.open(contextMenuItems(controller, { entityInfo: showEntityInfo }), x, y);
  };
  const view: ViewActions = {
    setFaces: (faces) => {
      viewer.setDisplayStyle({ faces });
      update();
    },
    toggleProjection: () => {
      viewer.setProjection(viewer.projection === 'parallel' ? 'perspective' : 'parallel');
      controller.notify(viewer.projection === 'parallel' ? 'Parallel projection' : 'Perspective');
    },
    chooseBackground: () => {
      const input = Object.assign(document.createElement('input'), { type: 'color', value: viewer.displayStyle().background });
      input.addEventListener('input', () => viewer.setDisplayStyle({ background: input.value }));
      input.click();
    },
    toggleScenes,
    player,
  };
  // Any click in the viewport stops a running slideshow.
  document.getElementById('viewport')!.addEventListener('pointerdown', () => player.stop(), true);

  buildPalette(toolButtons, setTool);
  const search = new SearchBox(document.getElementById('viewport')!, () => commandList(viewer, controller, files, setTool, toggleMaterials, view, showEntityInfo, keep));
  ({ undoButton, redoButton, materialsButton, viewButtons } = buildToolbar(viewer, controller, files, toggleMaterials, view, keep));

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
        g: () => controller.makeGroup(),
        i: () => void files.importModel(),
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
      if (player.playing) player.stop();
      else if (controller.previewing) controller.endPreview();
      else controller.escape();
      return;
    }
    if (key === 'F1') {
      e.preventDefault();
      showShortcuts();
      return;
    }
    if (key === 'PageDown' || key === 'PageUp') {
      e.preventDefault();
      player.stop();
      controller.stepScene(key === 'PageDown' ? 1 : -1);
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
    else if (action.type === 'previousView') previousView(viewer, controller);
    else if (action.type === 'backEdges') controller.notify(viewer.toggleBackEdges() ? 'Back edges shown (K to hide)' : 'Back edges hidden');
    else if (action.type === 'search') search.open();
    else if (action.type === 'lock') controller.toggleLock(action.lock);
    else controller.notify(`${action.name} (${binding.label}) is ${action.reason}.`);
  });

  await guardUnsavedChanges(controller, files);
  void updateTitle();
  update();
  await lifecycle.start();
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

/** Open the selected group for editing (the same as double-clicking it). */
function editSelectedGroup(controller: ToolController): void {
  const [id] = controller.selection.groups;
  if (id === undefined) controller.notify('Select a group to edit (or double-click it)');
  else controller.enterGroup(id);
}

/** Back to the view before the last orbit, pan, zoom or standard view. */
function previousView(viewer: Viewer, controller: ToolController): void {
  if (!viewer.previousView()) controller.notify('No previous view');
}

/** Everything the Search box can run: all tools, then file, edit, view and guide actions. */
/** View actions the toolbar and Search share. */
interface ViewActions {
  setFaces(faces: FaceStyle): void;
  toggleProjection(): void;
  chooseBackground(): void;
  toggleScenes(): void;
  player: ScenePlayer;
}

interface ViewButtons {
  styles: Map<FaceStyle, HTMLButtonElement>;
  projection: HTMLButtonElement;
  scenes: HTMLButtonElement;
  history: HTMLButtonElement;
}

const FACE_STYLES: [FaceStyle, string, string][] = [
  ['textured', 'Textured', ICONS.styleTextured],
  ['shaded', 'Shaded (colours, no textures)', ICONS.styleShaded],
  ['wireframe', 'Wireframe (edges only)', ICONS.styleWireframe],
  ['xray', 'X-ray (see-through faces)', ICONS.styleXray],
];

/** Keeping work safe and the app current (toolbar and Search share these). */
interface KeepActions {
  toggleHistory(): void;
  settings(): void;
  checkUpdates(): void;
  about(): void;
  saveCopy(): void;
  /** The Help menu, under its toolbar button. */
  help(anchor: HTMLElement): void;
}

function commandList(viewer: Viewer, controller: ToolController, files: FileCommands, setTool: (id: ToolId) => void, toggleMaterials: () => void, view: ViewActions, showEntityInfo: () => void, keep: KeepActions): Command[] {
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
    { id: 'file:copy', name: 'Save a Copy Without History…', keywords: ['file', 'share', 'send', 'export'], run: keep.saveCopy },
    { id: 'file:history', name: 'History (earlier versions)', keywords: ['versions', 'restore', 'backup', 'go back', 'revert'], run: keep.toggleHistory },
    { id: 'app:settings', name: 'Settings', keywords: ['preferences', 'options', 'autosave', 'backup folder'], run: keep.settings },
    { id: 'app:update', name: 'Check for Updates', keywords: ['version', 'upgrade', 'new version'], run: keep.checkUpdates },
    { id: 'help:keys', name: 'Keyboard and Mouse', keywords: ['shortcuts', 'keys', 'help'], shortcut: 'F1', run: showShortcuts },
    { id: 'help:new', name: 'What’s New in This Version', keywords: ['release notes', 'changelog', 'help'], run: () => void openLink(LINKS.releaseNotes) },
    { id: 'help:issue', name: 'Report a Problem or Idea', keywords: ['bug', 'feedback', 'issue', 'help'], run: () => void openLink(LINKS.newIssue) },
    { id: 'app:about', name: 'About VormCraft', keywords: ['version', 'graphics', 'gpu', 'help'], run: keep.about },
    { id: 'file:import', name: 'Import OBJ or STL…', keywords: ['file', 'open', 'mesh', '3d print', 'load'], shortcut: 'Ctrl+I', run: () => void files.importModel() },
    { id: 'file:stl', name: 'Export STL…', keywords: ['export', '3d print', 'mesh'], run: () => void files.exportStl() },
    { id: 'file:obj', name: 'Export OBJ…', keywords: ['export', 'mesh'], run: () => void files.exportObj() },
    { id: 'edit:undo', name: 'Undo', keywords: ['edit'], shortcut: 'Ctrl+Z', run: () => controller.undo() },
    { id: 'edit:redo', name: 'Redo', keywords: ['edit'], shortcut: 'Ctrl+Y', run: () => controller.redo() },
    { id: 'edit:selectall', name: 'Select All', keywords: ['edit', 'selection'], run: () => controller.selectAll() },
    { id: 'edit:delete', name: 'Delete Selection', keywords: ['edit', 'erase', 'remove'], shortcut: 'Delete', run: () => controller.deleteSelection() },
    { id: 'group:make', name: 'Make Group', keywords: ['group', 'combine'], shortcut: 'Ctrl+G', run: () => controller.makeGroup() },
    { id: 'group:explode', name: 'Explode Group', keywords: ['group', 'ungroup', 'explode'], run: () => controller.explodeSelection() },
    { id: 'group:edit', name: 'Edit Group', keywords: ['group', 'open', 'enter'], run: () => editSelectedGroup(controller) },
    { id: 'group:close', name: 'Close Group', keywords: ['group', 'exit', 'leave'], run: () => controller.exitGroup() },
    { id: 'view:extents', name: 'Zoom Extents', keywords: ['camera', 'fit'], shortcut: 'Shift+Z', run: () => viewer.zoomExtents() },
    { id: 'view:previous', name: 'Previous View', keywords: ['camera', 'back', 'undo view'], shortcut: 'Shift+V', run: () => previousView(viewer, controller) },
    ...views,
    { id: 'view:backedges', name: 'Back Edges', keywords: ['hidden', 'x-ray', 'view'], shortcut: 'K', run: () => controller.notify(viewer.toggleBackEdges() ? 'Back edges shown (K to hide)' : 'Back edges hidden') },
    { id: 'view:materials', name: 'Materials', keywords: ['paint', 'colour', 'color', 'texture'], run: toggleMaterials },
    ...FACE_STYLES.map(([f, label]) => ({ id: `style:${f}`, name: `Style: ${label}`, keywords: ['style', 'display', 'faces', 'view'], run: () => view.setFaces(f) })),
    { id: 'view:projection', name: 'Parallel / Perspective Projection', keywords: ['camera', 'orthographic', 'ortho', 'perspective', 'parallel'], run: view.toggleProjection },
    { id: 'view:background', name: 'Background Colour…', keywords: ['style', 'color', 'sky'], run: view.chooseBackground },
    { id: 'scenes:panel', name: 'Scenes', keywords: ['scene', 'view', 'pages', 'tabs'], run: view.toggleScenes },
    { id: 'scenes:add', name: 'Add Scene', keywords: ['scene', 'save view'], run: () => controller.addScene() },
    { id: 'scenes:update', name: 'Update Scene', keywords: ['scene', 'overwrite'], run: () => (controller.currentScene !== null ? controller.updateScene(controller.currentScene) : controller.notify('Go to a scene first, then update it')) },
    { id: 'scenes:next', name: 'Next Scene', keywords: ['scene'], shortcut: 'Page Down', run: () => controller.stepScene(1) },
    { id: 'scenes:previous', name: 'Previous Scene', keywords: ['scene'], shortcut: 'Page Up', run: () => controller.stepScene(-1) },
    { id: 'scenes:play', name: 'Play Scenes (Slideshow)', keywords: ['scene', 'animation', 'walkthrough', 'slideshow'], run: () => view.player.toggle() },
    { id: 'edit:info', name: 'Entity Info', keywords: ['properties', 'details', 'area', 'length', 'rename'], run: showEntityInfo },
    { id: 'edit:reverse', name: 'Reverse Faces', keywords: ['flip', 'orient', 'inside out', 'normal'], run: () => controller.reverseSelectedFaces() },
    { id: 'edit:soften', name: 'Soften Edges', keywords: ['smooth', 'hide edges'], run: () => controller.softenSelection(true) },
    { id: 'edit:unsoften', name: 'Unsoften Edges', keywords: ['smooth', 'show edges', 'hard'], run: () => controller.softenSelection(false) },
    ...(['Red', 'Green', 'Blue'] as const).map((c, i) => ({ id: `edit:flip${c}`, name: `Flip Along ${c} Direction`, keywords: ['mirror', 'flip'], run: () => controller.flipSelection(i as 0 | 1 | 2) })),
    { id: 'view:zoomselection', name: 'Zoom Selection', keywords: ['camera', 'fit', 'focus'], run: () => controller.zoomSelection() },
    { id: 'select:edges', name: 'Select Bounding Edges', keywords: ['selection'], run: () => controller.selectBoundingEdges() },
    { id: 'select:connected', name: 'Select Connected Faces', keywords: ['selection'], run: () => controller.selectConnectedFaces() },
    { id: 'select:allconnected', name: 'Select All Connected', keywords: ['selection'], run: () => controller.selectAllConnected() },
    { id: 'select:material', name: 'Select All with Same Material', keywords: ['selection', 'paint'], run: () => controller.selectSameMaterial() },
    { id: 'group:hide', name: 'Hide Selected Groups', keywords: ['hide', 'visibility', 'group'], run: () => controller.hideSelection() },
    { id: 'group:unhide', name: 'Unhide All', keywords: ['show', 'unhide', 'visibility', 'group'], run: () => controller.unhideAll() },
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

function buildToolbar(viewer: Viewer, controller: ToolController, files: FileCommands, toggleMaterials: () => void, view: ViewActions, keep: KeepActions) {
  const bar = document.getElementById('toolbar')!;
  const brand = document.createElement('span');
  brand.className = 'brand';
  brand.textContent = 'VormCraft';
  bar.append(brand);
  const sep = () => bar.append(Object.assign(document.createElement('span'), { className: 'sep' }));

  bar.append(
    iconButton(ICONS.newDoc, 'New (Ctrl+N)', () => void files.newDocument()),
    iconButton(ICONS.open, 'Open (Ctrl+O)', () => void files.open()),
    iconButton(ICONS.save, 'Save (Ctrl+S) · Save As (Ctrl+Shift+S)', () => void files.save()),
    textButton(ICONS.importFile, 'Import', 'Import an OBJ or STL file (Ctrl+I)', () => void files.importModel()),
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
  bar.append(iconButton(ICONS.previousView, withShortcut('Previous View'), () => previousView(viewer, controller)));
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
  sep();
  const materialsButton = iconButton(ICONS.materials, 'Materials (colours and textures)', toggleMaterials);
  bar.append(materialsButton);
  sep();
  const styles = new Map<FaceStyle, HTMLButtonElement>();
  for (const [f, label, icon] of FACE_STYLES) {
    const b = iconButton(icon, `Style: ${label}`, () => view.setFaces(f));
    styles.set(f, b);
    bar.append(b);
  }
  const projection = iconButton(ICONS.perspective, 'Perspective (click for parallel projection)', view.toggleProjection);
  bar.append(projection);
  sep();
  const scenes = iconButton(ICONS.scenes, 'Scenes (saved views)', view.toggleScenes);
  bar.append(scenes);
  const history = iconButton(ICONS.history, 'History: earlier versions of this design', keep.toggleHistory);
  bar.append(history);
  sep();
  bar.append(iconButton(ICONS.settings, 'Settings (autosave, backups, graphics card, history, updates)', keep.settings));
  const help = iconButton(ICONS.help, 'Help: shortcuts, updates, report a problem, about', () => keep.help(help));
  bar.append(help);
  const viewButtons: ViewButtons = { styles, projection, scenes, history };
  return { undoButton, redoButton, materialsButton, viewButtons };
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
