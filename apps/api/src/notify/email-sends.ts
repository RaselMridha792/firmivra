import type { EmailTransport } from './transports.js';

const HOUR_MS = 60 * 60 * 1000;
/** Enough to answer "did the latest send fail"; older outcomes add nothing. */
const KEEP = 50;

/**
 * Whether this API's recent emails went out, for the Super Admin's System Status (R25). Only the
 * time and the outcome of each send: never the address, the template or the error.
 */
export class EmailSendLog {
  private readonly outcomes: { at: number; ok: boolean }[] = [];

  record(ok: boolean, at = Date.now()): void {
    this.outcomes.push({ at, ok });
    if (this.outcomes.length > KEEP) this.outcomes.shift();
  }

  /** Degraded when the latest send in the last hour failed; online otherwise, or with no sends. */
  status(now = Date.now()): 'online' | 'degraded' {
    const latest = this.outcomes.at(-1);
    return latest && !latest.ok && now - latest.at <= HOUR_MS ? 'degraded' : 'online';
  }
}

/** The transport, with each send's outcome written to `sends`. */
export function trackedTransport(transport: EmailTransport, sends: EmailSendLog): EmailTransport {
  return {
    send: async (mail) => {
      try {
        await transport.send(mail);
      } catch (error) {
        sends.record(false);
        throw error;
      }
      sends.record(true);
    },
  };
}
