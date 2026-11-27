/**
 * File access for the two hosts the app runs in: a browser (file picker + downloads) and the
 * Tauri desktop app (native dialogs, real paths, so Save writes back to the same file).
 */
export interface OpenedFile {
  name: string;
  text: string;
  path?: string;
}

export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface FileHost {
  readonly native: boolean;
  open(filter: FileFilter): Promise<OpenedFile | null>;
  /**
   * Write a file. With `path` (desktop) it is written there directly; otherwise the user picks a
   * place (desktop) or it is downloaded (browser). A `suggestedName` that is a whole path starts
   * the picker there; a bare name starts it in the folder last saved in on this device (else
   * Documents). Returns the name/path written, or null if the user cancelled.
   */
  save(data: string | Uint8Array, suggestedName: string, filter: FileFilter, path?: string): Promise<{ name: string; path?: string } | null>;
  /** Pick a file and read it as bytes (importing binary formats such as STL). */
  openBinary(filter: FileFilter): Promise<{ name: string; path?: string; bytes: Uint8Array } | null>;
  /** Read a file by path as bytes (desktop only: a file opened from Explorer). */
  readPath?(path: string): Promise<{ name: string; path: string; bytes: Uint8Array }>;
  /** Show a saved file in the system's file manager, selected (desktop only). */
  reveal?(path: string): Promise<void>;
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function createFileHost(): Promise<FileHost> {
  return isTauri() ? tauriHost() : browserHost();
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** The folder a file was last saved in through the picker, on this device (desktop). */
const LAST_FOLDER_KEY = 'vormcraft.files.lastFolder';

function lastFolder(): string | null {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY);
  } catch {
    return null;
  }
}

function rememberFolder(path: string): void {
  const folder = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
  try {
    if (folder) localStorage.setItem(LAST_FOLDER_KEY, folder);
  } catch {
    // Remembered for this session only.
  }
}

async function tauriHost(): Promise<FileHost> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  const fs = await import('@tauri-apps/plugin-fs');
  const paths = await import('@tauri-apps/api/path');
  /** Where the save picker starts: the given path, else the last folder used, else Documents. */
  const startAt = async (suggestedName: string) => {
    if (/[\\/]/.test(suggestedName)) return suggestedName;
    const folder = lastFolder() ?? (await paths.documentDir().catch(() => null));
    return folder ? paths.join(folder, suggestedName) : suggestedName;
  };
  return {
    native: true,
    async open(filter) {
      const path = await dialog.open({ multiple: false, directory: false, filters: [filter] });
      if (typeof path !== 'string') return null;
      return { name: baseName(path), path, text: await fs.readTextFile(path) };
    },
    async save(data, suggestedName, filter, path) {
      const target = path ?? (await dialog.save({ defaultPath: await startAt(suggestedName), filters: [filter] }));
      if (!target) return null;
      if (!path) rememberFolder(target);
      // Write beside, then replace (as backups do): running out of disk space or a crash mid-write
      // never leaves the saved file half-written.
      const temp = `${target}.tmp`;
      try {
        if (typeof data === 'string') await fs.writeTextFile(temp, data);
        else await fs.writeFile(temp, data);
        await fs.rename(temp, target);
      } catch (err) {
        await fs.remove(temp).catch(() => {});
        throw err;
      }
      return { name: baseName(target), path: target };
    },
    async openBinary(filter) {
      const path = await dialog.open({ multiple: false, directory: false, filters: [filter] });
      if (typeof path !== 'string') return null;
      return { name: baseName(path), path, bytes: await fs.readFile(path) };
    },
    async readPath(path) {
      return { name: baseName(path), path, bytes: await fs.readFile(path) };
    },
    async reveal(path) {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(path);
    },
  };
}

function browserHost(): FileHost {
  return {
    native: false,
    open(filter) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = filter.extensions.map((e) => `.${e}`).join(',');
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          resolve(file ? { name: file.name, text: await file.text() } : null);
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
    },
    openBinary(filter) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = filter.extensions.map((e) => `.${e}`).join(',');
        input.addEventListener('change', async () => {
          const file = input.files?.[0];
          resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
    },
    async save(data, suggestedName) {
      // Always a generic binary type: Chrome on Android adds the type's own extension to names it
      // does not recognise, so text/plain turned "Model.vorm" into "Model.vorm.txt".
      const blob = new Blob([typeof data === 'string' ? data : (data.slice().buffer as ArrayBuffer)], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { name: suggestedName };
    },
  };
}
