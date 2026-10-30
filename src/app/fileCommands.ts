import { checkWatertight } from '../core/check/watertight';
import { Document } from '../doc/Document';
import { exportObj, exportStl } from '../io/export';
import { FILE_EXTENSION, OLD_FILE_EXTENSIONS, parseDocument, serializeDocument } from '../io/fileFormat';
import type { ToolController } from '../tools/ToolController';
import { confirmDialog, showExportDialog } from './dialogs';
import type { FileFilter, FileHost } from './files';

const MODEL_FILTER: FileFilter = { name: 'VormCraft model', extensions: [FILE_EXTENSION] };
/** Opening also accepts files saved before the app was renamed. */
const OPEN_FILTER: FileFilter = { name: 'VormCraft model', extensions: [FILE_EXTENSION, ...OLD_FILE_EXTENSIONS] };
/** Any of our extensions at the end of a file name. */
const EXTENSION = new RegExp(`\\.(${[FILE_EXTENSION, ...OLD_FILE_EXTENSIONS].join('|')})$`, 'i');
const STL_FILTER: FileFilter = { name: 'STL (binary)', extensions: ['stl'] };
const OBJ_FILTER: FileFilter = { name: 'Wavefront OBJ', extensions: ['obj'] };

/** New / Open / Save / Save As / Export, with unsaved-changes protection. */
export class FileCommands {
  name = 'Untitled';
  /** Where the document lives on disk (desktop only), so Save writes back to it. */
  path: string | undefined;
  onTitleChange: () => void = () => {};

  constructor(
    private readonly host: FileHost,
    private readonly controller: ToolController,
  ) {}

  title(): string {
    return `${this.name}${this.controller.dirty ? ' •' : ''} — VormCraft`;
  }

  /** True if it is fine to drop the current document (saved, or the user agreed to discard). */
  async confirmDiscard(): Promise<boolean> {
    if (!this.controller.dirty) return true;
    return confirmDialog('Unsaved changes', `${this.name} has changes that are not saved. Discard them?`, 'Discard changes');
  }

  async newDocument(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.controller.replaceDocument(new Document());
    this.name = 'Untitled';
    this.path = undefined;
    this.onTitleChange();
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    await this.guard(async () => {
      const file = await this.host.open(OPEN_FILTER);
      if (!file) return;
      this.controller.replaceDocument(parseDocument(file.text));
      this.name = file.name.replace(EXTENSION, '');
      // A file from before the rename is saved as a new .vorm file, not over the old one.
      this.path = EXTENSION.exec(file.name)?.[1].toLowerCase() === FILE_EXTENSION ? file.path : undefined;
      this.controller.notify(`Opened ${file.name}`);
      this.onTitleChange();
    });
  }

  async save(saveAs = false): Promise<void> {
    await this.guard(async () => {
      const text = serializeDocument(this.controller.doc);
      const written = await this.host.save(text, `${this.name}.${FILE_EXTENSION}`, MODEL_FILTER, saveAs ? undefined : this.path);
      if (!written) return;
      this.name = written.name.replace(EXTENSION, '');
      this.path = written.path;
      this.controller.markSaved();
      this.controller.notify(this.host.native ? `Saved ${written.name}` : `Downloaded ${written.name}`);
      this.onTitleChange();
    });
  }

  async exportStl(): Promise<void> {
    const model = this.controller.doc.model;
    const choice = await showExportDialog('STL', checkWatertight(model));
    if (!choice) return;
    await this.guard(async () => {
      const { data, triangles } = exportStl(model, choice);
      const written = await this.host.save(new Uint8Array(data), `${this.name}.stl`, STL_FILTER);
      if (written) this.controller.notify(`Exported ${written.name} (${triangles.toLocaleString()} triangles)`);
    });
  }

  async exportObj(): Promise<void> {
    const model = this.controller.doc.model;
    const choice = await showExportDialog('OBJ', checkWatertight(model));
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
