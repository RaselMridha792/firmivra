// Honest connection and sync state (Octavia's SH7): a provider is "Connected" only when it is
// authorized and data has come from it at least once; a saved company or test id alone is
// "Pending setup". The sync's state is separate: never synced, synced, or the last attempt failed
// (the last good data stays, and the failure is shown apart). Times come only from real events.

export type Tone = 'success' | 'warning' | 'danger' | 'neutral';

export interface ConnectionFacts {
  /** The provider's name; null when none was chosen for the client. */
  provider: string | null;
  /**
   * The connection as the API reports it. `NOT_AUTHORIZED`: a provider was chosen but the firm
   * has not connected it (Integrations).
   */
  status: 'CONNECTED' | 'ERROR' | 'EXPIRED' | 'DISCONNECTED' | 'NOT_AUTHORIZED' | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** A safe code (EXPIRED_TOKEN, RATE_LIMITED), never a provider's own message. */
  errorCode?: string | null;
}

export interface ConnectionState {
  label: string;
  tone: Tone;
  detail: string;
  sync: { label: string; tone: Tone };
  /** When the last attempt failed after the last success; null otherwise. */
  failedAt: string | null;
}

const ERRORS: Record<string, string> = {
  EXPIRED_TOKEN: 'The sign-in to the provider expired. Reconnect it.',
  RATE_LIMITED: 'The provider asked us to wait. The next sync tries again.',
};

const day = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function describeConnection(f: ConnectionFacts): ConnectionState {
  const failedAt =
    f.lastAttemptAt && (!f.lastSuccessAt || f.lastAttemptAt > f.lastSuccessAt)
      ? f.lastAttemptAt
      : null;
  const sync: ConnectionState['sync'] = failedAt
    ? { label: `Last attempt failed ${day(failedAt)}`, tone: 'danger' }
    : f.lastSuccessAt
      ? { label: `Synced ${day(f.lastSuccessAt)}`, tone: 'success' }
      : { label: 'Never synced', tone: 'neutral' };
  const base = { sync, failedAt };
  const name = f.provider ?? 'The provider';
  if (!f.provider || f.status === null) {
    return {
      ...base,
      label: 'Not connected',
      tone: 'neutral',
      detail: 'No provider is set up for this client.',
    };
  }
  switch (f.status) {
    case 'DISCONNECTED':
      return {
        ...base,
        label: 'Disconnected',
        tone: 'neutral',
        detail: `${name} was disconnected.`,
      };
    case 'ERROR':
    case 'EXPIRED':
      return {
        ...base,
        label: 'Needs attention',
        tone: 'danger',
        detail:
          (f.errorCode && ERRORS[f.errorCode]) ??
          `${name} could not be reached. The last data received is kept.`,
      };
    case 'NOT_AUTHORIZED':
      return {
        ...base,
        label: 'Not authorized',
        tone: 'warning',
        detail: `${name} is chosen but not connected for the firm. Connect it in Integrations.`,
      };
    case 'CONNECTED':
      return f.lastSuccessAt
        ? { ...base, label: 'Connected', tone: 'success', detail: `Data is coming from ${name}.` }
        : {
            ...base,
            label: 'Pending setup',
            tone: 'warning',
            detail: `No data has come from ${name} yet. It shows as connected after the first successful sync.`,
          };
  }
}
