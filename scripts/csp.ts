import type { Plugin } from 'vite';

/**
 * The web app's Content-Security-Policy, as a `<meta>` tag (GitHub Pages cannot send headers).
 * It matches the desktop app's (`src-tauri/tauri.conf.json`), plus Google sign-in for Drive
 * (Google Identity Services: its script, its sign-in frame and its styles). So even if a file
 * managed to add HTML to the page, no script outside the app could run and nothing could be
 * fetched from elsewhere.
 */
export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://www.googleapis.com https://accounts.google.com/gsi/",
  'frame-src https://accounts.google.com/gsi/',
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/**
 * Adds the policy to the web build only. The desktop build (run by the Tauri CLI, which sets
 * TAURI_ENV_PLATFORM) keeps Tauri's own policy: a second one here would block its IPC. The dev
 * server is left alone (its hot reload needs a web socket).
 */
export function webCsp(): Plugin {
  return {
    name: 'vormcraft-web-csp',
    apply: (_config, { command }) => command === 'build' && process.env.TAURI_ENV_PLATFORM === undefined,
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: WEB_CSP }, injectTo: 'head-prepend' }],
    },
  };
}
