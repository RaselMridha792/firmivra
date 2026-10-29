// Manual Event Confirmation records (R1, Oct 29; migration r1_automation_event_confirmations,
// Octavia's AU-F31 and AU-F32): one row per occurrence, keyed as the engine keys runs; the manual
// part never changes, provider evidence comes whole and only once, a row is never deleted, an
// evidence document stays while a row names it, and a firm never sees, changes or writes another
// firm's. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let documentA: string;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const EVENT = 'tax_return.accepted';

/** What a member's confirmation of one occurrence writes, for firm A unless told otherwise. */
const occurrence = (data: Record<string, unknown> = {}) => {
  const recordId = randomUUID();
  return {
    businessId: f.firmA,
    sourceModule: 'TAX_RETURNS' as const,
    eventCode: EVENT,
    recordKind: 'tax_return',
    recordId,
    occurrenceKey: `${EVENT}:${recordId}:2026-10-29`,
    clientId: f.clientA,
    confirmedByUserId: f.memberA,
    reference: 'Acknowledgment 0000-FAKE',
    ...data,
  };
};
const confirm = (data: Record<string, unknown> = {}) =>
  A().automationEventConfirmation.create({ data: occurrence(data) });
const update = (id: string, data: Record<string, unknown>) =>
  A().automationEventConfirmation.update({ where: { id }, data });
const provider = {
  providerVerifiedAt: new Date('2026-10-30T09:00:00Z'),
  providerCode: 'irs_efile',
  providerReference: 'Provider 1111-FAKE',
};

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1aec');
  documentA = await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    const service = await tx.service.create({
      data: { businessId: f.firmA, kind: 'ANNUAL_TAX', name: `Tax ${randomUUID()}` },
    });
    const engagement = await tx.engagement.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        serviceId: service.id,
        title: 'Tax (fake)',
      },
    });
    const doc = await tx.document.create({
      data: {
        businessId: f.firmA,
        clientId: f.clientA,
        engagementId: engagement.id,
        direction: 'FIRM_TO_CLIENT',
        fileName: 'acknowledgment.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
        sha256: 'e'.repeat(64),
        s3Key: `tenant/${f.firmA}/documents/${randomUUID()}`,
      },
    });
    return doc.id;
  });
});

describe('a manual confirmation', () => {
  it('records who confirmed which occurrence, once per occurrence (23505)', async () => {
    const data = occurrence();
    const row = await A().automationEventConfirmation.create({ data });
    expect(row).toMatchObject({
      occurrenceKey: data.occurrenceKey,
      confirmedByUserId: f.memberA,
      confirmedAt: expect.any(Date),
      providerVerifiedAt: null,
    });
    expect(await failure(A().automationEventConfirmation.create({ data }))).toMatch(
      /unique|occurrence_key/i,
    );
  });

  it("takes only the engine's key for its event and record, and short texts (23514)", async () => {
    for (const data of [
      { occurrenceKey: `${EVENT}:${randomUUID()}:2026-10-29` }, // another record
      { occurrenceKey: `other.event:${randomUUID()}:2026-10-29` },
      { eventCode: '' },
      { eventCode: ` ${EVENT}` },
      { recordKind: '' },
      { reference: 'x'.repeat(201) },
      { reference: '   ' },
      { note: 'x'.repeat(501) },
    ]) {
      expect(await failure(confirm(data)), JSON.stringify(data)).toMatch(
        /automation_event_confirmations_shape/,
      );
    }
    const recordId = randomUUID();
    expect(await failure(confirm({ recordId, occurrenceKey: `${EVENT}:${recordId}:` }))).toMatch(
      /automation_event_confirmations_shape/,
    );
  });

  it('never changes its manual part', async () => {
    const row = await confirm();
    for (const data of [
      { note: 'Changed later' },
      { reference: 'Another reference' },
      { confirmedByUserId: f.member2A },
      { confirmedAt: new Date('2026-01-01T00:00:00Z') },
      { evidenceDocumentId: documentA },
    ]) {
      expect(await failure(update(row.id, data)), JSON.stringify(data)).toMatch(/never changes/);
    }
  });

  it('is never deleted (no DELETE for the app role)', async () => {
    const row = await confirm();
    expect(
      await failure(A().automationEventConfirmation.delete({ where: { id: row.id } })),
    ).toMatch(/permission denied/i);
  });

  it('keeps its evidence document: the document cannot be deleted while it is named', async () => {
    await confirm({ evidenceDocumentId: documentA });
    expect(
      await failure(
        runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
          tx.document.delete({ where: { id: documentA } }),
        ),
      ),
    ).toMatch(/foreign key|evidence_docume/i);
  });
});

describe('provider evidence', () => {
  it('comes whole (23514), and is set once, never changed or cleared', async () => {
    const row = await confirm();
    for (const data of [
      { providerCode: 'irs_efile' },
      { providerVerifiedAt: provider.providerVerifiedAt, providerCode: 'irs_efile' },
      { ...provider, providerReference: '  ' },
    ]) {
      expect(await failure(update(row.id, data)), JSON.stringify(data)).toMatch(
        /automation_event_confirmations_provider/,
      );
    }
    await expect(update(row.id, provider)).resolves.toMatchObject({
      ...provider,
      confirmedByUserId: f.memberA,
    });
    for (const data of [
      { providerReference: 'Provider 2222-FAKE' },
      { providerVerifiedAt: null, providerCode: null, providerReference: null },
    ]) {
      expect(await failure(update(row.id, data)), JSON.stringify(data)).toMatch(/set once/);
    }
  });
});

describe('isolation', () => {
  it("firm B never sees, finds by occurrence or changes firm A's confirmation", async () => {
    const row = await confirm();
    expect(await B().automationEventConfirmation.findMany({ where: { id: row.id } })).toEqual([]);
    expect(
      await B().automationEventConfirmation.findMany({
        where: { occurrenceKey: row.occurrenceKey },
      }),
    ).toEqual([]);
    const { count } = await B().automationEventConfirmation.updateMany({
      where: { id: row.id },
      data: provider,
    });
    expect(count).toBe(0);
  });

  it("firm B can't write one for firm A, or with firm A's client, member or document", async () => {
    const own = { businessId: f.firmB, clientId: f.clientB, confirmedByUserId: f.memberB };
    expect(await failure(B().automationEventConfirmation.create({ data: occurrence() }))).toMatch(
      /row-level security|policy/i,
    );
    for (const data of [
      { ...own, clientId: f.clientA },
      { ...own, confirmedByUserId: f.memberA },
      { ...own, evidenceDocumentId: documentA },
    ]) {
      expect(
        await failure(B().automationEventConfirmation.create({ data: occurrence(data) })),
        JSON.stringify(data),
      ).toMatch(/foreign key/i);
    }
    // The same occurrence key in firm B is its own row.
    await expect(
      B().automationEventConfirmation.create({ data: occurrence(own) }),
    ).resolves.toMatchObject({ businessId: f.firmB });
  });
});
