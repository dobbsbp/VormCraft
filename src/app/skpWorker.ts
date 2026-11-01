/// <reference lib="webworker" />
import { parseSkp } from 'openskp';

/**
 * Reads a SketchUp file away from the main thread, so a large file does not freeze VormCraft.
 * Receives the file's bytes; answers with the parsed model or an error message.
 */
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    postMessage({ ok: true, model: parseSkp(e.data) });
  } catch (err) {
    postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
