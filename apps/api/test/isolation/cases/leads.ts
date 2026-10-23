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
  /** A service of the world's firm, for the pipeline's `serviceIds` (R57). */
  leadService: {
    async create({ tx, businessId }) {
      const row = await tx.service.create({
        data: { businessId, kind: 'OTHER', name: `Lead service ${randomUUID().slice(0, 8)}` },
      });
      return row.id;
    },
  },
  /** A plain open lead whose first service is `leadService`, for Convert Lead to Client (R57). */
  leadConvert: {
    async create({ tx, businessId, get }) {
      const row = await tx.lead.create({
        data: {
          businessId,
          serviceId: await get('leadService'),
          status: 'SUBMITTED',
          submittedAt: new Date(),
          firstName: 'Fake',
          lastName: 'Convert',
          email: `iso-convert-${randomUUID().slice(0, 8)}@iso.test`,
        },
      });
      return row.id;
    },
  },
  /** An open lead with a next action, for completing a follow-up (R57). */
  leadFollowUp: {
    async create({ tx, businessId, own }) {
      const row = await tx.lead.create({
        data: {
          businessId,
          serviceId: own.service,
          status: 'SUBMITTED',
          submittedAt: new Date(),
          firstName: 'Fake',
          lastName: 'FollowUp',
          email: `iso-follow-${randomUUID().slice(0, 8)}@iso.test`,
          nextActionType: 'CALL',
          nextActionAt: new Date(Date.now() + 86_400_000),
        },
      });
      return row.id;
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
  // The Leads pipeline (R57). `campaignId` and the bulk and message `ids` are in body-ids.ts'
  // NOT_RECORDS; the e2e tests (leads-pipeline.e2e.test.ts) cover those.
  'POST /api/v1/business/leads': {
    params: {},
    body: {
      firstName: 'Fake',
      lastName: 'Created',
      email: 'iso-created@iso.test',
      source: 'REFERRAL',
      allowDuplicate: true,
    },
    bodyIds: { serviceIds: 'leadService', assignedUserId: 'staffUser' },
  },
  'POST /api/v1/business/leads/bulk': {
    params: {},
    body: { action: 'ASSIGN', ids: ['01a14ebc-7954-75a4-be30-0ba529ae2e1a'] },
    bodyIds: { assignedUserId: 'staffUser' },
  },
  'GET /api/v1/business/leads/:id/profile': { params: { id: 'lead' } },
  'PATCH /api/v1/business/leads/:id': {
    params: { id: 'leadConvert' },
    body: { priority: 'COLD' },
    bodyIds: { serviceIds: 'leadService', assignedUserId: 'staffUser' },
  },
  // Lead Profile tabs and Convert Lead to Client (R57 part 2).
  'PUT /api/v1/business/leads/:id/follow-up': {
    params: { id: 'lead' },
    body: { type: 'CALL', dueAt: '2030-01-01T10:00:00Z' },
  },
  'POST /api/v1/business/leads/:id/follow-up/complete': {
    params: { id: 'leadFollowUp' },
    body: {},
  },
  'GET /api/v1/business/leads/:id/activity': { params: { id: 'lead' } },
  'POST /api/v1/business/leads/:id/activity': {
    params: { id: 'lead' },
    body: { kind: 'CALL', summary: 'Fake call' },
  },
  'GET /api/v1/business/leads/:id/notes': { params: { id: 'lead' } },
  'POST /api/v1/business/leads/:id/notes': { params: { id: 'lead' }, body: { text: 'Fake note' } },
  'GET /api/v1/business/leads/:id/tasks': { params: { id: 'lead' } },
  'GET /api/v1/business/leads/:id/appointments': { params: { id: 'lead' } },
  'GET /api/v1/business/leads/:id/documents-and-forms': { params: { id: 'lead' } },
  // The lead's first service is `leadService`, named in the body; the client and staff too.
  'POST /api/v1/business/leads/:id/convert-to-client': {
    params: { id: 'leadConvert' },
    body: {
      idempotencyKey: '01a14ebc-7954-75a4-be30-0ba529ae2e1b',
      fullName: 'Fake Convert',
      email: 'iso-convert@iso.test',
      phone: '+15550100000',
      sendPortalInvite: false,
    },
    bodyIds: {
      serviceIds: 'leadService',
      primaryStaffUserId: 'staffUser',
      additionalStaffUserIds: 'staffUser',
      clientId: 'client',
    },
  },
};

// The lead email's images (L4). The firm routes (`messages/images`, `/confirm`, and the member's
// own `me/message-signature`) name no record; firm B never confirms, reads or is served firm A's
// in test/e2e/lead-email.e2e.test.ts.
export const excluded: CaseModule['excluded'] = {
  'GET /api/v1/portal/:firmSlug/email-images/:file':
    "Public: an image a member put in a lead email (a random id); one firm's slug only ever reaches that firm's files",
};
