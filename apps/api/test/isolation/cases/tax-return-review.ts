// The Tax Returns workspace (R55), part 2: filings and transmissions, checklist, review steps,
// authorizations, return documents and the export.
import type { CaseModule, SeedContext } from '../world.js';

const DAY = 86_400_000;

/** A part a record's create() sets (`staffMembership`'s pattern in team.ts). */
const partOf = (owner: string, key: string) => ({
  clientPrivate: true,
  async create({ get }: SeedContext) {
    await get(owner);
    return get(key);
  },
});

export const records: CaseModule['records'] = {
  /** The world's return's federal e-file filing, with one transmission waiting for its answer. */
  taxFiling: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get, set }) {
      const filing = await tx.taxReturnFiling.create({
        data: { businessId, taxReturnId: await get('taxReturn'), jurisdiction: 'US' },
      });
      const attempt = await tx.taxReturnFilingAttempt.create({
        data: {
          businessId,
          filingId: filing.id,
          submissionId: 'FAKE-001',
          transmittedAt: new Date(Date.now() - DAY),
          recordedByUserId: owner.id,
        },
      });
      set('taxFilingAttempt', attempt.id);
      return filing.id;
    },
  },
  taxFilingAttempt: partOf('taxFiling', 'taxFilingAttempt'),
  /** A state filing on paper, not filed yet. */
  taxPaperFiling: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const filing = await tx.taxReturnFiling.create({
        data: {
          businessId,
          taxReturnId: await get('taxReturn'),
          jurisdiction: 'NJ',
          filingMethod: 'PAPER',
        },
      });
      return filing.id;
    },
  },
  /** An open preparation line of the world's return. */
  taxChecklistItem: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taxReturnChecklistItem.create({
        data: {
          businessId,
          taxReturnId: await get('taxReturn'),
          section: 'PREPARATION',
          label: 'Fake line',
        },
      });
      return row.id;
    },
  },
  /** A pending review step (the Owner decides it as an approver). */
  taxApproval: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taxReturnApproval.create({
        data: {
          businessId,
          taxReturnId: await get('taxReturn'),
          step: 'Fake review',
          sortOrder: 0,
        },
      });
      return row.id;
    },
  },
  /** The return's Form 8879 line, not sent. */
  taxAuthorization: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taxReturnAuthorization.create({
        data: { businessId, taxReturnId: await get('taxReturn'), kind: 'FEDERAL_EFILE' },
      });
      return row.id;
    },
  },
  /** The world's shared document, linked to the return as a draft (its id is the document's). */
  linkedTaxDocument: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const documentId = await get('document');
      await tx.taxReturnDocument.create({
        data: { businessId, taxReturnId: await get('taxReturn'), documentId, kind: 'DRAFT_RETURN' },
      });
      return documentId;
    },
  },
};

const ret = { id: 'taxReturn' };

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/tax-returns/:id/filings': { params: ret },
  'PUT /api/v1/business/tax-returns/:id/filings': {
    params: ret,
    body: { filings: [{ jurisdiction: 'US' }] },
  },
  'PATCH /api/v1/business/tax-returns/:id/filings/:filingId': {
    params: { id: 'taxReturn', filingId: 'taxFiling' },
    body: { required: false },
  },
  // The filing waits for its answer: found, then refused (409 ATTEMPT_PENDING).
  'POST /api/v1/business/tax-returns/:id/filings/:filingId/attempts': {
    params: { id: 'taxReturn', filingId: 'taxFiling' },
    body: { submissionId: 'FAKE-002', transmittedAt: '2026-01-02T00:00:00.000Z' },
    expect: 409,
  },
  'PATCH /api/v1/business/tax-returns/:id/attempts/:attemptId': {
    params: { id: 'taxReturn', attemptId: 'taxFilingAttempt' },
    body: { ackStatus: 'NOTE', correctiveAction: 'Fake note' },
  },
  'POST /api/v1/business/tax-returns/:id/filings/:filingId/paper-filed': {
    params: { id: 'taxReturn', filingId: 'taxPaperFiling' },
    body: { paperFiledOn: '2026-01-02' },
  },
  'GET /api/v1/business/tax-returns/:id/checklist': { params: ret },
  'POST /api/v1/business/tax-returns/:id/checklist': {
    params: ret,
    body: { section: 'PREPARATION', label: 'Fake new line' },
  },
  'PATCH /api/v1/business/tax-returns/:id/checklist/:itemId': {
    params: { id: 'taxReturn', itemId: 'taxChecklistItem' },
    body: { note: 'Fake note' },
  },
  'DELETE /api/v1/business/tax-returns/:id/checklist/:itemId': {
    params: { id: 'taxReturn', itemId: 'taxChecklistItem' },
  },
  'POST /api/v1/business/tax-returns/:id/final-validation': { params: ret },
  'GET /api/v1/business/tax-returns/:id/approvals': { params: ret },
  'POST /api/v1/business/tax-returns/:id/approvals': {
    params: ret,
    bodyIds: { assignedUserId: 'adminUser' },
    body: { step: 'Fake step', assignedUserId: '00000000-0000-4000-8000-000000000000' },
  },
  'POST /api/v1/business/tax-returns/:id/approvals/:approvalId/approve': {
    params: { id: 'taxReturn', approvalId: 'taxApproval' },
    bodyIds: { approvedDocumentId: 'document' },
    body: { approvedDocumentId: '00000000-0000-4000-8000-000000000000' },
  },
  'POST /api/v1/business/tax-returns/:id/approvals/:approvalId/return': {
    params: { id: 'taxReturn', approvalId: 'taxApproval' },
    body: { note: 'Fake note' },
  },
  'GET /api/v1/business/tax-returns/:id/authorizations': { params: ret },
  'PUT /api/v1/business/tax-returns/:id/authorizations': {
    params: ret,
    body: { items: [{ kind: 'FEDERAL_EFILE' }] },
  },
  'POST /api/v1/business/tax-returns/:id/authorizations/:authorizationId/link': {
    params: { id: 'taxReturn', authorizationId: 'taxAuthorization' },
    bodyIds: { esignRequestId: 'esignDraft' },
    body: { esignRequestId: '00000000-0000-4000-8000-000000000000' },
  },
  'POST /api/v1/business/tax-returns/:id/authorizations/:authorizationId/wet-signature': {
    params: { id: 'taxReturn', authorizationId: 'taxAuthorization' },
    bodyIds: { documentId: 'document' },
    body: { signedOn: '2026-01-02', documentId: '00000000-0000-4000-8000-000000000000' },
  },
  'GET /api/v1/business/tax-returns/:id/documents': { params: ret },
  'POST /api/v1/business/tax-returns/:id/documents': {
    params: ret,
    bodyIds: { documentId: 'document' },
    body: { documentId: '00000000-0000-4000-8000-000000000000', kind: 'DRAFT_RETURN' },
  },
  'DELETE /api/v1/business/tax-returns/:id/documents/:documentId': {
    params: { id: 'taxReturn', documentId: 'linkedTaxDocument' },
  },
};
