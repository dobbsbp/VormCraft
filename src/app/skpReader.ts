import type { SkpModel } from 'openskp';

/** A SketchUp file that could not be read. */
export class SkpReadError extends Error {}

/**
 * Read a SketchUp file in a background worker (so the window stays responsive), or on the main
 * thread where workers are not available.
 */
export async function readSkp(bytes: Uint8Array): Promise<SkpModel> {
  const buffer = bytes.slice().buffer as ArrayBuffer;
  let model: SkpModel;
  try {
    model = await inWorker(buffer);
  } catch (err) {
    if (err instanceof SkpReadError) throw err;
    const { parseSkp } = await import('openskp');
    try {
      model = parseSkp(bytes.slice().buffer as ArrayBuffer);
    } catch (e) {
      throw explain(e);
    }
  }
  return model;
}

function inWorker(buffer: ArrayBuffer): Promise<SkpModel> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./skpWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: true; model: SkpModel } | { ok: false; error: string }>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data.model);
      else reject(explain(e.data.error));
    };
    worker.onerror = (e) => {
      worker.terminate();
      // The worker itself could not run: fall back to reading here.
      reject(new Error(e.message || 'worker failed'));
    };
    worker.postMessage(buffer, [buffer]);
  });
}

/** A plain-language message for a file the reader could not handle. */
function explain(err: unknown): SkpReadError {
  const text = err instanceof Error ? err.message : String(err);
  if (/legacy/i.test(text)) return new SkpReadError('This SketchUp file is in an older layout that cannot be read yet. Opening it in SketchUp and saving it again usually helps.');
  return new SkpReadError(`This SketchUp file could not be read (${text}).`);
}
