// R36 (Services and Pricing, r36_service_pricing_items): a service's line items and add-ons, and the
// add-on an invoice line came from. Runs as the app role under RLS.
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
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const service = (data: Record<string, unknown> = {}) =>
  firmA().service.create({ data: { ...A(), kind: 'OTHER', name: `Service ${++count}`, ...data } });

beforeAll(async () => {
  f = await createFirms(owner, 'sp');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('line items and add-ons', () => {
  it('a service counts its line items as information unless it says they add up', async () => {
    expect(await service()).toMatchObject({ lineItemMode: 'INFORMATIONAL' });
    expect(await service({ lineItemMode: 'ADDITIVE' })).toMatchObject({ lineItemMode: 'ADDITIVE' });
  });

  it('line items have a name, a positive quantity and a rate; a service sets how they count', async () => {
    const s = await service({ lineItemMode: 'ADDITIVE' });
    const line = (data: Record<string, unknown>) =>
      firmA().serviceLineItem.create({
        data: { ...A(), serviceId: s.id, name: 'Base Preparation Fee', rateCents: 9900, ...data },
      });
    await expect(line({})).resolves.toMatchObject({ rateCents: 9900 });
    await expect(line({ name: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(line({ quantity: 0 })).rejects.toThrow(/check constraint/i);
    await expect(line({ rateCents: -1 })).rejects.toThrow(/check constraint/i);
    await expect(line({ rateCents: 0, name: 'State Return (if required)' })).resolves.toBeTruthy();
  });

  it('add-ons are required or client-selectable, never both, and unique by name in a service', async () => {
    const s = await service();
    const other = await service();
    const theirs = await runInScope(owner, { kind: 'business', businessId: f.firmB }, (tx) =>
      tx.service.create({ data: { businessId: f.firmB, kind: 'OTHER', name: `B ${f.run}` } }),
    );
    const add = (data: Record<string, unknown>) =>
      firmA().serviceAddOn.create({
        data: { ...A(), serviceId: s.id, name: `Add-on ${++count}`, priceCents: 7500, ...data },
      });
    await expect(add({ required: true, clientSelectable: true })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(add({ priceCents: -1 })).rejects.toThrow(/check constraint/i);
    await expect(add({ name: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(add({ linkedServiceId: s.id })).rejects.toThrow(/check constraint/i);
    await expect(add({ linkedServiceId: theirs.id })).rejects.toThrow(/foreign key/i);
    await expect(add({ linkedServiceId: other.id, clientSelectable: true })).resolves.toBeTruthy();
    await expect(add({ required: true })).resolves.toBeTruthy();
    await add({ name: 'Amended Return' });
    await expect(add({ name: 'Amended Return' })).rejects.toThrow(/unique/i);
  });

  it('an invoice line names the add-on it came from; a used add-on cannot be deleted', async () => {
    const s = await service();
    const addOn = await firmA().serviceAddOn.create({
      data: { ...A(), serviceId: s.id, name: 'Audit Representation', priceCents: 25000 },
    });
    const unused = await firmA().serviceAddOn.create({
      data: { ...A(), serviceId: s.id, name: 'Unused', priceCents: 100 },
    });
    const inv = await firmA().invoice.create({
      data: { ...A(), clientId: f.client, number: `INV-${++count}` },
    });
    await firmA().invoiceLine.create({
      data: {
        ...A(),
        invoiceId: inv.id,
        serviceId: s.id,
        serviceAddOnId: addOn.id,
        itemName: 'Audit Representation',
        description: 'Add-on',
        unitAmountCents: 25000,
      },
    });
    await expect(firmA().serviceAddOn.delete({ where: { id: addOn.id } })).rejects.toThrow(
      /foreign key/i,
    );
    await expect(firmA().serviceAddOn.delete({ where: { id: unused.id } })).resolves.toBeTruthy();
    await expect(
      firmA().invoiceLine.create({
        data: {
          ...A(),
          invoiceId: inv.id,
          serviceAddOnId: randomUUID(),
          description: 'x',
          unitAmountCents: 1,
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('isolation between firms', () => {
  it('line items and add-ons are invisible to another firm', async () => {
    const s = await service();
    await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      const bs = await tx.service.create({
        data: { businessId: f.firmB, kind: 'OTHER', name: `B iso ${f.run}` },
      });
      await tx.serviceLineItem.create({
        data: { businessId: f.firmB, serviceId: bs.id, name: 'b', rateCents: 1 },
      });
      await tx.serviceAddOn.create({
        data: { businessId: f.firmB, serviceId: bs.id, name: 'b', priceCents: 1 },
      });
    });
    await firmA().serviceLineItem.create({
      data: { ...A(), serviceId: s.id, name: 'a', rateCents: 1 },
    });
    await firmA().serviceAddOn.create({
      data: { ...A(), serviceId: s.id, name: 'a', priceCents: 1 },
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, [
      'service_line_items',
      'service_add_ons',
    ]);
    await expect(
      firmB().serviceAddOn.create({
        data: { businessId: f.firmB, serviceId: s.id, name: 'sneaky', priceCents: 1 },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      firmB().serviceLineItem.create({
        data: { ...A(), name: 'sneaky', serviceId: s.id, rateCents: 1 },
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
