// Intake forms of a client's engagement: the portal side (fill in, upload) and the firm's review.
import { createHash, randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
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
      await tx.intakeSubmission.create({
        data: {
          businessId,
          intakeId: row.id,
          version: 1,
          answers: { firstName: 'Fake' },
          submittedAt: new Date(),
          signerName: 'Fake Client X',
          signedAt: new Date(),
        },
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
