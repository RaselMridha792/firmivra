// Begin Online leads in the firm's inbox: review, convert, decline and the visitor's files.
import { createHash, randomUUID } from 'node:crypto';
import { submitLeadVersion } from '../../submitted-lead.js';
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /**
   * A lead a visitor sent (SUBMITTED), with its intake, answers and one clean file. Each world its
   * own. Files are added only while the lead is a draft, so the file is made here too.
   */
  lead: {
    async create({ tx, businessId, owner, own, get, set }) {
      const tag = randomUUID();
      const lead = await tx.lead.create({
        data: {
          businessId,
          serviceId: own.service,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `iso-lead-${tag.slice(0, 8)}@iso.test`,
          taxYear: 2025,
        },
      });
      const intake = await tx.intake.create({
        data: {
          businessId,
          formId: await get('intakeForm'),
          leadId: lead.id,
          status: 'IN_PROGRESS',
        },
      });
      const v1 = await tx.intakeSubmission.create({
        data: { businessId, intakeId: intake.id, version: 1, answers: { firstName: 'Fake' } },
      });
      const upload = await tx.leadUpload.create({
        data: {
          businessId,
          leadId: lead.id,
          slot: 'incomeDocuments',
          fileName: 'fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: createHash('sha256').update(tag).digest('hex'),
          s3Key: `tenant/${businessId}/begin-online/${tag}`,
        },
      });
      // As the scanner would: a clean file can be downloaded.
      await tx.leadUpload.update({
        where: { id: upload.id },
        data: { scanStatus: 'CLEAN', scannedAt: new Date() },
      });
      set('leadUpload', upload.id);
      // As Begin Online's submit leaves it: v1 signed and submitted, the intake and lead SUBMITTED.
      await submitLeadVersion(tx, {
        businessId,
        ownerId: owner.id,
        leadId: lead.id,
        intakeId: intake.id,
        submissionId: v1.id,
      });
      return lead.id;
    },
  },
  /** The lead's clean file, made with the lead (above). */
  leadUpload: {
    async create({ get }) {
      await get('lead');
      return get('leadUpload');
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/leads/:id': { params: { id: 'lead' } },
  'POST /api/v1/business/leads/:id/review': { params: { id: 'lead' } },
  'POST /api/v1/business/leads/:id/decline': {
    params: { id: 'lead' },
    body: { reason: 'Fake reason' },
  },
  // Converts into the world's client, assigned to its staff member (both named in the body).
  'POST /api/v1/business/leads/:id/convert': {
    params: { id: 'lead' },
    bodyIds: { clientId: 'client', assignedUserId: 'staffUser' },
  },
  // No file store in tests: found, then 503.
  'GET /api/v1/business/leads/:id/uploads/:uploadId/download': {
    params: { id: 'lead', uploadId: 'leadUpload' },
    expect: 503,
  },
};
