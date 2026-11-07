/**
 * The few Google Drive calls VormCraft needs (REST, v3), with the `drive.file` permission: it only
 * ever sees files and folders it created itself. No Google library: plain `fetch`, so it can be
 * tested against a stand-in.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const FILE_TYPE = 'application/json';
const FIELDS = 'id,name,modifiedTime,size,headRevisionId';
/** Larger files upload in pieces (resumable), so a dropped connection does not start over. */
const RESUMABLE_ABOVE = 5 * 1024 * 1024;
/** Piece size: a multiple of 256 KiB, as Drive requires. */
const CHUNK = 8 * 1024 * 1024;
const RETRIES = 5;

export interface DriveFile {
  id: string;
  name: string;
  /** ISO time. */
  modifiedTime: string;
  size?: string;
  /** Changes on every upload: used to notice edits made elsewhere. */
  headRevisionId?: string;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A token for the Drive permission; `renew` after Google said the last one is no longer valid. */
export type TokenSource = (renew: boolean) => Promise<string>;

export interface DriveApiOptions {
  fetch?: typeof fetch;
  /** Waiting between retries (tests skip it). */
  sleep?: (ms: number) => Promise<void>;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export class DriveApi {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly token: TokenSource,
    opts: DriveApiOptions = {},
  ) {
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * One request, retried when Drive asks to slow down or has a passing fault (429, 5xx, rate-limit
   * 403s) with growing waits, and once with a new token after a 401.
   */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    let renew = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.token(renew);
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      let res: Response;
      try {
        res = await this.fetch(url, { ...init, headers });
      } catch {
        if (attempt >= RETRIES) throw new DriveError('Google Drive could not be reached. Check the internet connection.', 0);
        await this.sleep(backoff(attempt));
        continue;
      }
      if (res.ok || res.status === 308) return res;
      if (res.status === 401 && !renew) {
        renew = true;
        continue;
      }
      const text = await res.text().catch(() => '');
      const rateLimited = res.status === 403 && /rateLimitExceeded|userRateLimitExceeded/.test(text);
      if ((res.status === 429 || res.status >= 500 || rateLimited) && attempt < RETRIES) {
        await this.sleep(backoff(attempt));
        continue;
      }
      throw new DriveError(driveMessage(res.status, text), res.status);
    }
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(url, init)).json()) as T;
  }

  /** The signed-in account (for showing which one is connected). */
  async account(): Promise<{ email: string; name: string }> {
    const r = await this.json<{ user?: { emailAddress?: string; displayName?: string } }>(`${API}/about?fields=user(emailAddress,displayName)`);
    return { email: r.user?.emailAddress ?? '', name: r.user?.displayName ?? '' };
  }

  /** A folder VormCraft made with this name (inside `parent`, else at the top of My Drive), made if missing. */
  async folder(name: string, parent?: string): Promise<string> {
    const q = `mimeType='${FOLDER}' and name=${quote(name)} and trashed=false and ${quote(parent ?? 'root')} in parents`;
    const found = await this.json<{ files: DriveFile[] }>(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`);
    if (found.files[0]) return found.files[0].id;
    const made = await this.json<DriveFile>(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    });
    return made.id;
  }

  /** Files (not folders) in a folder, newest first. */
  async list(folderId: string): Promise<DriveFile[]> {
    const q = `${quote(folderId)} in parents and trashed=false and mimeType!='${FOLDER}'`;
    const out: DriveFile[] = [];
    let page = '';
    do {
      const r = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(
        `${API}/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&pageSize=200&fields=nextPageToken,files(${FIELDS})${page ? `&pageToken=${page}` : ''}`,
      );
      out.push(...r.files);
      page = r.nextPageToken ?? '';
    } while (page);
    return out;
  }

  /** A file's details, or null if it is gone (deleted or in the bin). */
  async meta(fileId: string): Promise<DriveFile | null> {
    try {
      const f = await this.json<DriveFile & { trashed?: boolean }>(`${API}/files/${fileId}?fields=${FIELDS},trashed`);
      return f.trashed ? null : f;
    } catch (err) {
      if (err instanceof DriveError && err.status === 404) return null;
      throw err;
    }
  }

  async download(fileId: string): Promise<string> {
    return (await this.request(`${API}/files/${fileId}?alt=media`)).text();
  }

  /** A new file in a folder. */
  async create(name: string, folderId: string, text: string): Promise<DriveFile> {
    return this.upload('POST', `${UPLOAD}/files`, { name, parents: [folderId], mimeType: FILE_TYPE }, text);
  }

  /**
   * Replace a file's contents. Drive swaps in the new contents in one step once the upload is
   * complete, so the file is always either the old version or the new one, never half of each.
   */
  async update(fileId: string, text: string): Promise<DriveFile> {
    return this.upload('PATCH', `${UPLOAD}/files/${fileId}`, {}, text);
  }

  private async upload(method: 'POST' | 'PATCH', base: string, metadata: object, text: string): Promise<DriveFile> {
    const body = new TextEncoder().encode(text);
    if (body.length <= RESUMABLE_ABOVE) {
      const boundary = `vormcraft${Math.random().toString(36).slice(2)}`;
      const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${FILE_TYPE}\r\n\r\n`;
      const blob = new Blob([head, body, `\r\n--${boundary}--`]);
      return this.json<DriveFile>(`${base}?uploadType=multipart&fields=${FIELDS}`, { method, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: blob });
    }
    // Resumable: start a session, then send the pieces; after a failure, ask Drive how much
    // arrived and carry on from there.
    const start = await this.request(`${base}?uploadType=resumable&fields=${FIELDS}`, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': FILE_TYPE, 'X-Upload-Content-Length': String(body.length) },
      body: JSON.stringify(metadata),
    });
    const session = start.headers.get('Location');
    if (!session) throw new DriveError('Google Drive did not start the upload', start.status);
    let sent = 0;
    for (let failures = 0; ; ) {
      const end = Math.min(sent + CHUNK, body.length);
      let res: Response;
      try {
        res = await this.request(session, { method: 'PUT', headers: { 'Content-Range': `bytes ${sent}-${end - 1}/${body.length}` }, body: body.slice(sent, end) });
      } catch (err) {
        if (++failures > RETRIES) throw err;
        res = await this.request(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${body.length}` } });
      }
      if (res.status !== 308) return (await res.json()) as DriveFile;
      const range = res.headers.get('Range');
      sent = range ? Number(/-(\d+)$/.exec(range)?.[1] ?? -1) + 1 : 0;
    }
  }
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

function driveMessage(status: number, body: string): string {
  let detail = '';
  try {
    detail = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    // Not JSON.
  }
  if (status === 403 && /storageQuota|quota/i.test(body)) return 'Your Google Drive is full.';
  if (status === 401 || status === 403) return `Google Drive refused access${detail ? `: ${detail}` : ''}. Try connecting again.`;
  if (status === 404) return 'That file is no longer in Google Drive.';
  return `Google Drive error ${status}${detail ? `: ${detail}` : ''}`;
}
