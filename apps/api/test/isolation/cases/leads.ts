// Begin Online leads in the firm's inbox: review, convert, decline and the visitor's files.
import { createHash, randomUUID } from 'node:crypto';
import { submitLeadVersion } from '../../submitted-lead.js';
import type { CaseModule, SeedContext } from '../world.js';

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
  /** An open lead with one unfinished follow-up step, `leadStep` (L8, R55). */
  leadStepLead: {
    async create({ tx, businessId, own, set }) {
      const due = new Date(Date.now() + 86_400_000);
      const row = await tx.lead.create({
        data: {
          businessId,
          serviceId: own.service,
          status: 'SUBMITTED',
          submittedAt: new Date(),
          firstName: 'Fake',
          lastName: 'Steps',
          email: `iso-steps-${randomUUID().slice(0, 8)}@iso.test`,
          nextActionType: 'CALL',
          nextActionAt: due,
        },
      });
      const step = await tx.leadFollowUp.create({
        data: { businessId, leadId: row.id, actionType: 'CALL', dueAt: due },
      });
      set('leadStep', step.id);
      return row.id;
    },
  },
  /** The step, made with its lead (above). */
  leadStep: {
    async create({ get }) {
      await get('leadStepLead');
      return get('leadStep');
    },
  },
  /** Leads R2 17: an assignment rule of the firm, its owner the assignee. */
  leadRule: {
    async create({ tx, businessId, owner }) {
      const row = await tx.leadAssignmentRule.create({
        data: { businessId, name: 'Fake rule', position: 0, assigneeUserId: owner.id },
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
  /** An open lead with one open task of its own, `leadTask` (Leads R2 2, tasks.lead_id). */
  leadTaskLead: {
    async create({ tx, businessId, own, owner, set }) {
      const row = await tx.lead.create({
        data: {
          businessId,
          serviceId: own.service,
          status: 'CONTACTED',
          submittedAt: new Date(),
          firstName: 'Fake',
          lastName: 'Tasks',
          email: `iso-tasks-${randomUUID().slice(0, 8)}@iso.test`,
        },
      });
      const task = await tx.task.create({
        data: {
          businessId,
          leadId: row.id,
          title: 'Fake lead task',
          dueOn: new Date('2030-01-01T00:00:00Z'),
          createdByUserId: owner.id,
        },
      });
      set('leadTask', task.id);
      return row.id;
    },
  },
  leadTask: {
    async create({ get }) {
      await get('leadTaskLead');
      return get('leadTask');
    },
  },
  /** An open lead with a file the firm added, `leadStaffFile` (Leads R2 4, the 'staff' slot). */
  leadFileLead: {
    async create({ tx, businessId, own, owner, set }) {
      const tag = randomUUID();
      const row = await tx.lead.create({
        data: {
          businessId,
          serviceId: own.service,
          status: 'CONTACTED',
          submittedAt: new Date(),
          firstName: 'Fake',
          lastName: 'Files',
          email: `iso-files-${tag.slice(0, 8)}@iso.test`,
        },
      });
      const file = await tx.leadUpload.create({
        data: {
          businessId,
          leadId: row.id,
          slot: 'staff',
          uploadedByUserId: owner.id,
          fileName: 'fake-staff.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: createHash('sha256').update(tag).digest('hex'),
          s3Key: `tenant/${businessId}/leads/${row.id}/${tag}`,
        },
      });
      set('leadStaffFile', file.id);
      return row.id;
    },
  },
  leadStaffFile: {
    async create({ get }) {
      await get('leadFileLead');
      return get('leadStaffFile');
    },
  },
  // Leads R2 15: open leads of their own for the merge and "Not a duplicate" routes (the firm's
  // own control call really merges or dismisses them).
  ...Object.fromEntries(
    ['leadMergeA', 'leadMergeB', 'leadDismissA', 'leadDismissB'].map((key) => [
      key,
      {
        async create({ tx, businessId, own }: SeedContext) {
          const row = await tx.lead.create({
            data: {
              businessId,
              serviceId: own.service,
              status: 'CONTACTED',
              submittedAt: new Date(),
              firstName: 'Fake',
              lastName: key,
              email: `iso-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@iso.test`,
            },
          });
          return row.id;
        },
      },
    ]),
  ),
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
  // The Leads pipeline (R57). The bulk bar's `campaignId` and the bulk and message `ids` are in
  // body-ids.ts' NOT_RECORDS; the e2e tests (leads-pipeline, lead-campaigns) cover those.
  'POST /api/v1/business/leads': {
    params: {},
    body: {
      firstName: 'Fake',
      lastName: 'Created',
      email: 'iso-created@iso.test',
      source: 'REFERRAL',
      allowDuplicate: true,
    },
    bodyIds: {
      serviceIds: 'leadService',
      assignedUserId: 'staffUser',
      campaignId: 'communication',
    },
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
    bodyIds: {
      serviceIds: 'leadService',
      assignedUserId: 'staffUser',
      campaignId: 'communication',
    },
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
  // L8 (R55): a lead's follow-up steps.
  'POST /api/v1/business/leads/:id/follow-ups': {
    params: { id: 'leadStepLead' },
    body: { type: 'EMAIL', dueAt: '2030-01-01T10:00:00Z' },
  },
  'PATCH /api/v1/business/leads/:id/follow-ups/:followUpId': {
    params: { id: 'leadStepLead', followUpId: 'leadStep' },
    body: { notes: 'Fake note' },
  },
  'DELETE /api/v1/business/leads/:id/follow-ups/:followUpId': {
    params: { id: 'leadStepLead', followUpId: 'leadStep' },
  },
  'POST /api/v1/business/leads/:id/follow-ups/:followUpId/complete': {
    params: { id: 'leadStepLead', followUpId: 'leadStep' },
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
  // Leads R2 17: Settings > Lead assignment names members, services and rules.
  'PUT /api/v1/business/lead-routing': {
    params: {},
    body: {
      enabled: false,
      fallbackUserId: null,
      rules: [{ id: null, name: 'Fake rule', serviceIds: [], assigneeUserId: null }],
    },
    bodyIds: {
      fallbackUserId: 'staffUser',
      'rules.id': 'leadRule',
      'rules.serviceIds': 'leadService',
      'rules.assigneeUserId': 'staffUser',
    },
  },
  // Leads R2 16: import checks rows against the firm's own default service (a dry run here);
  // export of the selected leads: no file store in tests, so the firm's own lead gets 503.
  'POST /api/v1/business/leads/import': {
    params: {},
    body: {
      rows: [{ firstName: 'Fake', lastName: 'Import', email: 'iso-import@iso.test' }],
      dryRun: true,
    },
    bodyIds: { defaultServiceId: 'leadService' },
  },
  'POST /api/v1/business/leads/export': {
    params: {},
    body: { scope: 'SELECTED', fields: ['name'] },
    bodyIds: { ids: 'lead' },
    expect: 503,
  },
  // Leads R2 15: "Not a duplicate" names two leads; a merge names the lead merged in.
  'POST /api/v1/business/leads/duplicates/dismiss': {
    params: {},
    body: {},
    bodyIds: { leadId: 'leadDismissA', otherLeadId: 'leadDismissB' },
  },
  'POST /api/v1/business/leads/:id/merge': {
    params: { id: 'leadMergeA' },
    body: {},
    bodyIds: { mergeLeadId: 'leadMergeB' },
  },
  // Leads R2 2: a lead's own tasks; the assignee is a member of the lead's firm.
  'POST /api/v1/business/leads/:id/tasks': {
    params: { id: 'leadTaskLead' },
    body: { title: 'Fake task', dueOn: '2030-01-02' },
    bodyIds: { assignedUserId: 'staffUser' },
  },
  'PATCH /api/v1/business/leads/:id/tasks/:taskId': {
    params: { id: 'leadTaskLead', taskId: 'leadTask' },
    body: { done: true },
  },
  // Leads R2 4: files the firm adds to a lead. Confirm's own token is made-up: 410 at home.
  'POST /api/v1/business/leads/:id/files': {
    params: { id: 'leadFileLead' },
    body: {
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    },
  },
  'POST /api/v1/business/leads/:id/files/confirm': {
    params: { id: 'leadFileLead' },
    body: { uploadToken: 'made-up-token' },
    expect: 410,
  },
  'DELETE /api/v1/business/leads/:id/files/:fileId': {
    params: { id: 'leadFileLead', fileId: 'leadStaffFile' },
  },
  'GET /api/v1/business/leads/:id/appointments': { params: { id: 'lead' } },
  'GET /api/v1/business/leads/:id/documents-and-forms': { params: { id: 'lead' } },
  // The lead's first service is `leadService`, named in the body; the client and staff too.
  'POST /api/v1/business/leads/bulk-convert': {
    params: {},
    body: {
      idempotencyKey: '01a14ebc-7954-75a4-be30-0ba529ae2e1c',
      ids: ['01a14ebc-7954-75a4-be30-0ba529ae2e1a'],
      sendPortalInvite: false,
    },
    bodyIds: { primaryStaffUserId: 'staffUser' },
  },
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
