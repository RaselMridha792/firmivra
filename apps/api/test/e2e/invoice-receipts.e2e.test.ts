// End-to-end: Record Payment's Deposit To and receipts (R55; Octavia's Invoices & Payments review
// of Oct 27, IP-F12; Rasel, Oct 29). Deposit accounts are the firm's own. The client's receipt
// goes only with Automatic Receipts on or Send Receipt ticked, once per payment, after it
// succeeded; Send/Resend sends one each time. The firm's notice goes either way. Synthetic data.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DepositAccount, DepositAccountList } from '@firmivra/types';
import { InvoiceReceipts } from '../../src/payments/invoices/invoice-receipts.js';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
const PREFS = '/api/v1/business/settings/payment-preferences/deposit-accounts';

beforeAll(async () => {
  t = await startInvoiceApp('r55f12');
});
afterAll(async () => {
  await t.app.close();
});

/** Settings > Payments' deposit accounts, through the API. */
const accounts = async (
  method: 'get' | 'post' | 'put',
  path = '',
  body?: object,
  who: { email: string } = t.people.ownerA,
) => {
  const server = t.app.getHttpServer();
  const { token } = (
    await request(server).post('/api/v1/dev/token').send({ email: who.email }).expect(200)
  ).body as { token: string };
  const req = request(server)
    [method](`${PREFS}${path}`)
    .set('x-business-id', t.ids.firmA)
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
};
const open = async () => (await t.draft(t.ids.one, { status: 'OPEN' })).id;
const record = (invoiceId: string, extra: object = {}) =>
  t.firm('post', `/${invoiceId}/offline-payments`, t.people.ownerA, {
    method: 'CASH',
    amountCents: 1_000,
    receivedOn: nyDay(0),
    idempotencyKey: randomUUID(),
    ...extra,
  });
const autoReceipts = (on: boolean) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.paymentSettings.upsert({
      where: { businessId: t.ids.firmA },
      create: { businessId: t.ids.firmA, autoReceipts: on },
      update: { autoReceipts: on },
    }),
  );
/** The client's receipt emails and the firm's bell items for the invoice's payments. */
const sent = (invoiceId: string) =>
  t.inScope(t.ids.firmA, async (tx) => {
    const where = { businessId: t.ids.firmA, type: 'payment.received', entityId: invoiceId };
    return {
      receipts: await tx.notificationDelivery.count({
        where: { businessId: t.ids.firmA, channel: 'EMAIL', notification: where },
      }),
      firmTold:
        (await tx.notification.count({
          where: { ...where, recipientUserId: { not: t.people.primary.id } },
        })) > 0,
    };
  });

describe('deposit accounts (IP-F12)', () => {
  it('keeps the firm’s accounts, one default, archived ones hidden', async () => {
    const tag = randomUUID().slice(0, 6);
    const operating = DepositAccount.parse(
      expectOk(
        await accounts('post', '', { name: `Operating ${tag} (fake)`, isDefault: true }),
        201,
      ).body,
    );
    const savings = DepositAccount.parse(
      expectOk(await accounts('post', '', { name: `Savings ${tag} (fake)` }), 201).body,
    );
    const taken = await accounts('post', '', { name: `Operating ${tag} (fake)` });
    expect([taken.status, codeOf(taken)]).toEqual([409, 'NAME_TAKEN']);
    // The new default takes it over.
    expectOk(await accounts('put', `/${savings.id}`, { name: savings.name, isDefault: true }));
    const list = DepositAccountList.parse(expectOk(await accounts('get')).body).items;
    expect(list.filter((a) => a.isDefault).map((a) => a.id)).toEqual([savings.id]);
    const after = DepositAccountList.parse(
      expectOk(await accounts('post', `/${operating.id}/archive`)).body,
    ).items;
    expect(after.map((a) => a.id)).not.toContain(operating.id);
    // Staff may not manage them.
    expect((await accounts('get', '', undefined, t.people.staffA)).status).toBe(403);

    // Record Payment's Deposit To: a live account of the firm.
    const invoiceId = await open();
    const paid = Invoice.parse(
      expectOk(await record(invoiceId, { depositAccountId: savings.id })).body,
    );
    expect(paid.offlinePayments[0]?.depositAccount).toEqual({ id: savings.id, name: savings.name });
    for (const depositAccountId of [operating.id, randomUUID()]) {
      expect((await record(invoiceId, { depositAccountId })).status).toBe(404);
    }
  });
});

describe('receipts (IP-F12)', () => {
  it('go to the client only when asked, once per payment; the firm is told either way', async () => {
    await autoReceipts(false);
    const quiet = await open();
    const none = Invoice.parse(expectOk(await record(quiet)).body);
    expect(none.offlinePayments[0]?.receiptSentAt).toBeNull();
    expect(await sent(quiet)).toEqual({ receipts: 0, firmTold: true });

    // Send Receipt ticked; a retry with the same key records and sends nothing more.
    const asked = await open();
    const key = randomUUID();
    const first = Invoice.parse(
      expectOk(await record(asked, { sendReceipt: true, idempotencyKey: key })).body,
    );
    expect(first.offlinePayments[0]?.receiptSentAt).not.toBeNull();
    expectOk(await record(asked, { sendReceipt: true, idempotencyKey: key }));
    expect(await sent(asked)).toMatchObject({ receipts: 1 });

    // Automatic Receipts on: sent unless this payment's box was unticked.
    await autoReceipts(true);
    const auto = await open();
    expectOk(await record(auto));
    expectOk(await record(auto, { sendReceipt: false }));
    expect(await sent(auto)).toMatchObject({ receipts: 1 });
    await autoReceipts(false);
  });

  it('a Stripe payment: Automatic Receipts decides, and a retried webhook sends one', async () => {
    const receipts = t.app.get(InvoiceReceipts);
    const stripePaid = async () => {
      const invoiceId = await open();
      const paymentId = await t.inScope(t.ids.firmA, async (tx) => {
        const { accountId } = await tx.stripeAccount.findUniqueOrThrow({
          where: { businessId: t.ids.firmA },
        });
        const row = await tx.payment.create({
          data: {
            businessId: t.ids.firmA,
            invoiceId,
            amountCents: 2_000,
            currency: 'usd',
            processorRef: `cs_test_${randomUUID().replaceAll('-', '')}`,
            accountId,
          },
        });
        // As Stripe's webhook does: the success event first (the database requires it).
        await tx.paymentEvent.create({
          data: {
            businessId: t.ids.firmA,
            processorEventId: `evt_test_${randomUUID().replaceAll('-', '')}`,
            accountId,
            type: 'checkout.session.completed',
            paymentId: row.id,
            processedAt: new Date(),
          },
        });
        await tx.payment.update({
          where: { id: row.id },
          data: { status: 'SUCCEEDED', paidAt: new Date() },
        });
        return row.id;
      });
      return { invoiceId, paymentId };
    };
    const off = await stripePaid();
    await receipts.afterPayment(t.ids.firmA, off.invoiceId, { paymentId: off.paymentId });
    expect(await sent(off.invoiceId)).toEqual({ receipts: 0, firmTold: true });

    await autoReceipts(true);
    const on = await stripePaid();
    for (let i = 0; i < 2; i++) {
      await receipts.afterPayment(t.ids.firmA, on.invoiceId, { paymentId: on.paymentId });
    }
    expect(await sent(on.invoiceId)).toMatchObject({ receipts: 1 });
    await autoReceipts(false);

    // Send Receipt on the invoice works for a Stripe payment too.
    const again = Invoice.parse(
      expectOk(
        await t.firm(
          'post',
          `/${off.invoiceId}/payments/${off.paymentId}/receipts`,
          t.people.ownerA,
          {},
        ),
      ).body,
    );
    expect(again.payments[0]?.receiptSentAt).not.toBeNull();
    expect(await sent(off.invoiceId)).toMatchObject({ receipts: 1 });
  });

  it('Send and Resend send one each time; never for a voided payment or another invoice’s', async () => {
    const invoiceId = await open();
    const paid = Invoice.parse(expectOk(await record(invoiceId)).body);
    const offlinePaymentId = paid.offlinePayments[0]!.id;
    const send = (id: string, who = t.people.ownerA) =>
      t.firm('post', `/${id}/offline-payments/${offlinePaymentId}/receipts`, who, {});
    expectOk(await send(invoiceId));
    const resent = Invoice.parse(expectOk(await send(invoiceId)).body);
    expect(resent.offlinePayments[0]?.receiptSentAt).not.toBeNull();
    expect(await sent(invoiceId)).toMatchObject({ receipts: 2 });

    expect((await send(invoiceId, t.people.staffA)).status).toBe(403);
    expect((await send(await open())).status).toBe(404);

    expectOk(
      await t.firm(
        'post',
        `/${invoiceId}/offline-payments/${offlinePaymentId}/void`,
        t.people.ownerA,
        { reason: 'Recorded by mistake' },
      ),
    );
    const voided = await send(invoiceId);
    expect([voided.status, codeOf(voided)]).toEqual([409, 'RECEIPT_NOT_AVAILABLE']);
  });
});
