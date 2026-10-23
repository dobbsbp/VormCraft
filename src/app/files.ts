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
   * place (desktop) or it is downloaded (browser). Returns the name/path written, or null if
   * the user cancelled.
   */
  save(data: string | Uint8Array, suggestedName: string, filter: FileFilter, path?: string): Promise<{ name: string; path?: string } | null>;
}

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function createFileHost(): Promise<FileHost> {
  return isTauri() ? tauriHost() : browserHost();
}

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

async function tauriHost(): Promise<FileHost> {
  const dialog = await import('@tauri-apps/plugin-dialog');
  const fs = await import('@tauri-apps/plugin-fs');
  return {
    native: true,
    async open(filter) {
      const path = await dialog.open({ multiple: false, directory: false, filters: [filter] });
      if (typeof path !== 'string') return null;
      return { name: baseName(path), path, text: await fs.readTextFile(path) };
    },
    async save(data, suggestedName, filter, path) {
      const target = path ?? (await dialog.save({ defaultPath: suggestedName, filters: [filter] }));
      if (!target) return null;
      if (typeof data === 'string') await fs.writeTextFile(target, data);
      else await fs.writeFile(target, data);
      return { name: baseName(target), path: target };
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
    async save(data, suggestedName) {
      const blob = new Blob([typeof data === 'string' ? data : (data.slice().buffer as ArrayBuffer)], {
        type: typeof data === 'string' ? 'text/plain' : 'application/octet-stream',
      });
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
