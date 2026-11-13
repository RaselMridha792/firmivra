// End-to-end: IP-F10 (Rasel, Nov 7): invoices are archived, never deleted. A draft is archived
// out of the lists (asked for with `archived`); paid and canceled ones wait for R1's database
// change, and one still owed is refused; Delete on a never-sent draft archives it; restore brings it back. Owner and Admin only;
// firm B reaches none of it; each change is audited without amounts or lines.
import { InvoiceList } from '@firmivra/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeOf, expectOk, Invoice, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;

beforeAll(async () => {
  t = await startInvoiceApp('r56arc');
});

afterAll(async () => {
  await t.app.close();
});

const listed = async (query: string) =>
  InvoiceList.parse(
    expectOk(await t.firm('get', `?clientId=${t.ids.two}${query}`, t.people.ownerA)).body,
  ).items.map((i) => i.id);
const refused = async (res: Awaited<ReturnType<typeof t.firm>>) => [res.status, codeOf(res)];

describe('archive, never delete (IP-F10)', () => {
  it('archives a draft out of the lists, not yet a paid or canceled one, never one still owed; Delete archives a never-sent draft; restore brings it back', async () => {
    const draft = await t.draft(t.ids.two);
    const open = await t.draft(t.ids.two, { status: 'OPEN' });
    const { ownerA, adminA, staffA, ownerB } = t.people;

    // Still owed: refused. Staff: 403.
    expect(await refused(await t.firm('post', `/${open.id}/archive`, ownerA, {}))).toEqual([
      409,
      'NOT_ARCHIVABLE',
    ]);
    expect((await t.firm('post', `/${draft.id}/archive`, staffA, {})).status).toBe(403);

    const archived = Invoice.parse(
      expectOk(await t.firm('post', `/${draft.id}/archive`, adminA, {})).body,
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.status).toBe('DRAFT');
    // Again: nothing changes.
    expect(
      Invoice.parse(expectOk(await t.firm('post', `/${draft.id}/archive`, ownerA, {})).body)
        .archivedAt,
    ).toBe(archived.archivedAt);

    // Out of the default list; alone with `only`; beside the others with `include`.
    expect(await listed('')).not.toContain(draft.id);
    expect(await listed('')).toContain(open.id);
    expect(await listed('&archived=only')).toEqual([draft.id]);
    expect(await listed('&archived=include')).toEqual(expect.arrayContaining([draft.id, open.id]));
    expect((await t.firm('get', `?clientId=${t.ids.two}&archived=sometimes`, ownerA)).status).toBe(
      400,
    );

    // An archived draft is not edited or sent until it is restored.
    expect(await refused(await t.firm('post', `/${draft.id}/send`, ownerA, {}))).toEqual([
      409,
      'INVOICE_ARCHIVED',
    ]);
    expect(
      await refused(await t.firm('post', `/${draft.id}/cancel`, ownerA, { reason: 'Fake' })),
    ).toEqual([409, 'INVOICE_ARCHIVED']);
    const restored = Invoice.parse(
      expectOk(await t.firm('post', `/${draft.id}/restore`, ownerA, {})).body,
    );
    expect(restored.archivedAt).toBeNull();
    expect(await listed('')).toContain(draft.id);

    // Delete: a draft never sent is archived; anything else is refused.
    const deleted = Invoice.parse(expectOk(await t.firm('delete', `/${draft.id}`, ownerA)).body);
    expect(deleted.archivedAt).not.toBeNull();
    expect(await refused(await t.firm('delete', `/${open.id}`, ownerA))).toEqual([
      409,
      'NOT_DELETABLE',
    ]);

    // A canceled invoice is final in the database for now (R1 lets its archived_at change next).
    expectOk(await t.firm('post', `/${open.id}/cancel`, ownerA, { reason: 'Fake: billed twice' }));
    expect(await refused(await t.firm('post', `/${open.id}/archive`, ownerA, {}))).toEqual([
      409,
      'NOT_ARCHIVABLE',
    ]);

    // Firm B reaches none of it, from either firm.
    for (const [method, path] of [
      ['post', `/${draft.id}/restore`],
      ['post', `/${open.id}/archive`],
      ['delete', `/${draft.id}`],
    ] as const) {
      expect(
        (await t.firm(method, path, ownerB, method === 'post' ? {} : undefined, t.ids.firmB))
          .status,
      ).toBe(404);
    }

    // Audited with ids and the status, never amounts or lines.
    const rows = await t.inScope(t.ids.firmA, (tx) =>
      tx.auditLog.findMany({
        where: {
          entityId: { in: [draft.id, open.id] },
          action: { in: ['invoice.archived', 'invoice.restored', 'invoice.deleted'] },
        },
        select: { action: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(rows.map((r) => r.action)).toEqual([
      'invoice.archived',
      'invoice.restored',
      'invoice.deleted',
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/50000|Tax return/);
  });
});
