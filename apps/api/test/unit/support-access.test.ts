import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { decodeOffset, encodeOffset, statusOf } from '../../src/support-access/grants.js';
import { SupportAccessService } from '../../src/support-access/support-access.service.js';

const HOUR = 60 * 60_000;
const now = Date.parse('2026-10-13T14:00:00.000Z');
const at = (msFromNow: number) => new Date(now + msFromNow);
const firm = '0199b6e0-0000-7000-8000-000000000001';
const admin = '0199b6e0-0000-7000-8000-0000000000a1';
const owner = '0199b6e0-0000-7000-8000-000000000101';
const grantId = '0199b6e1-0000-7000-8000-000000000001';

describe('support access status', () => {
  it('is derived from the row: asked, approved, declined, revoked, expired', () => {
    const row = (fields: Partial<Parameters<typeof statusOf>[0]> = {}) => ({
      grantedByUserId: null,
      expiresAt: null,
      revokedAt: null,
      ...fields,
    });
    const approved = { grantedByUserId: owner, expiresAt: at(60_000) };
    expect(statusOf(row(), now)).toBe('PENDING');
    expect(statusOf(row({ revokedAt: at(-1) }), now)).toBe('DECLINED');
    expect(statusOf(row(approved), now)).toBe('ACTIVE');
    expect(statusOf(row({ ...approved, revokedAt: at(-1) }), now)).toBe('REVOKED');
    // The expiry moment itself is over, as `expires_at > now()` says in SQL.
    expect(statusOf(row({ ...approved, expiresAt: at(0) }), now)).toBe('EXPIRED');
    expect(statusOf(row({ ...approved, expiresAt: at(-1) }), now)).toBe('EXPIRED');
    // Revoked stays revoked after the expiry.
    expect(statusOf(row({ ...approved, expiresAt: at(-1), revokedAt: at(-2) }), now)).toBe(
      'REVOKED',
    );
  });
});

describe('support access paging', () => {
  it('round-trips an offset through an opaque cursor', () => {
    for (const offset of [0, 1, 25, 999_999]) {
      const cursor = encodeOffset(offset);
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(cursor).not.toContain(String(offset));
      expect(decodeOffset(cursor)).toBe(offset);
    }
    expect(decodeOffset(undefined)).toBe(0);
  });

  it('refuses any other cursor with 400', () => {
    const encoded = (text: string) => Buffer.from(text).toString('base64url');
    for (const bad of [
      '',
      'nope',
      encoded('o:-1'),
      encoded('o:1234567'),
      encoded('x:1'),
      encoded('o:1 '),
      encoded('o:'),
    ]) {
      expect(() => decodeOffset(bad), bad).toThrow(BadRequestException);
    }
  });
});

describe('the audit rows that follow an action are best effort', () => {
  const pending = {
    id: grantId,
    businessId: firm,
    adminUserId: admin,
    grantedByUserId: null,
    reason: 'Fake reason',
    expiresAt: null,
    revokedAt: null,
    createdAt: at(-HOUR),
  };
  /** The service over one fake transaction, with an AuditService whose `log` fails. */
  function failingCopies(tx: object) {
    const db = {
      withScope: (_scope: unknown, work: (t: object) => Promise<unknown>) => work(tx),
    } as unknown as Database;
    const audit = {
      logIn: vi.fn().mockResolvedValue(undefined),
      log: vi.fn().mockRejectedValue(new Error('database down')),
    };
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    return { service: new SupportAccessService(db, audit as never), audit, warn };
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("an answer stands when the platform's copy fails: a warning with the grant id", async () => {
    const { service, audit, warn } = failingCopies({
      $executeRaw: vi.fn().mockResolvedValue(0),
      $queryRaw: vi.fn().mockResolvedValue([{ ...pending, dbNow: new Date(now) }]),
      supportAccessGrant: {
        update: vi
          .fn()
          .mockResolvedValue({ ...pending, grantedByUserId: owner, expiresAt: at(2 * HOUR) }),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: owner, name: 'Fake Owner' }]) },
    });
    const answer = await service.decide(firm, owner, grantId, 'approve', 2);
    expect(answer).toMatchObject({
      id: grantId,
      status: 'ACTIVE',
      approvedBy: { userId: owner, name: 'Fake Owner' },
    });
    expect(audit.logIn).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      'support.approved',
      { type: 'support_access_grant', id: grantId },
      { businessId: firm, hours: 2 },
      { businessId: null },
    );
    expect(warn.mock.calls).toEqual([
      [`Could not copy support.approved to the platform's log (grant ${grantId})`],
    ]);
  });

  it("an ask stands when the firm's row fails: a warning with the grant id", async () => {
    const { service, audit, warn } = failingCopies({
      business: {
        findUnique: vi.fn().mockResolvedValue({ id: firm, name: 'Fake Firm', slug: 'fake' }),
      },
      // The pair's lock, then no open request.
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ ok: true }])
        .mockResolvedValueOnce([]),
      supportAccessGrant: { create: vi.fn().mockResolvedValue(pending) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: admin, name: 'Fake Super Admin' }]) },
    });
    const asked = await service.request(admin, firm, 'Fake reason');
    expect(asked).toMatchObject({
      id: grantId,
      status: 'PENDING',
      admin: { userId: admin, name: 'Fake Super Admin' },
    });
    expect(audit.log).toHaveBeenCalledWith(
      'support.requested',
      { type: 'support_access_grant', id: grantId },
      {},
      { businessId: firm, actorUserId: admin },
    );
    expect(warn.mock.calls).toEqual([
      [`Could not copy support.requested to the firm's log (grant ${grantId})`],
    ]);
  });
});
