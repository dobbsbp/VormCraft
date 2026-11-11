import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initBooleanKernel } from '../core';
import { Document } from '../doc/Document';
import { ToolController } from '../tools/ToolController';
import type { ToolId } from '../tools/types';
import type { StandardView } from '../view/navigation';
import { Viewer } from '../view/Viewer';
import { FileCommands } from './fileCommands';
import { choiceDialog, confirmDialog } from './dialogs';
import { createFileHost, isTauri } from './files';
import { ICONS } from './icons';
import type { Command } from './commands';
import { bindingFor, KEY_BINDINGS, withShortcut } from './keymap';
import { MaterialsPanel } from './materialsPanel';
import { ScenePlayer } from './scenePlayer';
import { ScenesPanel } from './scenesPanel';
import { LibraryPanel } from './libraryPanel';
import { showText3DDialog, text3dPlaceable } from './text3dDialog';
import { ContextMenu } from './contextMenuView';
import { moveTool, orderTools } from './toolOrder';
import type { MenuEntry } from '../tools/contextMenu';
import { EntityInfoPanel } from './entityInfoPanel';
import { contextMenuItems } from '../tools/contextMenu';
import { createBackupStore } from './backups';
import { HistoryPanel } from './historyPanel';
import { helpMenu, LINKS, openLink, showShortcuts } from './help';
import { Lifecycle } from './lifecycle';
import type { FaceStyle } from '../doc/Scenes';
import { SearchBox } from './searchBox';
import { showSupport } from './supportDialog';
import { DriveCommands } from './drive/driveCommands';
import { toolCursor } from './toolCursors';
import { ViewerMode } from './viewerMode';

const NAV_HINT = 'Orbit: middle-drag · Pan: right-drag · Re-centre: double middle-click · Zoom: wheel · Lock axis: arrow keys';

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
  { id: 'text3d', icon: ICONS.text3d, label: '3D Text' },
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
  // Google Drive (unless switched off: see DriveCommands.available). Switching it on or off in
  // Settings takes effect at once (syncDrive).
  const newDrive = () => new DriveCommands(files, controller, () => lifecycle.settings);
  let drive = (await DriveCommands.available()) ? newDrive() : null;
  const materials = new MaterialsPanel(document.getElementById('materials-panel')!, controller, () => setTool('paint'));
  controller.sceneView = viewer;
  const player = new ScenePlayer(controller);
  const scenes = new ScenesPanel(document.getElementById('scenes-panel')!, controller, player);
  player.onChange = () => update();
  const info = new EntityInfoPanel(document.getElementById('info-panel')!, controller);
  const library = new LibraryPanel(document.getElementById('library-panel')!, controller);
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
  let driveButton: HTMLButtonElement | null = null;
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

  let shownTitle = '';
  const updateTitle = async () => {
    const viewing = controller.previewing ? controller.doc.versions.get(controller.previewing.id) : undefined;
    const title = files.title(viewing ? new Date(viewing.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : undefined);
    if (title === shownTitle) return;
    shownTitle = title;
    document.title = title;
    const docName = document.querySelector<HTMLElement>('.toolbar .doc-name');
    if (docName) {
      docName.textContent = `${files.name}${controller.dirty ? ' •' : ''}`;
      docName.title = controller.dirty ? `${files.name} (changes not saved)` : files.name;
    }
    if (isTauri()) {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().setTitle(title);
    }
  };
  files.onTitleChange = () => void updateTitle();

  const update = () => {
    const tool = controller.tool;
    hint.textContent = controller.hint();
    hint.classList.toggle('is-error', controller.error !== null);
    vcbLabel.textContent = tool.vcbLabel() || 'Measurements';
    vcb.disabled = tool.vcbLabel() === '';
    if (typing === null) vcb.value = tool.vcbValue();
    for (const [id, b] of toolButtons) b.setAttribute('aria-pressed', String(id === tool.id));
    setToolCursor(tool.id, tool.copying?.() ?? false);
    materials.render();
    scenes.render();
    info.render();
    history.render();
    const viewing = controller.previewing ? controller.doc.versions.get(controller.previewing.id) : undefined;
    previewBar.hidden = !viewing;
    if (viewing) previewText.textContent = `Looking at the version from ${new Date(viewing.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${viewing.label} (read-only)`;
    const local = lifecycle.lastAutosave ? `Autosaved ${new Date(lifecycle.lastAutosave).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '';
    drive?.changed();
    autosaved.textContent = [local, drive?.statusText() ?? ''].filter(Boolean).join(' · ');
    driveButton?.classList.toggle('attention', drive?.needsAttention ?? false);
    viewButtons?.history.setAttribute('aria-pressed', String(history.isOpen));
    renderTabs();
    if (viewButtons) {
      const style = viewer.displayStyle();
      const current = FACE_STYLES.find(([f]) => f === style.faces) ?? FACE_STYLES[0];
      viewButtons.style.innerHTML = current[2] + MENU_CARET;
      viewButtons.style.title = `Style: ${current[1]} (click to change)`;
      viewButtons.projection.innerHTML = viewer.projection === 'parallel' ? ICONS.parallel : ICONS.perspective;
      viewButtons.projection.title = viewer.projection === 'parallel' ? 'Parallel projection (click for perspective)' : 'Perspective (click for parallel projection)';
      viewButtons.scenes.setAttribute('aria-pressed', String(scenes.isOpen));
      viewButtons.library.setAttribute('aria-pressed', String(library.isOpen));
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
    void updateTitle();
    viewer.setOverlay({
      selectedFaces: controller.selection.faces,
      selectedEdges: controller.selection.edges,
      selectedPoints: controller.selection.points,
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
  viewer.onLabelContextMenu = (id, [x, y]) => {
    typing = null;
    controller.labelContextPick(id);
    menu.open(contextMenuItems(controller, { entityInfo: showEntityInfo, mergeShapes }), x, y);
  };
  viewer.onPointer = (kind, sample) => {
    if (kind === 'move') controller.pointerMove(sample);
    else if (kind === 'down') controller.pointerDown(sample);
    else if (kind === 'up') controller.pointerUp(sample);
    else controller.doubleClick(sample);
  };

  // One side panel at a time.
  const panels = { materials, scenes, info, history, library };
  const togglePanel = (which: keyof typeof panels, open = !panels[which].isOpen) => {
    // The Materials window floats, so it stays open beside the side panels.
    if (which !== 'materials') for (const [k, p] of Object.entries(panels)) if (k !== which && k !== 'materials' && open) p.toggle(false);
    panels[which].toggle(open);
    update();
  };
  const setTool = (id: ToolId) => {
    typing = null;
    if (id === 'text3d') return void place3dText();
    if (id === 'paint' && !materials.isOpen) togglePanel('materials', true);
    controller.setTool(id);
  };
  /** 3D Text: ask for the text, then it follows the cursor like a Library item until placed. */
  const place3dText = async () => {
    const choice = await showText3DDialog();
    if (!choice) return;
    try {
      controller.place(text3dPlaceable(choice));
    } catch (err) {
      controller.notify(err instanceof Error ? err.message : String(err));
    }
  };
  const toggleMaterials = () => togglePanel('materials');
  const toggleScenes = () => togglePanel('scenes');
  const toggleLibrary = () => togglePanel('library');
  const showEntityInfo = () => togglePanel('info', true);
  const keep: KeepActions = {
    toggleHistory: () => togglePanel('history'),
    settings: () => void lifecycle.openSettings().then(() => syncDrive()),
    checkUpdates: () => void lifecycle.checkForUpdates(),
    about: () => void lifecycle.about(),
    saveCopy: () => void files.saveCopyWithoutHistory(),
    exportMenu: (anchor) => {
      const r = anchor.getBoundingClientRect();
      menu.open(
        [
          { label: 'STL (for 3D printing)', run: () => void files.exportStl() },
          { label: 'OBJ (for other 3D programs)', run: () => void files.exportObj() },
        ],
        r.left - 2,
        r.bottom,
      );
    },
    help: (anchor) => {
      const r = anchor.getBoundingClientRect();
      menu.open(helpMenu({ checkForUpdates: keep.checkUpdates, about: keep.about, support: showSupport }), r.left - 2, r.bottom);
    },
    get drive() {
      return drive;
    },
    driveMenu: (anchor) => {
      if (!drive) return;
      const r = anchor.getBoundingClientRect();
      menu.open(drive.menu(), r.left - 2, r.bottom);
    },
  };

  // Right-click: select what is under the cursor (unless already selected), then the menu.
  viewer.onContextMenu = (sample, [x, y]) => {
    typing = null;
    player.stop();
    controller.contextPick(sample);
    menu.open(contextMenuItems(controller, { entityInfo: showEntityInfo, mergeShapes }), x, y);
  };
  // Merge Shapes: flat faces merge at once; separate solids ask how to join them.
  const mergeShapes = async () => {
    const plan = controller.mergeShapesPlan();
    if ('kind' in plan && plan.kind === 'solids') {
      const choice = await choiceDialog(
        'Merge shapes',
        `You selected ${plan.count} separate solids.

Unify: join them into one solid. Where they overlap or touch, the faces inside are removed.

Keep shapes: leave every solid as it is and put them together in one group.${
          plan.flatLeft ? `\n\n${plan.flatLeft === 1 ? 'A flat face is' : `${plan.flatLeft} flat faces are`} selected too (such as the circle left inside a Follow Me ring). Unify leaves ${plan.flatLeft === 1 ? 'it' : 'them'} as ${plan.flatLeft === 1 ? 'it is' : 'they are'}.` : ''
        }`,
        [
          { label: 'Keep shapes', value: 'group' },
          { label: 'Unify', value: 'unify' },
        ],
      );
      if (choice) controller.mergeShapes(choice);
    } else controller.mergeShapes('unify');
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
    viewsMenu: (anchor) => {
      const r = anchor.getBoundingClientRect();
      menu.open(
        STANDARD_VIEWS.map(([v, label]) => ({ label: `${label} view`, run: () => viewer.setView(v) })),
        r.left - 2,
        r.bottom,
      );
    },
    styleMenu: (anchor) => {
      const r = anchor.getBoundingClientRect();
      const current = viewer.displayStyle().faces;
      menu.open(
        FACE_STYLES.map(([f, label]) => ({ label: `${f === current ? '✓ ' : ' '}${label}`, run: () => view.setFaces(f) })),
        r.left - 2,
        r.bottom,
      );
    },
    toggleLibrary,
    toggleTools: () => toggleTools(),
    toggleTopBar: () => toggleTopBar(),
    togglePaletteSide: () => togglePaletteSide(),
    resetToolOrder: () => resetToolOrder(),
    enterViewer: () => viewerMode.enter(),
    player,
  };
  // Any click in the viewport stops a running slideshow.
  document.getElementById('viewport')!.addEventListener('pointerdown', () => player.stop(), true);

  // Viewer mode (the eye): touch-friendly looking around, with the tools put away.
  const viewerMode = new ViewerMode(document.getElementById('viewport')!, {
    viewer,
    menu,
    open: () => void files.open(),
    driveShown: () => drive !== null,
    driveMenu: (anchor) => keep.driveMenu(anchor),
    onChange: (on) => {
      typing = null;
      if (on) {
        player.stop();
        menu.close();
        controller.setTool('select');
        controller.selection.clear();
        for (const p of Object.values(panels)) p.toggle(false);
      }
      update();
    },
  });
  const topBar = topBarToggle();
  const palette = buildPalette(toolButtons, setTool, menu, () => [{ label: topBar.hidden() ? 'Show Top Bar' : 'Hide Top Bar', run: topBar.toggle }]);
  const toggleTools = palette.toggle;
  const toggleTopBar = () => topBar.toggle();
  const togglePaletteSide = () => palette.setSide(palette.side() === 'left' ? 'right' : 'left');
  const resetToolOrder = () => palette.resetOrder();
  const search = new SearchBox(document.getElementById('viewport')!, () => commandList(viewer, controller, files, setTool, toggleMaterials, view, showEntityInfo, keep));
  ({ undoButton, redoButton, materialsButton, viewButtons, driveButton } = buildToolbar(viewer, controller, files, toggleMaterials, view, keep));
  const syncDrive = async () => {
    const on = await DriveCommands.available();
    if (on && !drive) drive = newDrive();
    // Switched off: no more autosaved copies; the sign-in is kept for when it is switched on again.
    if (!on) drive = null;
    driveButton!.style.display = drive ? '' : 'none';
    update();
  };

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

  // Pressing Ctrl switches copy mode at once (Move, Rotate, Push/Pull), as in SketchUp, so the + on
  // the cursor shows straight away and clicking with Ctrl held copies. If another key follows while
  // it is held, it was a shortcut (Ctrl+Z...): the switch is quietly taken back.
  let ctrlSwitched = false;
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') ctrlSwitched = false;
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || document.querySelector('dialog[open]')) return;
    const key = e.key;
    // Viewer mode has no tools: Esc leaves it; Page Up / Page Down still step through scenes.
    if (viewerMode.active) {
      if (key === 'Escape') viewerMode.exit();
      else if (key === 'PageDown' || key === 'PageUp') {
        e.preventDefault();
        player.stop();
        controller.stepScene(key === 'PageDown' ? 1 : -1);
      }
      return;
    }
    if (key === 'Control') {
      if (!e.repeat) ctrlSwitched = controller.toggleCopy();
      return;
    }
    if (ctrlSwitched) {
      controller.toggleCopy(true);
      ctrlSwitched = false;
    }
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
        // Everything in the model (not the page's text and buttons).
        a: () => controller.selectAll(),
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
    if (key === 'Enter') {
      controller.enter();
      update();
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
  /** The standard views (Iso, Top, Front…) and the face styles, as menus under their toolbar buttons. */
  viewsMenu(anchor: HTMLElement): void;
  styleMenu(anchor: HTMLElement): void;
  /** The Library panel: ready-made objects to place. */
  toggleLibrary(): void;
  toggleTools(): void;
  /** Hide the top bar (it shrinks to a thin strip with a tab), or show it again. */
  toggleTopBar(): void;
  /** Put the tool palette on the other side of the view. */
  togglePaletteSide(): void;
  /** Put the tools back in their usual order (they can be dragged to new places). */
  resetToolOrder(): void;
  /** Viewer mode: tools put away, touch navigation (see ViewerMode). */
  enterViewer(): void;
  player: ScenePlayer;
}

interface ViewButtons {
  /** Shows the current face style; opens the style menu. */
  style: HTMLButtonElement;
  projection: HTMLButtonElement;
  scenes: HTMLButtonElement;
  history: HTMLButtonElement;
  library: HTMLButtonElement;
}

const STANDARD_VIEWS: [Exclude<StandardView, 'bottom'>, string][] = [
  ['iso', 'Iso'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
];

/** A small down arrow on toolbar buttons that open a menu. */
const MENU_CARET = '<svg class="menu-caret" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 2.5 4 5.5 7 2.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

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
  /** The Export menu (STL or OBJ), under its toolbar button. */
  exportMenu(anchor: HTMLElement): void;
  /** Google Drive (null while it is switched off). */
  readonly drive: DriveCommands | null;
  /** The Google Drive menu, under its toolbar button. */
  driveMenu(anchor: HTMLElement): void;
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
    ...(keep.drive
      ? [
          { id: 'drive:save', name: 'Save to Google Drive…', keywords: ['file', 'cloud', 'drive', 'google', 'upload'], run: () => void keep.drive!.saveAs() },
          { id: 'drive:open', name: 'Open from Google Drive…', keywords: ['file', 'cloud', 'drive', 'google', 'load'], run: () => void keep.drive!.open() },
          { id: 'drive:autosave', name: 'Autosave a Copy to Google Drive (on/off)', keywords: ['cloud', 'drive', 'google', 'backup'], run: () => void keep.drive!.toggleAutosave() },
        ]
      : []),
    { id: 'file:copy', name: 'Save a Copy Without History…', keywords: ['file', 'share', 'send', 'export'], run: keep.saveCopy },
    { id: 'file:history', name: 'History (earlier versions)', keywords: ['versions', 'restore', 'backup', 'go back', 'revert'], run: keep.toggleHistory },
    { id: 'app:settings', name: 'Settings', keywords: ['preferences', 'options', 'autosave', 'backup folder'], run: keep.settings },
    { id: 'app:update', name: 'Check for Updates', keywords: ['version', 'upgrade', 'new version'], run: keep.checkUpdates },
    { id: 'help:keys', name: 'Keyboard and Mouse', keywords: ['shortcuts', 'keys', 'help'], shortcut: 'F1', run: showShortcuts },
    { id: 'help:new', name: 'What’s New in This Version', keywords: ['release notes', 'changelog', 'help'], run: () => void openLink(LINKS.releaseNotes) },
    { id: 'help:support', name: 'Support VormCraft ♥', keywords: ['donate', 'donation', 'sponsor', 'tip', 'coffee', 'qris', 'help'], run: showSupport },
    { id: 'help:issue', name: 'Report a Problem or Idea', keywords: ['bug', 'feedback', 'issue', 'help'], run: () => void openLink(LINKS.newIssue) },
    { id: 'app:about', name: 'About VormCraft', keywords: ['version', 'graphics', 'gpu', 'help'], run: keep.about },
    { id: 'file:import', name: 'Import SketchUp, OBJ or STL…', keywords: ['file', 'open', 'skp', 'sketchup', 'mesh', '3d print', 'load'], shortcut: 'Ctrl+I', run: () => void files.importModel() },
    { id: 'file:stl', name: 'Export STL…', keywords: ['export', '3d print', 'mesh'], run: () => void files.exportStl() },
    { id: 'file:obj', name: 'Export OBJ…', keywords: ['export', 'mesh'], run: () => void files.exportObj() },
    { id: 'edit:undo', name: 'Undo', keywords: ['edit'], shortcut: 'Ctrl+Z', run: () => controller.undo() },
    { id: 'edit:redo', name: 'Redo', keywords: ['edit'], shortcut: 'Ctrl+Y', run: () => controller.redo() },
    { id: 'edit:selectall', name: 'Select All', keywords: ['edit', 'selection'], shortcut: 'Ctrl+A', run: () => controller.selectAll() },
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
    { id: 'view:viewer', name: 'Viewer Mode', keywords: ['touch', 'phone', 'tablet', 'mobile', 'look', 'present', 'eye'], run: view.enterViewer },
    { id: 'view:topbar', name: 'Show / Hide Top Bar', keywords: ['toolbar', 'menu', 'header', 'hide', 'room', 'full screen', 'top'], run: view.toggleTopBar },
    { id: 'view:tools-side', name: 'Move Tools to the Other Side', keywords: ['palette', 'left', 'right', 'dock', 'layout', 'position'], run: view.togglePaletteSide },
    { id: 'view:tools-reset', name: 'Reset Tool Order', keywords: ['palette', 'order', 'layout', 'arrange', 'default'], run: view.resetToolOrder },
    { id: 'view:tools', name: 'Show / Hide Tools', keywords: ['palette', 'toolbar', 'icons', 'collapse', 'tab', 'hide', 'room'], run: view.toggleTools },
    { id: 'library:panel', name: 'Library', keywords: ['objects', 'furniture', 'components', 'models', 'catalogue', 'catalog', 'place', 'insert', 'kitchen', 'bathroom', 'sofa', 'bed', 'table', 'chair'], run: view.toggleLibrary },
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

const cursors = new Map<string, string>();
let shownCursor: string | null = null;

/** The viewport's mouse cursor shows the active tool's icon (`toolCursor`), with a + in copy mode; orbiting and panning still override it. */
function setToolCursor(id: ToolId, copy: boolean): void {
  const canvas = document.querySelector<HTMLElement>('.viewport-canvas');
  const key = `${id}${copy ? '+' : ''}`;
  if (shownCursor === key || !canvas) return;
  shownCursor = key;
  if (!cursors.has(key)) cursors.set(key, toolCursor(id, TOOLS.find((t) => t.id === id)?.icon ?? '', copy));
  canvas.style.setProperty('--tool-cursor', cursors.get(key)!);
}

const PALETTE_KEY = 'vormcraft.palette.hidden';
const PALETTE_ORDER_KEY = 'vormcraft.palette.order';
const PALETTE_SIDE_KEY = 'vormcraft.palette.side';
const TOOLBAR_KEY = 'vormcraft.toolbar.hidden';

/** Layout choices are kept on this device; without storage they last for the session. */
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Not remembered.
  }
}

interface PaletteControls {
  /** Tuck the tools away into a narrow tab, or bring them back. */
  toggle(): void;
  side(): 'left' | 'right';
  setSide(side: 'left' | 'right'): void;
  /** Whether the tools are in a different order from the usual one. */
  reordered(): boolean;
  resetOrder(): void;
}

/**
 * The tool palette, with a bar at the top that tucks it away into a narrow tab (for more room to
 * model); clicking the tab brings the tools back. Tools can be dragged to new places, the palette
 * can sit on the left or the right of the view, and right-clicking it offers those (and `more`).
 * All of it is remembered on the device.
 */
function buildPalette(buttons: Map<ToolId, HTMLButtonElement>, setTool: (id: ToolId) => void, menu: ContextMenu, more: () => MenuEntry[]): PaletteControls {
  const app = document.querySelector<HTMLElement>('.app')!;
  const palette = document.getElementById('palette')!;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'palette-toggle';
  const show = (hidden: boolean) => {
    palette.classList.toggle('collapsed', hidden);
    const title = hidden ? 'Show the tools' : 'Hide the tools';
    toggle.title = title;
    toggle.setAttribute('aria-label', title);
    toggle.setAttribute('aria-expanded', String(!hidden));
    toggle.innerHTML = hidden ? ICONS.expandRight : ICONS.collapseLeft;
    store(PALETTE_KEY, hidden ? '1' : '0');
  };
  const flip = () => show(!palette.classList.contains('collapsed'));
  toggle.addEventListener('click', () => {
    flip();
    toggle.blur(); // keep keyboard input going to the viewport / Measurements box
  });
  palette.append(toggle);

  const ids = TOOLS.map((t) => t.id);
  let saved: unknown = null;
  try {
    saved = JSON.parse(stored(PALETTE_ORDER_KEY) ?? 'null');
  } catch {
    // A damaged order: the usual one.
  }
  let order = orderTools(saved, ids);
  const toolOf = new Map<HTMLElement, ToolId>();
  for (const t of TOOLS) {
    const b = iconButton(t.icon, `${withShortcut(t.label, t.id)} · drag to move`, () => setTool(t.id));
    buttons.set(t.id, b);
    toolOf.set(b, t.id);
  }
  const layout = () => palette.append(...order.map((id) => buttons.get(id)!));
  const setOrder = (next: ToolId[]) => {
    order = next;
    store(PALETTE_ORDER_KEY, order.join() === ids.join() ? null : JSON.stringify(order));
    layout();
  };
  layout();

  // Dragging a tool (further than a click wobble) moves it before or after the tool it is dropped on.
  let drag: { id: ToolId; x: number; y: number; active: boolean; target: { id: ToolId; after: boolean } | null } | null = null;
  let swallowClick = false;
  const clearMarks = () => {
    for (const b of buttons.values()) b.classList.remove('dragging', 'drop-before', 'drop-after');
    palette.classList.remove('reordering');
  };
  palette.addEventListener('pointerdown', (e) => {
    const b = e.button === 0 && e.target instanceof Element ? e.target.closest<HTMLElement>('.icon-button') : null;
    const id = b ? toolOf.get(b) : undefined;
    drag = id ? { id, x: e.clientX, y: e.clientY, active: false, target: null } : null;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.active = true;
      buttons.get(drag.id)!.classList.add('dragging');
      palette.classList.add('reordering');
    }
    for (const b of buttons.values()) b.classList.remove('drop-before', 'drop-after');
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.icon-button');
    const id = over ? toolOf.get(over) : undefined;
    if (!over || !id || id === drag.id) {
      drag.target = null;
      return;
    }
    const r = over.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    over.classList.add(after ? 'drop-after' : 'drop-before');
    drag.target = { id, after };
  });
  const finish = (apply: boolean) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    clearMarks();
    if (apply && d.target) setOrder(moveTool(order, d.id, d.target.id, d.target.after));
    // The release after a drag is not a click on the tool.
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
  };
  window.addEventListener('pointerup', () => finish(true));
  window.addEventListener('pointercancel', () => finish(false));
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && drag?.active) {
        e.stopPropagation();
        finish(false);
      }
    },
    true,
  );
  palette.addEventListener(
    'click',
    (e) => {
      if (!swallowClick) return;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );

  const setSide = (side: 'left' | 'right') => {
    app.classList.toggle('palette-right', side === 'right');
    store(PALETTE_SIDE_KEY, side === 'right' ? 'right' : null);
  };
  const controls: PaletteControls = {
    toggle: flip,
    side: () => (app.classList.contains('palette-right') ? 'right' : 'left'),
    setSide,
    reordered: () => order.join() !== ids.join(),
    resetOrder: () => setOrder(ids),
  };
  palette.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    menu.open(
      [
        controls.side() === 'left' ? { label: 'Move Tools to the Right', run: () => setSide('right') } : { label: 'Move Tools to the Left', run: () => setSide('left') },
        { label: 'Reset Tool Order', run: controls.resetOrder, disabled: !controls.reordered() },
        { label: palette.classList.contains('collapsed') ? 'Show Tools' : 'Hide Tools', run: flip },
        ...more(),
      ],
      e.clientX,
      e.clientY,
    );
  });

  show(stored(PALETTE_KEY) === '1');
  setSide(stored(PALETTE_SIDE_KEY) === 'right' ? 'right' : 'left');
  return controls;
}

/**
 * Hiding the top bar: the toolbar shrinks to a thin strip with a tab to bring it back
 * (remembered on the device).
 */
function topBarToggle(): { toggle(): void; hidden(): boolean } {
  const app = document.querySelector<HTMLElement>('.app')!;
  const set = (hidden: boolean) => {
    app.classList.toggle('toolbar-hidden', hidden);
    store(TOOLBAR_KEY, hidden ? '1' : null);
  };
  set(stored(TOOLBAR_KEY) === '1');
  return { toggle: () => set(!app.classList.contains('toolbar-hidden')), hidden: () => app.classList.contains('toolbar-hidden') };
}

function buildToolbar(viewer: Viewer, controller: ToolController, files: FileCommands, toggleMaterials: () => void, view: ViewActions, keep: KeepActions) {
  const bar = document.getElementById('toolbar')!;
  const brand = document.createElement('span');
  brand.className = 'brand';
  const logo = document.createElement('img');
  logo.src = './icons/icon-192.png';
  logo.alt = '';
  logo.title = 'VormCraft';
  const docName = Object.assign(document.createElement('span'), { className: 'doc-name' });
  brand.append(logo, docName);
  bar.append(brand);
  // Viewer mode: easy to spot and tap on a phone or tablet.
  const viewerButton = iconButton(ICONS.eye, 'Viewer mode: look around the model with touch (one finger pans, two fingers zoom and orbit); the tools are put away', view.enterViewer);
  viewerButton.classList.add('viewer-enter');
  bar.append(viewerButton);
  const sep = () => bar.append(Object.assign(document.createElement('span'), { className: 'sep' }));

  bar.append(
    iconButton(ICONS.newDoc, 'New (Ctrl+N)', () => void files.newDocument()),
    iconButton(ICONS.open, 'Open (Ctrl+O)', () => void files.open()),
    iconButton(ICONS.save, 'Save (Ctrl+S) · Save As (Ctrl+Shift+S)', () => void files.save()),
  );
  // Always made, hidden while Google Drive is switched off (it can be switched on in Settings).
  const driveButton = iconButton(ICONS.cloud, 'Google Drive: save, open, autosave a copy', () => keep.driveMenu(driveButton));
  if (!keep.drive) driveButton.style.display = 'none';
  bar.append(driveButton);
  bar.append(
    textButton(ICONS.importFile, 'Import', 'Import a SketchUp (.skp), OBJ or STL file (Ctrl+I)', () => void files.importModel()),
  );
  const libraryButton = textButton(ICONS.library, 'Library', 'Library: furniture, kitchen, bathroom and more, at real sizes, to place in the model', view.toggleLibrary);
  bar.append(libraryButton);
  sep();
  const undoButton = iconButton(ICONS.undo, 'Undo (Ctrl+Z)', () => controller.undo());
  const redoButton = iconButton(ICONS.redo, 'Redo (Ctrl+Y)', () => controller.redo());
  bar.append(undoButton, redoButton);
  sep();
  const exportButton = textButton(ICONS.exportFile, 'Export', 'Export: STL (for 3D printing) or OBJ', () => keep.exportMenu(exportButton));
  bar.append(exportButton);
  sep();
  bar.append(iconButton(ICONS.zoomExtents, withShortcut('Zoom Extents'), () => viewer.zoomExtents()));
  bar.append(iconButton(ICONS.previousView, withShortcut('Previous View'), () => previousView(viewer, controller)));
  // One button each for the standard views and the face styles, opening a short menu, so the
  // toolbar fits on one row.
  const viewsButton = iconButton(ICONS.iso + MENU_CARET, 'Standard views: Iso, Top, Front, Right, Back, Left', () => view.viewsMenu(viewsButton));
  viewsButton.classList.add('has-menu');
  bar.append(viewsButton);
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
  const style = iconButton(ICONS.styleTextured + MENU_CARET, 'Style (click to change)', () => view.styleMenu(style));
  style.classList.add('has-menu');
  bar.append(style);
  const projection = iconButton(ICONS.perspective, 'Perspective (click for parallel projection)', view.toggleProjection);
  bar.append(projection);
  sep();
  const scenes = iconButton(ICONS.scenes, 'Scenes (saved views)', view.toggleScenes);
  bar.append(scenes);
  const history = iconButton(ICONS.history, 'History: earlier versions of this design', keep.toggleHistory);
  bar.append(history);
  sep();
  const support = iconButton(ICONS.heart, 'Support VormCraft: a small donation helps pay for the website and upkeep', showSupport);
  support.classList.add('support-button');
  bar.append(support);
  bar.append(iconButton(ICONS.settings, 'Settings (autosave, backups, graphics card, history, updates)', keep.settings));
  const help = iconButton(ICONS.help, 'Help: shortcuts, updates, report a problem, about', () => keep.help(help));
  bar.append(help);
  // Hiding the top bar leaves a thin strip whose tab brings it back.
  const hide = iconButton(ICONS.collapseUp, 'Hide the top bar (more room to model)', view.toggleTopBar);
  hide.classList.add('toolbar-hide');
  const showBar = iconButton(ICONS.expandDown, 'Show the top bar', view.toggleTopBar);
  showBar.classList.add('toolbar-show');
  bar.append(hide, showBar);
  const viewButtons: ViewButtons = { style, projection, scenes, history, library: libraryButton };
  return { undoButton, redoButton, materialsButton, viewButtons, driveButton };
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
