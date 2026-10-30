import { serializeDocument } from '../io/fileFormat';
import { hashText } from '../io/versions';
import type { ToolController } from '../tools/ToolController';
import type { BackupStore } from './backups';
import type { Settings } from './settings';

const SUFFIX = '.autosave.vorm';
const DAY = 24 * 3600_000;

/** What an autosaved copy says about the design it came from. */
export interface AutosaveInfo {
  /** The design's name (file name without extension, or Untitled). */
  name: string;
  /** Where the design is saved, if it has been. */
  path?: string;
  time: number;
}

/** An autosaved copy that can be recovered (left by a session that did not save or discard). */
export interface Recoverable extends AutosaveInfo {
  file: string;
  text: string;
}

/**
 * Autosave: every few minutes (Settings), if the design changed, record a version in its history
 * and write a recovery copy to the backup folder. The design's own file is never touched. The
 * copy is removed once the design is saved or its changes are discarded, so a copy still there
 * at startup means unsaved work to offer back.
 */
export class AutoSaver {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRevision = -1;
  /** This session's copy (named after the design, so a recovered design keeps using its copy). */
  private file: string | null = null;
  private readonly session = Date.now().toString(36);
  /** Called after each autosave (time) or failure (message). */
  onSaved: (time: number) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(
    private readonly controller: ToolController,
    private readonly design: () => { name: string; path?: string },
    private readonly store: BackupStore,
    private readonly settings: () => Settings,
    private readonly now: () => number = Date.now,
  ) {}

  /** (Re)start the timer from the current settings. */
  start(): void {
    this.stop();
    const s = this.settings();
    if (!s.autosave) return;
    this.timer = setInterval(() => void this.tick(), s.autosaveMinutes * 60_000);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** The copy's file name for the current design. */
  private fileName(): string {
    const { name, path } = this.design();
    const safe = name.replace(/[^\w\- ]+/g, '_').slice(0, 60) || 'Untitled';
    return `${safe}-${hashText(path ?? this.session).replace(/-/g, '')}${SUFFIX}`;
  }

  /**
   * Autosave now if anything changed since the last one. `force`: write the recovery copy even
   * if autosave is switched off (before installing an update). Returns whether it saved.
   */
  async tick(force = false): Promise<boolean> {
    const c = this.controller;
    const s = this.settings();
    if ((!s.autosave && !force) || c.previewing || !c.dirty || (!force && c.revision === this.lastRevision)) return false;
    const revision = c.revision;
    try {
      if (s.history) c.recordVersion('auto', s.historyLimitMB * 1024 * 1024);
      const time = this.now();
      const name = this.fileName();
      const info: AutosaveInfo = { ...this.design(), time };
      const file = JSON.parse(serializeDocument(c.doc, { history: s.history }));
      file.autosave = info;
      await this.store.write(name, JSON.stringify(file));
      // Renamed or saved elsewhere since the last copy: the old copy is not needed any more.
      if (this.file && this.file !== name) await this.store.remove(this.file);
      this.file = name;
      this.lastRevision = revision;
      this.onSaved(time);
      return true;
    } catch (err) {
      this.onError(`Autosave failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /** The design was saved or its changes discarded: its recovery copy is not needed. */
  async clear(): Promise<void> {
    const names = new Set([this.file, this.fileName()].filter((n): n is string => n !== null));
    this.file = null;
    this.lastRevision = this.controller.revision;
    for (const n of names) await this.store.remove(n).catch(() => {});
  }

  /**
   * Copies left by earlier sessions (newest first), after deleting those older than the
   * keep-for setting. Copies that cannot be read are skipped.
   */
  async recoverable(): Promise<Recoverable[]> {
    const keepFor = this.settings().keepBackupDays * DAY;
    const out: Recoverable[] = [];
    for (const e of await this.store.list()) {
      if (!e.name.endsWith(SUFFIX)) continue;
      if (this.now() - e.modified > keepFor) {
        await this.store.remove(e.name).catch(() => {});
        continue;
      }
      try {
        const text = await this.store.read(e.name);
        const info = JSON.parse(text).autosave as AutosaveInfo | undefined;
        out.push({ file: e.name, text, name: info?.name ?? 'Untitled', path: info?.path, time: info?.time ?? e.modified });
      } catch {
        // Unreadable: leave it for the user to look at.
      }
    }
    return out.sort((a, b) => b.time - a.time);
  }

  /** Continue with a recovered copy: later autosaves replace it, and saving removes it. */
  adopt(r: Recoverable): void {
    this.file = r.file;
  }

  /** Throw away a recovered copy the user does not want. */
  async discard(r: Recoverable): Promise<void> {
    await this.store.remove(r.file);
  }
}
