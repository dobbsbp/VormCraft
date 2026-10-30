/** App settings (not part of any design): kept on this computer, and kept across updates. */
export interface Settings {
  autosave: boolean;
  /** Minutes between autosaves (only when something changed). */
  autosaveMinutes: number;
  /** Folder for autosaved copies; null = the app's own data folder. Desktop only. */
  backupFolder: string | null;
  /** Autosaved copies that were never recovered are deleted after this many days. */
  keepBackupDays: number;
  /** Keep a version history in each design (saved in the file). */
  history: boolean;
  /** Largest size of a design's history, in megabytes; the oldest versions go first. */
  historyLimitMB: number;
  /** Look for a newer version on GitHub when the app starts. */
  checkUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autosave: true,
  autosaveMinutes: 1,
  backupFolder: null,
  keepBackupDays: 14,
  history: true,
  historyLimitMB: 25,
  checkUpdates: true,
};

const KEY = 'vormcraft.settings';
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** Settings from anything (stored JSON, a form): unknown or bad values fall back to the defaults. */
export function cleanSettings(raw: Partial<Record<keyof Settings, unknown>>): Settings {
  const d = DEFAULT_SETTINGS;
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    autosave: bool(raw.autosave, d.autosave),
    autosaveMinutes: clamp(raw.autosaveMinutes, 0.5, 60, d.autosaveMinutes),
    backupFolder: typeof raw.backupFolder === 'string' && raw.backupFolder.trim() ? raw.backupFolder.trim() : null,
    keepBackupDays: Math.round(clamp(raw.keepBackupDays, 1, 365, d.keepBackupDays)),
    history: bool(raw.history, d.history),
    historyLimitMB: Math.round(clamp(raw.historyLimitMB, 1, 1000, d.historyLimitMB)),
    checkUpdates: bool(raw.checkUpdates, d.checkUpdates),
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  try {
    const text = storage?.getItem(KEY);
    return cleanSettings(text ? JSON.parse(text) : {});
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: the settings last for this session only.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
