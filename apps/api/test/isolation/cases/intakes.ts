// Intake forms of a client's engagement: the portal side (fill in, upload) and the firm's review.
import { createHash, randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const ACKS = [
  { key: 'read', label: 'I read it', text: 'Synthetic acknowledgment.', required: true },
];

export const records: CaseModule['records'] = {
  /**
   * Firm P's published firm-wide intake agreement (its current version's id). One per firm, so
   * every world shares the first one.
   */
  firmWideAgreement: {
    async create({ tx, businessId, owner }) {
      const current = await tx.firmAgreementVersion.findFirst({
        where: { businessId, agreement: { scope: 'ALL_INTAKES', archivedAt: null } },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (current) return current.id;
      const agreement = await tx.firmAgreement.create({
        data: { businessId, scope: 'ALL_INTAKES', createdByUserId: owner.id },
      });
      const version = await tx.firmAgreementVersion.create({
        data: {
          businessId,
          agreementId: agreement.id,
          version: 1,
          title: 'Fake intake agreement',
          bodyMarkdown: '# Fake intake agreement\n\nNot legal text.',
          acknowledgments: ACKS,
          publishedByUserId: owner.id,
        },
      });
      return version.id;
    },
  },
  /** Client X's intake of their annual tax engagement, open (IN_PROGRESS) with its draft. */
  intake: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.intake.create({
        data: {
          businessId,
          formId: await get('intakeForm'),
          engagementId: await get('engagement'),
          status: 'IN_PROGRESS',
        },
      });
      await tx.intakeSubmission.create({ data: { businessId, intakeId: row.id, version: 1 } });
      return row.id;
    },
  },
  /** Client X's intake sent to the firm (SUBMITTED), on an engagement of its own. */
  submittedIntake: {
    clientPrivate: true,
    async create({ tx, businessId, own, get }) {
      const engagement = await tx.engagement.create({
        data: {
          businessId,
          clientId: await get('client'),
          serviceId: own.service,
          title: 'Fake 2024 return',
          taxYear: 2024,
        },
      });
      const row = await tx.intake.create({
        data: {
          businessId,
          formId: await get('intakeForm'),
          engagementId: engagement.id,
          status: 'IN_PROGRESS',
        },
      });
      const draft = await tx.intakeSubmission.create({
        data: { businessId, intakeId: row.id, version: 1, answers: { firstName: 'Fake' } },
      });
      // Submitting needs client X's signature of the firm-wide agreement in this transaction,
      // made as client X's login (the database checks the actor), as R14's sign() will.
      const version = await tx.firmAgreementVersion.findUniqueOrThrow({
        where: { id: await get('firmWideAgreement') },
      });
      const account = await tx.clientAccount.findFirstOrThrow({
        where: { businessId, userId: await get('clientUser') },
      });
      await tx.$executeRaw`SELECT set_config('app.current_actor_id', ${account.userId}, true)`;
      const sig = await tx.intakeSignature.create({
        data: {
          businessId,
          submissionId: draft.id,
          intakeId: row.id,
          clientAccountId: account.id,
          printedName: 'Fake Client X',
          signatureText: 'Fake Client X',
          acknowledgments: ACKS.map((a) => ({
            agreementVersionId: version.id,
            ...a,
            checked: true,
          })),
          answersSha256: '0'.repeat(64),
          evidenceSha256: createHash('sha256').update(randomUUID()).digest('hex'),
          agreements: {
            create: {
              agreementVersionId: version.id,
              bodySha256: version.bodySha256,
              pdfSha256: version.pdfSha256,
            },
          },
        },
      });
      await tx.$executeRaw`SELECT set_config('app.current_actor_id', '', true)`;
      await tx.intakeSubmission.update({
        where: { id: draft.id },
        data: { submittedAt: new Date(), signerName: sig.printedName, signedAt: sig.signedAt },
      });
      await tx.intake.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
      return row.id;
    },
  },
  /** A file client X put in a slot of their open intake. */
  intakeUpload: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const tag = randomUUID();
      const row = await tx.document.create({
        data: {
          businessId,
          clientId: await get('client'),
          engagementId: await get('engagement'),
          intakeId: await get('intake'),
          intakeSlot: 'incomeDocuments',
          direction: 'CLIENT_TO_FIRM',
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: createHash('sha256').update(tag).digest('hex'),
          s3Key: `tenant/${businessId}/iso/${tag}/fake.pdf`,
          uploadedByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/portal/:firmSlug/me/intakes/:id': { params: { id: 'intake' } },
  'PUT /api/v1/portal/:firmSlug/me/intakes/:id/steps/:stepKey': {
    params: { id: 'intake' },
    body: { answers: {} },
  },
  'POST /api/v1/portal/:firmSlug/me/intakes/:id/uploads': {
    params: { id: 'intake' },
    body: {
      slot: 'incomeDocuments',
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: createHash('sha256').update('fake').digest('hex'),
    },
  },
  // Found, then the token (made by the upload step above, not here) has expired: 410.
  'POST /api/v1/portal/:firmSlug/me/intakes/:id/uploads/confirm': {
    params: { id: 'intake' },
    body: { uploadToken: 'fake-token' },
    expect: 410,
  },
  'DELETE /api/v1/portal/:firmSlug/me/intakes/:id/uploads/:documentId': {
    params: { id: 'intake', documentId: 'intakeUpload' },
  },
  'GET /api/v1/business/clients/:id/intakes': { params: { id: 'client' } },
  'POST /api/v1/business/engagements/:id/intakes': { params: { id: 'engagement' }, body: {} },
  'GET /api/v1/business/intakes/:id': { params: { id: 'intake' } },
  'POST /api/v1/business/intakes/:id/review': { params: { id: 'submittedIntake' } },
  'POST /api/v1/business/intakes/:id/complete': { params: { id: 'submittedIntake' } },
  'POST /api/v1/business/intakes/:id/request-correction': {
    params: { id: 'submittedIntake' },
    body: { note: 'Fake note' },
  },
  'POST /api/v1/business/intakes/:id/unlock': { params: { id: 'submittedIntake' } },
};
