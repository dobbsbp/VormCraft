import { Document } from '../doc/Document';
import type { DisplayUnits } from '../doc/Units';
import { checkWatertightAll, exportObj, exportStl } from '../io/export';
import { FILE_EXTENSION, NewerFormatError, OLD_FILE_EXTENSIONS, WRITE_VERSION } from '../io/fileFormat';
import { encodeVorm, readVorm } from '../io/vormFile';
import { APP_VERSION } from './updater';
import type { ToolController } from '../tools/ToolController';
import type { AutoSaver } from './autosave';
import { importMesh } from '../core/ops/importMesh';
import { convertMesh, parseMeshFile } from '../io/meshFiles';
import { confirmDialog, progressDialog, showExportDialog } from './dialogs';
import { showImportDialog } from './importDialog';
import { convertSkp, suggestLeaveOut, summarizeSkp } from '../io/skpImport';
import { shrinkImage } from './materialLibrary';
import { LARGE_SKP, MAX_SKP, showSkpDialog } from './skpDialog';
import { readSkp } from './skpReader';
import type { FileFilter, FileHost, OpenedFile } from './files';
import type { DriveLocation } from './drive/driveSession';
import type { Settings } from './settings';

const MODEL_FILTER: FileFilter = { name: 'VormCraft model', extensions: [FILE_EXTENSION] };
/** Opening also accepts files saved before the app was renamed. */
const OPEN_FILTER: FileFilter = { name: 'VormCraft model', extensions: [FILE_EXTENSION, ...OLD_FILE_EXTENSIONS] };
/** Any of our extensions at the end of a file name. */
const EXTENSION = new RegExp(`\\.(${[FILE_EXTENSION, ...OLD_FILE_EXTENSIONS].join('|')})$`, 'i');
const STL_FILTER: FileFilter = { name: 'STL (binary)', extensions: ['stl'] };
const OBJ_FILTER: FileFilter = { name: 'Wavefront OBJ', extensions: ['obj'] };
const IMPORT_FILTER: FileFilter = { name: '3D models and drawings (SketchUp, OBJ, STL, DXF)', extensions: ['skp', 'obj', 'stl', 'dxf'] };
/** Above this many polygons an import asks first (it can take a while). */
const LARGE_IMPORT = 300_000;

export interface FileOptions {
  settings: () => Settings;
  autosave?: AutoSaver;
  /** A file from a newer version of the app was opened: offer the update. */
  onNewerFile?: () => void;
  /** A design saved nowhere yet, with Google Drive connected: save it here or there? (null: cancelled) */
  chooseSaveTarget?: () => Promise<'computer' | 'drive' | null>;
  /** Ask which units a new design uses (null: cancelled); without it, new designs use millimetres. */
  chooseUnits?: () => Promise<DisplayUnits | null>;
}

/** What Google Drive offers Save (set by DriveCommands while Drive is switched on). */
export interface DriveSaving {
  /** Signed in (Save may then ask where a new design goes). */
  connected(): boolean;
  /** Save back to the design's Drive file. */
  save(): Promise<void>;
  /** Save as a new Drive file (pick the folder and name). */
  saveAs(): Promise<void>;
}

/**
 * Where the design is saved: a file on this computer (desktop), on this device without a path
 * (the browser: opened from or downloaded to it), Google Drive, or nowhere yet.
 */
export type SavedPlace = { kind: 'nowhere' } | { kind: 'computer'; path: string } | { kind: 'device' } | { kind: 'drive'; folder?: string };

/**
 * New / Open / Save / Save As / Export, with unsaved-changes protection. Saving records a version
 * in the design's history; the first save over a file from an older format keeps a copy of it.
 */
export class FileCommands {
  name = 'Untitled';
  /** Where the document lives on disk (desktop only), so Save writes back to it. */
  path: string | undefined;
  /** The Google Drive file the design lives in (opened from or saved to Drive), if any. */
  drive: DriveLocation | undefined;
  /** The Drive file's folders ("VormCraft › Kitchen"), once looked up. */
  driveFolder: string | undefined;
  /** Google Drive's Save (set when Drive is available). */
  driveSaving: DriveSaving | null = null;
  /** The message shown after the last save (the status bar offers Show in folder while it shows). */
  savedNotice: string | null = null;
  onTitleChange: () => void = () => {};
  /** The opened file as it was, while it is in an older format and not yet backed up. */
  /** The file as opened, when in another format version: kept beside it on the first save over it. */
  private olderFormat: { bytes: Uint8Array; version: number } | null = null;
  /** Removes the recovery copy of changes the user agreed to discard, once they are replaced. */
  private discardedCopy: (() => Promise<void>) | null = null;
  /** Opened from or saved to this device without a path (the browser): Save downloads again. */
  private onDevice = false;

  constructor(
    private readonly host: FileHost,
    private readonly controller: ToolController,
    private readonly options: FileOptions = { settings: () => ({ history: false }) as Settings },
  ) {}

  /** Real files with paths (desktop), rather than downloads (browser). */
  get native(): boolean {
    return this.host.native;
  }

  /** Where the design is saved now. */
  where(): SavedPlace {
    if (this.drive) return { kind: 'drive', folder: this.driveFolder };
    if (this.path) return { kind: 'computer', path: this.path };
    return this.onDevice ? { kind: 'device' } : { kind: 'nowhere' };
  }

  /** Where the design is saved, in words (its path, or "Google Drive › VormCraft › Shed.vorm"). */
  whereText(): string {
    const p = this.where();
    if (p.kind === 'computer') return p.path;
    if (p.kind === 'drive') {
      const file = `${this.name}.${FILE_EXTENSION}`;
      // The folder is "VormCraft › …", or a note for a file moved out of VormCraft's folders.
      return p.folder && !p.folder.startsWith('VormCraft') ? `Google Drive › ${file} (${p.folder})` : `Google Drive › ${p.folder ?? 'VormCraft'} › ${file}`;
    }
    if (p.kind === 'device') return 'This device (each Save downloads a new copy to your downloads)';
    return 'Not saved yet';
  }

  /** Show the saved file in its folder (desktop). */
  async reveal(): Promise<void> {
    if (this.path && this.host.reveal) await this.guard(() => this.host.reveal!(this.path!));
  }

  /** Say where the design was just saved (status bar). */
  announceSaved(message: string): void {
    this.savedNotice = message;
    this.controller.notify(message);
  }

  /** The window/tab title; `viewing` names the older version being previewed, if any. */
  title(viewing?: string): string {
    return windowTitle(this.name, this.controller.dirty, viewing);
  }

  /**
   * True if it is fine to drop the current document (saved, or the user agreed to discard). The
   * recovery copy stays until another design has replaced this one (`replaced`): cancelling New
   * or Open, or a file that fails to open, must not lose it.
   */
  async confirmDiscard(): Promise<boolean> {
    this.discardedCopy = null;
    if (!this.controller.dirty) return true;
    const ok = await confirmDialog('Unsaved changes', `${this.name} has changes that are not saved. Discard them?`, 'Discard changes');
    if (ok) this.discardedCopy = this.options.autosave?.discarding() ?? null;
    return ok;
  }

  /** Like `confirmDiscard`, for leaving the app (closing or reloading): the copy goes at once. */
  async confirmLeave(): Promise<boolean> {
    const ok = await this.confirmDiscard();
    if (ok) await this.replaced();
    return ok;
  }

  /** Another design replaced the one whose changes were discarded: its copy is not needed. */
  private async replaced(): Promise<void> {
    const remove = this.discardedCopy;
    this.discardedCopy = null;
    await remove?.();
  }

  async newDocument(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const units = this.options.chooseUnits ? await this.options.chooseUnits() : undefined;
    if (units === null) return;
    const doc = new Document();
    if (units) doc.units = units;
    this.controller.replaceDocument(doc);
    this.name = 'Untitled';
    this.path = undefined;
    this.drive = undefined;
    this.driveFolder = undefined;
    this.onDevice = false;
    this.olderFormat = null;
    this.onTitleChange();
    await this.replaced();
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    await this.guard(async () => {
      const file = await this.host.openBinary(OPEN_FILTER);
      if (file) await this.load(file);
    });
  }

  /** Pick a saved AI design (a VormCraft build file) and read it; null if cancelled. */
  openDesignFile(): Promise<OpenedFile | null> {
    return this.host.open({ name: 'AI design', extensions: ['json', 'txt'] });
  }

  /** Open a file by path (desktop: a .vorm file double-clicked in Explorer). */
  async openPath(path: string): Promise<void> {
    if (!this.host.readPath) return;
    if (!(await this.confirmDiscard())) return;
    await this.guard(async () => this.load(await this.host.readPath!(path)));
  }

  /** Open a file handed over by the system (the installed web app opening a .vorm file). */
  async openBytes(name: string, bytes: Uint8Array): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    await this.guard(async () => this.load({ name, bytes }));
  }

  /** Open a design read from Google Drive (after the caller checked unsaved changes). */
  async openFromDrive(name: string, bytes: Uint8Array, drive: DriveLocation): Promise<void> {
    await this.guard(async () => {
      await this.load({ name, bytes });
      this.drive = drive;
      this.onDevice = false;
      this.onTitleChange();
    });
  }

  private async load(file: { name: string; path?: string; bytes: Uint8Array }): Promise<void> {
    let read;
    try {
      read = readVorm(file.bytes);
    } catch (err) {
      if (err instanceof NewerFormatError) this.options.onNewerFile?.();
      throw err;
    }
    const { doc, version, newer } = read;
    this.controller.replaceDocument(doc);
    this.name = file.name.replace(EXTENSION, '');
    // A file from before the rename is saved as a new .vorm file, not over the old one.
    this.path = EXTENSION.exec(file.name)?.[1].toLowerCase() === FILE_EXTENSION ? file.path : undefined;
    this.drive = undefined;
    this.driveFolder = undefined;
    this.onDevice = true;
    this.olderFormat = version !== WRITE_VERSION && this.path ? { bytes: file.bytes, version } : null;
    // The design as opened is the first point to come back to.
    if (this.options.settings().history && doc.versions.items.length === 0) this.controller.recordVersion('opened');
    this.controller.notify(
      newer
        ? `Opened ${file.name}. It was saved by a newer version of VormCraft, so anything this version does not know about is left out. Update VormCraft to see all of it.`
        : `Opened ${file.name}`,
    );
    this.onTitleChange();
    await this.replaced();
  }

  /** Continue with a recovered autosaved copy (it keeps its name and where it was saved). */
  recovered(doc: Document, name: string, path: string | undefined): void {
    this.controller.replaceDocument(doc);
    this.controller.dirty = true;
    this.name = name;
    this.path = path;
    this.drive = undefined;
    this.driveFolder = undefined;
    this.onDevice = false;
    this.olderFormat = null;
    this.onTitleChange();
  }

  /** The design as it is saved now, as a .vorm file (recording a "save" point in its history first). */
  bytesForSave(): Uint8Array {
    const s = this.options.settings();
    if (s.history) this.controller.recordVersion('save', s.historyLimitMB * 1024 * 1024);
    return encodeVorm(this.controller.doc, { history: s.history, undo: s.history ? this.controller.history.steps : undefined, savedBy: `VormCraft ${APP_VERSION}` });
  }

  /** The design was saved somewhere other than this device's files (Google Drive). */
  async savedElsewhere(fileName: string, drive: DriveLocation): Promise<void> {
    this.olderFormat = null;
    this.name = fileName.replace(EXTENSION, '');
    this.path = undefined;
    if (this.drive?.fileId !== drive.fileId || this.drive.folderId !== drive.folderId) this.driveFolder = undefined;
    this.drive = drive;
    this.onDevice = false;
    this.controller.markSaved();
    await this.options.autosave?.clear();
    this.onTitleChange();
  }

  /** The design's Google Drive file was renamed or moved (in the Drive browser): follow it. */
  driveFileChanged(fileId: string, fileName: string, folderId: string | undefined): void {
    if (this.drive?.fileId !== fileId) return;
    if (folderId && folderId !== this.drive.folderId) this.driveFolder = undefined;
    this.drive = { ...this.drive, folderId: folderId ?? this.drive.folderId };
    this.name = fileName.replace(EXTENSION, '');
    this.onTitleChange();
  }

  /**
   * Save where the design is (its file here, or in Google Drive). `saveAs` always picks a new
   * file on this computer (the browser downloads). A design saved nowhere yet asks whether it
   * goes here or to Google Drive, when Drive is connected.
   */
  async save(saveAs = false): Promise<void> {
    const drive = this.driveSaving;
    if (!saveAs && this.drive && drive) return drive.save();
    if (!saveAs && this.where().kind === 'nowhere' && drive?.connected() && this.options.chooseSaveTarget) {
      const to = await this.options.chooseSaveTarget();
      if (!to) return;
      if (to === 'drive') return drive.saveAs();
    }
    this.controller.endPreview();
    await this.guard(async () => {
      const bytes = this.bytesForSave();
      const target = saveAs ? undefined : this.path;
      // Save As starts beside the design's own file.
      const suggested = `${this.name}.${FILE_EXTENSION}`;
      const start = saveAs && this.path ? this.path.replace(/[^\\/]*$/, suggested) : suggested;
      // First save over a file from another format version: keep the original beside it.
      if (target && this.olderFormat && target === this.path) {
        const backup = target.replace(EXTENSION, '') + ` (format ${this.olderFormat.version} backup).${FILE_EXTENSION}`;
        await this.host.save(this.olderFormat.bytes, backup, MODEL_FILTER, backup);
      }
      const written = await this.host.save(bytes, start, MODEL_FILTER, target);
      if (!written) return;
      this.olderFormat = null;
      this.name = written.name.replace(EXTENSION, '');
      this.path = written.path;
      this.drive = undefined;
      this.driveFolder = undefined;
      this.onDevice = true;
      this.controller.markSaved();
      await this.options.autosave?.clear();
      this.announceSaved(written.path ? `Saved to ${written.path}` : `Downloaded ${written.name} to this device (your browser’s downloads)`);
      this.onTitleChange();
    });
  }

  /** Save As where the design is: a new Drive file for a design in Google Drive, else a new file here (Ctrl+Shift+S). */
  async saveAsHere(): Promise<void> {
    if (this.drive && this.driveSaving) return this.driveSaving.saveAs();
    return this.save(true);
  }

  /**
   * Save a copy in the plain format every 0.9 app opens (to send to someone who has not updated);
   * the design stays as it is.
   */
  async saveCopyForOlder(): Promise<void> {
    this.controller.endPreview();
    await this.guard(async () => {
      const s = this.options.settings();
      const bytes = encodeVorm(this.controller.doc, { history: s.history, undo: s.history ? this.controller.history.steps : undefined, zipped: false });
      const written = await this.host.save(bytes, `${this.name} (for older VormCraft).${FILE_EXTENSION}`, MODEL_FILTER);
      if (written) this.controller.notify(`Saved a copy that VormCraft 0.9 opens: ${written.name}`);
    });
  }

  /** Save a copy without the design's history (to send to someone); the design stays as it is. */
  async saveCopyWithoutHistory(): Promise<void> {
    this.controller.endPreview();
    await this.guard(async () => {
      const bytes = encodeVorm(this.controller.doc, { history: false, savedBy: `VormCraft ${APP_VERSION}` });
      const written = await this.host.save(bytes, `${this.name} (copy).${FILE_EXTENSION}`, MODEL_FILTER);
      if (written) this.controller.notify(`Saved a copy without history: ${written.name}`);
    });
  }

  /**
   * Import an OBJ or STL file: each object comes in as a group (flat areas merged into faces,
   * curved surfaces smoothed), selected and zoomed to. One undo step.
   */
  async importModel(): Promise<void> {
    this.controller.endPreview();
    await this.guard(async () => {
      const file = await this.host.openBinary(IMPORT_FILTER);
      if (!file) return;
      if (file.name.toLowerCase().endsWith('.skp')) return this.importSketchUp(file.name, file.bytes);
      if (file.name.toLowerCase().endsWith('.dxf')) return this.importDrawing(file.name, file.bytes);
      const objects = parseMeshFile(file.name, file.bytes);
      const polygons = objects.reduce((n, o) => n + o.polygons.length, 0);
      if (polygons > LARGE_IMPORT && !(await confirmDialog('Large model', `${file.name} has ${polygons.toLocaleString()} polygons. Importing it may take a while and make VormCraft slower.`, 'Import anyway'))) return;
      const choice = await showImportDialog(file.name, objects);
      if (!choice) return;
      const progress = progressDialog('Importing', `Reading ${file.name}…`);
      // Let the window show before the work starts.
      await new Promise((r) => setTimeout(r, 30));
      let skipped = 0;
      let faces = 0;
      try {
        const parts = convertMesh(objects, choice.unit, choice.yUp).map((o) => {
          const r = importMesh(o.polygons, { smoothAngle: choice.smooth ? 20 : 0 });
          skipped += r.skipped;
          faces += r.model.faces.size;
          return { name: o.name, model: r.model };
        });
        this.controller.importGroups(parts, `Import ${file.name}`);
      } finally {
        progress.close();
      }
      const groups = objects.length === 1 ? 'a group' : `${objects.length} groups`;
      this.controller.notify(`Imported ${file.name}: ${faces.toLocaleString()} faces in ${groups}${skipped ? `; ${skipped.toLocaleString()} broken or duplicate polygons were left out` : ''}.`);
    });
  }

  /**
   * A SketchUp file: read in the background, summarised, then brought in as one group (its groups
   * and components inside), with its materials and, if chosen, its scenes and guides.
   */
  private async importSketchUp(fileName: string, bytes: Uint8Array): Promise<void> {
    const name = fileName.split(/[\\/]/).pop()!.replace(/\.skp$/i, '');
    let progress = progressDialog('Importing', `Reading ${fileName.split(/[\\/]/).pop()}…`);
    let skp;
    try {
      skp = await readSkp(bytes);
    } finally {
      progress.close();
    }
    const stats = summarizeSkp(skp);
    if (stats.placedFaces === 0) {
      this.controller.notify(`${name}.skp has no geometry placed in the model (only unused components), so there is nothing to import.`);
      return;
    }
    const choice = await showSkpDialog(fileName, stats, (ids) => summarizeSkp(skp, ids).placedFaces, suggestLeaveOut(skp, stats, LARGE_SKP));
    if (!choice) return;
    // Building more than this runs out of memory and takes the whole app down: never start it.
    const faces = choice.leaveOut.length ? summarizeSkp(skp, choice.leaveOut).placedFaces : stats.placedFaces;
    if (faces > MAX_SKP) {
      this.controller.notify(`${name}.skp is too large to import (${n(faces)} faces once every copy of its components is placed).`);
      return;
    }
    const left = stats.heavy.filter((h) => choice.leaveOut.includes(h.id));
    progress = progressDialog('Importing', `Building ${faces.toLocaleString()} faces…`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const result = convertSkp(skp, { name, scenes: choice.scenes, guides: choice.guides, leaveOut: choice.leaveOut, hiddenTags: choice.hiddenTags });
      progress.set('Preparing textures…');
      for (const [key, m] of result.materials) if (m.texture) result.materials.set(key, { ...m, texture: { ...m.texture, image: await shrinkImage(m.texture.image) } });
      this.controller.importSkp(result, `Import ${name}.skp`);
      const f = result.faces;
      const notes = [f.turned ? `${n(f.turned)} turned round to fit` : '', f.detached ? `${n(f.detached)} kept on edges of their own` : '', f.skipped ? `${n(f.skipped)} broken faces left out` : ''].filter(Boolean);
      const leftOut = left.length ? ` Left out: ${left.map((h) => `${h.name} (${n(h.copies)} copies)`).join(', ')}.` : '';
      const missing = result.missing ? ` ${n(result.missing)} placed ${result.missing === 1 ? 'group was' : 'groups were'} missing from the file.` : '';
      const tags = result.tags.length ? `, ${result.tags.length} ${result.tags.length === 1 ? 'tag' : 'tags'}${result.tags.some((t) => t.hidden) ? ` (${result.tags.filter((t) => t.hidden).length} hidden: show them in the Tags panel)` : ''}` : '';
      this.controller.notify(`Imported ${name}.skp: ${n(f.total - f.skipped)} faces${notes.length ? ` (${notes.join(', ')})` : ''}${tags}${result.scenes.length ? `, ${result.scenes.length} scenes` : ''}.${leftOut}${missing}`);
    } finally {
      progress.close();
    }
  }

  /**
   * A DXF drawing: read, then asked about (units, curve detail, faces, layers), then brought in as
   * one group with a group per layer, and its texts and dimensions as labels.
   */
  private async importDrawing(fileName: string, bytes: Uint8Array): Promise<void> {
    const short = fileName.split(/[\\/]/).pop()!;
    // The DXF code loads the first time it is needed (its own small chunks).
    const [{ decodeDxf, DxfError, parseDxf }, { convertDxf }, { showDxfDialog }] = await Promise.all([import('../io/dxfFile'), import('../io/dxfImport'), import('./dxfDialog')]);
    let drawing;
    try {
      drawing = parseDxf(decodeDxf(bytes));
    } catch (e) {
      if (e instanceof DxfError) return this.controller.notify(e.message);
      throw e;
    }
    if (!drawing.curves.length && !drawing.faces.length && !drawing.texts.length && !drawing.dimensions.length) {
      this.controller.notify(`${short} has nothing VormCraft can bring in (no lines, curves, texts or 3D faces).`);
      return;
    }
    const choice = await showDxfDialog(short, drawing);
    if (!choice) return;
    const progress = progressDialog('Importing', `Building ${short}…`);
    try {
      await new Promise((r) => setTimeout(r, 30));
      const result = convertDxf(drawing, choice, short.replace(/\.dxf$/i, ''));
      this.controller.importDrawing(result.root, result.labels, `Import ${short}`);
      const parts = [`${n(result.edges)} edges`, `${n(result.faces)} faces`, `${n(result.circles)} true arcs and circles`, ...(result.labels.length ? [`${n(result.labels.length)} texts and dimensions`] : [])];
      this.controller.notify(`Imported ${short}: ${parts.join(', ')}.`);
    } finally {
      progress.close();
    }
  }

  async exportStl(): Promise<void> {
    // The whole model (every group too), wherever editing is.
    const model = this.controller.doc.allModels();
    const choice = await showExportDialog('STL', checkWatertightAll(model));
    if (!choice) return;
    await this.guard(async () => {
      const { data, triangles } = exportStl(model, choice);
      const written = await this.host.save(new Uint8Array(data), `${this.name}.stl`, STL_FILTER);
      if (written) this.controller.notify(`Exported ${written.name} (${triangles.toLocaleString()} triangles)`);
    });
  }

  async exportObj(): Promise<void> {
    const model = this.controller.doc.allModels();
    const choice = await showExportDialog('OBJ', checkWatertightAll(model));
    if (!choice) return;
    await this.guard(async () => {
      const text = exportObj(model, choice, this.name);
      const written = await this.host.save(text, `${this.name}.obj`, OBJ_FILTER);
      if (written) this.controller.notify(`Exported ${written.name}`);
    });
  }

  /** File errors become a status-bar message instead of an uncaught rejection. */
  async guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.controller.error = err instanceof Error ? err.message : String(err);
      this.controller.onUpdate();
    }
  }
}

const n = (x: number) => x.toLocaleString();

/**
 * "VormCraft — Kitchen shelf •": the app first, then the file name ("Untitled" until saved), a •
 * while there are unsaved changes, and the time of an older version being previewed.
 */
export function windowTitle(name: string, dirty: boolean, viewing?: string): string {
  return `VormCraft — ${name}${dirty ? ' •' : ''}${viewing ? ` (viewing ${viewing})` : ''}`;
}
