// R4 step 3: the firm key job (outside the request) and the owner link's status on the review page.
import { describe, expect, it, vi } from 'vitest';
import { ownerInviteStatus } from '../../src/firm-applications/firm-applications.service.js';
import { FirmKeyJob } from '../../src/firm-applications/firm-key-job.js';
import type { FirmKeys } from '../../src/firm-applications/firm-keys.js';

function jobWith(keys: FirmKeys, locked: boolean, firms: string[]) {
  const updates: unknown[] = [];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ ok: locked }]),
    business: {
      findMany: vi.fn().mockResolvedValue(firms.map((id) => ({ id }))),
      updateMany: vi.fn((args: unknown) => {
        updates.push(args);
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const database = { withScope: vi.fn((_scope: unknown, fn: (t: typeof tx) => unknown) => fn(tx)) };
  const audit = { logIn: vi.fn().mockResolvedValue(undefined) };
  const job = new FirmKeyJob(keys, database as never, audit as never);
  return { job, tx, updates, audit, database };
}

const kms = (ensureKey: FirmKeys['ensureKey']): FirmKeys => ({ mode: 'kms', ensureKey });

describe('FirmKeyJob', () => {
  it('does nothing with KMS_MODE=local', async () => {
    const ensureKey = vi.fn();
    const { job, database } = jobWith({ mode: 'local', ensureKey }, true, ['f1']);
    job.onModuleInit();
    await job.start('f1');
    expect(ensureKey).not.toHaveBeenCalled();
    expect(database.withScope).not.toHaveBeenCalled();
    job.onApplicationShutdown();
  });

  it('sweeps firms without a key under the try-lock, and stores each key once', async () => {
    const { job, updates, audit } = jobWith(
      kms((id) => Promise.resolve(`arn:key/${id}`)),
      true,
      ['f1', 'f2'],
    );
    await job.sweep();
    expect(updates).toEqual([
      { where: { id: 'f1', kmsKeyId: null }, data: { kmsKeyId: 'arn:key/f1' } },
      { where: { id: 'f2', kmsKeyId: null }, data: { kmsKeyId: 'arn:key/f2' } },
    ]);
    expect(audit.logIn).toHaveBeenCalledTimes(2);
  });

  it('leaves the sweep to the task holding the lock', async () => {
    const ensureKey = vi.fn();
    const { job, tx } = jobWith(kms(ensureKey), false, ['f1']);
    await job.sweep();
    expect(tx.business.findMany).not.toHaveBeenCalled();
    expect(ensureKey).not.toHaveBeenCalled();
  });

  it('runs one key call per firm at a time, and a failure only warns', async () => {
    let finish: (v: string) => void = () => undefined;
    const ensureKey = vi.fn(() => new Promise<string>((r) => (finish = r)));
    const { job } = jobWith(kms(ensureKey), true, []);
    const a = job.start('f1');
    const b = job.start('f1');
    finish('arn:key/f1');
    await Promise.all([a, b]);
    expect(ensureKey).toHaveBeenCalledTimes(1);

    const failing = jobWith(
      kms(() => Promise.reject(new Error('AccessDenied'))),
      true,
      [],
    );
    await expect(failing.job.start('f2')).resolves.toBeUndefined();
  });
});

describe('ownerInviteStatus', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  it('is ACCEPTED once used, else EXPIRED after its expiry, else SENT', () => {
    const later = new Date('2026-10-10T00:00:00Z');
    const earlier = new Date('2026-10-08T00:00:00Z');
    expect(ownerInviteStatus({ expiresAt: earlier, acceptedAt: earlier }, now)).toBe('ACCEPTED');
    expect(ownerInviteStatus({ expiresAt: earlier, acceptedAt: null }, now)).toBe('EXPIRED');
    expect(ownerInviteStatus({ expiresAt: later, acceptedAt: null }, now)).toBe('SENT');
  });
});
