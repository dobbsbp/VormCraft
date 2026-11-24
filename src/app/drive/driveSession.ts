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
  /** The folder a new design was last saved in, on this device. */
  lastFolderId?: string;
}

/** The Drive file a design lives in, and its revision when it was last opened or saved here. */
export interface DriveLocation {
  fileId: string;
  revision: string | undefined;
  /** The folder it is in (missing for designs opened by older versions: VormCraft's folder). */
  folderId?: string;
}

/** A design, wherever it is, with the folders it is in below VormCraft's ("Kitchen › Cabinets"). */
export interface DesignEverywhere {
  file: DriveFile;
  /** Folder names below VormCraft's folder; null when it is outside VormCraft's folders. */
  path: string[] | null;
}

/** What a folder holds, all the way down. */
export interface FolderContents {
  designs: number;
  folders: number;
}

const DESIGN = /\.(vorm|benup)$/i;

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

  /** Where Save to Google Drive starts for a new design: the folder last saved in on this device. */
  get lastFolderId(): string {
    const s = this.need();
    return s.lastFolderId ?? s.folderId;
  }

  /** A folder's page on the Drive website. */
  folderLink(folderId: string): string {
    return `https://drive.google.com/drive/folders/${folderId}`;
  }

  /** The folders from VormCraft's (not included) down to `folderId`, or null if it is not inside it. */
  async pathTo(folderId: string): Promise<DriveFile[] | null> {
    const s = this.need();
    if (folderId === s.folderId) return [];
    const byId = new Map((await this.api.allFolders()).map((f) => [f.id, f]));
    const path: DriveFile[] = [];
    for (let id: string | undefined = folderId, n = 0; id && n < 100; n++) {
      if (id === s.folderId) return path.reverse();
      const f = byId.get(id);
      if (!f) return null;
      path.push(f);
      id = f.parents?.[0];
    }
    return null;
  }

  /** Designs in a folder (VormCraft's own if none is given), newest first. */
  async list(folderId?: string): Promise<DriveFile[]> {
    return (await this.api.list(folderId ?? this.need().folderId)).filter((f) => DESIGN.test(f.name));
  }

  /** The folders in a folder, by name. VormCraft's Autosave folder is left out. */
  async folders(folderId?: string): Promise<DriveFile[]> {
    const s = this.need();
    const id = folderId ?? s.folderId;
    const found = await this.api.folders(id);
    return id === s.folderId ? found.filter((f) => f.id !== s.autosaveFolderId && f.name !== AUTOSAVE_FOLDER) : found;
  }

  /** A new folder (a name already there gets " (2)" and so on). */
  async makeFolder(name: string, parent: string): Promise<DriveFile> {
    const clean = name.trim().replace(/[\\/]/g, '-');
    if (!clean) throw new Error('Type a name for the folder.');
    const taken = new Set((await this.api.folders(parent)).map((f) => f.name.toLowerCase()));
    return this.api.makeFolder(uniqueName(clean, taken), parent);
  }

  /**
   * Rename a design or a folder. A design keeps its .vorm ending; a name another design (or
   * folder) in the same folder already has is refused.
   */
  async rename(item: DriveFile, name: string, folder: boolean): Promise<DriveFile> {
    let clean = name.trim().replace(/[\\/]/g, '-');
    if (!clean) throw new Error('Type a name.');
    if (!folder) clean = `${clean.replace(DESIGN, '')}.${DESIGN.exec(item.name)?.[1] ?? 'vorm'}`;
    if (clean === item.name) return item;
    const parent = item.parents?.[0];
    if (parent) {
      const siblings = folder ? await this.api.folders(parent) : await this.api.list(parent);
      if (siblings.some((f) => f.id !== item.id && f.name.toLowerCase() === clean.toLowerCase())) {
        throw new Error(`There is already ${folder ? 'a folder' : 'a design'} called “${clean.replace(DESIGN, '')}” there.`);
      }
    }
    return this.api.rename(item.id, clean);
  }

  /**
   * Move a design or folder into another folder. A folder cannot go inside itself; a name already
   * taken there gets " (2)".
   */
  async move(item: DriveFile, to: string, folder: boolean): Promise<DriveFile> {
    const from = item.parents?.[0];
    if (!from) throw new Error('VormCraft cannot tell which folder that is in.');
    if (from === to) return item;
    if (folder && (await this.inside(to, item.id))) throw new Error('A folder cannot go inside itself.');
    const there = folder ? await this.api.folders(to) : await this.api.list(to);
    const free = uniqueName(item.name, new Set(there.map((f) => f.name.toLowerCase())));
    const moved = await this.api.move(item.id, from, to);
    return free === item.name ? moved : this.api.rename(item.id, free);
  }

  /** Whether `folderId` is `ancestor` or inside it. */
  private async inside(folderId: string, ancestor: string): Promise<boolean> {
    const parent = new Map((await this.api.allFolders()).map((f) => [f.id, f.parents?.[0]]));
    for (let id: string | undefined = folderId, n = 0; id && n < 100; id = parent.get(id), n++) {
      if (id === ancestor) return true;
    }
    return false;
  }

  /** How many designs and folders a folder holds, all the way down. */
  async contents(folderId: string): Promise<FolderContents> {
    const out: FolderContents = { designs: 0, folders: 0 };
    const queue = [folderId];
    while (queue.length) {
      const id = queue.shift()!;
      const [designs, folders] = await Promise.all([this.api.list(id), this.api.folders(id)]);
      out.designs += designs.filter((f) => DESIGN.test(f.name)).length;
      out.folders += folders.length;
      queue.push(...folders.map((f) => f.id));
    }
    return out;
  }

  /** Put a design or folder (with all it holds) in Drive's bin. VormCraft's own folders stay. */
  async trash(item: DriveFile): Promise<void> {
    const s = this.need();
    if (item.id === s.folderId || item.id === s.autosaveFolderId) throw new Error('VormCraft needs this folder.');
    await this.api.trash(item.id);
    if (s.lastFolderId === item.id) {
      s.lastFolderId = undefined;
      this.save();
    }
  }

  /**
   * Every design VormCraft can see, newest first, with the folders it is in: also designs moved
   * out of VormCraft's folders on the Drive website. Autosaved copies are left out.
   */
  async everywhere(): Promise<DesignEverywhere[]> {
    const s = this.need();
    const [files, folders] = await Promise.all([this.api.allFiles(), this.api.allFolders()]);
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathOf = (folderId: string | undefined): string[] | null => {
      const names: string[] = [];
      for (let id = folderId, n = 0; id && n < 100; n++) {
        if (id === s.folderId) return names.reverse();
        const f = byId.get(id);
        if (!f) return null;
        names.push(f.name);
        id = f.parents?.[0];
      }
      return null;
    };
    const out: DesignEverywhere[] = [];
    for (const file of files) {
      const folderId = file.parents?.[0];
      if (!DESIGN.test(file.name) || (folderId !== undefined && folderId === s.autosaveFolderId)) continue;
      const path = pathOf(folderId);
      // Autosaved copies from another device (this one may not know that Autosave folder yet).
      if (path?.[0] === AUTOSAVE_FOLDER) continue;
      out.push({ file, path });
    }
    return out;
  }

  async open(file: DriveFile): Promise<{ bytes: Uint8Array; location: DriveLocation }> {
    const bytes = await this.api.downloadBytes(file.id);
    const meta = await this.api.meta(file.id);
    return { bytes, location: { fileId: file.id, revision: meta?.headRevisionId ?? file.headRevisionId, folderId: meta?.parents?.[0] ?? file.parents?.[0] } };
  }

  /**
   * A new design file in a folder (VormCraft's own if none is given; a name already there gets
   * " (2)" and so on). The folder is remembered as where the next new design starts.
   */
  async create(fileName: string, bytes: string | Uint8Array, folderId?: string): Promise<{ file: DriveFile; location: DriveLocation }> {
    const s = this.need();
    const folder = folderId ?? s.folderId;
    const taken = new Set((await this.api.list(folder)).map((f) => f.name.toLowerCase()));
    const file = await this.api.create(uniqueName(fileName, taken), folder, bytes);
    s.lastFolderId = folder === s.folderId ? undefined : folder;
    this.save();
    return { file, location: { fileId: file.id, revision: file.headRevisionId, folderId: folder } };
  }

  /**
   * Save over a design's Drive file. Unless `replace`, first checks it was not changed elsewhere
   * since it was opened or last saved here (throws `DriveClash`). A file that has gone (deleted)
   * is made again in its folder, or in VormCraft's folder if that has gone too.
   */
  async update(location: DriveLocation, fileName: string, bytes: string | Uint8Array, replace = false): Promise<{ file: DriveFile; location: DriveLocation }> {
    const current = await this.api.meta(location.fileId);
    if (!current) {
      const folderLeft = location.folderId !== undefined && (await this.api.meta(location.folderId)) !== null;
      return this.create(fileName, bytes, folderLeft ? location.folderId : undefined);
    }
    if (!replace && location.revision && current.headRevisionId && current.headRevisionId !== location.revision) throw new DriveClash(current);
    const file = await this.api.update(location.fileId, bytes);
    return { file, location: { fileId: file.id, revision: file.headRevisionId, folderId: file.parents?.[0] ?? current.parents?.[0] ?? location.folderId } };
  }

  /**
   * Write a design's autosaved copy to VormCraft/Autosave: one file per design, replaced each
   * time. Never touches the design's own file.
   */
  async autosave(designKey: string, fileName: string, bytes: string | Uint8Array): Promise<DriveFile> {
    const s = this.need();
    s.autosaveFolderId ??= await this.api.folder(AUTOSAVE_FOLDER, s.folderId);
    const known = s.autosaveFiles[designKey];
    let file: DriveFile | null = null;
    if (known) {
      try {
        file = await this.api.update(known, bytes);
      } catch (err) {
        if (!(err instanceof DriveError && err.status === 404)) throw err;
      }
    }
    if (!file) {
      try {
        file = await this.api.create(fileName, s.autosaveFolderId, bytes);
      } catch (err) {
        // The Autosave folder was deleted: make it again.
        if (!(err instanceof DriveError && err.status === 404)) throw err;
        s.autosaveFolderId = await this.api.folder(AUTOSAVE_FOLDER, s.folderId);
        file = await this.api.create(fileName, s.autosaveFolderId, bytes);
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
