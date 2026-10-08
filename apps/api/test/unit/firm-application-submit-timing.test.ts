// Unit: in AWS every submit answer takes at least SUBMIT_MIN_RESPONSE_MS (R3's atLeast), so a
// dropped honeypot and a real submit can't be told apart by time; local runs don't wait. The
// database, audit and notify services are stubs: nothing is stored.
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import type { Env } from '../../src/config/env.js';
import type { EinHashKey } from '../../src/firm-applications/ein-hash.js';
import {
  FirmApplicationSubmitService,
  SUBMIT_MIN_RESPONSE_MS,
} from '../../src/firm-applications/submit.service.js';

/** A transaction in which every lock is free and nobody has submitted yet. */
const tx = {
  $queryRaw: vi.fn().mockResolvedValue([{ ok: true }]),
  auditLog: { count: vi.fn().mockResolvedValue(0) },
};
const database = {
  withScope: (_scope: unknown, work: (t: typeof tx) => Promise<unknown>) => work(tx),
} as unknown as Database;
const audit = { logIn: vi.fn().mockResolvedValue(undefined) };
const notify = { send: vi.fn().mockResolvedValue(undefined) };
const key: EinHashKey = { ok: true, key: randomBytes(32) };

const service = (authMode: string, einKey: EinHashKey = key) =>
  new FirmApplicationSubmitService(database, audit as never, notify, einKey, {
    AUTH_MODE: authMode,
  } as unknown as Env);

/** A filled honeypot: the path that stores and sends nothing, so it would answer fastest. */
const trap = {
  honeypot: 'filled by a bot',
  primaryAdmin: { email: 'casey@sample.example.test' },
  business: {},
} as never;

async function elapsed(work: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await work().catch(() => undefined);
  return performance.now() - start;
}

describe('FirmApplicationSubmitService: a fixed minimum answer time in AWS', () => {
  it('a dropped honeypot takes at least the minimum, and answers like a real submit', async () => {
    const s = service('cognito');
    let answer: unknown;
    const ms = await elapsed(async () => (answer = await s.submit(trap)));
    expect(answer).toEqual({ received: true });
    expect(ms).toBeGreaterThanOrEqual(SUBMIT_MIN_RESPONSE_MS - 5);
    expect(notify.send).not.toHaveBeenCalled();
  });

  it('a refusal (503 without the key) waits as long', async () => {
    const s = service('cognito', { ok: false, problem: 'EIN_HASH_KEY is not set' });
    await expect(s.submit(trap)).rejects.toMatchObject({ status: 503 });
    expect(await elapsed(() => s.submit(trap))).toBeGreaterThanOrEqual(SUBMIT_MIN_RESPONSE_MS - 5);
  });

  it('local and test runs answer at once', async () => {
    expect(await elapsed(() => service('local').submit(trap))).toBeLessThan(
      SUBMIT_MIN_RESPONSE_MS / 2,
    );
  });
});
