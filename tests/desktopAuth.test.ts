import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DesktopGoogleAuth, type DesktopSignIn } from '../src/app/drive/desktopAuth';
import { SignInNeeded } from '../src/app/drive/googleAuth';

/** The desktop shell, standing in: Google answers with `reply(url)`; the kept token in memory. */
function shell(reply: (url: URL) => string, saved: string | null = null) {
  const s: { saved: string | null; urls: URL[]; native: DesktopSignIn } = {
    saved,
    urls: [],
    native: {
      client: async () => ({ id: 'client-id', secret: 'client-secret' }),
      authorize: async (url: string) => {
        const u = new URL(url);
        s.urls.push(u);
        return { redirect_uri: 'http://127.0.0.1:5555', query: reply(u) };
      },
      savedToken: async () => s.saved,
      saveToken: async (t: string) => void (s.saved = t),
      forgetToken: async () => void (s.saved = null),
    } satisfies DesktopSignIn,
  };
  return s;
}

/** Google's token endpoints, standing in: records each request, answers with `answer(form)`. */
function google(answer: (url: string, form: URLSearchParams) => object) {
  const calls: { url: string; form: URLSearchParams }[] = [];
  const http = (async (url: string, init: RequestInit) => {
    const form = new URLSearchParams(String(init.body));
    calls.push({ url, form });
    return new Response(JSON.stringify(answer(url, form)));
  }) as typeof fetch;
  return { calls, http };
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('Windows app Google sign-in', () => {
  it('signs in with PKCE through the browser and keeps the lasting sign-in', async () => {
    const s = shell((u) => `state=${u.searchParams.get('state')}&code=the-code&scope=drive.file`);
    const g = google(() => ({ access_token: 'access-1', expires_in: 3600, refresh_token: 'refresh-1' }));
    const auth = new DesktopGoogleAuth(undefined, s.native, g.http);
    expect(await auth.signIn(true)).toBe('access-1');
    const u = s.urls[0];
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toContain('select_account');
    const form = g.calls[0].form;
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('redirect_uri')).toBe('http://127.0.0.1:5555');
    // The verifier sent with the code is the one the challenge was made from.
    expect(b64url(createHash('sha256').update(form.get('code_verifier')!).digest())).toBe(u.searchParams.get('code_challenge'));
    expect(s.saved).toBe('refresh-1');
    expect(auth.ready).toBe(true);
  });

  it('refuses an answer that does not match the sign-in it started', async () => {
    const s = shell(() => 'state=someone-else&code=x');
    const g = google(() => ({ access_token: 'nope' }));
    await expect(new DesktopGoogleAuth(undefined, s.native, g.http).signIn(false)).rejects.toThrow(/did not match/);
    expect(g.calls).toHaveLength(0);
  });

  it('says so when access is not allowed', async () => {
    const s = shell((u) => `state=${u.searchParams.get('state')}&error=access_denied`);
    await expect(new DesktopGoogleAuth(undefined, s.native, google(() => ({})).http).signIn(false)).rejects.toThrow(/not allowed/);
  });

  it('renews from the kept sign-in without asking (after a restart, say)', async () => {
    const s = shell(() => {
      throw new Error('should not open the browser');
    }, 'refresh-1');
    const g = google(() => ({ access_token: 'access-2', expires_in: 3600 }));
    const auth = new DesktopGoogleAuth('me@example.com', s.native, g.http);
    expect(await auth.source(() => false)(false)).toBe('access-2');
    expect(g.calls[0].form.get('grant_type')).toBe('refresh_token');
    expect(g.calls[0].form.get('refresh_token')).toBe('refresh-1');
    // Kept for its hour: no new request.
    expect(await auth.source(() => false)(false)).toBe('access-2');
    expect(g.calls).toHaveLength(1);
  });

  it('a sign-in Google no longer accepts is forgotten; then it needs the person', async () => {
    const s = shell(() => '', 'refresh-old');
    const g = google(() => ({ error: 'invalid_grant' }));
    const auth = new DesktopGoogleAuth(undefined, s.native, g.http);
    await expect(auth.source(() => false)(false)).rejects.toBeInstanceOf(SignInNeeded);
    expect(s.saved).toBeNull();
  });

  it('disconnecting gives the permission back and forgets the sign-in', async () => {
    const s = shell(() => '', 'refresh-1');
    const g = google(() => ({}));
    await new DesktopGoogleAuth(undefined, s.native, g.http).signOut();
    expect(s.saved).toBeNull();
    expect(g.calls[0].url).toBe('https://oauth2.googleapis.com/revoke');
    expect(g.calls[0].form.get('token')).toBe('refresh-1');
  });
});
