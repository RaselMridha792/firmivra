// R25: the Super Admin's System Status rows and the dashboard's user and revenue figures.
import { describe, expect, it, vi } from 'vitest';
import type { AdminPrisma } from '../../src/firm-applications/admin-prisma.js';
import { FirmApplicationsService } from '../../src/firm-applications/firm-applications.service.js';
import { EmailSendLog, trackedTransport } from '../../src/notify/email-sends.js';
import {
  portalsHealth,
  STATUS_CACHE_MS,
  SystemStatusService,
} from '../../src/system-status/system-status.controller.js';

const HOUR = 60 * 60 * 1000;

describe('EmailSendLog', () => {
  it('is online with no sends, and while the latest send went out', () => {
    const log = new EmailSendLog();
    expect(log.status()).toBe('online');
    log.record(false, 1_000);
    log.record(true, 2_000);
    expect(log.status(3_000)).toBe('online');
  });

  it('is degraded while the latest send in the last hour failed, online again after an hour', () => {
    const log = new EmailSendLog();
    log.record(true, 1_000);
    log.record(false, 2_000);
    expect(log.status(2_000 + HOUR)).toBe('degraded');
    expect(log.status(2_001 + HOUR)).toBe('online');
  });

  it('records each send through the tracked transport and passes the error on', async () => {
    const log = new EmailSendLog();
    const send = vi.fn().mockRejectedValueOnce(new Error('MessageRejected'));
    send.mockResolvedValueOnce(undefined);
    const transport = trackedTransport({ send }, log);
    const mail = { from: { name: 'F', address: 'f@example.test' } } as never;
    await expect(transport.send(mail)).rejects.toThrow('MessageRejected');
    expect(log.status()).toBe('degraded');
    await transport.send(mail);
    expect(log.status()).toBe('online');
  });
});

describe('portalsHealth', () => {
  const ok = { status: 'fulfilled', value: {} } as const;
  const no = { status: 'rejected', reason: new Error('x') } as const;
  it('maps the portal reads to online, degraded and offline, and null with no firm', () => {
    expect(portalsHealth([ok, ok])).toBe('online');
    expect(portalsHealth([ok, no])).toBe('degraded');
    expect(portalsHealth([no, no])).toBe('offline');
    expect(portalsHealth([])).toBeNull();
  });
});

describe('SystemStatusService', () => {
  const make = (check: () => Promise<void>, mode: 'ses' | 'log' = 'ses') => {
    const findMany = vi.fn().mockResolvedValue([{ slug: 'lvp' }, { slug: 'b' }]);
    const activeFirm = vi.fn().mockResolvedValue({});
    const service = new SystemStatusService(
      { check: vi.fn(check) },
      { email: { mode } } as never,
      new EmailSendLog(),
      { db: { business: { findMany } } } as never,
      { activeFirm } as never,
    );
    return { service, findMany, activeFirm };
  };

  it('checks storage and every active portal, then reuses the answer for a minute', async () => {
    const { service, findMany, activeFirm } = make(async () => {});
    const first = await service.status(0);
    expect(first).toMatchObject({ storage: 'online', email: 'online', portals: 'online' });
    expect(activeFirm.mock.calls.map(([slug]) => slug)).toEqual(['lvp', 'b']);
    expect(await service.status(STATUS_CACHE_MS - 1)).toBe(first);
    expect(findMany).toHaveBeenCalledTimes(1);
    await service.status(STATUS_CACHE_MS);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('reports a failed storage check as offline and EMAIL_MODE=log as degraded', async () => {
    const { service } = make(() => Promise.reject(new Error('AccessDenied')), 'log');
    expect(await service.status(0)).toMatchObject({ storage: 'offline', email: 'degraded' });
  });
});

describe('dashboard', () => {
  it('counts staff and client logins from users, and gives 0 revenue', async () => {
    const count = vi.fn().mockResolvedValue(3);
    const userCount = vi.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(2);
    const service = new FirmApplicationsService(
      { db: { firmApplication: { count }, business: { count } } } as unknown as AdminPrisma,
      {} as never,
      {} as never,
      { forPlatform: () => ({ user: { count: userCount } }) } as never,
      {} as never,
      {} as never,
    );
    expect(await service.dashboard()).toEqual({
      pendingApplications: 3,
      activeFirms: 3,
      totalUsers: 12,
      newUsersThisWeek: 2,
      monthlyRevenueCents: 0,
    });
    expect(userCount.mock.calls[0]?.[0]).toEqual({ where: { pool: { not: 'ADMIN' } } });
    expect(userCount.mock.calls[1]?.[0]).toMatchObject({
      where: { pool: { not: 'ADMIN' }, createdAt: { gte: expect.any(Date) } },
    });
  });
});
