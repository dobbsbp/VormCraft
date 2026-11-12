import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreferences, collectPreferences, deviceIdentity, emptySettingsFile, guessDeviceName, parseSettingsFile, PREFERENCES, renameDevice, type PreferenceStore } from '../src/app/preferences';

function store(init: Record<string, string> = {}): PreferenceStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** Every 'vormcraft.…' key written in the app's source. */
function keysInSource(dir: string, out = new Set<string>()): Set<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) keysInSource(path, out);
    else if (path.endsWith('.ts')) for (const m of readFileSync(path, 'utf8').matchAll(/'(vormcraft\.[a-zA-Z.]+)'/g)) out.add(m[1]);
  }
  return out;
}

describe('device preferences', () => {
  it('every preference the app stores is listed, as synced or kept on the device', () => {
    const listed = new Set(PREFERENCES.map((p) => p.key));
    const missing = [...keysInSource(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))].filter((k) => !listed.has(k));
    expect(missing).toEqual([]);
  });

  it('collects synced preferences only, leaving out device-only fields', () => {
    const s = store({
      'vormcraft.backdrop': '{"on":true}',
      'vormcraft.settings': '{"autosave":false,"backupFolder":"D:/Backups"}',
      'vormcraft.drive': '{"email":"a@b.c"}',
      'vormcraft.materials.position': '[1,2]',
    });
    expect(collectPreferences(s)).toEqual({ 'vormcraft.backdrop': '{"on":true}', 'vormcraft.settings': '{"autosave":false}' });
  });

  it('applying sets synced ones, resets synced ones not saved, and keeps device-only ones', () => {
    const s = store({
      'vormcraft.palette.side': 'right',
      'vormcraft.settings': '{"autosave":true,"backupFolder":"D:/Mine"}',
      'vormcraft.drive': '{"email":"a@b.c"}',
    });
    applyPreferences(s, { 'vormcraft.settings': '{"autosave":false,"backupFolder":"E:/Theirs"}', 'vormcraft.units.default': '{"unit":"cm","precision":1}', 'vormcraft.unknown': 'x' });
    expect(s.data.get('vormcraft.palette.side')).toBeUndefined();
    expect(JSON.parse(s.data.get('vormcraft.settings')!)).toEqual({ autosave: false, backupFolder: 'D:/Mine' });
    expect(s.data.get('vormcraft.units.default')).toBe('{"unit":"cm","precision":1}');
    expect(s.data.get('vormcraft.drive')).toBe('{"email":"a@b.c"}');
    expect(s.data.has('vormcraft.unknown')).toBe(false);
  });

  it('reads the settings file, leaving out damaged entries; refuses other files and newer versions', () => {
    const file = { ...emptySettingsFile(), devices: { a: { name: 'Office PC', saved: 1, app: '0.5.12', settings: { k: 'v', bad: 3 } }, b: { name: 7 } } };
    const parsed = parseSettingsFile(JSON.stringify(file));
    expect(Object.keys(parsed.devices)).toEqual(['a']);
    expect(parsed.devices.a.settings).toEqual({ k: 'v' });
    expect(() => parseSettingsFile('{"format":"other"}')).toThrow(/not a VormCraft settings file/);
    expect(() => parseSettingsFile('{"format":"vormcraft-settings","version":2}')).toThrow(/newer version/);
  });

  it('a device keeps its id when renamed; its first name is a guess', () => {
    const s = store();
    const d = deviceIdentity(s, () => 'Chrome on Windows', () => 'id-1');
    expect(d).toEqual({ id: 'id-1', name: 'Chrome on Windows' });
    expect(deviceIdentity(s, () => 'x', () => 'id-2')).toEqual(d);
    renameDevice(s, d, 'Office PC');
    expect(deviceIdentity(s, () => 'x', () => 'id-3')).toEqual({ id: 'id-1', name: 'Office PC' });
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/130 Safari/537', false)).toBe('Chrome on Windows');
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari', false)).toBe('Chrome on Android');
    expect(guessDeviceName('anything', true)).toBe('Windows app');
  });
});
