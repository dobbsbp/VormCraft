import { isTauri } from './files';

/** An autosaved copy in the backup folder. */
export interface BackupEntry {
  name: string;
  /** When it was written (milliseconds since 1970). */
  modified: number;
}

/**
 * Where autosaved copies live: a real folder on the desktop (the app's data folder, or one chosen
 * in Settings), or the browser's own storage in the web version.
 */
export interface BackupStore {
  /** Where the copies are, for showing in Settings. */
  describe(): Promise<string>;
  write(name: string, text: string): Promise<void>;
  read(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  list(): Promise<BackupEntry[]>;
}

export async function createBackupStore(folder: () => string | null): Promise<BackupStore> {
  return isTauri() ? folderStore(folder) : browserStore();
}

async function folderStore(chosen: () => string | null): Promise<BackupStore> {
  const fs = await import('@tauri-apps/plugin-fs');
  const path = await import('@tauri-apps/api/path');
  const dir = async () => chosen() ?? (await path.join(await path.appLocalDataDir(), 'Backups'));
  const file = async (name: string) => path.join(await dir(), name);
  return {
    describe: dir,
    async write(name, text) {
      const d = await dir();
      if (!(await fs.exists(d))) await fs.mkdir(d, { recursive: true });
      // Write beside, then replace: a crash mid-write never leaves a half-written copy.
      const target = await file(name);
      const temp = `${target}.tmp`;
      await fs.writeTextFile(temp, text);
      await fs.rename(temp, target);
    },
    async read(name) {
      return fs.readTextFile(await file(name));
    },
    async remove(name) {
      const f = await file(name);
      if (await fs.exists(f)) await fs.remove(f);
    },
    async list() {
      const d = await dir();
      if (!(await fs.exists(d))) return [];
      const out: BackupEntry[] = [];
      for (const e of await fs.readDir(d)) {
        if (!e.isFile) continue;
        const info = await fs.stat(await path.join(d, e.name));
        out.push({ name: e.name, modified: info.mtime ? info.mtime.getTime() : 0 });
      }
      return out;
    },
  };
}

/** The web version: copies in IndexedDB (localStorage is too small for models with textures). */
function browserStore(): BackupStore {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('vormcraft-backups', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const store = (await db).transaction('files', mode).objectStore('files');
    return new Promise((resolve, reject) => {
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    describe: async () => 'This browser’s storage',
    write: async (name, text) => void (await run('readwrite', (s) => s.put({ text, modified: Date.now() }, name))),
    read: async (name) => ((await run('readonly', (s) => s.get(name))) as { text: string }).text,
    remove: async (name) => void (await run('readwrite', (s) => s.delete(name))),
    async list() {
      const keys = (await run('readonly', (s) => s.getAllKeys())) as string[];
      const values = (await run('readonly', (s) => s.getAll())) as { modified: number }[];
      return keys.map((name, i) => ({ name, modified: values[i]?.modified ?? 0 }));
    },
  };
}
