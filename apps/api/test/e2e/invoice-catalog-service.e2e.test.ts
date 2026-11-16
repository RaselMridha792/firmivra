// End-to-end: Invoices Review 2 I-N01, the header Service from the firm's whole catalog
// (POST and PUT /business/invoices with `serviceId`). A client not enrolled in it gets one PENDING
// "Requested" engagement (with the plan chosen), which the next invoice reuses; an enrolled client's
// active engagement is used as is. With both fields the client's own engagement decides; another
// firm's or an inactive service is 404 and makes nothing. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeOf, expectOk, Invoice, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
const svc = { bookkeeping: '', payroll: '', inactive: '', other: '' };
beforeAll(async () => {
  t = await startInvoiceApp('r1ics');
  await t.inScope(t.ids.firmA, async (tx) => {
    const A = { businessId: t.ids.firmA };
    svc.bookkeeping = (
      await tx.service.create({
        data: {
          ...A,
          kind: 'BOOKKEEPING',
          name: `Books ${t.run}`,
          packages: ['Starter', 'Growth'],
        },
      })
    ).id;
    svc.payroll = (
      await tx.service.create({ data: { ...A, kind: 'PAYROLL', name: `Pay ${t.run}` } })
    ).id;
    svc.inactive = (
      await tx.service.create({
        data: { ...A, kind: 'OTHER', name: `Old ${t.run}`, status: 'INACTIVE' },
      })
    ).id;
    // Client two already has Payroll, active.
    await tx.engagement.create({
      data: { ...A, clientId: t.ids.two, serviceId: svc.payroll, title: 'Payroll (fake)' },
    });
  });
  await t.inScope(t.ids.firmB, async (tx) => {
    svc.other = (
      await tx.service.create({
        data: { businessId: t.ids.firmB, kind: 'OTHER', name: `B ${t.run}` },
      })
    ).id;
  });
});
afterAll(async () => {
  await t.app.close();
});

const body = (extra: object) => ({
  lines: [{ description: 'Fake monthly books', unitAmountCents: 19_900 }],
  dueOn: nyDay(30),
  ...extra,
});
const create = (clientId: string, extra: object) =>
  t.firm('post', '', t.people.ownerA, { clientId, ...body(extra) });
const engagementsOf = (clientId: string, serviceId: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.engagement.findMany({
      where: { clientId, serviceId },
      select: { id: true, status: true, title: true, package: true },
    }),
  );
const requestedAudits = (engagementId: string) =>
  t.inScope(t.ids.firmA, (tx) =>
    tx.auditLog.findMany({
      where: { entityId: engagementId, action: 'engagement.requested' },
      select: { metadata: true },
    }),
  );

describe('An invoice for a catalog service (I-N01)', () => {
  it('adds exactly one PENDING Requested engagement for an unenrolled client; the next invoice reuses it', async () => {
    const first = Invoice.parse(
      expectOk(await create(t.ids.one, { serviceId: svc.bookkeeping, servicePackage: 'Growth' }))
        .body,
    );
    const made = await engagementsOf(t.ids.one, svc.bookkeeping);
    expect(made).toEqual([
      {
        id: first.service?.id,
        status: 'PENDING',
        title: `Books ${t.run} (Requested)`,
        package: 'Growth',
      },
    ]);
    expect(first.service).toEqual({ id: made[0]!.id, title: `Books ${t.run} (Requested)` });

    const second = Invoice.parse(
      expectOk(await create(t.ids.one, { serviceId: svc.bookkeeping })).body,
    );
    expect(second.service?.id).toBe(made[0]!.id);
    // A draft changed to the service links the same one too.
    const third = Invoice.parse(expectOk(await create(t.ids.one, {})).body);
    expect(third.service).toBeNull();
    const edited = Invoice.parse(
      expectOk(
        await t.firm('put', `/${third.id}`, t.people.ownerA, body({ serviceId: svc.bookkeeping })),
      ).body,
    );
    expect(edited.service?.id).toBe(made[0]!.id);
    expect(await engagementsOf(t.ids.one, svc.bookkeeping)).toHaveLength(1);
    expect((await requestedAudits(made[0]!.id)).map((a) => a.metadata)).toEqual([
      { clientId: t.ids.one, serviceId: svc.bookkeeping, via: 'invoice' },
    ]);
  });

  it("uses an enrolled client's active engagement and adds none", async () => {
    const [active] = await engagementsOf(t.ids.two, svc.payroll);
    const inv = Invoice.parse(expectOk(await create(t.ids.two, { serviceId: svc.payroll })).body);
    expect(inv.service).toEqual({ id: active!.id, title: 'Payroll (fake)' });
    expect(await engagementsOf(t.ids.two, svc.payroll)).toHaveLength(1);
  });

  it("with both, the named engagement decides; another firm's or an inactive service is 404, making nothing", async () => {
    const both = Invoice.parse(
      expectOk(
        await create(t.ids.two, { serviceId: svc.bookkeeping, engagementId: t.ids.engagementTwo }),
      ).body,
    );
    expect(both.service?.id).toBe(t.ids.engagementTwo);
    for (const serviceId of [svc.other, svc.inactive]) {
      for (const extra of [{}, { engagementId: t.ids.engagementTwo }]) {
        const res = await create(t.ids.two, { serviceId, ...extra });
        expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([404, 'NOT_FOUND']);
      }
    }
    expect(await engagementsOf(t.ids.two, svc.bookkeeping)).toEqual([]);
    expect(await engagementsOf(t.ids.two, svc.inactive)).toEqual([]);
  });
});
