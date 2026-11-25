// R55 db batch (r55_db_batch): M20 timezone, portal files-only text, refund cap with tip, the ACH
// account flag and default off, refund.updated, other lead contact kinds. Synthetic data only.
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
const stripeId = () => randomUUID().replace(/-/g, '');
const account = `acct_${stripeId()}`;
let count = 0;
let leadId = '';
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);

const message = (data: Record<string, unknown> = {}) =>
  firmA().outboundMessage.create({
    data: {
      ...A(),
      kind: 'DIRECT',
      channel: 'PORTAL',
      body: 'Hi',
      createdByUserId: staff,
      ...data,
    },
  });

const openInvoice = async () => {
  const inv = await firmA().invoice.create({
    data: { ...A(), clientId: f.client, number: `INV-${++count}` },
  });
  await firmA().invoiceLine.create({
    data: { ...A(), invoiceId: inv.id, description: 'Service', unitAmountCents: 10000 },
  });
  return firmA().invoice.update({
    where: { id: inv.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
};
const event = (paymentId: string | null, type: string, accountId = account) =>
  firmA().paymentEvent.create({
    data: { ...A(), processorEventId: `evt_${stripeId()}`, type, paymentId, accountId },
  });
/** A succeeded $100 payment with `tipCents` of tip. */
const succeeded = async (tipCents = 0) => {
  const inv = await openInvoice();
  const p = await firmA().payment.create({
    data: {
      ...A(),
      invoiceId: inv.id,
      amountCents: 10000,
      tipCents,
      processorRef: `cs_${stripeId()}`,
      accountId: account,
    },
  });
  await event(p.id, 'checkout.session.completed');
  return firmA().payment.update({
    where: { id: p.id },
    data: { status: 'SUCCEEDED', paidAt: new Date() },
  });
};
const refund = (paymentId: string, amountCents: number) =>
  firmA().paymentRefund.create({
    data: {
      ...A(),
      paymentId,
      processorRefundId: `re_${stripeId()}`,
      accountId: account,
      amountCents,
    },
  });
const confirm = async (refundId: string, paymentId: string, type = 'charge.refunded') => {
  const e = await event(paymentId, type);
  return firmA().paymentRefund.update({
    where: { id: refundId },
    data: { status: 'SUCCEEDED', eventId: e.id, refundedAt: new Date() },
  });
};
const paymentStatus = async (id: string) =>
  (await firmA().payment.findUniqueOrThrow({ where: { id } })).status;
const point = (data: Record<string, unknown>) =>
  firmA().leadContactPoint.create({
    data: { ...A(), leadId, position: 0, ...data } as never,
  });

beforeAll(async () => {
  f = await createFirms(owner, 'r55b');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@r55b.test`,
        name: 'Fake Staff',
      },
    });
    await tx.stripeAccount.create({
      data: {
        ...A(),
        accountId: account,
        onboardingStatus: 'COMPLETE',
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    await tx.membership.create({
      data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' },
    });
    const service = await tx.service.create({
      data: { ...A(), kind: 'ANNUAL_TAX', name: 'Fake Tax' },
    });
    leadId = (
      await tx.lead.create({
        data: {
          ...A(),
          serviceId: service.id,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `l-${randomUUID()}@r55b.test`,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('M20: outbound_messages.timezone', () => {
  it('is nullable and keeps an IANA name; empty or 65 characters is refused', async () => {
    expect((await message()).timezone).toBeNull();
    expect(await message({ timezone: 'America/New_York' })).toMatchObject({
      timezone: 'America/New_York',
    });
    await expect(message({ timezone: '' })).rejects.toThrow(/outbound_messages_timezone/);
    await expect(message({ timezone: 'x'.repeat(65) })).rejects.toThrow(
      /outbound_messages_timezone/,
    );
    await expect(message({ timezone: 'x'.repeat(64) })).resolves.toBeTruthy();
  });
});

describe('M22: a portal message may be files only', () => {
  it('accepts an empty body on PORTAL and refuses it on EMAIL and SMS', async () => {
    await expect(message({ channel: 'PORTAL', body: '' })).resolves.toMatchObject({ body: '' });
    await expect(message({ channel: 'PORTAL', body: '   ' })).resolves.toBeTruthy();
    for (const channel of ['EMAIL', 'SMS'] as const) {
      await expect(message({ channel, body: '' })).rejects.toThrow(/outbound_messages_text/);
      await expect(message({ channel, body: '  ' })).rejects.toThrow(/outbound_messages_text/);
      await expect(message({ channel, body: 'Hello' })).resolves.toBeTruthy();
    }
  });

  it('keeps the length limits', async () => {
    await expect(message({ body: 'x'.repeat(10001) })).rejects.toThrow(/outbound_messages_text/);
    await expect(message({ subject: 'x'.repeat(201) })).rejects.toThrow(/outbound_messages_text/);
    await expect(message({ channel: 'SMS', body: 'x'.repeat(1601) })).rejects.toThrow(
      /outbound_messages_text/,
    );
    await expect(message({ channel: 'SMS', body: 'x'.repeat(1600) })).resolves.toBeTruthy();
  });
});

describe('refunds with a tip', () => {
  it('can reach amount + tip, and one more cent is refused', async () => {
    const p = await succeeded(500);
    await refund(p.id, 10500);
    await expect(refund(p.id, 1)).rejects.toThrow(/more than the payment and its tip/);
    const row = await firmA().payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.refundReservedCents).toBe(10500);
  });

  it('with no tip, the cap is the amount as before', async () => {
    const p = await succeeded();
    await expect(refund(p.id, 10001)).rejects.toThrow(/more than the payment and its tip/);
    await refund(p.id, 10000);
    await expect(refund(p.id, 1)).rejects.toThrow(/more than the payment and its tip/);
  });

  it('becomes REFUNDED only when confirmed refunds cover amount + tip', async () => {
    const p = await succeeded(500);
    const first = await refund(p.id, 10000);
    await confirm(first.id, p.id);
    expect(await paymentStatus(p.id)).toBe('SUCCEEDED');
    const second = await refund(p.id, 500);
    await confirm(second.id, p.id);
    expect(await paymentStatus(p.id)).toBe('REFUNDED');
  });

  it('a payment with no tip is REFUNDED by a refund of the amount', async () => {
    const p = await succeeded();
    await confirm((await refund(p.id, 10000)).id, p.id);
    expect(await paymentStatus(p.id)).toBe('REFUNDED');
  });
});

describe('refund.updated confirms a refund', () => {
  it('accepts a refund.updated event of the same payment and account', async () => {
    const p = await succeeded();
    const r = await refund(p.id, 2500);
    expect(await confirm(r.id, p.id, 'refund.updated')).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('refuses an event of another type or another payment', async () => {
    const p = await succeeded();
    const other = await succeeded();
    const r = await refund(p.id, 2500);
    const set = (eventId: string) =>
      firmA().paymentRefund.update({
        where: { id: r.id },
        data: { status: 'SUCCEEDED', eventId, refundedAt: new Date() },
      });
    const rule = /charge\.refunded or refund\.updated event/;
    await expect(set((await event(p.id, 'charge.succeeded')).id)).rejects.toThrow(rule);
    await expect(set((await event(other.id, 'refund.updated')).id)).rejects.toThrow(rule);
  });
});

describe('ACH', () => {
  it('stripe_accounts.ach_payments_active defaults to false', async () => {
    const row = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.stripeAccount.findUniqueOrThrow({ where: { accountId: account } }),
    );
    expect(row.achPaymentsActive).toBe(false);
  });

  it('payment_settings.accept_ach defaults to false for a new row', async () => {
    const row = await firmA().paymentSettings.create({ data: { ...A() } });
    expect(row).toMatchObject({ acceptAch: false, acceptCard: true, acceptManual: true });
  });

  it('the migration resets existing rows once, firm by firm', () => {
    // The migration cannot be re-run here, so the data effect is covered by the default test above
    // (a new row is false); this reads the SQL for the one-time reset itself.
    const sql = readFileSync(
      new URL('../prisma/migrations/20261120120000_r55_db_batch/migration.sql', import.meta.url),
      'utf8',
    );
    expect(sql).toMatch(
      /FOREACH firm IN ARRAY firms LOOP[\s\S]*?UPDATE payment_settings SET accept_ach = false WHERE business_id = firm AND accept_ach;[\s\S]*?END LOOP/,
    );
  });
});

describe('LeadContactKind', () => {
  it('keeps EMAIL and PHONE', async () => {
    await expect(
      point({ kind: 'EMAIL', value: `x-${randomUUID().slice(0, 6)}@r55b.test` }),
    ).resolves.toBeTruthy();
    await expect(point({ kind: 'PHONE', value: '555-0100' })).resolves.toBeTruthy();
  });

  it('accepts ADDRESS, WEBSITE and OTHER', async () => {
    for (const [kind, value] of [
      ['ADDRESS', '1 Fake Street'],
      ['WEBSITE', 'https://fake.example'],
      ['OTHER', 'Fake note'],
    ] as const) {
      await expect(point({ kind, value })).resolves.toMatchObject({ kind, value });
    }
  });

  it("keeps each kind's length limits and the same value once", async () => {
    const limits = { ADDRESS: 300, WEBSITE: 2048, OTHER: 300 } as const;
    for (const [kind, max] of Object.entries(limits)) {
      await expect(point({ kind, value: 'a'.repeat(max) })).resolves.toBeTruthy();
      await expect(point({ kind, value: 'a'.repeat(max + 1) })).rejects.toThrow(
        /lead_contact_points_shape/,
      );
      await expect(point({ kind, value: '' })).rejects.toThrow(/lead_contact_points_shape/);
    }
    await point({ kind: 'ADDRESS', value: '2 Fake Road' });
    await expect(point({ kind: 'ADDRESS', value: '2 FAKE ROAD' })).rejects.toThrow(/unique/i);
  });
});
