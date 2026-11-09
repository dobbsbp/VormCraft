import { DRIVE_SCOPE, type TokenSource } from './driveApi';
import { SignInNeeded, type GoogleAuth } from './googleAuth';
import { accessDeniedMessage } from './preview';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/** What the desktop shell does for sign-in (src-tauri/src/google.rs); a stand-in in tests. */
export interface DesktopSignIn {
  /** VormCraft's desktop client at Google, if this build has one. */
  client(): Promise<{ id: string; secret: string } | null>;
  /** Open Google's sign-in in the browser; Google's answer (query string) and where it was sent. */
  authorize(url: string): Promise<{ redirect_uri: string; query: string }>;
  savedToken(): Promise<string | null>;
  saveToken(token: string): Promise<void>;
  forgetToken(): Promise<void>;
}

export function tauriSignIn(): DesktopSignIn {
  const call = async <T>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args);
  return {
    client: () => call('google_client'),
    authorize: (url) => call('google_authorize', { url }),
    savedToken: () => call('google_saved_token'),
    saveToken: (token) => call('google_save_token', { token }),
    forgetToken: () => call('google_forget_token'),
  };
}

interface TokenReply {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));

/**
 * The Windows app's sign-in: Google's page opens in the person's own browser (with PKCE; the
 * answer comes back to the app on this computer), and the lasting sign-in is kept in Windows
 * Credential Manager, so it carries over between sessions and a token that runs out is renewed
 * without asking.
 */
export class DesktopGoogleAuth implements GoogleAuth {
  private token: string | null = null;
  private expires = 0;
  private renewing: Promise<string | null> | null = null;

  constructor(
    private hint: string | undefined,
    private readonly native: DesktopSignIn = tauriSignIn(),
    private readonly http: typeof fetch = (...a) => fetch(...a),
  ) {}

  get ready(): boolean {
    return this.token !== null && Date.now() < this.expires - 60_000;
  }

  source(interactive: () => boolean): TokenSource {
    return async (renew) => {
      if (this.ready && !renew) return this.token!;
      const renewed = await this.renew();
      if (renewed) return renewed;
      if (!interactive()) throw new SignInNeeded();
      return this.signIn(false);
    };
  }

  private async client(): Promise<{ id: string; secret: string }> {
    const c = await this.native.client();
    if (!c) throw new Error('This copy of VormCraft was built without Google Drive.');
    return c;
  }

  private async post(url: string, form: Record<string, string>): Promise<TokenReply> {
    let r: Response;
    try {
      r = await this.http(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    } catch {
      throw new Error('Google could not be reached. Check the internet connection.');
    }
    return ((await r.json().catch(() => null)) as TokenReply | null) ?? {};
  }

  private took(r: TokenReply): string {
    this.token = r.access_token!;
    this.expires = Date.now() + (r.expires_in ?? 3600) * 1000;
    return this.token;
  }

  /** A new token from the kept sign-in, or null if there is none (or Google no longer accepts it). */
  private renew(): Promise<string | null> {
    this.renewing ??= (async () => {
      try {
        const refresh = await this.native.savedToken();
        if (!refresh) return null;
        const c = await this.client();
        const r = await this.post(TOKEN_URL, { client_id: c.id, client_secret: c.secret, refresh_token: refresh, grant_type: 'refresh_token' });
        if (r.access_token) return this.took(r);
        // Taken back (in the Google account's settings, say) or expired: sign in again.
        if (r.error === 'invalid_grant') await this.native.forgetToken();
        return null;
      } finally {
        this.renewing = null;
      }
    })();
    return this.renewing;
  }

  async signIn(chooseAccount: boolean): Promise<string> {
    const c = await this.client();
    const verifier = random(48);
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = random(16);
    const params = new URLSearchParams({
      client_id: c.id,
      response_type: 'code',
      scope: DRIVE_SCOPE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      access_type: 'offline',
      prompt: chooseAccount ? 'select_account consent' : 'consent',
    });
    if (!chooseAccount && this.hint) params.set('login_hint', this.hint);
    const reply = await this.native.authorize(`${AUTH_URL}?${params}`);
    const answer = new URLSearchParams(reply.query);
    if (answer.get('state') !== state) throw new Error('Google sign-in did not finish (the answer did not match). Try again.');
    const error = answer.get('error');
    if (error) throw new Error(error === 'access_denied' ? accessDeniedMessage() : `Google sign-in failed: ${error}`);
    const r = await this.post(TOKEN_URL, { code: answer.get('code') ?? '', client_id: c.id, client_secret: c.secret, redirect_uri: reply.redirect_uri, grant_type: 'authorization_code', code_verifier: verifier });
    if (!r.access_token) throw new Error(`Google sign-in failed${r.error_description ? `: ${r.error_description}` : r.error ? `: ${r.error}` : ''}`);
    if (r.refresh_token) await this.native.saveToken(r.refresh_token);
    return this.took(r);
  }

  remember(email: string): void {
    this.hint = email || undefined;
  }

  /** Disconnect: give the permission back to Google and forget the sign-in on this computer. */
  async signOut(): Promise<void> {
    const token = (await this.native.savedToken().catch(() => null)) ?? this.token;
    this.token = null;
    this.expires = 0;
    await this.native.forgetToken();
    if (token) await this.post(REVOKE_URL, { token }).catch(() => undefined);
  }
}
