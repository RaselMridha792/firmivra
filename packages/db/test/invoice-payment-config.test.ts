// R36 (Invoices and Payments, r36_payment_settings): the firm's payment settings, what happens
// around an invoice outside its money (views, reminders, AutoPay retries, archiving), its activity
// timeline and the files sent with it. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
const ids = { otherClient: '', engagement: '', otherEngagement: '' };
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const draft = () =>
  firmA().invoice.create({ data: { ...A(), clientId: f.client, number: `INV-${++count}` } });
/** A canceled invoice: final, like a PAID one, so nothing about its money can change. */
const finalInvoice = async () => {
  const inv = await draft();
  return firmA().invoice.update({
    where: { id: inv.id },
    data: { status: 'CANCELED', canceledAt: new Date() },
  });
};
const document = (clientId: string, engagementId: string, data: Record<string, unknown> = {}) =>
  firmA().document.create({
    data: {
      ...A(),
      clientId,
      engagementId,
      direction: 'FIRM_TO_CLIENT',
      fileName: 'letter.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      sha256: 'c'.repeat(64),
      s3Key: `tenant/${f.firmA}/documents/${randomUUID()}`,
      ...data,
    },
  });
const clean = async (id: string) =>
  firmA().document.update({
    where: { id },
    data: { scanStatus: 'CLEAN', scannedAt: new Date() },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'pc');
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@pc.test`,
        name: 'Fake Staff',
      },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    await tx.membership.create({
      data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' },
    });
    ids.otherClient = (await tx.client.create({ data: { ...A(), displayName: 'Other' } })).id;
    const service = await tx.service.create({ data: { ...A(), kind: 'OTHER', name: 'Svc' } });
    for (const [key, clientId] of [
      ['engagement', f.client],
      ['otherEngagement', ids.otherClient],
    ] as const) {
      ids[key] = (
        await tx.engagement.create({
          data: { ...A(), clientId, serviceId: service.id, title: 'E' },
        })
      ).id;
    }
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('payment settings', () => {
  it("are one row per firm, with the screen's defaults", async () => {
    const row = await firmA().paymentSettings.create({ data: { ...A() } });
    expect(row).toMatchObject({
      acceptCard: true,
      acceptAch: true,
      acceptManual: true,
      autoReceipts: true,
      invoicePrefix: 'INV-',
      defaultTerms: 'net_14',
      dueSoonDays: 14,
      retryAttempts: 3,
      lateFeeEnabled: false,
      tippingEnabled: false,
      requirePaymentBeforeDue: false,
      portalPaymentsEnabled: true,
    });
    await expect(firmA().paymentSettings.create({ data: { ...A() } })).rejects.toThrow(/unique/i);
  });

  it('keep prefix, terms, memo and the day counts within bounds', async () => {
    const set = (data: Record<string, unknown>) =>
      firmA().paymentSettings.update({ where: { businessId: f.firmA }, data });
    await expect(set({ invoicePrefix: 'INVOICE-2026-X' })).rejects.toThrow(/check constraint/i);
    await expect(set({ invoicePrefix: 'IN V' })).rejects.toThrow(/check constraint/i);
    await expect(set({ invoicePrefix: '' })).resolves.toBeTruthy();
    await expect(set({ defaultTerms: 'Net 30' })).rejects.toThrow(/check constraint/i);
    await expect(set({ defaultMemo: 'x'.repeat(501) })).rejects.toThrow(/check constraint/i);
    await expect(set({ dueSoonDays: 0 })).rejects.toThrow(/check constraint/i);
    await expect(set({ retryAttempts: 11 })).rejects.toThrow(/check constraint/i);
    await expect(set({ reminderDaysBefore: 3, retryIntervalDays: 14 })).resolves.toBeTruthy();
  });

  it('a late fee is a percentage or a fixed amount, and switched on it needs one', async () => {
    const set = (data: Record<string, unknown>) =>
      firmA().paymentSettings.update({ where: { businessId: f.firmA }, data });
    await expect(set({ lateFeeEnabled: true })).rejects.toThrow(/check constraint/i);
    await expect(set({ lateFeeType: 'PERCENT' })).rejects.toThrow(/check constraint/i);
    await expect(set({ lateFeeType: 'PERCENT', lateFeePercent: 0 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(set({ lateFeeType: 'PERCENT', lateFeePercent: 101 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      set({ lateFeeType: 'PERCENT', lateFeePercent: 2, lateFeeCents: 500 }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      set({ lateFeeEnabled: true, lateFeeType: 'PERCENT', lateFeePercent: 2 }),
    ).resolves.toBeTruthy();
    await expect(
      set({ lateFeeType: 'FIXED', lateFeePercent: null, lateFeeCents: 2500 }),
    ).resolves.toMatchObject({ lateFeeCents: 2500 });
    await expect(set({ lateFeeType: 'FIXED', lateFeeCents: 0 })).rejects.toThrow(
      /check constraint/i,
    );
  });

  it('name the member who changed them, from this firm', async () => {
    const set = (updatedByUserId: string) =>
      firmA().paymentSettings.update({ where: { businessId: f.firmA }, data: { updatedByUserId } });
    await expect(set(randomUUID())).rejects.toThrow(/foreign key/i);
    await expect(set(staff)).resolves.toBeTruthy();
  });
});

describe('invoice tracking', () => {
  it('records views, reminders and AutoPay retries, even on a final invoice', async () => {
    const inv = await finalInvoice();
    const t = { ...A(), invoiceId: inv.id };
    const row = await firmA().invoiceTracking.create({
      data: {
        ...t,
        firstViewedAt: new Date('2026-10-01'),
        lastViewedAt: new Date('2026-10-02'),
        viewCount: 2,
      },
    });
    await expect(
      firmA().invoiceTracking.update({
        where: { invoiceId: row.invoiceId },
        data: {
          reminderCount: 1,
          lastReminderAt: new Date(),
          autopayAttempts: 1,
          autopayFailureCode: 'card_declined',
        },
      }),
    ).resolves.toMatchObject({ reminderCount: 1, autopayFailureCode: 'card_declined' });
    await expect(firmA().invoiceTracking.create({ data: t })).rejects.toThrow(/unique/i);
  });

  it('keeps the view fields consistent and the failure code a code', async () => {
    const make = async (data: Record<string, unknown>) =>
      firmA().invoiceTracking.create({ data: { ...A(), invoiceId: (await draft()).id, ...data } });
    await expect(make({ viewCount: 1 })).rejects.toThrow(/check constraint/i);
    await expect(make({ firstViewedAt: new Date(), viewCount: 1 })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      make({
        firstViewedAt: new Date('2026-10-02'),
        lastViewedAt: new Date('2026-10-01'),
        viewCount: 1,
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(make({ autopayFailureCode: 'Card was declined!' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(make({ viewCount: -1 })).rejects.toThrow(/check constraint/i);
  });

  it('archives with the member who did it, both or neither', async () => {
    const make = async (data: Record<string, unknown>) =>
      firmA().invoiceTracking.create({ data: { ...A(), invoiceId: (await draft()).id, ...data } });
    await expect(make({ archivedAt: new Date() })).rejects.toThrow(/check constraint/i);
    await expect(make({ archivedByUserId: randomUUID() })).rejects.toThrow(/check constraint/i);
    await expect(make({ archivedAt: new Date(), archivedByUserId: randomUUID() })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(make({ archivedAt: new Date(), archivedByUserId: staff })).resolves.toBeTruthy();
  });
});

describe('invoice events', () => {
  const event = async (data: Record<string, unknown>, invoiceId?: string) =>
    firmA().invoiceEvent.create({
      data: {
        ...A(),
        invoiceId: invoiceId ?? (await draft()).id,
        type: 'NOTE',
        actorUserId: staff,
        ...data,
      },
    });

  it('record staff notes and system events, on a final invoice too', async () => {
    const inv = await finalInvoice();
    await expect(event({ body: 'Chased by phone' }, inv.id)).resolves.toMatchObject({
      actorKind: 'STAFF',
    });
    await expect(
      event({ type: 'REMINDER_SENT', actorKind: 'SYSTEM', actorUserId: null }, inv.id),
    ).resolves.toBeTruthy();
    await expect(
      event({ type: 'VIEWED', actorKind: 'CLIENT', actorUserId: null }, inv.id),
    ).resolves.toBeTruthy();
  });

  it('a note has its text; staff events name a member and others never do', async () => {
    await expect(event({})).rejects.toThrow(/check constraint/i);
    await expect(event({ body: '   ' })).rejects.toThrow(/check constraint/i);
    await expect(event({ type: 'ACTIVITY_LOGGED', body: 'x'.repeat(2001) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(event({ type: 'SENT', actorUserId: null })).rejects.toThrow(/check constraint/i);
    await expect(event({ type: 'VIEWED', actorKind: 'CLIENT' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(event({ type: 'SENT', actorUserId: randomUUID() })).rejects.toThrow(
      /foreign key/i,
    );
  });

  it('are never changed or deleted by the app', async () => {
    const e = await event({ body: 'Keep me' });
    await expect(
      firmA().invoiceEvent.update({ where: { id: e.id }, data: { body: 'Changed' } }),
    ).rejects.toThrow(/permission denied/i);
    await expect(firmA().invoiceEvent.deleteMany({ where: { id: e.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('invoice attachments', () => {
  const attach = (invoiceId: string, documentId: string) =>
    firmA().invoiceAttachment.create({
      data: { ...A(), invoiceId, documentId, addedByUserId: staff },
    });

  it("take the invoice client's own clean, shared document, once", async () => {
    const inv = await draft();
    const doc = await document(f.client, ids.engagement);
    await expect(attach(inv.id, doc.id)).rejects.toThrow(/clean, shared document/); // still PENDING
    await clean(doc.id);
    await expect(attach(inv.id, doc.id)).resolves.toBeTruthy();
    await expect(attach(inv.id, doc.id)).rejects.toThrow(/unique/i);
  });

  it("refuse another client's document and an internal one", async () => {
    const inv = await draft();
    const theirs = await clean((await document(ids.otherClient, ids.otherEngagement)).id);
    await expect(attach(inv.id, theirs.id)).rejects.toThrow(/clean, shared document/);
    const internal = await clean(
      (await document(f.client, ids.engagement, { direction: 'INTERNAL' })).id,
    );
    await expect(attach(inv.id, internal.id)).rejects.toThrow(/clean, shared document/);
  });

  it('change only while the invoice can: removable on a draft, frozen once canceled', async () => {
    const inv = await draft();
    const doc = await clean((await document(f.client, ids.engagement)).id);
    const row = await attach(inv.id, doc.id);
    await firmA().invoiceAttachment.delete({ where: { id: row.id } });
    const again = await attach(inv.id, doc.id);
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    await expect(firmA().invoiceAttachment.delete({ where: { id: again.id } })).rejects.toThrow(
      /keeps its files/,
    );
    const other = await clean((await document(f.client, ids.engagement)).id);
    await expect(attach(inv.id, other.id)).rejects.toThrow(/keeps its files/);
  });
});

describe('isolation between firms', () => {
  it('payment settings, tracking, events and attachments are invisible to another firm', async () => {
    const inv = await draft();
    await firmA().invoiceTracking.create({ data: { ...A(), invoiceId: inv.id } });
    await firmA().invoiceEvent.create({
      data: { ...A(), invoiceId: inv.id, type: 'SENT', actorUserId: staff },
    });
    const doc = await clean((await document(f.client, ids.engagement)).id);
    await firmA().invoiceAttachment.create({
      data: { ...A(), invoiceId: inv.id, documentId: doc.id },
    });
    await firmB().paymentSettings.create({ data: { businessId: f.firmB } });
    const tables = [
      'payment_settings',
      'invoice_tracking',
      'invoice_events',
      'invoice_attachments',
    ];
    // Firm B has rows of its own only in settings; the others it must simply not see of A's.
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['payment_settings']);
    for (const table of tables.slice(1)) {
      const rows = await runInScope(app, { kind: 'business', businessId: f.firmB }, (tx) =>
        tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table}`),
      );
      expect(rows[0]?.n, table).toBe(0);
    }
    await expect(
      firmB().invoiceEvent.create({
        data: { ...A(), invoiceId: inv.id, type: 'SENT', actorKind: 'SYSTEM' },
      }),
    ).rejects.toThrow(/row-level security/i);
    // Nor can firm B track firm A's invoice (same-firm foreign key).
    const untracked = await draft();
    await expect(
      firmB().invoiceTracking.create({ data: { businessId: f.firmB, invoiceId: untracked.id } }),
    ).rejects.toThrow(/foreign key/i);
  });
});
