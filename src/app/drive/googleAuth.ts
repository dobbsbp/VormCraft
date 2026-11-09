import { DRIVE_SCOPE, type TokenSource } from './driveApi';
import { accessDeniedMessage } from './preview';

/** VormCraft's web sign-in ID at Google (public: every web page that signs in shows its own). */
export const GOOGLE_WEB_CLIENT_ID = '893145123622-39trbq3b7vu1mv4g7va9f0uq8tjasu0h.apps.googleusercontent.com';

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (r: TokenResponse) => void;
  error_callback?: (e: { type?: string; message?: string }) => void;
  requestAccessToken(opts?: { prompt?: string; login_hint?: string }): void;
}

interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

/** Google sign-in as the Drive commands use it (the web version's, or the Windows app's). */
export interface GoogleAuth {
  /** Whether a token is in hand (no sign-in needed). */
  readonly ready: boolean;
  /** For Drive calls: the token in hand, or a new one (asking the person only if `interactive`). */
  source(interactive: () => boolean): TokenSource;
  /** Sign in. `chooseAccount` shows the account chooser even if one is remembered. */
  signIn(chooseAccount: boolean): Promise<string>;
  remember(email: string): void;
  signOut(): Promise<void>;
}

/** Sign-in was needed but could not be done without the person (the token ran out). */
export class SignInNeeded extends Error {
  constructor() {
    super('Google Drive needs you to sign in again: use the Google Drive button.');
  }
}

let gisLoading: Promise<Gis> | null = null;

function loadGis(): Promise<Gis> {
  const existing = (window as unknown as { google?: Gis }).google;
  if (existing?.accounts?.oauth2) return Promise.resolve(existing);
  gisLoading ??= new Promise<Gis>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SCRIPT;
    s.async = true;
    s.onload = () => resolve((window as unknown as { google: Gis }).google);
    s.onerror = () => {
      gisLoading = null;
      reject(new Error('Google sign-in could not be loaded. Check the internet connection.'));
    };
    document.head.append(s);
  });
  return gisLoading;
}

/**
 * The web version's sign-in: Google's own pop-up (Google Identity Services). VormCraft never sees
 * the password, only a token for the Drive permission, kept in memory for its hour. A new one
 * needs a pop-up, which browsers only allow right after a click, so a token that runs out during
 * autosave waits for the next time the person uses the Drive button or saves.
 */
export class WebGoogleAuth implements GoogleAuth {
  private token: string | null = null;
  private expires = 0;
  private client: TokenClient | null = null;

  constructor(private hint: string | undefined) {}

  /** Whether a token is in hand (no pop-up needed). */
  get ready(): boolean {
    return this.token !== null && Date.now() < this.expires - 60_000;
  }

  /** For Drive calls: the token in hand, or (after a click) a new one. */
  source(interactive: () => boolean): TokenSource {
    return async (renew) => {
      if (this.ready && !renew) return this.token!;
      if (!interactive()) throw new SignInNeeded();
      return this.signIn(false);
    };
  }

  /** Ask Google for a token. `chooseAccount` shows the account chooser even if one is remembered. */
  async signIn(chooseAccount: boolean): Promise<string> {
    const gis = await loadGis();
    return new Promise<string>((resolve, reject) => {
      const done = (r: TokenResponse) => {
        if (r.access_token) {
          this.token = r.access_token;
          this.expires = Date.now() + (r.expires_in ?? 3600) * 1000;
          resolve(r.access_token);
        } else reject(new Error(r.error === 'access_denied' ? accessDeniedMessage() : `Google sign-in failed${r.error_description ? `: ${r.error_description}` : ''}`));
      };
      this.client ??= gis.accounts.oauth2.initTokenClient({ client_id: GOOGLE_WEB_CLIENT_ID, scope: DRIVE_SCOPE, callback: done });
      this.client.callback = done;
      this.client.error_callback = (e) => reject(new Error(e.type === 'popup_closed' ? 'Google sign-in was closed before it finished.' : e.type === 'popup_failed_to_open' ? 'The browser blocked Google’s sign-in window. Allow pop-ups for this site and try again.' : 'Google sign-in did not finish.'));
      this.client.requestAccessToken({ prompt: chooseAccount ? 'select_account' : '', login_hint: chooseAccount ? undefined : this.hint });
    });
  }

  remember(email: string): void {
    this.hint = email || undefined;
  }

  /** Disconnect: give the permission back to Google and forget the token. */
  async signOut(): Promise<void> {
    const token = this.token;
    this.token = null;
    this.expires = 0;
    if (!token) return;
    const gis = await loadGis().catch(() => null);
    await new Promise<void>((r) => (gis ? gis.accounts.oauth2.revoke(token, r) : r()));
  }
}
