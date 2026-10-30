import { Document } from '../doc/Document';
import { checkWatertightAll, exportObj, exportStl } from '../io/export';
import { FILE_EXTENSION, fileFormatVersion, FORMAT_VERSION, NewerFormatError, OLD_FILE_EXTENSIONS, parseDocument, serializeDocument } from '../io/fileFormat';
import type { ToolController } from '../tools/ToolController';
import type { AutoSaver } from './autosave';
import { confirmDialog, showExportDialog } from './dialogs';
import type { FileFilter, FileHost, OpenedFile } from './files';
import type { Settings } from './settings';

const MODEL_FILTER: FileFilter = { name: 'VormCraft model', extensions: [FILE_EXTENSION] };
/** Opening also accepts files saved before the app was renamed. */
const OPEN_FILTER: FileFilter = { name: 'VormCraft model', extensions: [FILE_EXTENSION, ...OLD_FILE_EXTENSIONS] };
/** Any of our extensions at the end of a file name. */
const EXTENSION = new RegExp(`\\.(${[FILE_EXTENSION, ...OLD_FILE_EXTENSIONS].join('|')})$`, 'i');
const STL_FILTER: FileFilter = { name: 'STL (binary)', extensions: ['stl'] };
const OBJ_FILTER: FileFilter = { name: 'Wavefront OBJ', extensions: ['obj'] };

export interface FileOptions {
  settings: () => Settings;
  autosave?: AutoSaver;
  /** A file from a newer version of the app was opened: offer the update. */
  onNewerFile?: () => void;
}

/**
 * New / Open / Save / Save As / Export, with unsaved-changes protection. Saving records a version
 * in the design's history; the first save over a file from an older format keeps a copy of it.
 */
export class FileCommands {
  name = 'Untitled';
  /** Where the document lives on disk (desktop only), so Save writes back to it. */
  path: string | undefined;
  onTitleChange: () => void = () => {};
  /** The opened file as it was, while it is in an older format and not yet backed up. */
  private olderFormat: { text: string; version: number } | null = null;

  constructor(
    private readonly host: FileHost,
    private readonly controller: ToolController,
    private readonly options: FileOptions = { settings: () => ({ history: false }) as Settings },
  ) {}

  title(): string {
    return `${this.name}${this.controller.dirty ? ' •' : ''} — VormCraft`;
  }

  /** True if it is fine to drop the current document (saved, or the user agreed to discard). */
  async confirmDiscard(): Promise<boolean> {
    if (!this.controller.dirty) return true;
    const ok = await confirmDialog('Unsaved changes', `${this.name} has changes that are not saved. Discard them?`, 'Discard changes');
    if (ok) await this.options.autosave?.clear();
    return ok;
  }

  async newDocument(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.controller.replaceDocument(new Document());
    this.name = 'Untitled';
    this.path = undefined;
    this.olderFormat = null;
    this.onTitleChange();
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    await this.guard(async () => {
      const file = await this.host.open(OPEN_FILTER);
      if (file) this.load(file);
    });
  }

  /** Open a file by path (desktop: a .vorm file double-clicked in Explorer). */
  async openPath(path: string): Promise<void> {
    if (!this.host.readPath) return;
    if (!(await this.confirmDiscard())) return;
    await this.guard(async () => this.load(await this.host.readPath!(path)));
  }

  private load(file: OpenedFile): void {
    let doc: Document;
    try {
      doc = parseDocument(file.text);
    } catch (err) {
      if (err instanceof NewerFormatError) this.options.onNewerFile?.();
      throw err;
    }
    this.controller.replaceDocument(doc);
    this.name = file.name.replace(EXTENSION, '');
    // A file from before the rename is saved as a new .vorm file, not over the old one.
    this.path = EXTENSION.exec(file.name)?.[1].toLowerCase() === FILE_EXTENSION ? file.path : undefined;
    const version = fileFormatVersion(file.text) ?? FORMAT_VERSION;
    this.olderFormat = version < FORMAT_VERSION && this.path ? { text: file.text, version } : null;
    // The design as opened is the first point to come back to.
    if (this.options.settings().history && doc.versions.items.length === 0) this.controller.recordVersion('opened');
    this.controller.notify(`Opened ${file.name}`);
    this.onTitleChange();
  }

  /** Continue with a recovered autosaved copy (it keeps its name and where it was saved). */
  recovered(doc: Document, name: string, path: string | undefined): void {
    this.controller.replaceDocument(doc);
    this.controller.dirty = true;
    this.name = name;
    this.path = path;
    this.olderFormat = null;
    this.onTitleChange();
  }

  async save(saveAs = false): Promise<void> {
    this.controller.endPreview();
    await this.guard(async () => {
      const s = this.options.settings();
      if (s.history) this.controller.recordVersion('save', s.historyLimitMB * 1024 * 1024);
      const text = serializeDocument(this.controller.doc, { history: s.history });
      const target = saveAs ? undefined : this.path;
      // First save over a file from an older format: keep the original beside it.
      if (target && this.olderFormat && target === this.path) {
        const backup = target.replace(EXTENSION, '') + ` (format ${this.olderFormat.version} backup).${FILE_EXTENSION}`;
        await this.host.save(this.olderFormat.text, backup, MODEL_FILTER, backup);
      }
      const written = await this.host.save(text, `${this.name}.${FILE_EXTENSION}`, MODEL_FILTER, target);
      if (!written) return;
      this.olderFormat = null;
      this.name = written.name.replace(EXTENSION, '');
      this.path = written.path;
      this.controller.markSaved();
      await this.options.autosave?.clear();
      this.controller.notify(this.host.native ? `Saved ${written.name}` : `Downloaded ${written.name}`);
      this.onTitleChange();
    });
  }

  /** Save a copy without the design's history (to send to someone); the design stays as it is. */
  async saveCopyWithoutHistory(): Promise<void> {
    this.controller.endPreview();
    await this.guard(async () => {
      const text = serializeDocument(this.controller.doc, { history: false });
      const written = await this.host.save(text, `${this.name} (copy).${FILE_EXTENSION}`, MODEL_FILTER);
      if (written) this.controller.notify(`Saved a copy without history: ${written.name}`);
    });
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
  private async guard(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.controller.error = err instanceof Error ? err.message : String(err);
      this.controller.onUpdate();
    }
  }
}
