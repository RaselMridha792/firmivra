// R55, SM4: the tenant guard's staff sessions. A session the firm ended is 401 SESSION_REVOKED, a
// failed lookup fails closed, and the session's own writes never fail the request.
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import type { AuditService } from '../../src/audit/audit.service.js';
import { deviceLabel, sessionKey, StaffSessions } from '../../src/auth/staff-sessions.js';

const FIRM = '0190a000-0000-7000-8000-000000000001';
const OTHER = '0190a000-0000-7000-8000-000000000002';
const req = {
  ip: '203.0.113.7',
  get: (h: string) => (h === 'user-agent' ? 'Mozilla/5.0 (Macintosh) Safari/605.1.15' : undefined),
} as unknown as Request;

type Rules = { autoLogoutMinutes: number | null; disableOn: Date | null };

function sessions(
  found: () => Promise<unknown>,
  over: { start?: () => Promise<unknown>; rules?: Rules } = {},
) {
  const rules = over.rules ?? null;
  const staffSession = {
    // A found row comes with the member's own rules (SM33), as the query selects them.
    findFirst: vi.fn(async () => {
      const row = await found();
      return row ? { ...(row as object), member: { staffSecurity: rules } } : row;
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const staffSecuritySettings = { findUnique: vi.fn().mockResolvedValue(rules) };
  // The firm's time zone (SM33's disable-on date) is read in a scope of its own.
  const zone = { businessSettings: { findUnique: () => Promise.resolve({ timezone: 'UTC' }) } };
  const withScope = vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    String(fn).includes('firmTimeZone') ? fn(zone) : over.start ? over.start() : Promise.resolve(),
  );
  const db = {
    forBusiness: () => ({ staffSession, staffSecuritySettings }),
    withScope,
  } as unknown as Database;
  return { tracker: new StaffSessions(db, {} as AuditService), staffSession, withScope };
}

const revokedError = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(UnauthorizedException);
  expect((e as UnauthorizedException).getResponse()).toMatchObject({ code: 'SESSION_REVOKED' });
};

describe('StaffSessions (SM4)', () => {
  it('keys a session per firm, never as the id itself', () => {
    const a = sessionKey(FIRM, 'sid-1');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('sid-1');
    expect(sessionKey(OTHER, 'sid-1')).not.toBe(a);
    expect(sessionKey(FIRM, 'sid-1')).toBe(a);
  });

  it('names the device in plain words', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBe('Safari on macOS');
    expect(deviceLabel(undefined)).toBe('Unknown device');
  });

  it('answers 401 SESSION_REVOKED for a session the firm ended', async () => {
    const { tracker, withScope } = sessions(() =>
      Promise.resolve({
        id: 's1',
        membershipId: 'm1',
        revokedAt: new Date(),
        lastActiveAt: new Date(),
      }),
    );
    await revokedError(tracker.check(req, FIRM, 'm1', 'sid-1'));
    expect(withScope).not.toHaveBeenCalled();
  });

  it('answers 401 for a row of another membership under the same key', async () => {
    const { tracker } = sessions(() =>
      Promise.resolve({ id: 's1', membershipId: 'm2', revokedAt: null, lastActiveAt: new Date() }),
    );
    await revokedError(tracker.check(req, FIRM, 'm1', 'sid-1'));
  });

  it('fails closed when the session cannot be read', async () => {
    const { tracker } = sessions(() => Promise.reject(new Error('database down')));
    await expect(tracker.check(req, FIRM, 'm1', 'sid-1')).rejects.toThrow('database down');
  });

  it('opens the row on the first request, and a failed write never fails the request', async () => {
    const opened = sessions(() => Promise.resolve(null));
    await expect(opened.tracker.check(req, FIRM, 'm1', 'sid-1')).resolves.toBeUndefined();
    expect(opened.withScope).toHaveBeenCalledWith(
      { kind: 'business', businessId: FIRM },
      expect.any(Function),
    );
    const broken = sessions(() => Promise.resolve(null), {
      start: () => Promise.reject(new Error('write failed')),
    });
    await expect(broken.tracker.check(req, FIRM, 'm1', 'sid-1')).resolves.toBeUndefined();
  });

  it('moves lastActiveAt at most once a minute, and a failed move never fails the request', async () => {
    const seen = (ms: number) => () =>
      Promise.resolve({
        id: 's1',
        membershipId: 'm1',
        revokedAt: null,
        lastActiveAt: new Date(Date.now() - ms),
      });
    const recent = sessions(seen(30_000));
    await recent.tracker.check(req, FIRM, 'm1', 'sid-1');
    expect(recent.staffSession.updateMany).not.toHaveBeenCalled();
    const stale = sessions(seen(61_000));
    await stale.tracker.check(req, FIRM, 'm1', 'sid-1');
    expect(stale.staffSession.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', revokedAt: null },
      data: { lastActiveAt: expect.any(Date) as Date },
    });
    stale.staffSession.updateMany.mockRejectedValue(new Error('write failed'));
    await expect(stale.tracker.check(req, FIRM, 'm1', 'sid-1')).resolves.toBeUndefined();
  });

  it("SM33: the member's shorter automatic logout ends an idle session; SEC-4's 15 minutes still cap it", async () => {
    const seen = (minutes: number) => () =>
      Promise.resolve({
        id: 's1',
        membershipId: 'm1',
        revokedAt: null,
        lastActiveAt: new Date(Date.now() - minutes * 60_000),
      });
    const short = sessions(seen(6), { rules: { autoLogoutMinutes: 5, disableOn: null } });
    const e = await short.tracker.check(req, FIRM, 'm1', 'sid-1').catch((err: unknown) => err);
    expect((e as UnauthorizedException).getResponse()).toMatchObject({
      code: 'SESSION_IDLE',
      message: expect.stringContaining('5 minutes') as string,
    });
    expect(short.staffSession.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    const long = sessions(seen(6), { rules: { autoLogoutMinutes: 60, disableOn: null } });
    await expect(long.tracker.check(req, FIRM, 'm1', 'sid-1')).resolves.toBeUndefined();
    const capped = sessions(seen(16), { rules: { autoLogoutMinutes: 60, disableOn: null } });
    await expect(capped.tracker.check(req, FIRM, 'm1', 'sid-1')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('SM33: from the "Disable account on" date the firm answers 401, and the session ends', async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000);
    const live = () =>
      Promise.resolve({ id: 's1', membershipId: 'm1', revokedAt: null, lastActiveAt: new Date() });
    const ended = sessions(live, { rules: { autoLogoutMinutes: null, disableOn: day(0) } });
    const e = await ended.tracker.check(req, FIRM, 'm1', 'sid-1').catch((err: unknown) => err);
    expect((e as UnauthorizedException).getResponse()).toMatchObject({
      code: 'SESSION_REVOKED',
      message: expect.stringContaining('ended on') as string,
    });
    expect(ended.staffSession.updateMany).toHaveBeenCalled();
    // A first request (no row yet) reads the rules on their own, and is refused too.
    const first = sessions(() => Promise.resolve(null), {
      rules: { autoLogoutMinutes: null, disableOn: day(-1) },
    });
    await revokedError(first.tracker.check(req, FIRM, 'm1', 'sid-1'));
    const later = sessions(live, { rules: { autoLogoutMinutes: null, disableOn: day(2) } });
    await expect(later.tracker.check(req, FIRM, 'm1', 'sid-1')).resolves.toBeUndefined();
  });
});
