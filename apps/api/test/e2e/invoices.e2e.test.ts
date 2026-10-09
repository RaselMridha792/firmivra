// End-to-end: R7 step 7, the firm's invoices (contract in packages/types/src/payments). Owner and
// Admin create drafts and replace them whole; the database computes every amount; numbers are
// INV-{year}-{4 digits} per firm. Staff read only their assigned clients' invoices and get 403
// on every change. Firm B and the portal never reach firm A's invoices. Changes are audited.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { codeOf, expectOk, Invoice, InvoiceList, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;

beforeAll(async () => {
  t = await startInvoiceApp('r7i');
});

afterAll(async () => {
  await t.app.close();
});

describe('create and update a draft', () => {
  it('numbers drafts per firm and keeps the amounts the database computes', async () => {
    const res = await t.firm('post', '', t.people.adminA, {
      clientId: t.ids.one,
      engagementId: t.ids.engagementOne,
      lines: [
        { description: 'Return', quantity: 1.5, unitAmountCents: 3_333 },
        { description: 'Schedule C', unitAmountCents: 10_000 },
      ],
      discountCents: 1_000,
      dueOn: nyDay(30),
    });
    const first = Invoice.parse(expectOk(res).body);
    const year = nyDay().slice(0, 4);
    expect(first.number).toMatch(new RegExp(`^INV-${year}-\\d{4}$`));
    expect(first).toMatchObject({
      status: 'DRAFT',
      clientStatus: null,
      client: { id: t.ids.one },
      service: { id: t.ids.engagementOne, title: '2025 Tax Return' },
      title: '2025 Tax Return',
      subtotalCents: 15_000, // 1.5 x 33.33 = 49.995, rounded half up to 50.00
      discountCents: 1_000,
      totalCents: 14_000,
      balanceDueCents: 14_000,
      amountPaidCents: 0,
      payments: [],
      createdBy: { userId: t.people.adminA.id },
    });
    expect(first.lines.map((l) => [l.description, l.quantity, l.amountCents])).toEqual([
      ['Return', 1.5, 5_000],
      ['Schedule C', 1, 10_000],
    ]);

    // Two at once still get the next numbers, one each.
    const [a, b] = await Promise.all([t.draft(t.ids.two), t.draft(t.ids.two)]);
    const n = (num: string) => Number(num.slice(-4));
    expect([n(a.number), n(b.number)].sort()).toEqual([n(first.number) + 1, n(first.number) + 2]);
    expect(a.title).toBe('Tax return'); // no service: the first line

    const audit = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findFirst({ where: { action: 'invoice.created', entityId: first.id } }),
    );
    expect(audit).toMatchObject({ actorUserId: t.people.adminA.id, entityType: 'invoice' });
    expect(audit?.metadata).toEqual({
      clientId: t.ids.one,
      number: first.number,
      totalCents: 14_000,
      lines: 2,
    });
  });

  it('PUT replaces the whole draft, lines included', async () => {
    const created = await t.draft(t.ids.one, { engagementId: t.ids.engagementOne });
    const res = await t.firm('put', `/${created.id}`, t.people.ownerA, {
      lines: [{ description: 'Bookkeeping', quantity: 2, unitAmountCents: 7_550 }],
      dueOn: nyDay(20),
      scheduledFor: nyDay(10),
    });
    const updated = Invoice.parse(expectOk(res).body);
    expect(updated).toMatchObject({
      id: created.id,
      number: created.number,
      service: null,
      title: 'Bookkeeping',
      subtotalCents: 15_100,
      discountCents: 0,
      totalCents: 15_100,
      scheduledFor: nyDay(10),
      dueOn: nyDay(20),
    });
    expect(updated.lines).toHaveLength(1);
    const audited = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.count({ where: { action: 'invoice.updated', entityId: created.id } }),
    );
    expect(audited).toBe(1);
  });

  it('refuses amounts in the request, a discount above the subtotal and a bad schedule (400)', async () => {
    const base = {
      clientId: t.ids.one,
      lines: [{ description: 'x', unitAmountCents: 100 }],
      dueOn: nyDay(5),
    };
    for (const body of [
      { ...base, totalCents: 100 },
      { ...base, businessId: t.ids.firmB },
      { ...base, lines: [{ description: 'x', unitAmountCents: 100, amountCents: 1 }] },
      { ...base, discountCents: 101 },
      { ...base, lines: [] },
      { ...base, lines: [{ description: 'x', quantity: 1.234, unitAmountCents: 100 }] },
      { ...base, scheduledFor: nyDay(6) },
    ]) {
      const res = await t.firm('post', '', t.people.ownerA, body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it("404 for another firm's client or another client's service; 409 for an archived client or a sent invoice", async () => {
    const body = { lines: [{ description: 'x', unitAmountCents: 100 }], dueOn: nyDay(5) };
    const cases: [object, number, string][] = [
      [{ ...body, clientId: t.ids.clientB }, 404, 'NOT_FOUND'],
      [{ ...body, clientId: randomUUID() }, 404, 'NOT_FOUND'],
      [{ ...body, clientId: t.ids.one, engagementId: t.ids.engagementTwo }, 404, 'NOT_FOUND'],
      [{ ...body, clientId: t.ids.old }, 409, 'CLIENT_ARCHIVED'],
    ];
    for (const [b, status, code] of cases) {
      const res = await t.firm('post', '', t.people.ownerA, b);
      expect([res.status, codeOf(res)], JSON.stringify(b)).toEqual([status, code]);
    }

    const sent = await t.draft(t.ids.two);
    await t.inScope(t.ids.firmA, (tx) =>
      tx.invoice.update({ where: { id: sent.id }, data: { status: 'OPEN', issuedAt: new Date() } }),
    );
    const put = await t.firm('put', `/${sent.id}`, t.people.ownerA, body);
    expect([put.status, codeOf(put)]).toEqual([409, 'NOT_DRAFT']);
    // 404 comes before 409: a service of another client on a sent invoice.
    const wrong = await t.firm('put', `/${sent.id}`, t.people.ownerA, {
      ...body,
      engagementId: t.ids.engagementOne,
    });
    expect([wrong.status, codeOf(wrong)]).toEqual([404, 'NOT_FOUND']);
  });
});

describe('list and get', () => {
  it('lists newest first with filters, search and pages; paymentsEnabled from the Stripe account', async () => {
    const mine = await t.draft(t.ids.two, {
      lines: [{ description: 'Searchable', unitAmountCents: 1_000 }],
    });
    const page1 = InvoiceList.parse(
      expectOk(await t.firm('get', '?limit=2', t.people.ownerA)).body,
    );
    expect(page1.paymentsEnabled).toBe(true);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0]!.id).toBe(mine.id);
    const page2 = InvoiceList.parse(
      expectOk(await t.firm('get', `?limit=2&cursor=${page1.nextCursor ?? ''}`, t.people.ownerA))
        .body,
    );
    expect(page2.items.map((i) => i.id)).not.toContain(mine.id);

    const byNumber = InvoiceList.parse(
      expectOk(await t.firm('get', `?search=${mine.number.toLowerCase()}`, t.people.ownerA)).body,
    );
    expect(byNumber.items.map((i) => i.id)).toEqual([mine.id]);
    const byName = InvoiceList.parse(
      expectOk(await t.firm('get', `?search=alpha%20${t.run}`, t.people.ownerA)).body,
    );
    expect(byName.items.length).toBeGreaterThan(0);
    expect(byName.items.every((i) => i.client.id === t.ids.one)).toBe(true);
    const open = InvoiceList.parse(
      expectOk(await t.firm('get', `?status=OPEN&clientId=${t.ids.two}`, t.people.ownerA)).body,
    );
    expect(open.items.length).toBeGreaterThan(0);
    expect(open.items.every((i) => i.status === 'OPEN' && i.client.id === t.ids.two)).toBe(true);

    const got = Invoice.parse(expectOk(await t.firm('get', `/${mine.id}`, t.people.ownerA)).body);
    expect(got).toEqual(mine);

    const b = InvoiceList.parse(
      expectOk(await t.firm('get', '', t.people.ownerB, undefined, t.ids.firmB)).body,
    );
    expect(b).toEqual({ items: [], nextCursor: null, paymentsEnabled: false });
    const bad = await t.firm('get', '?cursor=nope', t.people.ownerA);
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it("Staff read only their clients' invoices and get 403 on every change", async () => {
    const theirs = await t.draft(t.ids.one);
    const notTheirs = await t.draft(t.ids.two);
    const list = InvoiceList.parse(expectOk(await t.firm('get', '', t.people.staffA)).body);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((i) => i.client.id === t.ids.one)).toBe(true);
    expectOk(await t.firm('get', `/${theirs.id}`, t.people.staffA));

    const refused = [
      [await t.firm('get', `/${notTheirs.id}`, t.people.staffA), 404, 'NOT_FOUND'],
      [await t.firm('get', `?clientId=${t.ids.two}`, t.people.staffA), 404, 'NOT_FOUND'],
      // The role guard runs before the body and the id are read.
      [await t.firm('post', '', t.people.staffA, { clientId: t.ids.one }), 403, 'FORBIDDEN'],
      [await t.firm('put', `/${theirs.id}`, t.people.staffA, {}), 403, 'FORBIDDEN'],
      [await t.firm('put', '/not-a-uuid', t.people.staffA, {}), 403, 'FORBIDDEN'],
      [await t.firm('get', '', t.people.primary), 403, 'FORBIDDEN'],
    ] as const;
    for (const [res, status, code] of refused) {
      expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
    }
  });

  it("firm B's owner gets 404 for firm A's invoices, from either firm", async () => {
    const a = await t.draft(t.ids.one);
    const body = { lines: [{ description: 'x', unitAmountCents: 100 }], dueOn: nyDay(5) };
    for (const res of [
      await t.firm('get', `/${a.id}`, t.people.ownerB, undefined, t.ids.firmB),
      await t.firm('put', `/${a.id}`, t.people.ownerB, body, t.ids.firmB),
      await t.firm('get', `?clientId=${t.ids.one}`, t.people.ownerB, undefined, t.ids.firmB),
      await t.firm('get', `/${a.id}`, t.people.ownerB, undefined, t.ids.firmA),
    ]) {
      expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([404, 'NOT_FOUND']);
    }
    const unchanged = Invoice.parse(
      expectOk(await t.firm('get', `/${a.id}`, t.people.ownerA)).body,
    );
    expect(unchanged.updatedAt).toBe(a.updatedAt);
  });
});

describe('tenant isolation', () => {
  it("the app role in firm B's scope sees none of firm A's invoices, lines or numbers", async () => {
    const a = await t.draft(t.ids.one);
    const app = createPrismaClient(t.appUrl);
    try {
      const seen = await runInScope(
        app,
        { kind: 'business', businessId: t.ids.firmB },
        async (tx) => ({
          invoice: await tx.invoice.findFirst({ where: { id: a.id } }),
          lines: await tx.invoiceLine.count({ where: { invoiceId: a.id } }),
          updated: await tx.invoice.updateMany({
            where: { id: a.id },
            data: { dueOn: new Date('2030-01-01') },
          }),
        }),
      );
      expect(seen).toEqual({ invoice: null, lines: 0, updated: { count: 0 } });
    } finally {
      await app.$disconnect();
    }
  });
});
