// System Settings' System Health and Email Delivery Status (R55): what each service reports from
// the API's own configuration, and that a slow or failing check is DOWN instead of a hang.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminHealthService } from '../../src/admin-settings/admin-health.service.js';

type Parts = ConstructorParameters<typeof AdminHealthService>;

function make(over: {
  ping?: () => Promise<void>;
  head?: () => Promise<unknown>;
  email?: unknown;
  sms?: unknown;
  testRow?: { createdAt: Date; metadata: unknown } | null;
}) {
  const admin = {
    db: {
      platformSecretRef: { findUnique: () => Promise.resolve(null) },
      auditLog: { findFirst: () => Promise.resolve(over.testRow ?? null) },
    },
  } as unknown as Parts[0];
  const database = { ping: over.ping ?? (() => Promise.resolve()) } as unknown as Parts[1];
  const storage = { head: over.head ?? (() => Promise.resolve(null)) } as unknown as Parts[2];
  const notify = {
    email: over.email ?? { mode: 'log' },
    sms: over.sms ?? { mode: 'log', unregistered: false },
  } as unknown as Parts[3];
  return new AdminHealthService(admin, database, storage, notify);
}
const statusOf = async (s: AdminHealthService) =>
  Object.fromEntries((await s.health()).services.map((x) => [x.key, x.status]));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('health', () => {
  it('reports what answered and what is configured', async () => {
    vi.stubEnv('STRIPE_MODE', 'fake');
    const s = make({ email: { mode: 'ses' }, sms: { mode: 'sns' } });
    expect(await statusOf(s)).toEqual({
      api: 'ONLINE',
      database: 'ONLINE',
      storage: 'ONLINE',
      email: 'CONFIGURED',
      sms: 'CONFIGURED',
      payments: 'CONFIGURED',
    });
  });

  it('is DOWN when the database or storage fails, and says why the rest are off', async () => {
    vi.stubEnv('STRIPE_MODE', '');
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const s = make({
      ping: () => Promise.reject(new Error('fake')),
      head: () => Promise.reject(new Error('fake')),
      sms: { mode: 'log', unregistered: true },
    });
    const h = await s.health();
    const by = Object.fromEntries(h.services.map((x) => [x.key, x]));
    expect(by.database?.status).toBe('DOWN');
    expect(by.storage?.status).toBe('DOWN');
    expect(by.email).toMatchObject({
      status: 'NOT_CONFIGURED',
      detail: expect.stringMatching(/log/),
    });
    expect(by.sms?.detail).toMatch(/origination number/);
    expect(by.payments?.status).toBe('NOT_CONFIGURED');
  });

  it('gives up on storage that does not answer', async () => {
    vi.useFakeTimers();
    const s = make({ head: () => new Promise(() => {}) });
    const pending = s.health();
    await vi.advanceTimersByTimeAsync(3_100);
    expect((await pending).services.find((x) => x.key === 'storage')?.status).toBe('DOWN');
  });
});

describe('emailStatus', () => {
  it('names the sender and the last test, with no delivery figures', async () => {
    const at = new Date('2026-10-20T09:00:00Z');
    const s = make({
      email: { mode: 'smtp' },
      testRow: { createdAt: at, metadata: { accepted: true } },
    });
    expect(await s.emailStatus()).toEqual({
      sender: 'SMTP',
      customSmtp: false,
      lastTest: { at: at.toISOString(), accepted: true },
      deliveryRate24h: null,
      bounced24h: null,
    });
    expect((await make({}).emailStatus()).lastTest).toBeNull();
  });
});
