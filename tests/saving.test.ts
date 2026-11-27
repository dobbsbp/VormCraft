import { beforeAll, describe, expect, it } from 'vitest';
import { FileCommands, type DriveSaving } from '../src/app/fileCommands';
import type { FileHost } from '../src/app/files';
import { DEFAULT_SETTINGS } from '../src/app/settings';
import { drawRectangle, GROUND_PLANE, initBooleanKernel } from '../src/core';
import { harness } from './helpers/tools';

beforeAll(async () => {
  await initBooleanKernel();
});

/** A file host in memory: desktop-like (paths), or browser-like (downloads, no paths). */
class MemoryHost implements FileHost {
  files = new Map<string, Uint8Array>();
  /** The name or path each save started the picker with (no `path` given). */
  asked: string[] = [];
  revealed: string[] = [];
  constructor(readonly native = true) {}
  open = async () => null;
  openBinary = async () => null;
  async save(data: string | Uint8Array, suggestedName: string, _f: unknown, path?: string) {
    if (!this.native) {
      this.asked.push(suggestedName);
      return { name: suggestedName };
    }
    if (!path) this.asked.push(suggestedName);
    const target = path ?? (suggestedName.includes('/') ? suggestedName : `C:/Saved/${suggestedName}`);
    this.files.set(target, typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return { name: target.split('/').pop()!, path: target };
  }
  reveal = async (path: string) => void this.revealed.push(path);
}

/** Google Drive's side of Save, counting what was asked of it. */
function fakeDrive(connected = true) {
  const calls: string[] = [];
  const drive: DriveSaving = {
    connected: () => connected,
    save: async () => void calls.push('save'),
    saveAs: async () => void calls.push('saveAs'),
  };
  return { drive, calls };
}

function setup(native = true, choose?: () => Promise<'computer' | 'drive' | null>) {
  const h = harness();
  const host = new MemoryHost(native);
  let asked = 0;
  const files = new FileCommands(host, h.controller, {
    settings: () => ({ ...DEFAULT_SETTINGS, history: false }),
    chooseSaveTarget: choose
      ? () => {
          asked++;
          return choose();
        }
      : undefined,
  });
  const change = () => h.ctx.apply(() => drawRectangle(h.doc.model, GROUND_PLANE, [0, 0, 0], 10, 10), undefined, 'Rectangle');
  return { ...h, host, files, change, asked: () => asked };
}

const inDrive = { fileId: 'f1', revision: '1', folderId: 'kitchen' };

describe('where a design is saved', () => {
  it('a new design is not saved anywhere yet', () => {
    const { files } = setup();
    expect(files.where()).toEqual({ kind: 'nowhere' });
    expect(files.whereText()).toBe('Not saved yet');
  });

  it('saving on the computer says where, and Show in folder shows that file', async () => {
    const { files, host, controller, change } = setup();
    change();
    await files.save();
    expect(host.asked).toEqual(['Untitled.vorm']);
    expect(files.where()).toEqual({ kind: 'computer', path: 'C:/Saved/Untitled.vorm' });
    expect(controller.notice).toBe('Saved to C:/Saved/Untitled.vorm');
    expect(files.savedNotice).toBe(controller.notice);
    await files.reveal();
    expect(host.revealed).toEqual(['C:/Saved/Untitled.vorm']);
    // Saving again writes the same file without asking.
    await files.save();
    expect(host.asked).toHaveLength(1);
  });

  it('Save As starts beside the design’s own file', async () => {
    const { files, host } = setup();
    await files.save();
    await files.save(true);
    expect(host.asked).toEqual(['Untitled.vorm', 'C:/Saved/Untitled.vorm']);
  });

  it('a new design forgets where the last one was saved', async () => {
    const { files } = setup();
    await files.save();
    await files.newDocument();
    expect(files.where()).toEqual({ kind: 'nowhere' });
  });

  it('in the browser a saved design is on this device, and each Save downloads it', async () => {
    const { files, host, controller } = setup(false);
    await files.save();
    expect(files.where()).toEqual({ kind: 'device' });
    expect(files.whereText()).toMatch(/This device/);
    expect(controller.notice).toMatch(/^Downloaded Untitled\.vorm/);
    await files.save();
    expect(host.asked).toHaveLength(2);
  });

  it('a design in Google Drive is shown with its folders', async () => {
    const { files } = setup();
    await files.savedElsewhere('Shed.vorm', inDrive);
    expect(files.whereText()).toBe('Google Drive › VormCraft › Shed.vorm');
    files.driveFolder = 'VormCraft › Kitchen';
    expect(files.whereText()).toBe('Google Drive › VormCraft › Kitchen › Shed.vorm');
    files.driveFolder = 'outside the VormCraft folder';
    expect(files.whereText()).toBe('Google Drive › Shed.vorm (outside the VormCraft folder)');
    // Moved to another folder: looked up again.
    files.driveFolder = 'VormCraft › Kitchen';
    files.driveFileChanged('f1', 'Shed.vorm', 'garden');
    expect(files.driveFolder).toBeUndefined();
  });
});

describe('Save with Google Drive', () => {
  it('a new design asks where it goes, when Drive is connected', async () => {
    let answer: 'computer' | 'drive' | null = 'drive';
    const s = setup(true, async () => answer);
    const { drive, calls } = fakeDrive();
    s.files.driveSaving = drive;
    await s.files.save();
    expect(calls).toEqual(['saveAs']);
    expect(s.host.asked).toEqual([]);
    answer = null;
    await s.files.save();
    expect(calls).toEqual(['saveAs']);
    expect(s.host.asked).toEqual([]);
    answer = 'computer';
    await s.files.save();
    expect(s.host.asked).toEqual(['Untitled.vorm']);
    // Saved now: Save does not ask again.
    await s.files.save();
    expect(s.asked()).toBe(3);
  });

  it('does not ask while Drive is not connected', async () => {
    const s = setup(true, async () => 'drive');
    s.files.driveSaving = fakeDrive(false).drive;
    await s.files.save();
    expect(s.asked()).toBe(0);
    expect(s.files.where().kind).toBe('computer');
  });

  it('a design in Drive saves back there; Save As stays in Drive unless this computer is asked for', async () => {
    const s = setup(true, async () => 'drive');
    const { drive, calls } = fakeDrive();
    s.files.driveSaving = drive;
    await s.files.savedElsewhere('Shed.vorm', inDrive);
    await s.files.save();
    await s.files.saveAsHere();
    expect(calls).toEqual(['save', 'saveAs']);
    await s.files.save(true);
    expect(s.host.asked).toEqual(['Shed.vorm']);
    expect(s.files.where()).toEqual({ kind: 'computer', path: 'C:/Saved/Shed.vorm' });
    expect(s.asked()).toBe(0);
  });
});
