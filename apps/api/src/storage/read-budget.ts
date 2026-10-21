/**
 * How many bytes of whole files this process may hold in memory at once: confirm's checks of an
 * upload (every flow), and Firm Sign's reads (send, completion, replace, templates, the signer's
 * packet, the page viewer's bytes). The API task has 1 GiB; this leaves the rest to Node, the
 * requests and the parsed copies a PDF library makes. One budget for the process, never one per
 * service: three 100 MB confirms fit, a fourth waits for its retry.
 */
export const READ_BUDGET_BYTES = 320 * 1024 * 1024;

/**
 * pdf-lib copies a PDF's streams as it parses it: work that parses a PDF holds about twice its
 * bytes (agreement checks, Firm Sign's page counts, packets and stamping).
 */
export const PDF_PARSE_FACTOR = 2;

/** Gives back what `tryTake` took; calling it again does nothing. */
export type Release = () => void;
/** Takes over a release, to call it once the bytes are gone (a response that streams them). */
export type Keep = (release: Release) => void;

/** The bytes whole-file reads may hold at once, taken before a read and given back after it. */
export class ReadBudget {
  private held = 0;

  constructor(readonly total: number) {}

  /** What is not taken right now. */
  get free(): number {
    return this.total - this.held;
  }

  /**
   * Takes `bytes`, or answers null when they don't fit now. A need larger than the whole budget
   * takes all of it: it runs only when nothing else holds any.
   */
  tryTake(bytes: number): Release | null {
    const need = Math.min(this.total, Math.max(0, Math.ceil(bytes)));
    if (this.held + need > this.total) return null;
    this.held += need;
    let given = false;
    return () => {
      if (given) return;
      given = true;
      this.held -= need;
    };
  }

  /**
   * Runs `work` holding `bytes`, and gives them back when it ends. When they don't fit, throws
   * `busy()` without running it (each flow answers its own 503, which the browser retries). With
   * `keep`, a `work` that succeeds hands the release to `keep` instead (a route that streams the
   * bytes gives them back when its response closes).
   */
  async hold<T>(bytes: number, busy: () => Error, work: () => Promise<T>, keep?: Keep): Promise<T> {
    const release = this.tryTake(bytes);
    if (!release) throw busy();
    let kept = false;
    try {
      const result = await work();
      if (keep) {
        kept = true;
        keep(release);
      }
      return result;
    } finally {
      if (!kept) release();
    }
  }
}

/** The process's one budget. */
export const readBudget = new ReadBudget(READ_BUDGET_BYTES);

/**
 * Keeps the bytes until the response is done: its `close` comes once it is sent or its
 * connection drops. A response that closed already gives them back at once.
 */
export function untilClosed(res: {
  once(event: 'close', listener: () => void): unknown;
  readonly closed?: boolean;
  readonly destroyed?: boolean;
}): Keep {
  return (release) => {
    res.once('close', release);
    if (res.closed || res.destroyed) release();
  };
}
