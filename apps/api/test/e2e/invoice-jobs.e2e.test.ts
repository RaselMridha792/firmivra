// End-to-end: R7 step 10, the job that opens SCHEDULED invoices whose day has come in their firm's
// time zone, against the database: each firm in its own scope, audited, once only, and skipped
// while another task holds the job's advisory lock. The job is off in tests; each test runs it.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import {
  InvoiceJobs,
  invoiceJobsOn,
  OPEN_SCHEDULED_LOCK_KEY,
} from '../../src/payments/invoices/invoice-jobs.js';
import { InvoiceNotices } from '../../src/payments/invoices/invoice-notices.js';
import { nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
let jobs: InvoiceJobs;
beforeAll(async () => {
  t = await startInvoiceApp('r7j');
  jobs = t.app.get(InvoiceJobs);
});
afterAll(async () => {
  await t.app.close();
});

/** A SCHEDULED invoice for `scheduledFor` (a date), written straight to the database. */
const scheduled = async (scheduledFor: string, firm: 'A' | 'B' = 'A') => {
  const businessId = firm === 'A' ? t.ids.firmA : t.ids.firmB;
  const clientId = firm === 'A' ? t.ids.one : t.ids.clientB;
  return t.inScope(businessId, async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        businessId,
        clientId,
        number: `INV-J-${randomUUID().slice(0, 8)}`,
        dueOn: new Date(`${nyDay(40)}T00:00:00.000Z`),
        scheduledFor: new Date(`${scheduledFor}T00:00:00.000Z`),
      },
    });
    await tx.invoiceLine.create({
      data: { businessId, invoiceId: invoice.id, description: 'Payroll', unitAmountCents: 9_000 },
    });
    await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'SCHEDULED' } });
    return invoice.id;
  });
};
const stateOf = (id: string, businessId = t.ids.firmA) =>
  t.inScope(businessId, (tx) =>
    tx.invoice.findFirstOrThrow({
      where: { businessId, id },
      select: { status: true, scheduledFor: true, issuedAt: true },
    }),
  );
const openedAudits = (id: string, businessId = t.ids.firmA) =>
  t.inScope(businessId, (tx) =>
    tx.auditLog.findMany({
      where: { businessId, entityId: id, action: 'invoice.opened' },
      select: { businessId: true, metadata: true },
    }),
  );
const runFor = (now: Date, ...businessIds: string[]) =>
  jobs.run({ now, businessIds: businessIds.length ? businessIds : [t.ids.firmA] });

describe('the scheduled invoices job', () => {
  it('opens the ones whose day has come, audited, once, and leaves later ones Upcoming', async () => {
    const due = await scheduled(nyDay(0));
    const later = await scheduled(nyDay(2));
    const now = new Date();
    expect(await runFor(now)).toEqual({ skipped: false, opened: 1 });
    expect(await stateOf(due)).toEqual({ status: 'OPEN', scheduledFor: null, issuedAt: now });
    expect((await stateOf(later)).status).toBe('SCHEDULED');
    const audits = await openedAudits(due);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ actor: 'job', clientId: t.ids.one });
    expect(await runFor(new Date())).toEqual({ skipped: false, opened: 0 });
    expect(await openedAudits(due)).toHaveLength(1);
  });

  it("goes by the firm's time zone, not UTC", async () => {
    const day = nyDay(5);
    const id = await scheduled(day);
    // 02:00 UTC on that day is still the evening before in New York.
    await runFor(new Date(`${day}T02:00:00.000Z`));
    expect((await stateOf(id)).status).toBe('SCHEDULED');
    await runFor(new Date(`${day}T05:00:00.000Z`));
    expect((await stateOf(id)).status).toBe('OPEN');
  });

  it("opens each firm's invoices in that firm only", async () => {
    const a = await scheduled(nyDay(0));
    const b = await scheduled(nyDay(0), 'B');
    await runFor(new Date());
    expect((await stateOf(b, t.ids.firmB)).status).toBe('SCHEDULED');
    expect(await openedAudits(b, t.ids.firmB)).toHaveLength(0);
    await runFor(new Date(), t.ids.firmA, t.ids.firmB);
    expect((await stateOf(a)).status).toBe('OPEN');
    expect((await stateOf(b, t.ids.firmB)).status).toBe('OPEN');
    expect(await openedAudits(b, t.ids.firmB)).toEqual([
      expect.objectContaining({ businessId: t.ids.firmB }),
    ]);
  });

  it('skips the run while another task holds its lock', async () => {
    const id = await scheduled(nyDay(0));
    const other = createPrismaClient(testDatabaseUrls('test_api').owner);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => (locked = resolve));
    const holder = runInScope(
      other,
      { kind: 'platform' },
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${OPEN_SCHEDULED_LOCK_KEY}::bigint)::text`;
        locked();
        await held;
      },
      { timeout: 20_000 },
    );
    try {
      await isLocked;
      expect(await runFor(new Date())).toEqual({ skipped: true });
      expect((await stateOf(id)).status).toBe('SCHEDULED');
    } finally {
      release();
      await holder;
      await other.$disconnect();
    }
    expect(await runFor(new Date())).toEqual({ skipped: false, opened: 1 });
  });
});

describe('the scheduled invoices job, edges', () => {
  it('sends invoice.sent only after the change commits, and only for invoices it opened', async () => {
    const due = await scheduled(nyDay(0));
    const canceled = await scheduled(nyDay(0));
    // Canceled after it was scheduled and before the run: only a row still SCHEDULED opens.
    await t.inScope(t.ids.firmA, (tx) =>
      tx.invoice.update({
        where: { id: canceled },
        data: { status: 'CANCELED', canceledAt: new Date() },
      }),
    );
    const notices = t.app.get(InvoiceNotices);
    const seen: { kind: string; businessId: string; id: string; status: string }[] = [];
    const spy = vi.spyOn(notices, 'send').mockImplementation(async (kind, businessId, id) => {
      // Another connection sees the change, so it has committed.
      seen.push({ kind, businessId, id, status: (await stateOf(id)).status });
    });
    try {
      await runFor(new Date());
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual([
      { kind: 'invoice.sent', businessId: t.ids.firmA, id: due, status: 'OPEN' },
    ]);
    expect((await stateOf(canceled)).status).toBe('CANCELED');
    expect(await openedAudits(canceled)).toHaveLength(0);
  });

  it('leaves a suspended firm alone', async () => {
    const id = await scheduled(nyDay(0), 'B');
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const setStatus = (status: 'ACTIVE' | 'SUSPENDED') =>
      runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.business.update({ where: { id: t.ids.firmB }, data: { status } }),
      );
    try {
      await setStatus('SUSPENDED');
      expect(await runFor(new Date(), t.ids.firmB)).toEqual({ skipped: false, opened: 0 });
      expect((await stateOf(id, t.ids.firmB)).status).toBe('SCHEDULED');
    } finally {
      await setStatus('ACTIVE');
      await owner.$disconnect();
    }
  });

  it('turns the day at local midnight on the day the clocks go back', async () => {
    // Nov 1 2026: New York goes from UTC-4 to UTC-5 at 02:00 local; midnight is 04:00 UTC.
    const id = await scheduled('2026-11-01');
    await runFor(new Date('2026-11-01T03:59:00.000Z'));
    expect((await stateOf(id)).status).toBe('SCHEDULED');
    await runFor(new Date('2026-11-01T04:01:00.000Z'));
    expect((await stateOf(id)).status).toBe('OPEN');
  });

  it('a timer run never rejects', async () => {
    const spy = vi.spyOn(jobs, 'run').mockRejectedValueOnce(new Error('boom'));
    try {
      await expect(jobs.tick()).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('invoiceJobsOn', () => {
  it('runs unless INVOICE_JOBS=off, and not in tests unless INVOICE_JOBS=on', () => {
    expect(invoiceJobsOn({ NODE_ENV: 'production' })).toBe(true);
    expect(invoiceJobsOn({ NODE_ENV: 'production', INVOICE_JOBS: 'off' })).toBe(false);
    expect(invoiceJobsOn({ NODE_ENV: 'test' })).toBe(false);
    expect(invoiceJobsOn({ NODE_ENV: 'test', INVOICE_JOBS: 'on' })).toBe(true);
  });

  it('refuses any other value, so a typo never leaves the job running', () => {
    for (const value of ['false', '0', 'OFF', 'yes']) {
      expect(() => invoiceJobsOn({ NODE_ENV: 'production', INVOICE_JOBS: value })).toThrow(
        'INVOICE_JOBS',
      );
    }
  });
});
