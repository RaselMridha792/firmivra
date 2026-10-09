// End-to-end: R7, sending an invoice (OPEN now or SCHEDULED for later) and the portal's Receipts &
// Invoices (the signed-in client's own invoices through myInvoiceStatus()). Staff get 403 on send;
// firm B and other clients get 404.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MyInvoice, MyInvoiceDetail as Detail, MyInvoiceList as List } from '@firmivra/types';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

const My = z.strictObject({
  ...MyInvoice.shape,
  service: MyInvoice.shape.service,
});
const MyList = z.strictObject({ ...List.shape, items: z.array(My) });
const MyDetail = z.strictObject(Detail.shape);

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r7s');
});
afterAll(async () => {
  await t.app.close();
});

const create = async (clientId: string, extra: object = {}) =>
  Invoice.parse(
    expectOk(
      await t.firm('post', '', t.people.ownerA, {
        clientId,
        lines: [{ description: 'Bookkeeping', unitAmountCents: 20_000 }],
        dueOn: nyDay(30),
        ...extra,
      }),
    ).body,
  );
const send = (id: string, who = t.people.ownerA, businessId?: string) =>
  t.firm('post', `/${id}/send`, who, {}, businessId);
const auditOf = (id: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.auditLog.findMany({ where: { entityId: id }, select: { action: true } }),
  );

describe('POST /business/invoices/{id}/send', () => {
  it('opens a draft now, audited, and refuses a second send', async () => {
    const draft = await create(t.ids.one);
    const sent = Invoice.parse(expectOk(await send(draft.id)).body);
    expect(sent).toMatchObject({ status: 'OPEN', clientStatus: 'PENDING', scheduledFor: null });
    expect(sent.issuedAt).not.toBeNull();
    expect((await auditOf(draft.id)).map((a) => a.action)).toContain('invoice.sent');
    const again = await send(draft.id);
    expect([again.status, codeOf(again)]).toEqual([409, 'NOT_DRAFT']);
  });

  it('schedules a draft whose day is later (Upcoming on the portal)', async () => {
    const draft = await create(t.ids.one, { scheduledFor: nyDay(3), dueOn: nyDay(20) });
    const sent = Invoice.parse(expectOk(await send(draft.id)).body);
    expect(sent).toMatchObject({ status: 'SCHEDULED', clientStatus: 'UPCOMING', issuedAt: null });
    expect((await auditOf(draft.id)).map((a) => a.action)).toContain('invoice.scheduled');
  });

  it('refuses nothing to pay, a passed due date and an archived client (409)', async () => {
    const zero = await create(t.ids.one, {
      lines: [{ description: 'Free', unitAmountCents: 1_000 }],
      discountCents: 1_000,
    });
    const past = await create(t.ids.one);
    await t.inScope(t.ids.firmA, (tx) =>
      tx.invoice.update({
        where: { id: past.id },
        data: { dueOn: new Date(`${nyDay(-2)}T00:00:00.000Z`) },
      }),
    );
    for (const [id, code] of [
      [zero.id, 'ZERO_TOTAL'],
      [past.id, 'DUE_DATE_PASSED'],
    ] as const) {
      const res = await send(id);
      expect([res.status, codeOf(res)]).toEqual([409, code]);
    }
    const archived = await create(t.ids.two);
    await t.inScope(t.ids.firmA, (tx) =>
      tx.client.update({ where: { id: t.ids.two }, data: { archivedAt: new Date() } }),
    );
    try {
      const res = await send(archived.id);
      expect([res.status, codeOf(res)]).toEqual([409, 'CLIENT_ARCHIVED']);
    } finally {
      await t.inScope(t.ids.firmA, (tx) =>
        tx.client.update({ where: { id: t.ids.two }, data: { archivedAt: null } }),
      );
    }
  });

  it('gives Staff 403 and firm B 404, changing nothing', async () => {
    const draft = await create(t.ids.one);
    const staff = await send(draft.id, t.people.staffA);
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
    const b = await send(draft.id, t.people.ownerB, t.ids.firmB);
    expect([b.status, codeOf(b)]).toEqual([404, 'NOT_FOUND']);
    const body = Invoice.parse(expectOk(await t.firm('get', `/${draft.id}`, t.people.ownerA)).body);
    expect(body.status).toBe('DRAFT');
  });
});

describe('GET /portal/{firmSlug}/me/invoices', () => {
  it("shows the client's own sent invoices, never drafts, to every login of that client", async () => {
    const hidden = await create(t.ids.one, {
      lines: [{ description: `Hidden ${t.run}`, unitAmountCents: 500 }],
    });
    const open = await create(t.ids.one, {
      lines: [{ description: `Payable ${t.run}`, unitAmountCents: 12_345 }],
    });
    expectOk(await send(open.id));
    for (const who of [t.people.primary, t.people.spouse]) {
      const list = MyList.parse(expectOk(await t.portal('get', '?limit=100', who)).body);
      expect(list.paymentsEnabled).toBe(true);
      const ids = list.items.map((i) => i.id);
      expect(ids).toContain(open.id);
      expect(ids).not.toContain(hidden.id);
      const mine = list.items.find((i) => i.id === open.id)!;
      expect(mine).toMatchObject({
        status: 'PENDING',
        section: 'CURRENT',
        balanceDueCents: 12_345,
        canPay: true,
        paymentProcessing: false,
      });
    }
    const detail = MyDetail.parse(
      expectOk(await t.portal('get', `/${open.id}`, t.people.primary)).body,
    );
    expect(detail.lines.map((l) => l.amountCents)).toEqual([12_345]);
    const draft = await t.portal('get', `/${hidden.id}`, t.people.primary);
    expect([draft.status, codeOf(draft)]).toEqual([404, 'NOT_FOUND']);
  });

  it('filters by view, status, section and search, and pages', async () => {
    const upcoming = await create(t.ids.one, { scheduledFor: nyDay(2), dueOn: nyDay(9) });
    expectOk(await send(upcoming.id));
    const view = MyList.parse(
      expectOk(await t.portal('get', '?view=UPCOMING', t.people.primary)).body,
    );
    expect(view.items.length).toBeGreaterThan(0);
    expect(view.items.every((i) => i.status === 'UPCOMING' && !i.canPay)).toBe(true);
    const past = MyList.parse(
      expectOk(await t.portal('get', '?section=PAST', t.people.primary)).body,
    );
    expect(past.items.every((i) => i.section === 'PAST')).toBe(true);
    const found = MyList.parse(
      expectOk(await t.portal('get', `?search=${upcoming.number.toLowerCase()}`, t.people.primary))
        .body,
    );
    expect(found.items.map((i) => i.id)).toEqual([upcoming.id]);

    const one = MyList.parse(expectOk(await t.portal('get', '?limit=1', t.people.primary)).body);
    expect(one.nextCursor).not.toBeNull();
    const two = MyList.parse(
      expectOk(await t.portal('get', `?limit=1&cursor=${one.nextCursor!}`, t.people.primary)).body,
    );
    expect(two.items[0]!.id).not.toBe(one.items[0]!.id);
    const bad = await t.portal('get', '?cursor=nope', t.people.primary);
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it("gives another client 404 for this client's invoice, and firm B's portal never shows it", async () => {
    const open = await create(t.ids.one);
    expectOk(await send(open.id));
    const other = await t.portal('get', `/${open.id}`, t.people.other);
    expect([other.status, codeOf(other)]).toEqual([404, 'NOT_FOUND']);
    const otherList = MyList.parse(
      expectOk(await t.portal('get', '?limit=100', t.people.other)).body,
    );
    expect(otherList.items.map((i) => i.id)).not.toContain(open.id);
    const b = await t.portal('get', `/${open.id}`, t.people.clientB, undefined, t.ids.slugB);
    expect([b.status, codeOf(b)]).toEqual([404, 'NOT_FOUND']);
    const staff = await t.portal('get', '', t.people.ownerA);
    expect(staff.status).not.toBe(200);
  });
});
