import { describe, expect, it } from 'vitest';
import { DriveApi, DriveError, type DriveFile } from '../src/app/drive/driveApi';
import { DriveAutosaveScheduler, type Clock } from '../src/app/drive/driveAutosave';
import { DriveClash, DriveSession, uniqueName } from '../src/app/drive/driveSession';
import { contentsText, folderLabel, searchDesigns } from '../src/app/drive/driveDialog';

/** A small in-memory stand-in for the Drive REST API (only what VormCraft uses). */
class FakeDrive {
  files = new Map<string, DriveFile & { parents: string[]; folder: boolean; text: string; trashed?: boolean }>();
  calls: string[] = [];
  /** Statuses to answer with before the next real answers (429, 401...). */
  failures: number[] = [];
  private next = 1;
  private rev = 1;
  uploads = new Map<string, { meta: Record<string, unknown>; fileId?: string; total: number; got: Uint8Array[] }>();

  add(name: string, parent: string, folder = false, text = ''): string {
    const id = `f${this.next++}`;
    this.files.set(id, { id, name, parents: [parent], folder, text, modifiedTime: new Date(2026, 10, this.next).toISOString(), headRevisionId: `r${this.rev++}`, size: String(text.length) });
    return id;
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname}${url.searchParams.get('uploadType') ? `?${url.searchParams.get('uploadType')}` : ''}`);
    const fail = this.failures.shift();
    if (fail) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: fail });
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
    const path = url.pathname;
    if (path.endsWith('/about')) return json({ user: { emailAddress: 'ben@example.com', displayName: 'Ben' } });
    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q')!;
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const wantFolder = q.includes("mimeType='application/vnd.google-apps.folder'");
      const name = /name='([^']+)'/.exec(q)?.[1];
      const list = [...this.files.values()].filter((f) => !this.binned(f) && (parent === undefined || f.parents.includes(parent)) && f.folder === wantFolder && (name === undefined || f.name === name));
      if (url.searchParams.get('orderBy') === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
      return json({ files: list });
    }
    if (path === '/drive/v3/files' && method === 'POST') {
      const m = JSON.parse(String(init.body)) as { name: string; parents?: string[] };
      return json(this.files.get(this.add(m.name, m.parents?.[0] ?? 'root', true)));
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (one && method === 'GET') {
      const f = this.files.get(one[1]);
      if (!f) return json({ error: { message: 'not found' } }, 404);
      return url.searchParams.get('alt') === 'media' ? new Response(f.text) : json({ ...f, trashed: this.binned(f) });
    }
    if (one && method === 'PATCH') {
      const f = this.files.get(one[1]);
      if (!f) return json({ error: { message: 'not found' } }, 404);
      const body = JSON.parse(String(init.body ?? '{}')) as { name?: string; trashed?: boolean };
      const add = url.searchParams.get('addParents');
      const remove = url.searchParams.get('removeParents');
      if (add && remove) f.parents = [...f.parents.filter((p) => p !== remove), add];
      if (body.name !== undefined) f.name = body.name;
      if (body.trashed) f.trashed = true;
      return json(f);
    }
    if (path.startsWith('/upload/drive/v3/files')) {
      const fileId = /files\/([^/]+)$/.exec(path)?.[1];
      if (url.searchParams.get('uploadType') === 'multipart') {
        const body = await new Response(init.body as Blob).text();
        const parts = body.split(/--vormcraft\w+/);
        const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
        const text = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
        return json(this.write(fileId, meta, text));
      }
      // Resumable: start a session.
      const session = `https://upload.example/session${this.next++}`;
      this.uploads.set(session, { meta: JSON.parse(String(init.body)), fileId, total: Number(new Headers(init.headers).get('X-Upload-Content-Length')), got: [] });
      return new Response('', { status: 200, headers: { Location: session } });
    }
    const up = this.uploads.get(url.href);
    if (up) {
      up.got.push(new Uint8Array(init.body as Uint8Array));
      const have = up.got.reduce((n, c) => n + c.length, 0);
      if (have < up.total) return new Response('', { status: 308, headers: { Range: `bytes=0-${have - 1}` } });
      const all = new Uint8Array(have);
      let o = 0;
      for (const c of up.got) all.set(c, (o += c.length) - c.length);
      return json(this.write(up.fileId, up.meta, new TextDecoder().decode(all)));
    }
    return json({ error: { message: `unexpected ${method} ${path}` } }, 400);
  };

  /** In the bin, or in a folder that is (Drive bins what a folder holds along with it). */
  binned(f: { trashed?: boolean; parents: string[] }): boolean {
    for (let x: typeof f | undefined = f, n = 0; x && n < 50; x = this.files.get(x.parents[0]), n++) if (x.trashed) return true;
    return false;
  }

  named(name: string) {
    return [...this.files.values()].find((f) => f.name === name)!;
  }

  private write(fileId: string | undefined, meta: { name?: string; parents?: string[] }, text: string): DriveFile {
    if (fileId) {
      const f = this.files.get(fileId);
      if (!f) throw new Error('no file');
      Object.assign(f, { text, headRevisionId: `r${this.rev++}`, size: String(text.length) });
      return f;
    }
    const id = this.add(meta.name!, meta.parents![0], false, text);
    return this.files.get(id)!;
  }
}

const setup = () => {
  const fake = new FakeDrive();
  const tokens: boolean[] = [];
  const api = new DriveApi(async (renew) => (tokens.push(renew), renew ? 'new-token' : 'token'), { fetch: fake.fetch, sleep: async () => {} });
  const store = new Map<string, string>();
  const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const session = new DriveSession(async () => 'token', kv, api);
  return { fake, api, session, tokens, store };
};

describe('Google Drive', () => {
  it('connects: notes the account and makes the VormCraft folder once', async () => {
    const { fake, session } = setup();
    await session.connect();
    expect(session.email).toBe('ben@example.com');
    await session.connect();
    expect([...fake.files.values()].filter((f) => f.folder && f.name === 'VormCraft')).toHaveLength(1);
  });

  it('saves a new design, lists it, opens it, and saves over it', async () => {
    const { session } = setup();
    await session.connect();
    const { file, location } = await session.create('Shelf.vorm', '{"a":1}');
    expect(file.name).toBe('Shelf.vorm');
    const again = await session.create('Shelf.vorm', '{}');
    expect(again.file.name).toBe('Shelf (2).vorm');
    expect((await session.list()).map((f) => f.name).sort()).toEqual(['Shelf (2).vorm', 'Shelf.vorm']);
    const opened = await session.open(file);
    expect(opened.text).toBe('{"a":1}');
    const saved = await session.update(location, 'Shelf.vorm', '{"a":2}');
    expect(saved.location.revision).not.toBe(location.revision);
    expect((await session.open(file)).text).toBe('{"a":2}');
  });

  it('notices a file changed elsewhere, and can replace it when asked', async () => {
    const { session, fake } = setup();
    await session.connect();
    const { location } = await session.create('Shelf.vorm', 'mine');
    fake.files.get(location.fileId)!.headRevisionId = 'changed-elsewhere';
    await expect(session.update(location, 'Shelf.vorm', 'mine 2')).rejects.toBeInstanceOf(DriveClash);
    await session.update(location, 'Shelf.vorm', 'mine 2', true);
    expect(fake.files.get(location.fileId)!.text).toBe('mine 2');
  });

  it('a design whose Drive file was deleted is saved as a new file', async () => {
    const { session, fake } = setup();
    await session.connect();
    const { location } = await session.create('Shelf.vorm', 'one');
    fake.files.get(location.fileId)!.trashed = true;
    const r = await session.update(location, 'Shelf.vorm', 'two');
    expect(r.location.fileId).not.toBe(location.fileId);
  });

  it('autosaved copies go in VormCraft/Autosave, one file per design, replaced each time', async () => {
    const { session, fake } = setup();
    await session.connect();
    const a = await session.autosave('design-1', 'Shelf (autosave).vorm', 'v1');
    const b = await session.autosave('design-1', 'Shelf (autosave).vorm', 'v2');
    expect(b.id).toBe(a.id);
    expect(fake.files.get(a.id)!.text).toBe('v2');
    const folder = fake.files.get(fake.files.get(a.id)!.parents[0])!;
    expect(folder.name).toBe('Autosave');
    expect(fake.files.get(folder.parents[0])!.name).toBe('VormCraft');
    await session.autosave('design-2', 'Box (autosave).vorm', 'x');
    expect([...fake.files.values()].filter((f) => !f.folder)).toHaveLength(2);
  });

  it('retries when Drive says slow down, and gets a new token after a 401', async () => {
    const { session, fake, tokens } = setup();
    await session.connect();
    fake.failures = [429, 503, 401];
    const { file } = await session.create('Shelf.vorm', 'x');
    expect(file.name).toBe('Shelf.vorm');
    expect(tokens).toContain(true);
  });

  it('gives up with a clear message on other errors', async () => {
    const { api, fake } = setup();
    fake.failures = [403];
    await expect(api.account()).rejects.toThrow(/refused access/);
    fake.failures = [400];
    await expect(api.account()).rejects.toBeInstanceOf(DriveError);
  });

  it('large designs upload in pieces', async () => {
    const { session, fake } = setup();
    await session.connect();
    const big = 'x'.repeat(12 * 1024 * 1024);
    const { file } = await session.create('Big.vorm', big);
    expect(fake.files.get(file.id)!.text.length).toBe(big.length);
    expect(fake.calls.filter((c) => c.startsWith('PUT')).length).toBe(2);
  });

  it('unique names', () => {
    expect(uniqueName('A.vorm', new Set())).toBe('A.vorm');
    expect(uniqueName('A.vorm', new Set(['a.vorm', 'a (2).vorm']))).toBe('A (3).vorm');
  });
});

/** A clock the test moves by hand. */
class FakeClock implements Clock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private id = 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.id;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clearTimeout = (id: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== id);
  };
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > end) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
    this.t = end;
  }
}

describe('Google Drive folders', () => {
  const connected = async () => {
    const t = setup();
    await t.session.connect();
    return t;
  };

  it('makes folders inside folders, gives a taken name a number, and hides the Autosave folder', async () => {
    const { session } = await connected();
    await session.autosave('k', 'Shelf (autosave).vorm', '{}');
    const kitchen = await session.makeFolder('Kitchen', session.folderId);
    const again = await session.makeFolder(' kitchen ', session.folderId);
    expect(again.name).toBe('kitchen (2)');
    const cabinets = await session.makeFolder('Cabinets', kitchen.id);
    expect((await session.folders()).map((f) => f.name)).toEqual(['Kitchen', 'kitchen (2)']);
    expect((await session.folders(kitchen.id)).map((f) => f.name)).toEqual(['Cabinets']);
    expect((await session.pathTo(cabinets.id))!.map((f) => f.name)).toEqual(['Kitchen', 'Cabinets']);
    expect(await session.pathTo(session.folderId)).toEqual([]);
    await expect(session.makeFolder('  ', session.folderId)).rejects.toThrow(/name/);
  });

  it('saves into a folder: names are counted per folder, and the folder is where the next design starts', async () => {
    const { session, store } = await connected();
    const kitchen = await session.makeFolder('Kitchen', session.folderId);
    await session.create('Shelf.vorm', '{}');
    const { file, location } = await session.create('Shelf.vorm', '{"in":"kitchen"}', kitchen.id);
    expect(file.name).toBe('Shelf.vorm');
    expect(location.folderId).toBe(kitchen.id);
    expect((await session.create('Shelf.vorm', '{}', kitchen.id)).file.name).toBe('Shelf (2).vorm');
    expect((await session.list(kitchen.id)).map((f) => f.name).sort()).toEqual(['Shelf (2).vorm', 'Shelf.vorm']);
    expect((await session.list()).map((f) => f.name)).toEqual(['Shelf.vorm']);
    expect(session.lastFolderId).toBe(kitchen.id);
    // Remembered on this device.
    expect(new DriveSession(async () => 't', { getItem: (k) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} }).lastFolderId).toBe(kitchen.id);
    // Opening tells which folder it is in.
    expect((await session.open(file)).location.folderId).toBe(kitchen.id);
  });

  it('a deleted design is made again in its folder, or in VormCraft’s if that went too', async () => {
    const { fake, session } = await connected();
    const kitchen = await session.makeFolder('Kitchen', session.folderId);
    const a = await session.create('A.vorm', '{}', kitchen.id);
    fake.files.get(a.file.id)!.trashed = true;
    expect((await session.update(a.location, 'A.vorm', '{"b":1}')).location.folderId).toBe(kitchen.id);
    const b = await session.create('B.vorm', '{}', kitchen.id);
    fake.files.get(kitchen.id)!.trashed = true;
    const again = await session.update(b.location, 'B.vorm', '{}');
    expect(again.location.folderId).toBe(session.folderId);
    // A design opened by an older version has no folder: VormCraft's.
    fake.files.get(again.file.id)!.trashed = true;
    expect((await session.update({ fileId: again.file.id, revision: undefined }, 'B.vorm', '{}')).location.folderId).toBe(session.folderId);
  });

  it('renames designs (keeping .vorm) and folders, refusing a name taken in the same folder', async () => {
    const { session } = await connected();
    const a = (await session.create('A.vorm', '{}')).file;
    await session.create('B.vorm', '{}');
    expect((await session.rename(a, 'Table', false)).name).toBe('Table.vorm');
    await expect(session.rename({ ...a, name: 'Table.vorm' }, 'b', false)).rejects.toThrow(/already a design called “b”/);
    const f = await session.makeFolder('Kitchen', session.folderId);
    expect((await session.rename(f, 'Bathroom', true)).name).toBe('Bathroom');
  });

  it('moves designs and folders, numbering a name taken there; a folder cannot go inside itself', async () => {
    const { session } = await connected();
    const kitchen = await session.makeFolder('Kitchen', session.folderId);
    const cabinets = await session.makeFolder('Cabinets', kitchen.id);
    await session.create('Shelf.vorm', '{}', kitchen.id);
    const shelf = (await session.create('Shelf.vorm', '{}')).file;
    const moved = await session.move(shelf, kitchen.id, false);
    expect(moved.name).toBe('Shelf (2).vorm');
    expect(moved.parents).toEqual([kitchen.id]);
    await expect(session.move(kitchen, cabinets.id, true)).rejects.toThrow(/inside itself/);
    await expect(session.move(kitchen, kitchen.id, true)).rejects.toThrow(/inside itself/);
    const top = await session.move(cabinets, session.folderId, true);
    expect(top.parents).toEqual([session.folderId]);
  });

  it('counts what a folder holds, all the way down, and puts it in the bin', async () => {
    const { fake, session } = await connected();
    const kitchen = await session.makeFolder('Kitchen', session.folderId);
    expect(await session.contents(kitchen.id)).toEqual({ designs: 0, folders: 0 });
    const cabinets = await session.makeFolder('Cabinets', kitchen.id);
    await session.create('A.vorm', '{}', kitchen.id);
    await session.create('B.vorm', '{}', cabinets.id);
    await session.create('C.vorm', '{}', cabinets.id);
    const inside = await session.contents(kitchen.id);
    expect(inside).toEqual({ designs: 3, folders: 1 });
    expect(contentsText(inside)).toBe('3 designs and 1 folder');
    expect(contentsText({ designs: 1, folders: 0 })).toBe('1 design');
    await session.trash(kitchen);
    expect(await session.folders()).toEqual([]);
    expect(fake.binned(fake.named('B.vorm'))).toBe(true);
    await expect(session.trash({ id: session.folderId, name: 'VormCraft', modifiedTime: '' })).rejects.toThrow(/needs this folder/);
  });

  it('All designs: every design VormCraft can see, with its folders, but no autosaved copies', async () => {
    const { fake, session } = await connected();
    const kitchen = await session.makeFolder('Kitchen', session.folderId);
    const cabinets = await session.makeFolder('Cabinets', kitchen.id);
    await session.create('Top.vorm', '{}');
    await session.create('Door.vorm', '{}', cabinets.id);
    const lost = (await session.create('Lost.vorm', '{}')).file;
    // Moved on the Drive website into a folder VormCraft cannot see.
    fake.files.get(lost.id)!.parents = ['someone-elses-folder'];
    await session.autosave('k', 'Top (autosave).vorm', '{}');
    const all = await session.everywhere();
    const where = Object.fromEntries(all.map((d) => [d.file.name, folderLabel(d.path)]));
    expect(where).toEqual({ 'Top.vorm': 'VormCraft', 'Door.vorm': 'VormCraft › Kitchen › Cabinets', 'Lost.vorm': 'outside the VormCraft folder' });
    expect(searchDesigns(all, 'do').map((d) => d.file.name)).toEqual(['Door.vorm']);
    expect(searchDesigns(all, '  ')).toHaveLength(3);
    expect(searchDesigns(all, 'lost VORM').map((d) => d.file.name)).toEqual(['Lost.vorm']);
  });
});

describe('Drive autosave timing', () => {
  const make = () => {
    const clock = new FakeClock();
    const uploads: { revision: number; at: number }[] = [];
    let release: (() => void) | null = null;
    let hold = false;
    const s = new DriveAutosaveScheduler(
      (revision) => {
        uploads.push({ revision, at: clock.t });
        return hold ? new Promise<void>((r) => (release = r)) : Promise.resolve();
      },
      { quiet: 20_000, maxWait: 120_000, retry: 60_000 },
      clock,
    );
    return { clock, uploads, s, holdNext: () => (hold = true), finish: () => (hold = false, release?.()) };
  };

  it('waits for a 20 s pause, not after every change', async () => {
    const { clock, uploads, s } = make();
    s.changed(1);
    await clock.advance(10_000);
    s.changed(2);
    await clock.advance(15_000);
    expect(uploads).toHaveLength(0);
    await clock.advance(5_000);
    expect(uploads).toEqual([{ revision: 2, at: 30_000 }]);
  });

  it('uploads at least every 2 minutes while changes keep coming', async () => {
    const { clock, uploads, s } = make();
    for (let i = 1; i <= 30; i++) {
      s.changed(i);
      await clock.advance(5_000);
    }
    expect(uploads.length).toBeGreaterThanOrEqual(1);
    expect(uploads[0].at).toBe(120_000);
  });

  it('one upload at a time; changes during it are sent once afterwards', async () => {
    const t = make();
    t.holdNext();
    t.s.changed(1);
    await t.clock.advance(20_000);
    expect(t.uploads).toHaveLength(1);
    t.s.changed(2);
    t.s.changed(3);
    await t.clock.advance(60_000);
    expect(t.uploads).toHaveLength(1); // still busy
    t.finish();
    await new Promise((r) => setTimeout(r, 0));
    await t.clock.advance(20_000);
    expect(t.uploads.map((u) => u.revision)).toEqual([1, 3]);
  });

  it('nothing is sent after the design was saved; flush sends a waiting copy at once', async () => {
    const { clock, uploads, s } = make();
    s.changed(1);
    s.settled(1);
    await clock.advance(200_000);
    expect(uploads).toHaveLength(0);
    s.changed(2);
    s.flush();
    await clock.advance(0);
    expect(uploads).toEqual([{ revision: 2, at: 200_000 }]);
  });
});
