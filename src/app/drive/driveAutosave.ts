/**
 * When to upload the autosaved copy to Google Drive. Uploading after every change would send the
 * whole file over and over (and run into Drive's limits), so instead:
 * - after a change, wait until there has been a pause (`quiet`, 20 s);
 * - while changes keep coming, upload at least every `maxWait` (2 minutes);
 * - one upload at a time: changes made during an upload are sent by one more upload after it;
 * - `flush` sends any waiting changes at once (the tab is being hidden or closed).
 * After a failure it tries again on the next change, or after `retry`.
 */
export interface AutosaveTiming {
  quiet: number;
  maxWait: number;
  retry: number;
}

export const DRIVE_AUTOSAVE_TIMING: AutosaveTiming = { quiet: 20_000, maxWait: 120_000, retry: 60_000 };

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class DriveAutosaveScheduler {
  /** Revision of the design last uploaded (or being uploaded). */
  private uploaded = -1;
  /** The newest revision seen. */
  private latest = -1;
  /** When the oldest change not yet uploaded was seen. */
  private pendingSince: number | null = null;
  private timer: unknown = null;
  private busy = false;

  constructor(
    /** Upload the design as it is now; resolves when done (rejects on failure). */
    private readonly upload: (revision: number) => Promise<void>,
    private readonly timing: AutosaveTiming = DRIVE_AUTOSAVE_TIMING,
    private readonly clock: Clock = realClock,
  ) {}

  /** The design is at `revision` (call on every change; repeats are fine). */
  changed(revision: number): void {
    if (revision === this.latest) return;
    this.latest = revision;
    if (revision === this.uploaded) return;
    const now = this.clock.now();
    this.pendingSince ??= now;
    this.schedule(Math.min(this.timing.quiet, this.pendingSince + this.timing.maxWait - now));
  }

  /** The design was saved or reset: nothing is waiting any more. */
  settled(revision: number): void {
    this.latest = this.uploaded = revision;
    this.pendingSince = null;
    this.cancelTimer();
  }

  /** Upload now if anything is waiting (the page is being hidden). */
  flush(): void {
    if (this.pendingSince !== null) this.schedule(0);
  }

  stop(): void {
    this.cancelTimer();
    this.pendingSince = null;
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    this.cancelTimer();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, Math.max(0, ms));
  }

  private async run(): Promise<void> {
    if (this.busy || this.pendingSince === null) return;
    this.busy = true;
    const revision = this.latest;
    this.pendingSince = null;
    try {
      await this.upload(revision);
      this.uploaded = revision;
    } catch {
      // Try again later (or with the next change).
      this.pendingSince ??= this.clock.now();
      this.schedule(this.timing.retry);
    } finally {
      this.busy = false;
    }
    // Changes that came in during the upload: one more, on the normal rules.
    if (this.latest !== this.uploaded && this.timer === null) {
      this.pendingSince ??= this.clock.now();
      this.schedule(this.timing.quiet);
    }
  }
}
