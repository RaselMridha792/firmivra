// R0 step 10 rules: the database keeps invoice totals, invoices follow their status rules and
// become PAID only when payments confirmed by a recorded processor event cover the total, a
// webhook event is processed once, and content and calculators keep their shape. App role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', client: '', otherClient: '' };
/** A fake Stripe connected account id (acct_ + letters and digits). */
/** Stripe ids have no hyphens. */
const stripeId = () => randomUUID().replace(/-/g, '');
const newAccountId = () => `acct_${stripeId()}`;
const accounts = { A: newAccountId(), B: newAccountId() };
let invoiceNumber = 0;

const firmA = () => db.forBusiness(ids.firmA);
const A = () => ({ businessId: ids.firmA });
const draft = () =>
  firmA().invoice.create({
    data: { ...A(), clientId: ids.client, number: `INV-${++invoiceNumber}` },
  });
const addLine = (invoiceId: string, unitAmountCents: number, quantity = 1) =>
  firmA().invoiceLine.create({
    data: { ...A(), invoiceId, description: 'Service', unitAmountCents, quantity },
  });
const total = async (id: string) =>
  (await firmA().invoice.findUniqueOrThrow({ where: { id } })).totalCents;
/** An issued invoice for $100. */
const openInvoice = async () => {
  const inv = await draft();
  await addLine(inv.id, 10000);
  return firmA().invoice.update({
    where: { id: inv.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
};
const pay = (invoiceId: string, amountCents = 10000, accountId = accounts.A) =>
  firmA().payment.create({
    data: { ...A(), invoiceId, amountCents, processorRef: `cs_${stripeId()}`, accountId },
  });
const recordEvent = (
  paymentId: string | null,
  accountId = accounts.A,
  type = 'checkout.session.completed',
) =>
  firmA().paymentEvent.create({
    data: { ...A(), processorEventId: `evt_${stripeId()}`, type, paymentId, accountId },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `ba-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `bb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    ids.client = (await tx.client.create({ data: { ...A(), displayName: 'One' } })).id;
    ids.otherClient = (await tx.client.create({ data: { ...A(), displayName: 'Two' } })).id;
  });
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.stripeAccount.create({
      data: {
        ...A(),
        accountId: accounts.A,
        onboardingStatus: 'COMPLETE',
        chargesEnabled: true,
        payoutsEnabled: true,
      },
    });
    await tx.stripeAccount.create({
      data: { businessId: ids.firmB, accountId: accounts.B, chargesEnabled: true },
    });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('invoice totals', () => {
  it('the database adds up the lines and applies the discount', async () => {
    const inv = await draft();
    await addLine(inv.id, 3333, 1.5); // 4999.5 rounds to 5000
    const second = await addLine(inv.id, 2000);
    // A discount is set once there are lines: it can never exceed the subtotal.
    await firmA().invoice.update({ where: { id: inv.id }, data: { discountCents: 500 } });
    expect(await total(inv.id)).toBe(5000 + 2000 - 500);
    await firmA().invoiceLine.delete({ where: { id: second.id } });
    expect(await total(inv.id)).toBe(4500);
  });

  it('the app cannot set the subtotal, and a discount cannot exceed it', async () => {
    const inv = await draft();
    await addLine(inv.id, 1000);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { subtotalCents: 1 } }),
    ).rejects.toThrow(/kept by the database/);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { discountCents: 2000 } }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('a new invoice starts as an empty draft', async () => {
    await expect(
      firmA().invoice.create({
        data: { ...A(), clientId: ids.client, number: `INV-${++invoiceNumber}`, status: 'OPEN' },
      }),
    ).rejects.toThrow(/empty DRAFT/);
  });
});

describe('invoice status', () => {
  it('lines and amounts are fixed once issued', async () => {
    const inv = await openInvoice();
    await expect(addLine(inv.id, 100)).rejects.toThrow(/draft or scheduled/);
    await expect(firmA().invoiceLine.deleteMany({ where: { invoiceId: inv.id } })).rejects.toThrow(
      /draft or scheduled/,
    );
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { discountCents: 100 } }),
    ).rejects.toThrow(/keeps its number/);
    await expect(
      firmA().invoice.update({ where: { id: inv.id }, data: { clientId: ids.otherClient } }),
    ).rejects.toThrow(/client of an invoice cannot change/);
  });

  it('moves only along the allowed paths', async () => {
    const inv = await draft();
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      }),
    ).rejects.toThrow(/cannot go from DRAFT to PAID/);
    const open = await openInvoice();
    await expect(
      firmA().invoice.update({ where: { id: open.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow(/cannot go from OPEN to DRAFT/);
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'SCHEDULED' },
      }),
    ).rejects.toThrow(/check constraint/i);
  });

  it('is PAID only when succeeded payments cover the total; then final', async () => {
    const inv = await openInvoice();
    const markPaid = () =>
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
    await expect(markPaid()).rejects.toThrow(/covering the total/);

    const p = await pay(inv.id);
    await expect(markPaid()).rejects.toThrow(/covering the total/);
    await recordEvent(p.id);
    await firmA().payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    await expect(markPaid()).resolves.toMatchObject({ status: 'PAID' });
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      }),
    ).rejects.toThrow(/final/);
    await expect(firmA().invoice.deleteMany({ where: { id: inv.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('payments and webhook events', () => {
  it('a payment starts PENDING on an open invoice', async () => {
    const d = await draft();
    await expect(pay(d.id)).rejects.toThrow(/only an open invoice/);
    const inv = await openInvoice();
    await expect(
      firmA().payment.create({
        data: {
          ...A(),
          invoiceId: inv.id,
          amountCents: 10000,
          processorRef: `cs_${stripeId()}`,
          accountId: accounts.A,
          status: 'SUCCEEDED',
          paidAt: new Date(),
        },
      }),
    ).rejects.toThrow(/starts PENDING/);
  });

  it('succeeds only on a recorded processor event, and never changes amount', async () => {
    const p = await pay((await openInvoice()).id);
    await expect(
      firmA().payment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      }),
    ).rejects.toThrow(/recorded success event/);
    await expect(
      firmA().payment.update({ where: { id: p.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow(/cannot change/);
    await firmA().payment.update({
      where: { id: p.id },
      data: { status: 'FAILED', failureCode: 'card_declined' },
    });
    await expect(
      firmA().payment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      }),
    ).rejects.toThrow(/cannot go from FAILED to SUCCEEDED/);
  });

  it('a duplicate event is refused; an event is processed once', async () => {
    const p = await pay((await openInvoice()).id);
    const eventId = `evt_${stripeId()}`;
    const record = () =>
      firmA().paymentEvent.create({
        data: {
          ...A(),
          processorEventId: eventId,
          accountId: accounts.A,
          type: 'checkout.session.completed',
          paymentId: p.id,
        },
      });
    const e = await record();
    await expect(record()).rejects.toThrow(/unique constraint/i);
    await firmA().paymentEvent.update({ where: { id: e.id }, data: { processedAt: new Date() } });
    for (const data of [
      { processedAt: new Date(Date.now() + 1000) },
      { type: 'charge.refunded' },
    ]) {
      await expect(firmA().paymentEvent.update({ where: { id: e.id }, data })).rejects.toThrow(
        /recorded once/,
      );
    }
    await expect(firmA().paymentEvent.deleteMany({ where: { id: e.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('Stripe Connect: each firm is paid into its own account', () => {
  it("a payment runs only on the firm's own account, with charges enabled", async () => {
    const inv = await openInvoice();
    await expect(pay(inv.id, 10000, accounts.B)).rejects.toThrow(/own connected account/);
    await expect(pay(inv.id, 10000, newAccountId())).rejects.toThrow(/own connected account/);

    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.stripeAccount.update({
        where: { businessId: ids.firmA },
        data: { chargesEnabled: false, onboardingStatus: 'RESTRICTED' },
      }),
    );
    try {
      await expect(pay(inv.id)).rejects.toThrow(/charges enabled/);
    } finally {
      await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.stripeAccount.update({
          where: { businessId: ids.firmA },
          data: { chargesEnabled: true, onboardingStatus: 'COMPLETE' },
        }),
      );
    }
  });

  it("an event from another firm's account cannot be recorded or mark anything paid", async () => {
    const inv = await openInvoice();
    const p = await pay(inv.id);
    // Firm B's account sending an event into firm A's scope is refused outright.
    await expect(recordEvent(p.id, accounts.B)).rejects.toThrow(/own connected account/);
    await expect(recordEvent(null, accounts.B)).rejects.toThrow(/own connected account/);
    await expect(
      firmA().payment.update({
        where: { id: p.id },
        data: { status: 'SUCCEEDED', paidAt: new Date() },
      }),
    ).rejects.toThrow(/recorded success event/);

    // In firm B's own scope, with B's own account, firm A's payment is out of reach.
    await expect(
      db.forBusiness(ids.firmB).paymentEvent.create({
        data: {
          businessId: ids.firmB,
          processorEventId: `evt_${stripeId()}`,
          type: 'checkout.session.completed',
          accountId: accounts.B,
          paymentId: p.id,
        },
      }),
    ).rejects.toThrow();

    // From the firm's own account, the full path works.
    await recordEvent(p.id);
    await firmA().payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
    await expect(
      firmA().invoice.update({
        where: { id: inv.id },
        data: { status: 'PAID', paidAt: new Date() },
      }),
    ).resolves.toMatchObject({ status: 'PAID' });
  });

  it('one account per firm, never shared, never changed; the platform can read it', async () => {
    const platform = db.forPlatform();
    await expect(
      platform.stripeAccount.create({
        data: { businessId: ids.firmB, accountId: newAccountId() },
      }),
    ).rejects.toThrow(/unique constraint/i);
    await expect(
      platform.stripeAccount.update({
        where: { businessId: ids.firmA },
        data: { accountId: newAccountId() },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      platform.stripeAccount.update({
        where: { businessId: ids.firmA },
        data: { onboardingStatus: 'COMPLETE', payoutsEnabled: false },
      }),
    ).rejects.toThrow(/check constraint/i);
    expect(await db.forBusiness(ids.firmB).stripeAccount.findMany()).toHaveLength(1);
    const seen = (await platform.stripeAccount.findMany()).map((a) => a.accountId);
    expect(seen).toEqual(expect.arrayContaining([accounts.A, accounts.B]));
  });

  it('a firm reads its account but never creates or changes it', async () => {
    const firmC = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug: `bc-${run}`, name: 'C' } }),
    );
    await expect(
      db.forBusiness(firmC.id).stripeAccount.create({
        data: { businessId: firmC.id, accountId: newAccountId(), chargesEnabled: true },
      }),
    ).rejects.toThrow(/row-level security/i);
    expect(
      (
        await firmA().stripeAccount.updateMany({
          where: { businessId: ids.firmA },
          data: { chargesEnabled: false },
        })
      ).count,
    ).toBe(0);
    expect(
      await firmA().stripeAccount.findUnique({ where: { businessId: ids.firmA } }),
    ).toMatchObject({ chargesEnabled: true });
  });
});

describe('lead review of #48: event types, set-once fields, frozen invoices', () => {
  /** A PENDING payment of $100 on a new open invoice. */
  const pending = async () => {
    const inv = await openInvoice();
    return { inv, p: await pay(inv.id) };
  };
  const setPayment = (id: string, data: Record<string, unknown>) =>
    firmA().payment.update({ where: { id }, data });

  it('a failure event never makes a payment SUCCEEDED; a refund needs a refund event', async () => {
    const { p } = await pending();
    await recordEvent(p.id, accounts.A, 'payment_intent.payment_failed');
    await expect(setPayment(p.id, { status: 'SUCCEEDED', paidAt: new Date() })).rejects.toThrow(
      /success event/,
    );
    await recordEvent(p.id, accounts.A, 'payment_intent.succeeded');
    await setPayment(p.id, { status: 'SUCCEEDED', paidAt: new Date() });
    // REFUNDED comes only from confirmed refund rows (see the refunds tests).
    await recordEvent(p.id, accounts.A, 'charge.refunded');
    await expect(setPayment(p.id, { status: 'REFUNDED', refundedAt: new Date() })).rejects.toThrow(
      /set by the database/,
    );
  });

  it('paid_at, refunded_at and failure_code are set once', async () => {
    const { p } = await pending();
    await recordEvent(p.id);
    await setPayment(p.id, { status: 'SUCCEEDED', paidAt: new Date() });
    await expect(setPayment(p.id, { paidAt: new Date('2001-01-01') })).rejects.toThrow(/set once/);

    const failed = (await pending()).p;
    await expect(setPayment(failed.id, { failureCode: 'card_declined' })).rejects.toThrow(
      /check constraint/i,
    );
    await setPayment(failed.id, { status: 'FAILED', failureCode: 'card_declined' });
    await expect(setPayment(failed.id, { failureCode: 'expired_card' })).rejects.toThrow(
      /set once/,
    );
  });

  it('Stripe ids have a prefix and no spaces', async () => {
    const inv = await openInvoice();
    await expect(
      firmA().payment.create({
        data: {
          ...A(),
          invoiceId: inv.id,
          amountCents: 100,
          processorRef: 'not a ref',
          accountId: accounts.A,
        },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      recordEvent(null, accounts.A, 'checkout.session.completed').then(() => undefined),
    ).resolves.toBeUndefined();
  });

  it('a paid invoice is frozen, including its reason, schedule and author', async () => {
    const { inv, p } = await pending();
    await recordEvent(p.id);
    await setPayment(p.id, { status: 'SUCCEEDED', paidAt: new Date() });
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { status: 'PAID', paidAt: new Date() },
    });
    for (const data of [
      { scheduledFor: new Date('2026-12-01') },
      { cancelReason: 'Changed after payment' },
      { dueOn: new Date('2027-01-01') },
    ]) {
      await expect(firmA().invoice.update({ where: { id: inv.id }, data })).rejects.toThrow(
        /final/,
      );
    }
  });

  it('cancel_reason only on a canceled invoice; nothing to pay means nothing to issue', async () => {
    const d = await draft();
    await expect(
      firmA().invoice.update({ where: { id: d.id }, data: { cancelReason: 'Duplicate' } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().invoice.update({
        where: { id: d.id },
        data: { status: 'OPEN', issuedAt: new Date() },
      }),
    ).rejects.toThrow(/amount to pay/);
    await expect(
      firmA().invoice.update({
        where: { id: d.id },
        data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: 'Duplicate' },
      }),
    ).resolves.toMatchObject({ status: 'CANCELED' });
  });
});

describe('refunds: one row per Stripe refund, confirmed by its event', () => {
  /** A succeeded $100 payment. */
  const succeeded = async () => {
    const inv = await openInvoice();
    const p = await pay(inv.id);
    await recordEvent(p.id);
    return firmA().payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
  };
  const refund = (
    paymentId: string,
    amountCents: number,
    data: { status?: 'PENDING' | 'SUCCEEDED'; eventId?: string; accountId?: string } = {},
  ) =>
    firmA().paymentRefund.create({
      data: {
        ...A(),
        paymentId,
        processorRefundId: `re_${stripeId()}`,
        accountId: accounts.A,
        amountCents,
        ...data,
        ...(data.status === 'SUCCEEDED' ? { refundedAt: new Date() } : {}),
      },
    });
  const confirm = async (refundId: string, paymentId: string) => {
    const e = await recordEvent(paymentId, accounts.A, 'charge.refunded');
    return firmA().paymentRefund.update({
      where: { id: refundId },
      data: { status: 'SUCCEEDED', eventId: e.id, refundedAt: new Date() },
    });
  };
  const paymentStatus = async (id: string) =>
    (await firmA().payment.findUniqueOrThrow({ where: { id } })).status;

  it('only a succeeded payment, in its own account, never more than the payment', async () => {
    const inv = await openInvoice();
    const pendingPayment = await pay(inv.id);
    await expect(refund(pendingPayment.id, 1000)).rejects.toThrow(/succeeded payment/);

    const p = await succeeded();
    await expect(refund(p.id, 1000, { accountId: accounts.B })).rejects.toThrow(/own account/);
    await refund(p.id, 6000);
    await expect(refund(p.id, 5000)).rejects.toThrow(/more than the payment/);
    await expect(refund(p.id, 4000)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it("counts only once Stripe's charge.refunded event of this payment confirms it", async () => {
    const p = await succeeded();
    const r = await refund(p.id, 2500);
    const other = await succeeded();
    const otherEvent = await recordEvent(other.id, accounts.A, 'charge.refunded');
    const wrongType = await recordEvent(p.id, accounts.A, 'payment_intent.succeeded');
    for (const eventId of [otherEvent.id, wrongType.id]) {
      await expect(
        firmA().paymentRefund.update({
          where: { id: r.id },
          data: { status: 'SUCCEEDED', eventId, refundedAt: new Date() },
        }),
      ).rejects.toThrow(/charge.refunded event of this payment/);
    }
    await expect(confirm(r.id, p.id)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(await paymentStatus(p.id)).toBe('SUCCEEDED');
  });

  it("a refund made in the firm's Stripe dashboard is recorded straight from its event", async () => {
    const p = await succeeded();
    const e = await recordEvent(p.id, accounts.A, 'charge.refunded');
    await expect(refund(p.id, 1500, { status: 'SUCCEEDED', eventId: e.id })).resolves.toMatchObject(
      { status: 'SUCCEEDED' },
    );
  });

  it('the database marks the payment REFUNDED once confirmed refunds cover it all', async () => {
    const p = await succeeded();
    const part = await refund(p.id, 4000);
    const rest = await refund(p.id, 6000);
    await confirm(part.id, p.id);
    expect(await paymentStatus(p.id)).toBe('SUCCEEDED');
    await confirm(rest.id, p.id);
    const done = await firmA().payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(done).toMatchObject({ status: 'REFUNDED' });
    expect(done.refundedAt).not.toBeNull();
    const invoice = await firmA().invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
    expect(invoice.status).toBe('OPEN');
  });

  it('a failed refund frees its amount; SUCCEEDED and FAILED are final; never deleted', async () => {
    const p = await succeeded();
    const r = await refund(p.id, 10000);
    await firmA().paymentRefund.update({ where: { id: r.id }, data: { status: 'FAILED' } });
    await expect(refund(p.id, 10000)).resolves.toMatchObject({ status: 'PENDING' });
    await expect(
      firmA().paymentRefund.update({ where: { id: r.id }, data: { status: 'PENDING' } }),
    ).rejects.toThrow(/final/);
    await expect(
      firmA().paymentRefund.update({ where: { id: r.id }, data: { amountCents: 1 } }),
    ).rejects.toThrow(/cannot change/);
    await expect(firmA().paymentRefund.deleteMany({ where: { id: r.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('refunds: review of #52 (one event each, races, nits)', () => {
  const succeeded = async () => {
    const inv = await openInvoice();
    const p = await pay(inv.id);
    await recordEvent(p.id);
    return firmA().payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', paidAt: new Date() },
    });
  };
  const refundData = (paymentId: string, amountCents: number) => ({
    ...A(),
    paymentId,
    processorRefundId: `re_${stripeId()}`,
    accountId: accounts.A,
    amountCents,
  });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('one Stripe event confirms one refund', async () => {
    const p = await succeeded();
    const e = await recordEvent(p.id, accounts.A, 'charge.refunded');
    const confirmed = { status: 'SUCCEEDED' as const, eventId: e.id, refundedAt: new Date() };
    await firmA().paymentRefund.create({ data: { ...refundData(p.id, 1000), ...confirmed } });
    await expect(
      firmA().paymentRefund.create({ data: { ...refundData(p.id, 1000), ...confirmed } }),
    ).rejects.toThrow(/unique constraint/i);
  });

  it('two confirmations at once still mark the payment REFUNDED', async () => {
    const p = await succeeded();
    const part = await firmA().paymentRefund.create({ data: refundData(p.id, 4000) });
    const rest = await firmA().paymentRefund.create({ data: refundData(p.id, 6000) });
    const e1 = await recordEvent(p.id, accounts.A, 'charge.refunded');
    const e2 = await recordEvent(p.id, accounts.A, 'charge.refunded');
    const confirm = (id: string, eventId: string, holdMs: number) =>
      db.withScope({ kind: 'business', businessId: ids.firmA }, async (tx) => {
        await tx.paymentRefund.update({
          where: { id },
          data: { status: 'SUCCEEDED', eventId, refundedAt: new Date() },
        });
        await sleep(holdMs);
      });
    const first = confirm(part.id, e1.id, 400);
    await sleep(100);
    await Promise.all([first, confirm(rest.id, e2.id, 0)]);
    expect((await firmA().payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe(
      'REFUNDED',
    );
  });

  it('under REPEATABLE READ a second confirmation at once fails to serialize, never misses the first', async () => {
    const p = await succeeded();
    const part = await firmA().paymentRefund.create({ data: refundData(p.id, 4000) });
    const rest = await firmA().paymentRefund.create({ data: refundData(p.id, 6000) });
    const e1 = await recordEvent(p.id, accounts.A, 'charge.refunded');
    const e2 = await recordEvent(p.id, accounts.A, 'charge.refunded');
    const confirm = (id: string, eventId: string, holdMs: number) =>
      owner.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.scope', 'business', true),
            set_config('app.current_business_id', ${ids.firmA}, true)`;
          await tx.paymentRefund.update({
            where: { id },
            data: { status: 'SUCCEEDED', eventId, refundedAt: new Date() },
          });
          await sleep(holdMs);
        },
        { isolationLevel: 'RepeatableRead', maxWait: 15_000, timeout: 60_000 },
      );
    const first = confirm(part.id, e1.id, 400);
    await sleep(100);
    const results = await Promise.allSettled([first, confirm(rest.id, e2.id, 0)]);
    // Under load either one may win; never both (the old lock let both through).
    const won = results.findIndex((r) => r.status === 'fulfilled');
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    // The webhook retries the other; until then the payment is honestly part-refunded.
    const after = await firmA().payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe('SUCCEEDED');
    const confirmed = await firmA().paymentRefund.findMany({
      where: { paymentId: p.id, status: 'SUCCEEDED' },
    });
    expect(confirmed.map((r) => r.amountCents)).toEqual([won === 0 ? 4000 : 6000]);
  });

  it('two refunds at once never exceed the payment, even under REPEATABLE READ', async () => {
    const p = await succeeded();
    const refundAt = (holdMs: number) =>
      owner.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.scope', 'business', true),
            set_config('app.current_business_id', ${ids.firmA}, true)`;
          await tx.paymentRefund.create({ data: refundData(p.id, 7000) });
          await sleep(holdMs);
        },
        { isolationLevel: 'RepeatableRead', maxWait: 15_000, timeout: 60_000 },
      );
    const first = refundAt(400);
    await sleep(100);
    const results = await Promise.allSettled([first, refundAt(0)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const after = await firmA().payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.refundReservedCents).toBe(7000);
    expect(await firmA().paymentRefund.count({ where: { paymentId: p.id } })).toBe(1);
  });

  it('the reserve is kept by the database; an event and a time only on SUCCEEDED; Stripe ids', async () => {
    const p = await succeeded();
    await expect(
      firmA().payment.update({ where: { id: p.id }, data: { refundReservedCents: 0 } }),
    ).resolves.toBeDefined();
    await expect(
      firmA().payment.update({ where: { id: p.id }, data: { refundReservedCents: 5 } }),
    ).rejects.toThrow(/kept by the database/);
    const e = await recordEvent(p.id, accounts.A, 'charge.refunded');
    await expect(
      firmA().paymentRefund.create({ data: { ...refundData(p.id, 100), eventId: e.id } }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().paymentRefund.create({
        data: { ...refundData(p.id, 100), processorRefundId: `pi_${stripeId()}` },
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      firmA().paymentRefund.create({
        data: {
          ...refundData(p.id, 100),
          status: 'SUCCEEDED',
          eventId: e.id,
          refundedAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toThrow(/future/);
  });
});

describe('content and calculators', () => {
  const item = (data: { kind: 'RESOURCE' | 'EXTERNAL_LINK'; url?: string; body?: string }) =>
    firmA().contentItem.create({ data: { ...A(), title: 'Item', ...data } });

  it('content has size limits', async () => {
    for (const data of [
      { title: 'x'.repeat(201), body: 'Body' },
      { title: 'Title', body: 'x'.repeat(20001) },
      { title: 'Title', body: 'Body', category: ' ' },
    ]) {
      await expect(
        firmA().contentItem.create({ data: { ...A(), kind: 'RESOURCE', ...data } }),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it('an external link is an https URL; a resource has a body', async () => {
    await expect(item({ kind: 'EXTERNAL_LINK', url: 'http://example.test' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(item({ kind: 'EXTERNAL_LINK' })).rejects.toThrow(/check constraint/i);
    await expect(item({ kind: 'RESOURCE' })).rejects.toThrow(/check constraint/i);
    await expect(
      item({ kind: 'EXTERNAL_LINK', url: 'https://www.irs.gov/' }),
    ).resolves.toBeDefined();
  });

  it('an external link icon is a design-system icon name, never a URL', async () => {
    const link = (iconKey: string) =>
      firmA().contentItem.create({
        data: {
          ...A(),
          kind: 'EXTERNAL_LINK',
          category: 'IRS & Business Taxes',
          title: 'IRS EIN',
          url: 'https://www.irs.gov/ein',
          iconKey,
        },
      });
    await expect(link('https://evil.test/icon.png')).rejects.toThrow(/check constraint/i);
    await expect(link('irs')).resolves.toMatchObject({ iconKey: 'irs' });
  });

  it('a calculator needs a disclaimer and a key, once per firm', async () => {
    const calc = (key: string, disclaimer: string) =>
      firmA().calculatorDefinition.create({ data: { ...A(), key, title: 'Calc', disclaimer } });
    await expect(calc('tax_return', ' ')).rejects.toThrow(/check constraint/i);
    await expect(calc('Tax Return', 'Estimate only')).rejects.toThrow(/check constraint/i);
    await calc('tax_return', 'Estimate only');
    await expect(calc('tax_return', 'Estimate only')).rejects.toThrow(/unique constraint/i);
  });
});
