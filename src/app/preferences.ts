/**
 * Every preference VormCraft keeps on a device (localStorage keys), and which of them travel to
 * Google Drive when the person saves this device's settings there. Things tied to this one device
 * (a folder path, the Drive sign-in, window positions, caches) stay behind.
 */
export interface Preference {
  key: string;
  synced: boolean;
  /** For a synced object, fields that stay on the device (kept when loading, left out when saving). */
  local?: readonly string[];
}

export const PREFERENCES: readonly Preference[] = [
  { key: 'vormcraft.backdrop', synced: true },
  { key: 'vormcraft.settings', synced: true, local: ['backupFolder'] },
  { key: 'vormcraft.units.default', synced: true },
  { key: 'vormcraft.palette.order', synced: true },
  { key: 'vormcraft.palette.tools', synced: true },
  { key: 'vormcraft.palette.side', synced: true },
  { key: 'vormcraft.toolbar.hidden', synced: true },
  { key: 'vormcraft.export.resolution', synced: true },
  { key: 'vormcraft.import', synced: true },
  { key: 'vormcraft.import.skp', synced: true },
  { key: 'vormcraft.text3d', synced: true },
  { key: 'vormcraft.palette.hidden', synced: false },
  { key: 'vormcraft.materials.position', synced: false },
  { key: 'vormcraft.materials.tab', synced: false },
  { key: 'vormcraft.viewer.resolution', synced: false },
  { key: 'vormcraft.graphicsTip.dismissed', synced: false },
  { key: 'vormcraft.drive', synced: false },
  { key: 'vormcraft.drive.autosave', synced: false },
  { key: 'vormcraft.drive.hidden', synced: false },
  { key: 'vormcraft.device', synced: false },
];

/** The part of localStorage these helpers use (so tests can pass a plain object). */
export interface PreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const parseObject = (text: string | null): Record<string, unknown> | null => {
  try {
    const v = text === null ? null : JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** This device's synced preferences, as stored (keys that are not set are left out). */
export function collectPreferences(store: PreferenceStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PREFERENCES) {
    if (!p.synced) continue;
    const value = store.getItem(p.key);
    if (value === null) continue;
    const obj = p.local ? parseObject(value) : null;
    if (obj) for (const field of p.local!) delete obj[field];
    out[p.key] = obj ? JSON.stringify(obj) : value;
  }
  return out;
}

/**
 * Use saved preferences on this device: every synced preference takes the saved value, or goes
 * back to its default when the saved set has none. Device-only preferences, and device-only
 * fields of synced ones, are kept. Unknown keys are ignored.
 */
export function applyPreferences(store: PreferenceStore, saved: Record<string, string>): void {
  for (const p of PREFERENCES) {
    if (!p.synced) continue;
    const value = typeof saved[p.key] === 'string' ? saved[p.key] : null;
    if (value === null) {
      store.removeItem(p.key);
      continue;
    }
    const obj = p.local ? parseObject(value) : null;
    const here = p.local ? parseObject(store.getItem(p.key)) : null;
    if (obj) for (const field of p.local!) if (here && field in here) obj[field] = here[field];
    store.setItem(p.key, obj ? JSON.stringify(obj) : value);
  }
}

/** One device's settings as saved in Google Drive. */
export interface SavedDevice {
  name: string;
  /** When they were saved (milliseconds since 1970). */
  saved: number;
  /** The VormCraft version that saved them. */
  app: string;
  settings: Record<string, string>;
}

/** The settings file in VormCraft's Drive folder: each device's settings by its id. */
export interface SettingsFile {
  format: 'vormcraft-settings';
  version: 1;
  devices: Record<string, SavedDevice>;
}

export const SETTINGS_FILE_NAME = 'VormCraft settings.json';

export const emptySettingsFile = (): SettingsFile => ({ format: 'vormcraft-settings', version: 1, devices: {} });

/** Read the settings file; entries that are damaged are left out, a file that is not one is an error. */
export function parseSettingsFile(text: string): SettingsFile {
  const raw = parseObject(text);
  if (!raw || raw.format !== 'vormcraft-settings') throw new Error(`${SETTINGS_FILE_NAME} in Google Drive is not a VormCraft settings file.`);
  if (typeof raw.version !== 'number' || raw.version > 1) throw new Error(`${SETTINGS_FILE_NAME} was saved by a newer version of VormCraft; please update the app.`);
  const out = emptySettingsFile();
  const devices = raw.devices && typeof raw.devices === 'object' ? (raw.devices as Record<string, unknown>) : {};
  for (const [id, d] of Object.entries(devices)) {
    const e = d as Partial<SavedDevice> | null;
    if (!e || typeof e.name !== 'string' || typeof e.saved !== 'number' || !e.settings || typeof e.settings !== 'object') continue;
    const settings = Object.fromEntries(Object.entries(e.settings).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
    out.devices[id] = { name: e.name, saved: e.saved, app: typeof e.app === 'string' ? e.app : '', settings };
  }
  return out;
}

/** This device: an id that never changes (so it can be renamed) and the name the person gave it. */
export interface DeviceIdentity {
  id: string;
  name: string;
}

const DEVICE_KEY = 'vormcraft.device';

/** A first guess at a name for this device ("Windows app", "Chrome on Android"). */
export function guessDeviceName(userAgent: string, desktopApp: boolean): string {
  if (desktopApp) return 'Windows app';
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const os = /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iPhone or iPad' : /Windows/.test(userAgent) ? 'Windows' : /Mac OS/.test(userAgent) ? 'Mac' : /Linux/.test(userAgent) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function deviceIdentity(store: PreferenceStore, guess: () => string, newId: () => string): DeviceIdentity {
  const saved = parseObject(store.getItem(DEVICE_KEY));
  if (saved && typeof saved.id === 'string' && typeof saved.name === 'string') return { id: saved.id, name: saved.name };
  const made = { id: newId(), name: guess() };
  store.setItem(DEVICE_KEY, JSON.stringify(made));
  return made;
}

export function renameDevice(store: PreferenceStore, device: DeviceIdentity, name: string): DeviceIdentity {
  const next = { ...device, name };
  store.setItem(DEVICE_KEY, JSON.stringify(next));
  return next;
}
