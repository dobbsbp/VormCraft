import { FILE_EXTENSION, serializeDocument } from '../../io/fileFormat';
import type { ToolController } from '../../tools/ToolController';
import type { MenuEntry } from '../../tools/contextMenu';
import { choiceDialog, confirmDialog, progressDialog, promptDialog } from '../dialogs';
import type { FileCommands } from '../fileCommands';
import { isTauri } from '../files';
import type { Settings } from '../settings';
import { DriveAutosaveScheduler } from './driveAutosave';
import { showDriveOpenDialog } from './driveDialog';
import { DriveClash, DriveSession, type KeyValueStore } from './driveSession';
import { SignInNeeded, WebGoogleAuth } from './googleAuth';

const AUTOSAVE_KEY = 'vormcraft.drive.autosave';
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function storage(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The page was just clicked or typed in (browsers only open a sign-in pop-up then). */
const userActive = () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true;

/**
 * Google Drive in the app (web version for now): connect an account, save a design to VormCraft's
 * folder and open one from it (Ctrl+S then saves back there), and, if switched on, keep an
 * autosaved copy in VormCraft/Autosave. The design's own file is only written by Save.
 */
export class DriveCommands {
  readonly auth: WebGoogleAuth;
  readonly session: DriveSession;
  private readonly scheduler: DriveAutosaveScheduler;
  private readonly sessionKey = `session-${Date.now().toString(36)}`;
  private autosaveOn: boolean;
  private lastCopy: number | null = null;
  private problem: string | null = null;
  private uploading = false;

  constructor(
    private readonly files: FileCommands,
    private readonly controller: ToolController,
    private readonly settings: () => Settings,
  ) {
    const store = storage();
    this.session = new DriveSession(async (renew) => this.auth.source(userActive)(renew), store);
    this.auth = new WebGoogleAuth(this.session.email || undefined);
    this.autosaveOn = store?.getItem(AUTOSAVE_KEY) === '1';
    this.scheduler = new DriveAutosaveScheduler((revision) => this.uploadCopy(revision));
    files.saveToDrive = () => this.save();
    // Leaving the page (closing the tab, switching away): send a waiting copy now.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.scheduler.flush();
    });
  }

  /**
   * Drive works in the web version (the Windows app's sign-in comes later). While Google has the
   * app in testing (only listed test accounts can sign in) it shows on the test server only, or
   * where switched on with localStorage `vormcraft.drive.preview` = "1".
   */
  static available(): boolean {
    if (isTauri()) return false;
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return true;
    try {
      return localStorage.getItem('vormcraft.drive.preview') === '1';
    } catch {
      return false;
    }
  }

  /** For the status bar: the autosaved copy, or what needs attention. */
  statusText(): string {
    if (this.problem) return `Google Drive: ${this.problem}`;
    if (this.uploading) return 'Google Drive: uploading…';
    if (this.autosaveOn && this.session.connected && this.lastCopy) return `Copy in Google Drive ${time(this.lastCopy)}`;
    return '';
  }

  get needsAttention(): boolean {
    return this.problem !== null;
  }

  /** Call on every change: the autosaved copy follows the design. */
  changed(): void {
    if (!this.autosaveOn || !this.session.connected || this.controller.previewing) return;
    if (!this.controller.dirty) this.scheduler.settled(this.controller.revision);
    else this.scheduler.changed(this.controller.revision);
  }

  private async uploadCopy(revision: number): Promise<void> {
    if (revision !== this.controller.revision && !this.controller.dirty) return;
    const key = this.files.drive?.fileId ?? this.files.path ?? this.sessionKey;
    const history = this.settings().history;
    const text = serializeDocument(this.controller.doc, { history, undo: history ? this.controller.history.steps : undefined });
    this.uploading = true;
    this.controller.onUpdate();
    try {
      await this.session.autosave(key, `${this.files.name} (autosave).${FILE_EXTENSION}`, text);
      this.lastCopy = Date.now();
      this.problem = null;
    } catch (err) {
      this.problem = err instanceof SignInNeeded ? 'sign in again to keep the copy up to date (click the Drive button)' : `copy not uploaded (${err instanceof Error ? err.message : String(err)}); trying again`;
      throw err;
    } finally {
      this.uploading = false;
      this.controller.onUpdate();
    }
  }

  /** Sign in (choosing the account) and set up VormCraft's folder. */
  async connect(): Promise<boolean> {
    try {
      await this.auth.signIn(true);
      await this.session.connect();
      this.auth.remember(this.session.email);
      this.problem = null;
      this.controller.notify(`Google Drive connected: ${this.session.email}. Designs go in the VormCraft folder.`);
      return true;
    } catch (err) {
      this.fail(err);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    const ok = await confirmDialog('Disconnect Google Drive', `VormCraft will stop using ${this.session.email}'s Google Drive and give back its permission. Your files stay in Google Drive.`, 'Disconnect');
    if (!ok) return;
    this.scheduler.stop();
    await this.auth.signOut();
    this.session.disconnect();
    this.problem = null;
    this.lastCopy = null;
    this.files.drive = undefined;
    this.controller.notify('Google Drive disconnected');
  }

  private async ready(): Promise<boolean> {
    if (this.session.connected) return true;
    return this.connect();
  }

  /** Save to Google Drive as a new file (asks for the name). */
  async saveAs(): Promise<void> {
    if (!(await this.ready())) return;
    const name = await promptDialog('Save to Google Drive', 'Name', this.files.name === 'Untitled' ? '' : this.files.name, 'Save');
    if (!name) return;
    await this.files.guard(async () => {
      const progress = progressDialog('Saving to Google Drive', `Uploading ${name}…`);
      try {
        const text = this.files.textForSave();
        const { file, location } = await this.session.create(`${name.replace(/\.vorm$/i, '')}.${FILE_EXTENSION}`, text);
        await this.files.savedElsewhere(file.name, location);
        this.afterSave(file.name);
      } finally {
        progress.close();
      }
    });
  }

  /** Save a design that lives in Google Drive back to its file (Ctrl+S). */
  async save(replace = false): Promise<void> {
    const location = this.files.drive;
    if (!location) return this.saveAs();
    if (!(await this.ready())) return;
    this.controller.endPreview();
    let clash: DriveClash | null = null;
    await this.files.guard(async () => {
      const progress = progressDialog('Saving to Google Drive', `Uploading ${this.files.name}…`);
      try {
        const text = this.files.textForSave();
        const { file, location: next } = await this.session.update(location, `${this.files.name}.${FILE_EXTENSION}`, text, replace);
        await this.files.savedElsewhere(file.name, next);
        this.afterSave(file.name);
      } catch (err) {
        if (err instanceof DriveClash) clash = err;
        else throw err;
      } finally {
        progress.close();
      }
    });
    if (clash) await this.resolveClash(clash);
  }

  private async resolveClash(clash: DriveClash): Promise<void> {
    const changed = new Date(clash.current.modifiedTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const choice = await choiceDialog(
      'Changed in Google Drive',
      `“${clash.current.name}” in Google Drive was changed somewhere else (${changed}) since you opened it here.\n\nKeep both: your version is saved as a new file next to it.\nReplace: your version replaces the one in Drive (Drive keeps the old one in its version history).`,
      [
        { label: 'Replace', value: 'replace' },
        { label: 'Keep both', value: 'both' },
      ],
    );
    if (choice === 'replace') await this.save(true);
    else if (choice === 'both') {
      await this.files.guard(async () => {
        const text = this.files.textForSave();
        const { file, location } = await this.session.create(`${this.files.name}.${FILE_EXTENSION}`, text);
        await this.files.savedElsewhere(file.name, location);
        this.afterSave(file.name);
      });
    }
  }

  private afterSave(fileName: string): void {
    this.problem = null;
    this.scheduler.settled(this.controller.revision);
    this.controller.notify(`Saved to Google Drive: VormCraft/${fileName}`);
  }

  async open(): Promise<void> {
    if (!(await this.ready())) return;
    if (!(await this.files.confirmDiscard())) return;
    await this.files.guard(async () => {
      const progress = progressDialog('Google Drive', 'Looking in the VormCraft folder…');
      let list;
      try {
        list = await this.session.list();
      } finally {
        progress.close();
      }
      const picked = await showDriveOpenDialog(list, this.session.email, this.session.folderUrl);
      if (!picked) return;
      const loading = progressDialog('Opening from Google Drive', `Downloading ${picked.name}…`);
      try {
        const { text, location } = await this.session.open(picked);
        await this.files.openFromDrive(picked.name, text, location);
        this.scheduler.settled(this.controller.revision);
      } finally {
        loading.close();
      }
    });
  }

  async toggleAutosave(): Promise<void> {
    if (!this.autosaveOn && !(await this.ready())) return;
    this.autosaveOn = !this.autosaveOn;
    try {
      storage()?.setItem(AUTOSAVE_KEY, this.autosaveOn ? '1' : '0');
    } catch {
      // Just for this session.
    }
    if (this.autosaveOn) {
      this.controller.notify('Autosaving a copy to Google Drive (VormCraft/Autosave) after each pause in your work. Your own file only changes when you save.');
      this.changed();
    } else {
      this.scheduler.stop();
      this.controller.notify('No longer autosaving a copy to Google Drive');
    }
  }

  /** The Google Drive button's menu. */
  menu(): MenuEntry[] {
    if (!this.session.connected) {
      return [
        { label: 'Connect Google Drive…', run: () => void this.connect() },
        'separator',
        { label: 'Save to Google Drive…', run: () => void this.saveAs() },
        { label: 'Open from Google Drive…', run: () => void this.open() },
      ];
    }
    const inDrive = this.files.drive !== undefined;
    const folder = this.session.folderUrl;
    return [
      ...(this.problem ? [{ label: 'Sign in again', run: () => void this.reauthorize() } as MenuEntry, 'separator' as const] : []),
      ...(inDrive ? [{ label: 'Save to Google Drive', shortcut: 'Ctrl+S', run: () => void this.save() } as MenuEntry] : []),
      { label: inDrive ? 'Save as a New File in Google Drive…' : 'Save to Google Drive…', run: () => void this.saveAs() },
      { label: 'Open from Google Drive…', run: () => void this.open() },
      'separator',
      { label: `${this.autosaveOn ? '✓ ' : ''}Autosave a Copy to Google Drive`, run: () => void this.toggleAutosave() },
      ...(folder ? [{ label: 'Show the VormCraft Folder in Google Drive', run: () => void window.open(folder, '_blank', 'noopener') } as MenuEntry] : []),
      'separator',
      { label: `Disconnect ${this.session.email}`, run: () => void this.disconnect() },
    ];
  }

  /** After the token ran out: sign in again (from a click) and send the waiting copy. */
  private async reauthorize(): Promise<void> {
    try {
      await this.auth.signIn(false);
      this.problem = null;
      this.scheduler.flush();
      this.controller.onUpdate();
    } catch (err) {
      this.fail(err);
    }
  }

  private fail(err: unknown): void {
    this.controller.error = err instanceof Error ? err.message : String(err);
    this.controller.onUpdate();
  }
}
