// End-to-end: Create Invoice's Additional Settings (R55; Octavia's Invoices & Payments review of
// Oct 27, IP-F04). The email to the client is the invoice's own choice; the tip only while
// Settings > Payments has it on, and a draft keeps its own. The tip is stored only: Pay Now still
// charges the balance due. Payment before the due date is withdrawn (Review Two, I-D01): still
// accepted, never stored. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MyInvoiceDetail } from '@firmivra/types';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;

beforeAll(async () => {
  t = await startInvoiceApp('r55f04');
});
afterAll(async () => {
  await t.app.close();
});

const body = (extra: object = {}) => ({
  clientId: t.ids.one,
  lines: [{ description: 'Advice (fake)', unitAmountCents: 5_000 }],
  dueOn: nyDay(30),
  ...extra,
});
const create = async (extra: object = {}) =>
  Invoice.parse(expectOk(await t.firm('post', '', t.people.ownerA, body(extra))).body);
const update = (id: string, extra: object = {}) => {
  const { clientId: _c, ...rest } = body(extra);
  return t.firm('put', `/${id}`, t.people.ownerA, rest);
};
const send = async (id: string) =>
  Invoice.parse(expectOk(await t.firm('post', `/${id}/send`, t.people.ownerA, {})).body);
/** Settings > Payments' Taxes & Fees switches. */
const fees = (on: boolean) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.paymentSettings.upsert({
      where: { businessId: t.ids.firmA },
      create: { businessId: t.ids.firmA, tippingEnabled: on, requirePaymentBeforeDue: on },
      update: { tippingEnabled: on, requirePaymentBeforeDue: on },
    }),
  );
/** The invoice.sent bell items and email copies written for the invoice. */
const notices = (invoiceId: string) =>
  t.inScope(t.ids.firmA, async (tx) => ({
    bell: await tx.notification.count({
      where: { businessId: t.ids.firmA, type: 'invoice.sent', entityId: invoiceId },
    }),
    emails: await tx.notificationDelivery.count({
      where: {
        businessId: t.ids.firmA,
        channel: 'EMAIL',
        notification: { type: 'invoice.sent', entityId: invoiceId },
      },
    }),
  }));

describe('Create Invoice Additional Settings (IP-F04)', () => {
  it('opens the invoice in the portal without an email when the email is off', async () => {
    const quiet = await create({ emailClient: false });
    expect(quiet).toMatchObject({ emailClient: false, allowTip: false });
    expect(quiet.requirePaymentBeforeDue).toBe(false);
    // Left out on update: kept.
    expect(Invoice.parse(expectOk(await update(quiet.id)).body).emailClient).toBe(false);
    expect((await send(quiet.id)).status).toBe('OPEN');
    expect(await notices(quiet.id)).toEqual({ bell: 1, emails: 0 });
    expectOk(await t.portal('get', `/${quiet.id}`, t.people.primary));

    const emailed = await create({ emailClient: true });
    await send(emailed.id);
    expect(await notices(emailed.id)).toEqual({ bell: 1, emails: 1 });
    // Left out on create: as before, the email goes.
    expect((await create()).emailClient).toBe(true);
  });

  it('a recurring draft with the email off keeps its later invoices in the portal', async () => {
    const draft = await create({
      emailClient: false,
      recurring: { frequency: 'MONTHLY', maxOccurrences: 3 },
    });
    const schedule = await t.inScope(t.ids.firmA, (tx) =>
      tx.recurringInvoice.findFirstOrThrow({
        where: { businessId: t.ids.firmA, id: draft.recurring!.id },
        select: { delivery: true },
      }),
    );
    expect(schedule.delivery).toBe('PORTAL');
  });

  it('takes a tip only while Settings has it on, and a draft keeps its own', async () => {
    await fees(false);
    const res = await t.firm('post', '', t.people.ownerA, body({ allowTip: true }));
    expect([res.status, codeOf(res)]).toEqual([409, 'OPTION_NOT_ENABLED']);
    // Off is always fine.
    expect((await create({ allowTip: false })).allowTip).toBe(false);

    await fees(true);
    const draft = await create({ allowTip: true });
    expect(draft.allowTip).toBe(true);
    const plain = await create();

    // Settings turned off again: the draft keeps its own, a new choice is refused.
    await fees(false);
    expect(Invoice.parse(expectOk(await update(draft.id, { allowTip: true })).body).allowTip).toBe(
      true,
    );
    const refused = await update(plain.id, { allowTip: true });
    expect([refused.status, codeOf(refused)]).toEqual([409, 'OPTION_NOT_ENABLED']);

    // The tip is stored only: the client's invoice charges the balance due.
    const sent = await send(draft.id);
    const mine = MyInvoiceDetail.parse(
      expectOk(await t.portal('get', `/${draft.id}`, t.people.primary)).body,
    );
    expect([mine.totalCents, mine.balanceDueCents]).toEqual([sent.totalCents, 5_000]);
    expect(JSON.stringify(mine)).not.toContain('allowTip');
  });

  it('I-D01: payment before the due date is withdrawn: still accepted, never written', async () => {
    // Even while the old Settings switch is still on in a firm's row.
    await fees(true);
    const created = await create({ requirePaymentBeforeDue: true });
    expect(created.requirePaymentBeforeDue).toBe(false);
    const updated = await update(created.id, { requirePaymentBeforeDue: true });
    expect(Invoice.parse(expectOk(updated).body).requirePaymentBeforeDue).toBe(false);
    await fees(false);
    // An older screen sends it on every save, mostly false: that saves too.
    expect(
      Invoice.parse(expectOk(await update(created.id, { requirePaymentBeforeDue: false })).body),
    ).toMatchObject({ requirePaymentBeforeDue: false, totalCents: 5_000 });

    // An older invoice that asked for it keeps its stored value (no save changes it) and opens and
    // charges as any other: the value never blocked or sent anything.
    const older = await create();
    const plain = await create();
    await t.inScope(t.ids.firmA, (tx) =>
      tx.invoice.update({
        where: { businessId_id: { businessId: t.ids.firmA, id: older.id } },
        data: { requirePaymentBeforeDue: true },
      }),
    );
    const kept = await update(older.id, { requirePaymentBeforeDue: false });
    expect(Invoice.parse(expectOk(kept).body).requirePaymentBeforeDue).toBe(true);
    expect((await send(older.id)).status).toBe('OPEN');
    await send(plain.id);
    const [mine, other] = await Promise.all(
      [older.id, plain.id].map(async (id) =>
        MyInvoiceDetail.parse(expectOk(await t.portal('get', `/${id}`, t.people.primary)).body),
      ),
    );
    expect([mine!.balanceDueCents, mine!.canPay]).toEqual([other!.balanceDueCents, other!.canPay]);
  });
});
