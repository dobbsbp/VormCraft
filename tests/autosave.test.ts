import { strFromU8, strToU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AutoSaver } from '../src/app/autosave';
import type { BackupEntry, BackupStore } from '../src/app/backups';
import { FileCommands } from '../src/app/fileCommands';
import type { FileHost } from '../src/app/files';
import { cleanSettings, DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../src/app/settings';
import { drawRectangle, GROUND_PLANE, initBooleanKernel } from '../src/core';
import { parseDocument, serializeDocument, WRITE_VERSION, WRITE_ZIPPED } from '../src/io/fileFormat';
import { isZipped } from '../src/io/vormFile';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** "Discard changes?" (no DOM in tests): answered with `discardAnswer`. */
let discardAnswer = true;
vi.mock('../src/app/dialogs', async (original) => ({ ...(await original<typeof import('../src/app/dialogs')>()), confirmDialog: async () => discardAnswer }));

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
  files = new Map<string, Uint8Array>();
  /** The design the file picker picks next (as text, as files before format 9 were). */
  next: { text: string; name: string; path: string } | null = null;
  open = async () => this.next;
  nextBinary: { name: string; bytes: Uint8Array } | null = null;
  openBinary = async () => this.nextBinary ?? (this.next && { name: this.next.name, path: this.next.path, bytes: strToU8(this.next.text) });
  async save(data: string | Uint8Array, suggestedName: string, _f: unknown, path?: string) {
    const target = path ?? `C:/Saved/${suggestedName}`;
    this.files.set(target, typeof data === 'string' ? strToU8(data) : data);
    return { name: target.split('/').pop()!, path: target };
  }
  readPath = async (path: string) => ({ name: path.split('/').pop()!, path, bytes: this.files.get(path)! });
  /** The JSON of a saved .vorm (inside the zip from format 9; the whole file before). */
  design(path: string) {
    const bytes = this.files.get(path)!;
    return JSON.parse(strFromU8(isZipped(bytes) ? unzipSync(bytes)['design.json'] : bytes));
  }
}

function setup(over: Partial<Settings> = {}, chooseUnits?: () => Promise<null>) {
  discardAnswer = true;
  const h = harness();
  const store = new MemoryStore();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...over };
  const host = new MemoryHost();
  let files!: FileCommands;
  const saver: AutoSaver = new AutoSaver(h.controller, () => ({ name: files.name, path: files.path }), store, () => settings, () => store.clock);
  files = new FileCommands(host, h.controller, { settings: () => settings, autosave: saver, chooseUnits });
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

describe('discarding changes', () => {
  it('cancelling New or Open after Discard changes keeps the recovery copy, and autosave goes on', async () => {
    const h = setup({}, async () => null);
    h.change();
    await h.saver.tick();
    const [copy] = h.store.files.keys();
    await h.files.newDocument(); // Units dialog cancelled
    expect(h.store.files.has(copy)).toBe(true);
    h.host.next = null;
    await h.files.open(); // file picker cancelled
    expect(h.store.files.has(copy)).toBe(true);
    h.host.next = { name: 'Bad.vorm', path: 'D:/Bad.vorm', text: 'not a design' };
    await h.files.open(); // a file that fails to open
    expect(h.controller.error).toBeTruthy();
    expect(h.store.files.has(copy)).toBe(true);
    expect(h.controller.dirty).toBe(true);
    h.change();
    expect(await h.saver.tick()).toBe(true);
  });

  it('the copy goes once another design has replaced the discarded one', async () => {
    const h = setup();
    h.change();
    await h.saver.tick();
    h.host.next = { name: 'Shed.vorm', path: 'D:/Shed.vorm', text: serializeDocument(harness().doc) };
    await h.files.open();
    expect(h.files.name).toBe('Shed');
    expect(h.store.files.size).toBe(0);
    h.change();
    await h.saver.tick();
    await h.files.newDocument();
    expect(h.store.files.size).toBe(0);
  });

  it('keeping the changes keeps the copy; leaving the app after discarding removes it', async () => {
    const h = setup();
    h.change();
    await h.saver.tick();
    discardAnswer = false;
    expect(await h.files.confirmLeave()).toBe(false);
    expect(h.store.files.size).toBe(1);
    discardAnswer = true;
    expect(await h.files.confirmLeave()).toBe(true);
    expect(h.store.files.size).toBe(0);
  });

  it('a recovered copy keeps its undo steps', async () => {
    const h = setup();
    h.change();
    h.change();
    await h.saver.tick();
    const [r] = await h.saver.recoverable();
    const doc = parseDocument(r.text);
    const b = harness();
    b.controller.replaceDocument(doc);
    expect(b.doc.root.faces.size).toBe(2);
    expect(b.controller.history.undoLabel).toBe('Rectangle');
    b.controller.undo();
    expect(b.doc.root.faces.size).toBe(1);
  });
});

describe('saving with history', () => {
  it('Save records a version and puts the history in the file; Save a Copy leaves it out', async () => {
    const h = setup();
    h.change();
    await h.files.save();
    const file = h.host.design('C:/Saved/Untitled.vorm');
    expect(file.history.versions.map((v: { kind: string }) => v.kind)).toEqual(['save']);
    // Zipped files say which app saved them; the plain ones for 0.9 apps cannot.
    expect(file.savedBy).toBe(WRITE_ZIPPED ? 'VormCraft 0.0.0-test' : undefined);
    await h.files.saveCopyWithoutHistory();
    const copy = h.host.design('C:/Saved/Untitled (copy).vorm');
    expect(copy.history).toBeUndefined();
  });

  it('with history switched off, nothing is recorded or saved', async () => {
    const h = setup({ history: false });
    h.change();
    await h.files.save();
    expect(h.doc.versions.items).toHaveLength(0);
    expect(h.host.design('C:/Saved/Untitled.vorm').history).toBeUndefined();
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
    expect(strFromU8(h.host.files.get('D:/Work/Shed (format 4 backup).vorm')!)).toBe(oldText);
    expect(h.host.design('D:/Work/Shed.vorm').version).toBe(WRITE_VERSION);
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

  it('a newer file that says this version can read it opens, with a note; saving over it keeps it beside', async () => {
    const h = setup();
    const future = { ...JSON.parse(serializeDocument(h.doc, { history: false })), version: 12, minReaderVersion: 8, tags: [{ name: 'Walls' }] };
    h.host.next = { name: 'Future.vorm', path: 'D:/Future.vorm', text: JSON.stringify(future) };
    await h.files.open();
    expect(h.controller.error).toBeFalsy();
    expect(h.files.name).toBe('Future');
    h.change();
    await h.files.save();
    expect(h.host.files.has('D:/Future (format 12 backup).vorm')).toBe(true);
    expect(h.host.design('D:/Future.vorm').version).toBe(WRITE_VERSION);
  });

  it('a saved design opens again from its file, undo steps and all', async () => {
    const h = setup();
    h.change();
    h.change();
    await h.files.save();
    await h.files.openPath('C:/Saved/Untitled.vorm');
    expect(h.doc.root.faces.size).toBe(2);
    expect(h.controller.history.undoLabel).toBe('Rectangle');
    h.controller.undo();
    expect(h.doc.root.faces.size).toBe(1);
  });
});
