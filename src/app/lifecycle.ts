import { parseDocument } from '../io/fileFormat';
import type { ToolController } from '../tools/ToolController';
import type { Viewer } from '../view/Viewer';
import { AutoSaver } from './autosave';
import type { BackupStore } from './backups';
import { confirmDialog, messageDialog } from './dialogs';
import type { FileCommands } from './fileCommands';
import { isTauri } from './files';
import { loadSettings, saveSettings, type Settings } from './settings';
import { showSettingsDialog } from './settingsDialog';
import { APP_VERSION, checkForUpdates, type UpdateHooks } from './updater';

/**
 * Keeping work safe and the app current: settings, autosave and recovery after a crash, update
 * checks, and the About box. Created once at startup by main.ts.
 */
export class Lifecycle {
  settings: Settings = loadSettings();
  readonly autosave: AutoSaver;
  /** When the last autosave happened (for the status bar). */
  lastAutosave: number | null = null;
  private files!: FileCommands;

  constructor(
    private readonly controller: ToolController,
    private readonly viewer: Viewer,
    private readonly backups: BackupStore,
  ) {
    this.autosave = new AutoSaver(controller, () => ({ name: this.files.name, path: this.files.path }), backups, () => this.settings);
    this.autosave.onSaved = (time) => {
      this.lastAutosave = time;
      controller.onUpdate();
    };
    this.autosave.onError = (message) => controller.notify(message);
  }

  /** Byte limit for a design's history, from the settings. */
  get historyLimit(): number {
    return this.settings.historyLimitMB * 1024 * 1024;
  }

  /** Connect the file commands (they need the autosaver, and it needs their file name). */
  attach(files: FileCommands): void {
    this.files = files;
  }

  readonly updateHooks: UpdateHooks = {
    notify: (message) => this.controller.notify(message),
    beforeInstall: async () => {
      if (!this.controller.dirty) return true;
      const save = await confirmDialog(
        'Unsaved changes',
        'Save your changes before updating?\n\nIf you do not, they are kept as a recovery copy and offered back when VormCraft opens again.',
        'Save and update',
        'Update without saving',
      );
      if (save) await this.files.save();
      if (this.controller.dirty) await this.autosave.tick(true);
      return true;
    },
  };

  checkForUpdates(quiet = false): Promise<void> {
    return checkForUpdates(this.updateHooks, quiet);
  }

  async openSettings(): Promise<void> {
    const next = await showSettingsDialog(this.settings, {
      defaultFolder: isTauri() ? await this.backups.describe() : 'This browser’s storage',
      version: APP_VERSION,
      checkForUpdates: () => void this.checkForUpdates(),
    });
    if (!next) return;
    this.settings = next;
    saveSettings(next);
    this.autosave.start();
    this.controller.notify('Settings saved');
  }

  async about(): Promise<void> {
    const gpu = this.viewer.graphicsInfo();
    await messageDialog(
      'About VormCraft',
      [
        `VormCraft ${APP_VERSION}`,
        'A free, open-source push/pull 3D modeler.',
        '',
        `Graphics: ${gpu.renderer}${gpu.software ? ' (software: no hardware acceleration)' : ''}`,
        `Running as: ${isTauri() ? 'desktop app' : 'web app'}`,
        '',
        'https://github.com/dobbsbp/VormCraft',
        'MIT licence.',
      ].join('\n'),
    );
  }

  /**
   * Startup: warn about software rendering, open a file the app was started with (or offer to
   * recover unsaved work from last time), start autosave, then look for updates.
   */
  async start(): Promise<void> {
    const gpu = this.viewer.graphicsInfo();
    if (gpu.software) {
      await messageDialog(
        'Graphics acceleration is off',
        `VormCraft is drawing without the graphics card (${gpu.renderer}), so it will be slow.\n\nUpdating your graphics drivers usually fixes this. On a laptop with two graphics chips, you can also set VormCraft to "High performance" in Windows Settings → System → Display → Graphics.`,
      );
    }
    const launched = await this.launchFile();
    if (launched) await this.files.openPath(launched);
    else await this.offerRecovery();
    this.autosave.start();
    if (this.settings.checkUpdates) setTimeout(() => void this.checkForUpdates(true), 3000);
  }

  /** The .vorm file double-clicked in Explorer to start the app (desktop), if any. */
  private async launchFile(): Promise<string | null> {
    if (!isTauri()) return null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const f = await invoke<{ name: string; path: string; text: string } | null>('launch_file');
      return f?.path ?? null;
    } catch {
      return null;
    }
  }

  /** Unsaved work left by a session that ended without saving: offer the newest back. */
  private async offerRecovery(): Promise<void> {
    let found;
    try {
      found = await this.autosave.recoverable();
    } catch {
      return;
    }
    const r = found[0];
    if (!r) return;
    const when = new Date(r.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const more = found.length > 1 ? `\n\n(${found.length - 1} older unsaved ${found.length === 2 ? 'copy is' : 'copies are'} also in the backup folder.)` : '';
    const ok = await confirmDialog(
      'Recover unsaved work?',
      `VormCraft closed without saving “${r.name}”. An autosaved copy from ${when} can be opened.${more}\n\nIf you choose Not now, the copy stays in the backup folder for ${this.settings.keepBackupDays} days.`,
      'Recover',
      'Not now',
    );
    if (!ok) return;
    try {
      this.files.recovered(parseDocument(r.text), r.name, r.path);
      this.autosave.adopt(r);
      this.controller.notify(`Recovered “${r.name}” from ${when}. Save it to keep it.`);
    } catch (err) {
      this.controller.notify(`Could not recover that copy: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
