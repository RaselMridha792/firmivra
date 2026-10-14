// R37, Tax Returns: authorization (signature) lines, the return's files, and the signatures part
// of the ready-to-file gate. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staffA: randomUUID(),
  staffB: randomUUID(),
  client: '',
  client2: '',
  engagement: '',
  engagement2: '',
  doc: '',
  doc2: '',
  docB: '',
  clientB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);

const newReturn = () =>
  A().taxReturn.create({
    data: { businessId: ids.firmA, clientId: ids.client, taxYear: 2025, filingType: 'INDIVIDUAL' },
  });
const authorization = (taxReturnId: string, data: Record<string, unknown> = {}) =>
  A().taxReturnAuthorization.create({
    data: { businessId: ids.firmA, taxReturnId, kind: 'FEDERAL_EFILE', ...data },
  });
const esignDraft = (clientId: string, engagementId: string) =>
  A().esignRequest.create({
    data: {
      businessId: ids.firmA,
      title: 'Form 8879',
      source: 'TAB',
      clientId,
      engagementId,
      senderUserId: ids.staffA,
      routing: 'SEQUENTIAL',
      expiryDays: 30,
      reminderFirstAfterDays: 3,
      reminderEveryDays: 3,
      reminderMax: 3,
      expiryWarningDays: 2,
    },
  });
const toReadyToFile = (id: string) =>
  A().taxReturn.update({ where: { id }, data: { workflowStatus: 'READY_TO_FILE' } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@ts.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `tsa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `tsb-${run}`, name: 'B' } })).id;
  });
  const setup = (businessId: string, userId: string) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
      });
      const out: string[] = [];
      for (const name of ['One', 'Two']) {
        const c = await tx.client.create({ data: { businessId, displayName: name } });
        const e = await tx.engagement.create({
          data: { businessId, clientId: c.id, serviceId: service.id, title: '2025' },
        });
        const d = await tx.document.create({
          data: {
            businessId,
            clientId: c.id,
            engagementId: e.id,
            direction: 'INTERNAL',
            fileName: 'File.pdf',
            contentType: 'application/pdf',
            sizeBytes: 100,
            sha256: 'd'.repeat(64),
            s3Key: `tenant/${businessId}/documents/${randomUUID()}`,
          },
        });
        out.push(c.id, e.id, d.id);
      }
      return out as [string, string, string, string, string, string];
    });
  [ids.client, ids.engagement, ids.doc, ids.client2, ids.engagement2, ids.doc2] = await setup(
    ids.firmA,
    ids.staffA,
  );
  [ids.clientB, , ids.docB] = await setup(ids.firmB, ids.staffB);
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's lines or files, and refuses to point at them", async () => {
    const r = await newReturn();
    const line = await authorization(r.id);
    const file = await A().taxReturnDocument.create({
      data: { businessId: ids.firmA, taxReturnId: r.id, documentId: ids.doc, kind: 'DRAFT_RETURN' },
    });
    expect(await B().taxReturnAuthorization.findUnique({ where: { id: line.id } })).toBeNull();
    expect(await B().taxReturnDocument.findUnique({ where: { id: file.id } })).toBeNull();
    expect(
      (
        await B().taxReturnAuthorization.updateMany({
          where: { id: line.id },
          data: { required: false },
        })
      ).count,
    ).toBe(0);
    expect((await B().taxReturnDocument.deleteMany({ where: { id: file.id } })).count).toBe(0);
    await expect(
      B().taxReturnAuthorization.create({
        data: { businessId: ids.firmB, taxReturnId: r.id, kind: 'FEDERAL_EFILE' },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      B().taxReturnDocument.create({
        data: { businessId: ids.firmB, taxReturnId: r.id, documentId: ids.docB, kind: 'VOUCHER' },
      }),
    ).rejects.toThrow(/foreign key|signed copy is a document/i);
    await expect(
      authorization(r.id, { kind: 'CLIENT_CONSENT', documentId: ids.docB, signedOn: new Date() }),
    ).rejects.toThrow(/foreign key|signed copy is a document/i);
  });
});

describe('authorization lines', () => {
  it('a state line names the state, the others none; one line per kind and state', async () => {
    const r = await newReturn();
    await expect(authorization(r.id, { kind: 'STATE_EFILE' })).rejects.toThrow(
      /tax_return_authorizations_jurisdiction/,
    );
    await expect(authorization(r.id, { jurisdiction: 'GA' })).rejects.toThrow(
      /tax_return_authorizations_jurisdiction/,
    );
    await expect(
      authorization(r.id, { kind: 'STATE_EFILE', jurisdiction: 'georgia' }),
    ).rejects.toThrow(/tax_return_authorizations_jurisdiction/);
    await authorization(r.id);
    await expect(authorization(r.id)).rejects.toThrow(/Unique/i);
    await expect(
      authorization(r.id, { kind: 'STATE_EFILE', jurisdiction: 'GA' }),
    ).resolves.toBeTruthy();
    await expect(
      authorization(r.id, { kind: 'STATE_EFILE', jurisdiction: 'FL' }),
    ).resolves.toBeTruthy();
    await expect(authorization(r.id, { kind: 'STATE_EFILE', jurisdiction: 'GA' })).rejects.toThrow(
      /Unique/i,
    );
  });

  it('the Firm Sign request and the signed copy are the return’s client’s', async () => {
    const r = await newReturn();
    const other = await esignDraft(ids.client2, ids.engagement2);
    await expect(authorization(r.id, { esignRequestId: other.id })).rejects.toThrow(
      /Firm Sign request is the return's client's/,
    );
    await expect(
      authorization(r.id, { signedOn: new Date(), documentId: ids.doc2 }),
    ).rejects.toThrow(/signed copy is a document/);
    await expect(authorization(r.id, { signedOn: new Date() })).rejects.toThrow(
      /tax_return_authorizations_signed/,
    );
    await expect(
      authorization(r.id, { signedOn: new Date(Date.now() + 5 * 86_400_000), documentId: ids.doc }),
    ).rejects.toThrow(/cannot be in the future/);
    const mine = await esignDraft(ids.client, ids.engagement);
    await expect(authorization(r.id, { esignRequestId: mine.id })).resolves.toMatchObject({
      esignRequestId: mine.id,
    });
  });

  it('the return and kind of a line never change; lines are never deleted', async () => {
    const r = await newReturn();
    const line = await authorization(r.id);
    await expect(
      A().taxReturnAuthorization.update({
        where: { id: line.id },
        data: { kind: 'CLIENT_CONSENT' },
      }),
    ).rejects.toThrow(/cannot change/);
    await expect(
      A().taxReturnAuthorization.update({ where: { id: line.id }, data: { required: false } }),
    ).resolves.toBeTruthy();
    await expect(A().taxReturnAuthorization.delete({ where: { id: line.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('ready to file', () => {
  it('needs every required signature: a recorded one, or a completed Firm Sign request', async () => {
    const r = await newReturn();
    const federal = await authorization(r.id);
    const consent = await authorization(r.id, { kind: 'CLIENT_CONSENT', required: false });
    await expect(toReadyToFile(r.id)).rejects.toThrow(/required signature must be in/);
    // A request that is only a draft is not a signature.
    const request = await esignDraft(ids.client, ids.engagement);
    await A().taxReturnAuthorization.update({
      where: { id: federal.id },
      data: { esignRequestId: request.id },
    });
    await expect(toReadyToFile(r.id)).rejects.toThrow(/required signature must be in/);
    await A().taxReturnAuthorization.update({
      where: { id: federal.id },
      data: { signedOn: new Date(), documentId: ids.doc },
    });
    await expect(toReadyToFile(r.id)).resolves.toMatchObject({ workflowStatus: 'READY_TO_FILE' });
    expect(consent.required).toBe(false);
  });
});

describe('the return’s files', () => {
  const file = (taxReturnId: string, documentId: string, kind: string, jurisdiction?: string) =>
    A().taxReturnDocument.create({
      data: {
        businessId: ids.firmA,
        taxReturnId,
        documentId,
        kind: kind as 'VOUCHER',
        jurisdiction,
      },
    });

  it('are the client’s own documents, once each, with a jurisdiction when one applies', async () => {
    const r = await newReturn();
    await expect(file(r.id, ids.doc2, 'VOUCHER')).rejects.toThrow(
      /document of the return's client/,
    );
    await expect(file(r.id, ids.doc, 'VOUCHER', 'georgia')).rejects.toThrow(
      /tax_return_documents_jurisdiction/,
    );
    await expect(file(r.id, ids.doc, 'VOUCHER', 'GA')).resolves.toBeTruthy();
    await expect(file(r.id, ids.doc, 'PAYMENT_PROOF')).rejects.toThrow(/Unique/i);
  });

  it('the filed return and the acknowledgment stay linked; the other roles can be removed', async () => {
    const r = await newReturn();
    const draft = await file(r.id, ids.doc, 'DRAFT_RETURN');
    await expect(A().taxReturnDocument.delete({ where: { id: draft.id } })).resolves.toBeTruthy();
    for (const kind of ['FILED_RETURN', 'ACKNOWLEDGMENT'] as const) {
      const other = await newReturn();
      const linked = await file(other.id, ids.doc, kind);
      await expect(A().taxReturnDocument.delete({ where: { id: linked.id } })).rejects.toThrow(
        /stay linked/,
      );
    }
  });
});
