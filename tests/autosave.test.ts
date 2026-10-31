import { beforeAll, describe, expect, it } from 'vitest';
import { AutoSaver } from '../src/app/autosave';
import type { BackupEntry, BackupStore } from '../src/app/backups';
import { FileCommands } from '../src/app/fileCommands';
import type { FileHost } from '../src/app/files';
import { cleanSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../src/app/settings';
import { drawRectangle, GROUND_PLANE, initBooleanKernel } from '../src/core';
import { parseDocument, serializeDocument } from '../src/io/fileFormat';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A backup folder in memory, with a clock for file times. */
class MemoryStore implements BackupStore {
  files = new Map<string, { text: string; modified: number }>();
  clock = 1_000_000;
  describe = async () => 'memory';
  write = async (name: string, text: string) => void this.files.set(name, { text, modified: this.clock });
  read = async (name: string) => this.files.get(name)!.text;
  remove = async (name: string) => void this.files.delete(name);
  list = async (): Promise<BackupEntry[]> => [...this.files].map(([name, f]) => ({ name, modified: f.modified }));
}

/** A desktop-like file host writing to memory. */
class MemoryHost implements FileHost {
  readonly native = true;
  files = new Map<string, string>();
  next: { text: string; name: string; path: string } | null = null;
  open = async () => this.next;
  nextBinary: { name: string; bytes: Uint8Array } | null = null;
  openBinary = async () => this.nextBinary;
  async save(data: string | Uint8Array, suggestedName: string, _f: unknown, path?: string) {
    const target = path ?? `C:/Saved/${suggestedName}`;
    this.files.set(target, typeof data === 'string' ? data : '<binary>');
    return { name: target.split('/').pop()!, path: target };
  }
  readPath = async (path: string) => ({ name: path.split('/').pop()!, path, text: this.files.get(path)! });
}

function setup(over: Partial<Settings> = {}) {
  const h = harness();
  const store = new MemoryStore();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...over };
  const host = new MemoryHost();
  let files!: FileCommands;
  const saver: AutoSaver = new AutoSaver(h.controller, () => ({ name: files.name, path: files.path }), store, () => settings, () => store.clock);
  files = new FileCommands(host, h.controller, { settings: () => settings, autosave: saver });
  const change = () => h.ctx.apply(() => drawRectangle(h.doc.model, GROUND_PLANE, [Math.random() * 1000, 0, 0], 10, 10), undefined, 'Rectangle');
  return { ...h, store, host, saver, files, change, set: (s: Partial<Settings>) => (settings = { ...settings, ...s }) };
}

describe('settings', () => {
  it('bad or missing values fall back to the defaults; values are kept in range', () => {
    expect(cleanSettings({})).toEqual(DEFAULT_SETTINGS);
    const s = cleanSettings({ autosaveMinutes: 0, keepBackupDays: 9999, historyLimitMB: 'lots', backupFolder: '  ', autosave: 'yes' });
    expect(s.autosaveMinutes).toBe(0.5);
    expect(s.keepBackupDays).toBe(365);
    expect(s.historyLimitMB).toBe(DEFAULT_SETTINGS.historyLimitMB);
    expect(s.backupFolder).toBeNull();
    expect(s.autosave).toBe(true);
  });

  it('are saved and loaded', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveSettings({ ...DEFAULT_SETTINGS, autosaveMinutes: 5, backupFolder: 'D:/Backups' }, storage);
    expect(loadSettings(storage)).toMatchObject({ autosaveMinutes: 5, backupFolder: 'D:/Backups' });
  });
});

describe('autosave', () => {
  it('saves a recovery copy and a version only when something changed', async () => {
    const h = setup();
    expect(await h.saver.tick()).toBe(false); // nothing changed yet
    h.change();
    expect(await h.saver.tick()).toBe(true);
    expect(h.store.files.size).toBe(1);
    expect(h.doc.versions.items.map((v) => [v.label, v.kind])).toEqual([['Rectangle', 'auto']]);
    expect(await h.saver.tick()).toBe(false); // no new change
    const copy = [...h.store.files.values()][0].text;
    expect(JSON.parse(copy).autosave.name).toBe('Untitled');
    expect(parseDocument(copy).root.faces.size).toBe(1);
  });

  it('never touches the design’s own file', async () => {
    const h = setup();
    h.change();
    await h.files.save();
    const saved = h.host.files.get('C:/Saved/Untitled.vorm');
    h.change();
    await h.saver.tick();
    expect(h.host.files.get('C:/Saved/Untitled.vorm')).toBe(saved);
  });

  it('does nothing when switched off, or while looking at an earlier version', async () => {
    const h = setup({ autosave: false });
    h.change();
    expect(await h.saver.tick()).toBe(false);
    h.set({ autosave: true });
    h.controller.recordVersion('auto');
    h.change();
    h.controller.previewVersion(h.doc.versions.items[0].id);
    expect(await h.saver.tick()).toBe(false);
  });

  it('saving the design removes its recovery copy; so does discarding the changes', async () => {
    const h = setup();
    h.change();
    await h.saver.tick();
    expect(h.store.files.size).toBe(1);
    await h.files.save();
    expect(h.store.files.size).toBe(0);
    h.change();
    await h.saver.tick();
    await h.saver.clear();
    expect(h.store.files.size).toBe(0);
  });

  it('copies left behind can be recovered (newest first); very old ones are deleted', async () => {
    const h = setup({ keepBackupDays: 7 });
    h.change();
    await h.saver.tick();
    h.store.files.set('Old-x.autosave.vorm', { text: '{}', modified: h.store.clock });
    h.store.clock += 8 * 24 * 3600_000;
    const fresh = setup({ keepBackupDays: 7 });
    fresh.store.files = h.store.files;
    fresh.store.clock = h.store.clock;
    fresh.change();
    await fresh.saver.tick();
    const found = await fresh.saver.recoverable();
    expect(found.map((r) => r.name)).toEqual(['Untitled']);
    expect(found).toHaveLength(1);
    expect(fresh.store.files.has('Old-x.autosave.vorm')).toBe(false);
    // Recovering: the design comes back as unsaved changes.
    const r = found[0];
    h.files.recovered(parseDocument(r.text), r.name, r.path);
    expect(h.controller.dirty).toBe(true);
  });
});

describe('saving with history', () => {
  it('Save records a version and puts the history in the file; Save a Copy leaves it out', async () => {
    const h = setup();
    h.change();
    await h.files.save();
    const file = JSON.parse(h.host.files.get('C:/Saved/Untitled.vorm')!);
    expect(file.history.versions.map((v: { kind: string }) => v.kind)).toEqual(['save']);
    await h.files.saveCopyWithoutHistory();
    const copy = JSON.parse(h.host.files.get('C:/Saved/Untitled (copy).vorm')!);
    expect(copy.history).toBeUndefined();
  });

  it('with history switched off, nothing is recorded or saved', async () => {
    const h = setup({ history: false });
    h.change();
    await h.files.save();
    expect(h.doc.versions.items).toHaveLength(0);
    expect(JSON.parse(h.host.files.get('C:/Saved/Untitled.vorm')!).history).toBeUndefined();
  });

  it('opening records the design as opened; saving over an older-format file keeps a backup first', async () => {
    const h = setup();
    const old = JSON.parse(serializeDocument(h.doc, { history: false }));
    old.version = 4;
    const oldText = JSON.stringify(old);
    h.host.next = { name: 'Shed.vorm', path: 'D:/Work/Shed.vorm', text: oldText };
    await h.files.open();
    expect(h.doc.versions.items.map((v) => v.kind)).toEqual(['opened']);
    h.change();
    await h.files.save();
    expect(h.host.files.get('D:/Work/Shed (format 4 backup).vorm')).toBe(oldText);
    expect(JSON.parse(h.host.files.get('D:/Work/Shed.vorm')!).version).toBe(5);
    // Only the first time.
    h.host.files.delete('D:/Work/Shed (format 4 backup).vorm');
    h.change();
    await h.files.save();
    expect(h.host.files.has('D:/Work/Shed (format 4 backup).vorm')).toBe(false);
  });

  it('a file from a newer version of the app offers the update', async () => {
    let offered = false;
    const h = setup();
    const files = new FileCommands(h.host, h.controller, { settings: () => DEFAULT_SETTINGS, onNewerFile: () => (offered = true) });
    h.host.next = { name: 'Future.vorm', path: 'D:/Future.vorm', text: JSON.stringify({ format: 'vormcraft', version: 999, units: 'mm' }) };
    await files.open();
    expect(offered).toBe(true);
    expect(h.controller.error).toMatch(/newer version/);
  });
});
