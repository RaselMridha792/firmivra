// R4 step 3: the firm key job (outside the request) and the owner link's status on the review page.
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownerInviteStatus } from '../../src/firm-applications/firm-applications.service.js';
import {
  FIRM_KEY_SWEEP_MIN_AGE_MS,
  FIRM_KEY_SWEEP_MS,
  FirmKeyJob,
  KEY_NEEDS_PERSON,
} from '../../src/firm-applications/firm-key-job.js';
import { FirmKeyError, type FirmKeys } from '../../src/firm-applications/firm-keys.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function jobWith(keys: FirmKeys, locked: boolean, firms: string[], held: string[] = []) {
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
    auditLog: {
      findMany: vi.fn().mockResolvedValue(held.map((entityId) => ({ entityId }))),
      count: vi.fn().mockResolvedValue(0),
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

describe('FirmKeyJob: failures', () => {
  it('skips firms newer than the minimum age and firms waiting for a person', async () => {
    const ensureKey = vi.fn((id: string) => Promise.resolve(`arn:key/${id}`));
    const { job, tx } = jobWith(kms(ensureKey), true, ['f1', 'f2'], ['f2']);
    const before = Date.now();
    await job.sweep();
    const after = Date.now();
    const where = (tx.business.findMany.mock.calls[0]![0] as { where: { createdAt: { lt: Date } } })
      .where;
    // The cutoff is "now" during the sweep minus the minimum age (the clock may tick meanwhile).
    const cutoff = where.createdAt.lt.getTime();
    expect(cutoff).toBeGreaterThanOrEqual(before - FIRM_KEY_SWEEP_MIN_AGE_MS);
    expect(cutoff).toBeLessThanOrEqual(after - FIRM_KEY_SWEEP_MIN_AGE_MS);
    expect(ensureKey.mock.calls).toEqual([['f1']]);
  });

  it('records a FirmKeyError once and logs it once, then the sweep leaves the firm alone', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const fail = () =>
      Promise.reject(new FirmKeyError('Business f1: key k was made but not named'));
    const { job, tx, audit } = jobWith(kms(fail), true, []);
    await job.start('f1');
    expect(audit.logIn).toHaveBeenCalledWith(tx, KEY_NEEDS_PERSON, { type: 'business', id: 'f1' });
    tx.auditLog.count.mockResolvedValue(1);
    await job.start('f1');
    expect(audit.logIn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/was made but not named.*Not retried/);
  });

  it('keeps the API up when a sweep fails: a warning, and the next one runs', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { job, database } = jobWith(kms(vi.fn()), true, []);
    database.withScope.mockRejectedValue(Object.assign(new Error('db down'), { name: 'DbError' }));
    job.onModuleInit();
    await vi.advanceTimersByTimeAsync(FIRM_KEY_SWEEP_MS * 2);
    expect(database.withScope).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'The firm key sweep failed (DbError); it runs again later',
      'The firm key sweep failed (DbError); it runs again later',
    ]);
    job.onApplicationShutdown();
  });
});

describe('ownerInviteStatus', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  it('is ACCEPTED once used, else EXPIRED when revoked or past its expiry, else SENT', () => {
    const later = new Date('2026-10-10T00:00:00Z');
    const earlier = new Date('2026-10-08T00:00:00Z');
    expect(
      ownerInviteStatus({ expiresAt: earlier, acceptedAt: earlier, revokedAt: null }, now),
    ).toBe('ACCEPTED');
    expect(ownerInviteStatus({ expiresAt: earlier, acceptedAt: null, revokedAt: null }, now)).toBe(
      'EXPIRED',
    );
    expect(ownerInviteStatus({ expiresAt: later, acceptedAt: null, revokedAt: null }, now)).toBe(
      'SENT',
    );
    // Revoked (and no newer link): it no longer works.
    expect(ownerInviteStatus({ expiresAt: later, acceptedAt: null, revokedAt: earlier }, now)).toBe(
      'EXPIRED',
    );
  });
});
