import { DriveApi, DriveError, type DriveFile, type TokenSource } from './driveApi';
import { emptySettingsFile, parseSettingsFile, SETTINGS_FILE_NAME, type SettingsFile } from '../preferences';

/** The folder VormCraft makes at the top of My Drive, and the one for autosaved copies inside it. */
export const FOLDER_NAME = 'VormCraft';
export const AUTOSAVE_FOLDER = 'Autosave';
const STORE_KEY = 'vormcraft.drive';

/** What is remembered between sessions (on this device). Never the token. */
interface Stored {
  email: string;
  name: string;
  folderId: string;
  autosaveFolderId?: string;
  /** Autosaved copy's file for each design (by the design's key). */
  autosaveFiles: Record<string, string>;
}

/** The Drive file a design lives in, and its revision when it was last opened or saved here. */
export interface DriveLocation {
  fileId: string;
  revision: string | undefined;
}

/** The Drive file changed since it was opened here (saved from another device, say). */
export class DriveClash extends Error {
  constructor(readonly current: DriveFile) {
    super('The file in Google Drive was changed somewhere else since you opened it.');
  }
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Google Drive for the app: the connected account, VormCraft's folder, saving and opening designs,
 * and the autosaved copies. Built on `DriveApi` (and testable with a stand-in for it).
 */
export class DriveSession {
  private stored: Stored | null;
  readonly api: DriveApi;

  constructor(
    token: TokenSource,
    private readonly store: KeyValueStore | null,
    api?: DriveApi,
  ) {
    this.api = api ?? new DriveApi(token);
    this.stored = this.load();
  }

  private load(): Stored | null {
    try {
      const raw = this.store?.getItem(STORE_KEY);
      return raw ? (JSON.parse(raw) as Stored) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      if (this.stored) this.store?.setItem(STORE_KEY, JSON.stringify(this.stored));
      else this.store?.removeItem(STORE_KEY);
    } catch {
      // Not remembered: connect again next time.
    }
  }

  get connected(): boolean {
    return this.stored !== null;
  }

  get email(): string {
    return this.stored?.email ?? '';
  }

  /** VormCraft's folder (connect first). */
  get folderId(): string {
    return this.need().folderId;
  }

  get folderUrl(): string | null {
    return this.stored ? `https://drive.google.com/drive/folders/${this.stored.folderId}` : null;
  }

  /** After signing in: note the account and make (or find) VormCraft's folder. */
  async connect(): Promise<void> {
    const who = await this.api.account();
    const folderId = await this.api.folder(FOLDER_NAME);
    const same = this.stored?.email === who.email;
    this.stored = { email: who.email, name: who.name, folderId, autosaveFolderId: same ? this.stored?.autosaveFolderId : undefined, autosaveFiles: same ? (this.stored?.autosaveFiles ?? {}) : {} };
    this.save();
  }

  disconnect(): void {
    this.stored = null;
    this.save();
  }

  private need(): Stored {
    if (!this.stored) throw new Error('Connect Google Drive first.');
    return this.stored;
  }

  /** Designs in VormCraft's folder, newest first. */
  async list(): Promise<DriveFile[]> {
    return (await this.api.list(this.need().folderId)).filter((f) => /\.(vorm|benup)$/i.test(f.name));
  }

  async open(file: DriveFile): Promise<{ text: string; location: DriveLocation }> {
    const text = await this.api.download(file.id);
    const meta = await this.api.meta(file.id);
    return { text, location: { fileId: file.id, revision: meta?.headRevisionId ?? file.headRevisionId } };
  }

  /** A new design file in VormCraft's folder (a name already there gets " (2)" and so on). */
  async create(fileName: string, text: string): Promise<{ file: DriveFile; location: DriveLocation }> {
    const s = this.need();
    const taken = new Set((await this.api.list(s.folderId)).map((f) => f.name.toLowerCase()));
    const file = await this.api.create(uniqueName(fileName, taken), s.folderId, text);
    return { file, location: { fileId: file.id, revision: file.headRevisionId } };
  }

  /**
   * Save over a design's Drive file. Unless `replace`, first checks it was not changed elsewhere
   * since it was opened or last saved here (throws `DriveClash`). A file that has gone (deleted)
   * is made again in VormCraft's folder.
   */
  async update(location: DriveLocation, fileName: string, text: string, replace = false): Promise<{ file: DriveFile; location: DriveLocation }> {
    const current = await this.api.meta(location.fileId);
    if (!current) return this.create(fileName, text);
    if (!replace && location.revision && current.headRevisionId && current.headRevisionId !== location.revision) throw new DriveClash(current);
    const file = await this.api.update(location.fileId, text);
    return { file, location: { fileId: file.id, revision: file.headRevisionId } };
  }

  /**
   * Write a design's autosaved copy to VormCraft/Autosave: one file per design, replaced each
   * time. Never touches the design's own file.
   */
  async autosave(designKey: string, fileName: string, text: string): Promise<DriveFile> {
    const s = this.need();
    s.autosaveFolderId ??= await this.api.folder(AUTOSAVE_FOLDER, s.folderId);
    const known = s.autosaveFiles[designKey];
    let file: DriveFile | null = null;
    if (known) {
      try {
        file = await this.api.update(known, text);
      } catch (err) {
        if (!(err instanceof DriveError && err.status === 404)) throw err;
      }
    }
    if (!file) {
      try {
        file = await this.api.create(fileName, s.autosaveFolderId, text);
      } catch (err) {
        // The Autosave folder was deleted: make it again.
        if (!(err instanceof DriveError && err.status === 404)) throw err;
        s.autosaveFolderId = await this.api.folder(AUTOSAVE_FOLDER, s.folderId);
        file = await this.api.create(fileName, s.autosaveFolderId, text);
      }
      s.autosaveFiles[designKey] = file.id;
    }
    this.save();
    return file;
  }
}

/** Settings saved per device (see `preferences.ts`): one file in VormCraft's folder. */
export async function readSettingsFile(session: DriveSession): Promise<{ file: DriveFile | null; settings: SettingsFile }> {
  const file = (await session.api.list(session.folderId)).find((f) => f.name === SETTINGS_FILE_NAME) ?? null;
  return { file, settings: file ? parseSettingsFile(await session.api.download(file.id)) : emptySettingsFile() };
}

/** Write the settings file (made in VormCraft's folder if there is none yet). */
export async function writeSettingsFile(session: DriveSession, file: DriveFile | null, settings: SettingsFile): Promise<void> {
  const text = JSON.stringify(settings, null, 1);
  if (file) {
    try {
      await session.api.update(file.id, text);
      return;
    } catch (err) {
      // Deleted meanwhile: make it again.
      if (!(err instanceof DriveError && err.status === 404)) throw err;
    }
  }
  await session.api.create(SETTINGS_FILE_NAME, session.folderId, text);
}

/** "Shelf.vorm" → "Shelf (2).vorm" while the name is taken. */
export function uniqueName(fileName: string, taken: Set<string>): string {
  if (!taken.has(fileName.toLowerCase())) return fileName;
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  for (let i = 2; ; i++) {
    const n = `${stem} (${i})${ext}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
}
