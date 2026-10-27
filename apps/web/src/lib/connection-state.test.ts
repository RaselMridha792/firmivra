import { describe, expect, it } from 'vitest';
import { describeConnection } from './connection-state';

const at = (d: number) => `2026-10-${String(d).padStart(2, '0')}T12:00:00.000Z`;

describe('describeConnection (SH7)', () => {
  it('never says Connected before data came from the provider', () => {
    const s = describeConnection({
      provider: 'Fake Ledger',
      status: 'CONNECTED',
      lastSuccessAt: null,
      lastAttemptAt: null,
    });
    expect(s.label).toBe('Pending setup');
    expect(s.sync.label).toBe('Never synced');
  });

  it('is Connected once a sync succeeded, and keeps a later failure apart', () => {
    const ok = describeConnection({
      provider: 'Fake Ledger',
      status: 'CONNECTED',
      lastSuccessAt: at(20),
      lastAttemptAt: at(20),
    });
    expect(ok).toMatchObject({ label: 'Connected', tone: 'success', failedAt: null });
    expect(ok.sync.label).toMatch(/^Synced Oct 20, 2026/);
    const failed = describeConnection({
      provider: 'Fake Ledger',
      status: 'CONNECTED',
      lastSuccessAt: at(20),
      lastAttemptAt: at(22),
    });
    expect(failed.label).toBe('Connected');
    expect(failed.failedAt).toBe(at(22));
    expect(failed.sync).toMatchObject({ tone: 'danger' });
    expect(failed.sync.label).toMatch(/^Last attempt failed Oct 22, 2026/);
  });

  it('says what is missing otherwise', () => {
    expect(
      describeConnection({ provider: null, status: null, lastSuccessAt: null, lastAttemptAt: null })
        .label,
    ).toBe('Not connected');
    expect(
      describeConnection({
        provider: 'Fake Payroll',
        status: 'NOT_AUTHORIZED',
        lastSuccessAt: null,
        lastAttemptAt: null,
      }).detail,
    ).toContain('Connect it in Integrations');
    expect(
      describeConnection({
        provider: 'Fake Ledger',
        status: 'EXPIRED',
        lastSuccessAt: at(1),
        lastAttemptAt: at(2),
        errorCode: 'EXPIRED_TOKEN',
      }),
    ).toMatchObject({
      label: 'Needs attention',
      detail: 'The sign-in to the provider expired. Reconnect it.',
    });
  });
});
