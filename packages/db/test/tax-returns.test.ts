// Tax returns (R10 step 7, portal Taxes tab): a return stays with its client, its engagement and
// return PDF are that client's, the PDF is never INTERNAL, and only an IN_PROGRESS return can be
// deleted. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  client1: '',
  client2: '',
  engagement1: '',
  engagement2: '',
  returnPdf: '',
  internalPdf: '',
  otherClientPdf: '',
  firmBPdf: '',
};

const firmA = () => db.forBusiness(ids.firmA);
type Return = {
  clientId?: string;
  engagementId?: string;
  taxYear?: number;
  filingType?: 'INDIVIDUAL' | 'BUSINESS';
  quarter?: number;
  formType?: string;
  status?: 'IN_PROGRESS' | 'FILED' | 'ACCEPTED' | 'COMPLETED';
  filedOn?: Date;
  documentId?: string;
};
/** A new 2024 individual return for client 1 of firm A. */
const addReturn = (data: Return = {}) =>
  firmA().taxReturn.create({
    data: {
      businessId: ids.firmA,
      clientId: ids.client1,
      taxYear: 2024,
      filingType: 'INDIVIDUAL',
      ...data,
    },
  });
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

/** A client, an engagement of it, and a document of that engagement. */
async function clientWithDocument(
  tx: TxClient,
  businessId: string,
  direction: 'FIRM_TO_CLIENT' | 'INTERNAL' = 'FIRM_TO_CLIENT',
) {
  const client = await tx.client.create({ data: { businessId, displayName: 'Client (fake)' } });
  const service = await tx.service.create({
    data: { businessId, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID()}` },
  });
  const engagement = await tx.engagement.create({
    data: { businessId, clientId: client.id, serviceId: service.id, title: '2024 Personal Tax' },
  });
  const document = await tx.document.create({
    data: {
      businessId,
      clientId: client.id,
      engagementId: engagement.id,
      direction,
      fileName: '2024 return.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      sha256: 'd'.repeat(64),
      s3Key: `tenant/${businessId}/documents/${randomUUID()}`,
    },
  });
  return { client, engagement, document };
}

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `ta-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `tb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const one = await clientWithDocument(tx, ids.firmA);
    ids.client1 = one.client.id;
    ids.engagement1 = one.engagement.id;
    ids.returnPdf = one.document.id;
    ids.internalPdf = (
      await tx.document.create({
        data: {
          businessId: ids.firmA,
          clientId: ids.client1,
          engagementId: ids.engagement1,
          direction: 'INTERNAL',
          fileName: 'workpapers.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
          sha256: 'e'.repeat(64),
          s3Key: `tenant/${ids.firmA}/documents/${randomUUID()}`,
        },
      })
    ).id;
    const two = await clientWithDocument(tx, ids.firmA);
    ids.client2 = two.client.id;
    ids.engagement2 = two.engagement.id;
    ids.otherClientPdf = two.document.id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    ids.firmBPdf = (await clientWithDocument(tx, ids.firmB)).document.id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('what a return can point at', () => {
  it("links only this client's engagement and this client's own, shareable PDF", async () => {
    await expect(addReturn({ engagementId: ids.engagement2 })).rejects.toThrow(/foreign key/i);
    // Firm B's PDF is refused by the same check (RLS hides it) before the foreign key runs.
    for (const documentId of [ids.otherClientPdf, ids.internalPdf, ids.firmBPdf]) {
      await expect(addReturn({ documentId })).rejects.toThrow(/one of this client's documents/);
    }
    await expect(
      addReturn({ engagementId: ids.engagement1, documentId: ids.returnPdf, formType: '1040' }),
    ).resolves.toMatchObject({ status: 'IN_PROGRESS', documentId: ids.returnPdf });
  });

  it('a return of an old year needs no engagement', async () => {
    await expect(
      addReturn({ taxYear: 2020, status: 'COMPLETED', filedOn: new Date('2021-03-20') }),
    ).resolves.toMatchObject({ engagementId: null, taxYear: 2020 });
  });

  it('the PDF check also runs when the PDF changes later', async () => {
    const r = await addReturn();
    await expect(
      firmA().taxReturn.update({ where: { id: r.id }, data: { documentId: ids.internalPdf } }),
    ).rejects.toThrow(/one of this client's documents/);
  });
});

describe('return rules', () => {
  it('checks the year, quarter, form and filed date', async () => {
    for (const data of [
      { taxYear: 1999 },
      { quarter: 5 },
      { quarter: 0 },
      { formType: ' ' },
      { formType: 'x'.repeat(21) },
      { status: 'FILED' as const },
      { status: 'ACCEPTED' as const },
    ]) {
      await expect(addReturn(data)).rejects.toThrow(/check constraint/i);
    }
    await expect(addReturn({ status: 'FILED', filedOn: days(10) })).rejects.toThrow(/future/);
    await expect(
      addReturn({ filingType: 'BUSINESS', quarter: 2, formType: '1120-S' }),
    ).resolves.toMatchObject({ quarter: 2 });
  });

  it('stays with its client', async () => {
    const r = await addReturn();
    await expect(
      firmA().taxReturn.update({ where: { id: r.id }, data: { clientId: ids.client2 } }),
    ).rejects.toThrow(/cannot change client/);
  });

  it('only an IN_PROGRESS return can be deleted', async () => {
    const remove = async (id: string) =>
      (await firmA().taxReturn.deleteMany({ where: { id } })).count;
    const filed = await addReturn({ status: 'FILED', filedOn: days(-30) });
    expect(await remove(filed.id)).toBe(0);
    expect(await remove((await addReturn()).id)).toBe(1);
  });

  it("a return's PDF cannot be deleted while the return points at it", async () => {
    await addReturn({ documentId: ids.returnPdf });
    await expect(firmA().document.delete({ where: { id: ids.returnPdf } })).rejects.toThrow();
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's returns", async () => {
    const r = await addReturn();
    const b = db.forBusiness(ids.firmB);
    expect(await b.taxReturn.findMany()).toEqual([]);
    expect(
      (await b.taxReturn.updateMany({ where: { id: r.id }, data: { formType: '1040' } })).count,
    ).toBe(0);
    expect((await b.taxReturn.deleteMany({ where: { id: r.id } })).count).toBe(0);
  });
});
