// End-to-end: R7 step 7, reading the firm's invoices (contract in packages/types/src/payments):
// list (filters, search, pages, paymentsEnabled) and get. Staff read only their assigned clients'
// invoices. Firm B never reaches firm A's invoices.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { codeOf, expectOk, Invoice, InvoiceList, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;

beforeAll(async () => {
  t = await startInvoiceApp('r7i');
});

afterAll(async () => {
  await t.app.close();
});

describe('list and get', () => {
  it('lists newest first with filters, search and pages; paymentsEnabled from the Stripe account', async () => {
    await t.draft(t.ids.one);
    await t.draft(t.ids.two, { status: 'OPEN' });
    const mine = await t.draft(t.ids.two, {
      lines: [{ description: 'Searchable', unitAmountCents: 1_000 }],
    });
    expect(mine.subtotalCents).toBe(1_000);
    const page1 = InvoiceList.parse(
      expectOk(await t.firm('get', '?limit=2', t.people.ownerA)).body,
    );
    expect(page1.paymentsEnabled).toBe(true);
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
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

  it("Staff read only their clients' invoices", async () => {
    const theirs = await t.draft(t.ids.one);
    const notTheirs = await t.draft(t.ids.two);
    const list = InvoiceList.parse(expectOk(await t.firm('get', '', t.people.staffA)).body);
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.every((i) => i.client.id === t.ids.one)).toBe(true);
    expectOk(await t.firm('get', `/${theirs.id}`, t.people.staffA));

    const refused = [
      [await t.firm('get', `/${notTheirs.id}`, t.people.staffA), 404, 'NOT_FOUND'],
      [await t.firm('get', `?clientId=${t.ids.two}`, t.people.staffA), 404, 'NOT_FOUND'],
      [await t.firm('get', '', t.people.primary), 403, 'FORBIDDEN'],
    ] as const;
    for (const [res, status, code] of refused) {
      expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
    }
  });

  it("firm B's owner gets 404 for firm A's invoices, from either firm", async () => {
    const a = await t.draft(t.ids.one);
    for (const res of [
      await t.firm('get', `/${a.id}`, t.people.ownerB, undefined, t.ids.firmB),
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
