// IntakeSignaturesService.sign() (R14 step 9) against the real database, as R15's submits call
// it: inside the firm's transaction, before submitted_at is set. Synthetic text only.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AgreementOutdatedDetails, IntakeSignatureSummary } from '@firmivra/types';
import {
  IntakeSignaturesService,
  type SignIntakeInput,
} from '../../src/agreements/intake-signatures.service.js';
import { AuditService } from '../../src/audit/audit.service.js';
import { requestContext } from '../../src/common/request-context.js';

const fx = inject('fixtures');
const db = createDatabase(fx.appUrl);
const service = new IntakeSignaturesService(new AuditService(db as never));
const run = randomUUID().slice(0, 8);
const sha = (n: number) => n.toString(16).padStart(64, '0');
const ids = {} as Record<
  | 'firm'
  | 'empty'
  | 'emptyTax'
  | 'emptyFirmWide'
  | 'owner'
  | 'tax'
  | 'books'
  | 'taxForm'
  | 'booksForm'
  | 'engagement'
  | 'account'
  | 'clientUser'
  | 'firmWide'
  | 'firmWideVersion'
  | 'booksAgreement',
  string
>;
const ACKS = [
  { key: 'read', label: 'I read it', text: 'Synthetic acknowledgment.', required: true },
  { key: 'tips', label: 'Tips', text: 'Synthetic optional consent.', required: false },
];

const inFirm = <T>(fn: (tx: TxClient) => Promise<T>, businessId = ids.firm, actorUserId?: string) =>
  requestContext.run({ ip: '::ffff:203.0.113.7', userAgent: 'Test browser/1.0' } as never, () =>
    db.withScope({ kind: 'business', businessId, actorUserId }, fn),
  );

async function leadDraft(serviceId = ids.tax, businessId = ids.firm) {
  return db.withScope({ kind: 'business', businessId }, async (tx) => {
    const { id: formId } = await tx.intakeForm.findFirstOrThrow({ where: { serviceId } });
    const lead = await tx.lead.create({
      data: {
        businessId,
        serviceId,
        firstName: 'Sam',
        lastName: 'Sample',
        email: `s-${randomUUID()}@r14.test`,
      },
    });
    const intake = await tx.intake.create({ data: { businessId, formId, leadId: lead.id } });
    const submission = await tx.intakeSubmission.create({
      data: { businessId, intakeId: intake.id, version: 1, answers: { name: 'Sam Sample' } },
    });
    return { lead, intake, submission };
  });
}

type Draft = Awaited<ReturnType<typeof leadDraft>>;
const firmWideSigned = (bodySha256: string) => ({
  agreementId: ids.firmWide,
  version: 1,
  bodySha256,
});
let firmWideSha = '';

const input = (
  draft: Draft,
  change: Partial<SignIntakeInput['signature']> = {},
  more = {},
): SignIntakeInput => ({
  businessId: ids.firm,
  intakeId: draft.intake.id,
  submissionId: draft.submission.id,
  serviceId: ids.tax,
  signer: { kind: 'lead', leadId: draft.lead.id, email: draft.lead.email },
  signature: {
    agreements: [firmWideSigned(firmWideSha)],
    acknowledgments: [{ agreementId: ids.firmWide, key: 'read' }],
    acceptLegal: { termsVersion: 1, privacyVersion: 1 },
    signer: { printedName: 'Sam  Sample', method: 'TYPED', typedSignature: 'sam sample' },
    title: null,
    ...change,
  },
  ...more,
});

/** Signs and submits in one transaction, as R15's submit does (a portal one as the client). */
const signAndSubmit = (
  draft: Draft,
  signInput: SignIntakeInput,
  actorUserId?: string,
  businessId = ids.firm,
) =>
  inFirm(
    async (tx) => {
      const signed = await service.sign(tx, signInput);
      await tx.intakeSubmission.update({
        where: { id: draft.submission.id },
        data: {
          submittedAt: new Date(),
          signerName: signed.printedName,
          signedAt: signed.signedAt,
          signerIp: signed.ip,
          signerUserAgent: signed.userAgent,
        },
      });
      return signed;
    },
    businessId,
    actorUserId,
  );

const codeOf = (e: unknown) => (e as { response?: { code?: string } }).response?.code;
async function refused(promise: Promise<unknown>): Promise<{ code?: string; details?: unknown }> {
  try {
    await promise;
  } catch (e) {
    return {
      code: codeOf(e),
      details: (e as { response?: { details?: unknown } }).response?.details,
    };
  }
  throw new Error('expected a refusal');
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  ids.owner = randomUUID();
  const clientUser = (ids.clientUser = randomUUID());
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [id, pool] of [
      [ids.owner, 'STAFF'],
      [clientUser, 'CLIENT'],
    ] as const) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool, email: `${id}@r14.test`, name: 'Fake R14' },
      });
    }
    for (const key of ['firm', 'empty'] as const) {
      ids[key] = (
        await tx.business.create({
          data: { slug: `r14s-${key}-${run}`, name: key, status: 'ACTIVE' },
        })
      ).id;
    }
  });
  for (const key of ['firm', 'empty'] as const) {
    const businessId = ids[key];
    await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({
        data: { businessId, userId: ids.owner, role: 'OWNER', status: 'ACTIVE' },
      });
      const svc = (kind: 'ANNUAL_TAX' | 'BOOKKEEPING', name: string) =>
        tx.service.create({ data: { businessId, kind, name } });
      const form = (serviceId: string) =>
        tx.intakeForm.create({
          data: {
            businessId,
            serviceId,
            version: 1,
            title: 'Intake',
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        });
      const tax = await svc('ANNUAL_TAX', 'Tax');
      const books = await svc('BOOKKEEPING', 'Books');
      const taxForm = await form(tax.id);
      const booksForm = await form(books.id);
      if (key !== 'firm') {
        ids.emptyTax = tax.id;
        return;
      }
      Object.assign(ids, {
        tax: tax.id,
        books: books.id,
        taxForm: taxForm.id,
        booksForm: booksForm.id,
      });
      const client = await tx.client.create({ data: { businessId, displayName: 'Client' } });
      ids.engagement = (
        await tx.engagement.create({
          data: { businessId, clientId: client.id, serviceId: tax.id, title: '2025' },
        })
      ).id;
      ids.account = (
        await tx.clientAccount.create({
          data: {
            businessId,
            userId: clientUser,
            clientId: client.id,
            email: `${clientUser}@r14.test`,
            status: 'ACTIVE',
          },
        })
      ).id;
      for (const kind of ['TERMS', 'PRIVACY'] as const) {
        await tx.firmLegalDocument.create({
          data: {
            businessId,
            kind,
            version: 1,
            body: 'Not legal text.',
            publishedByUserId: ids.owner,
          },
        });
      }
      const file = await tx.firmAgreementFile.create({
        data: {
          businessId,
          fileName: 'a.pdf',
          sizeBytes: 100,
          sha256: sha(7),
          s3Key: `tenant/${businessId}/agreements/${randomUUID()}`,
          uploadedByUserId: ids.owner,
        },
      });
      await tx.firmAgreementFile.update({
        where: { id: file.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      const agreement = (scope: 'ALL_INTAKES' | 'SERVICE', serviceId: string | null) =>
        tx.firmAgreement.create({
          data: { businessId, scope, serviceId, createdByUserId: ids.owner },
        });
      ids.firmWide = (await agreement('ALL_INTAKES', null)).id;
      const v = await tx.firmAgreementVersion.create({
        data: {
          businessId,
          agreementId: ids.firmWide,
          version: 1,
          title: 'Firm-wide',
          bodyMarkdown: 'Synthetic firm-wide text. Not legal text.',
          acknowledgments: ACKS,
          pdfFileId: file.id,
          pdfSha256: file.sha256,
          publishedByUserId: ids.owner,
        },
      });
      ids.firmWideVersion = v.id;
      firmWideSha = v.bodySha256;
      ids.booksAgreement = (await agreement('SERVICE', books.id)).id;
      await tx.firmAgreementVersion.create({
        data: {
          businessId,
          agreementId: ids.booksAgreement,
          version: 1,
          title: 'Books extra',
          bodyMarkdown: 'Synthetic books text.',
          acknowledgments: [
            { key: 'monthly', label: 'Monthly', text: 'Synthetic.', required: true },
          ],
          publishedByUserId: ids.owner,
        },
      });
    });
  }
  await owner.$disconnect();
});

afterAll(async () => {
  await db.disconnect();
});

describe('IntakeSignaturesService.sign', () => {
  it('signs a Begin Online lead: evidence rows, database time, audit, then the submit', async () => {
    const draft = await leadDraft();
    const signed = await signAndSubmit(draft, input(draft));
    expect(signed).toMatchObject({
      printedName: 'Sam Sample',
      ip: '203.0.113.7',
      userAgent: 'Test browser/1.0',
    });
    expect(signed.evidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    // The returned time and the answers hash are the stored ones (the database's).
    const row = await inFirm((tx) =>
      tx.intakeSignature.findUniqueOrThrow({ where: { id: signed.signatureId } }),
    );
    expect(row.signedAt.getTime()).toBe(signed.signedAt.getTime());
    expect(row.answersSha256).toBe(
      createHash('sha256').update('{"name": "Sam Sample"}').digest('hex'),
    );

    const summary = await inFirm((tx) =>
      service.summary(tx, draft.submission.id, { showNetwork: true }),
    );
    expect(IntakeSignatureSummary.parse(summary)).toMatchObject({
      printedName: 'Sam Sample',
      typedSignature: 'sam sample',
      method: 'TYPED',
      agreements: [
        { agreementId: ids.firmWide, version: 1, bodySha256: firmWideSha, pdfSha256: sha(7) },
      ],
      legal: { termsVersion: 1, privacyVersion: 1 },
      ip: '203.0.113.7',
    });
    expect(summary?.acknowledgments.map((a) => [a.key, a.checked])).toEqual([
      ['read', true],
      ['tips', false],
    ]);
    const hidden = await inFirm((tx) =>
      service.summary(tx, draft.submission.id, { showNetwork: false }),
    );
    expect([hidden?.ip, hidden?.userAgent]).toEqual([null, null]);

    const audit = await inFirm((tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'intake.signed', entityId: draft.submission.id },
      }),
    );
    expect(audit.metadata).toMatchObject({ signatureId: signed.signatureId });
    expect(JSON.stringify(audit.metadata)).not.toContain('Sam Sample');
    expect(JSON.stringify(audit.metadata)).not.toContain('203.0.113.7');
    // A submitted version can't be signed again.
    await expect(inFirm((tx) => service.sign(tx, input(draft)))).rejects.toThrow();
  });

  it('refuses outdated agreements, missing ticks, a mismatched name and old Terms', async () => {
    const draft = await leadDraft();
    const outdated = await refused(
      inFirm((tx) => service.sign(tx, input(draft, { agreements: [firmWideSigned(sha(1))] }))),
    );
    expect(outdated.code).toBe('AGREEMENT_OUTDATED');
    expect(AgreementOutdatedDetails.parse(outdated.details)).toMatchObject({
      ready: true,
      agreements: [{ agreementId: ids.firmWide }],
      legal: { terms: { version: 1 }, privacy: { version: 1 } },
    });
    const cases: [Partial<SignIntakeInput['signature']>, string][] = [
      [{ acknowledgments: [] }, 'ACKNOWLEDGMENT_REQUIRED'],
      [{ acknowledgments: [{ agreementId: ids.firmWide, key: 'nope' }] }, 'VALIDATION_FAILED'],
      [
        { signer: { printedName: 'Sam Sample', method: 'TYPED', typedSignature: 'Someone' } },
        'SIGNATURE_MISMATCH',
      ],
      // The database's own name comparison: a dotted capital I folds differently in Postgres.
      [
        {
          signer: {
            printedName: 'İpek Sample',
            method: 'TYPED',
            typedSignature: 'i\u0307pek sample',
          },
        },
        'SIGNATURE_MISMATCH',
      ],
      [{ acceptLegal: { termsVersion: 2, privacyVersion: 1 } }, 'TERMS_OUTDATED'],
      [{ acceptLegal: null }, 'VALIDATION_FAILED'],
      [{ acceptLegal: undefined }, 'VALIDATION_FAILED'],
    ];
    for (const [change, code] of cases) {
      expect((await refused(inFirm((tx) => service.sign(tx, input(draft, change))))).code).toBe(
        code,
      );
    }
    // Nothing was written for the refused attempts.
    expect(
      await inFirm((tx) => service.summary(tx, draft.submission.id, { showNetwork: false })),
    ).toBeNull();
  });

  it("a service's extra agreement is signed with the firm-wide one", async () => {
    const draft = await leadDraft(ids.books);
    const books = { serviceId: ids.books };
    const only = await refused(inFirm((tx) => service.sign(tx, input(draft, {}, books))));
    expect(only.code).toBe('AGREEMENT_OUTDATED');
    const block = only.details as {
      agreements: { agreementId: string; version: number; bodySha256: string }[];
    };
    const all = block.agreements.map(({ agreementId, version, bodySha256 }) => ({
      agreementId,
      version,
      bodySha256,
    }));
    const ackOnlyFirmWide = await refused(
      inFirm((tx) => service.sign(tx, input(draft, { agreements: all }, books))),
    );
    expect(ackOnlyFirmWide.code).toBe('ACKNOWLEDGMENT_REQUIRED');
    const signed = await signAndSubmit(
      draft,
      input(
        draft,
        {
          agreements: all,
          acknowledgments: [
            { agreementId: ids.firmWide, key: 'read' },
            { agreementId: ids.booksAgreement, key: 'monthly' },
          ],
        },
        books,
      ),
    );
    const summary = await inFirm((tx) =>
      service.summary(tx, draft.submission.id, { showNetwork: false }),
    );
    expect(summary?.agreements.map((a) => a.agreementId).sort()).toEqual(
      [ids.firmWide, ids.booksAgreement].sort(),
    );
    expect(summary?.id).toBe(signed.signatureId);
  });

  it('a portal client signs without the Terms tick', async () => {
    const draft = await inFirm(async (tx) => {
      const intake = await tx.intake.create({
        data: { businessId: ids.firm, formId: ids.taxForm, engagementId: ids.engagement },
      });
      const submission = await tx.intakeSubmission.create({
        data: { businessId: ids.firm, intakeId: intake.id, version: 1 },
      });
      return { intake, submission, lead: { id: '', email: null } } as unknown as Draft;
    });
    const asClient = { signer: { kind: 'client', clientAccountId: ids.account } } as const;
    // The portal takes no Terms tick, and its outdated block has no legal.
    const ticked = await refused(inFirm((tx) => service.sign(tx, input(draft, {}, asClient))));
    expect(ticked.code).toBe('VALIDATION_FAILED');
    const old = await refused(
      inFirm((tx) =>
        service.sign(
          tx,
          input(draft, { acceptLegal: undefined, agreements: [firmWideSigned(sha(2))] }, asClient),
        ),
      ),
    );
    expect(old.code).toBe('AGREEMENT_OUTDATED');
    expect(AgreementOutdatedDetails.parse(old.details).legal).toBeNull();
    const signed = await signAndSubmit(
      draft,
      input(
        draft,
        { acceptLegal: undefined },
        { signer: { kind: 'client', clientAccountId: ids.account } },
      ),
      ids.clientUser,
    );
    const summary = await inFirm((tx) =>
      service.summary(tx, draft.submission.id, { showNetwork: true }),
    );
    expect(summary).toMatchObject({ id: signed.signatureId, legal: null });
    expect(IntakeSignatureSummary.parse(summary).answersSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a firm with no intake agreement refuses; another firm sees no signature', async () => {
    const draft = await leadDraft(undefined, ids.empty).catch(() => null);
    // Firm "empty" has its own services: reuse its first service's draft.
    const emptyDraft =
      draft ??
      (await db.withScope({ kind: 'business', businessId: ids.empty }, async (tx) => {
        const svc = await tx.service.findFirstOrThrow({ where: { kind: 'ANNUAL_TAX' } });
        const form = await tx.intakeForm.findFirstOrThrow({ where: { serviceId: svc.id } });
        const lead = await tx.lead.create({
          data: {
            businessId: ids.empty,
            serviceId: svc.id,
            firstName: 'E',
            lastName: 'Mpty',
            email: `e-${run}@r14.test`,
          },
        });
        const intake = await tx.intake.create({
          data: { businessId: ids.empty, formId: form.id, leadId: lead.id },
        });
        const submission = await tx.intakeSubmission.create({
          data: { businessId: ids.empty, intakeId: intake.id, version: 1 },
        });
        return { lead, intake, submission };
      }));
    const res = await refused(
      inFirm(
        (tx) =>
          service.sign(tx, {
            ...input(emptyDraft),
            businessId: ids.empty,
            serviceId: null,
          }),
        ids.empty,
      ),
    );
    expect(res.code).toBe('NO_INTAKE_AGREEMENT');
    const signedDraft = await leadDraft();
    await signAndSubmit(signedDraft, input(signedDraft));
    expect(
      await inFirm(
        (tx) => service.summary(tx, signedDraft.submission.id, { showNetwork: true }),
        ids.empty,
      ),
    ).toBeNull();
  });

  it('Begin Online asks no Terms tick unless both Terms and Privacy are published', async () => {
    // Firm "empty" now gets a firm-wide agreement and Terms, but no Privacy Policy.
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    const bodySha256 = await runInScope(
      owner,
      { kind: 'business', businessId: ids.empty },
      async (tx) => {
        await tx.firmLegalDocument.create({
          data: {
            businessId: ids.empty,
            kind: 'TERMS',
            version: 1,
            body: 'Not legal text.',
            publishedByUserId: ids.owner,
          },
        });
        const agreement = await tx.firmAgreement.create({
          data: { businessId: ids.empty, scope: 'ALL_INTAKES', createdByUserId: ids.owner },
        });
        ids.emptyFirmWide = agreement.id;
        const v = await tx.firmAgreementVersion.create({
          data: {
            businessId: ids.empty,
            agreementId: agreement.id,
            version: 1,
            title: 'Firm-wide',
            bodyMarkdown: 'Synthetic firm-wide text.',
            acknowledgments: ACKS,
            publishedByUserId: ids.owner,
          },
        });
        return v.bodySha256;
      },
    );
    await owner.$disconnect();
    const draft = await leadDraft(ids.emptyTax, ids.empty);
    const signature = {
      agreements: [{ agreementId: ids.emptyFirmWide, version: 1, bodySha256 }],
      acknowledgments: [{ agreementId: ids.emptyFirmWide, key: 'read' }],
    };
    const base = { ...input(draft), businessId: ids.empty, serviceId: ids.emptyTax };
    const sign = (change: Partial<SignIntakeInput['signature']>) =>
      inFirm(
        (tx) => service.sign(tx, { ...base, signature: { ...base.signature, ...change } }),
        ids.empty,
      );
    const stale = await refused(sign({ ...signature, agreements: [] }));
    expect(stale.code).toBe('AGREEMENT_OUTDATED');
    expect(AgreementOutdatedDetails.parse(stale.details).legal).toBeNull();
    const ticked = await refused(sign(signature));
    expect(ticked.code).toBe('VALIDATION_FAILED');
    const signed = await signAndSubmit(
      draft,
      { ...base, signature: { ...base.signature, ...signature, acceptLegal: null } },
      undefined,
      ids.empty,
    );
    const summary = await inFirm(
      (tx) => service.summary(tx, draft.submission.id, { showNetwork: false }),
      ids.empty,
    );
    expect(summary).toMatchObject({ id: signed.signatureId, legal: null });
  });
});
