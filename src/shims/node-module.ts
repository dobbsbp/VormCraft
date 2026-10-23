/**
 * Browser stand-in for `node:module`. Manifold's loader imports it only when running under Node,
 * so this is never called in the app; aliasing it keeps Vite from externalizing a Node built-in.
 */
export function createRequire(): never {
  throw new Error('node:module is not available in the browser');
}
