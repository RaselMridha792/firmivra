// Bookkeeping Terms (R55): a bookkeeping client's engagement terms, on client X's Bookkeeping
// engagement (the `workspace` record). A write case runs in a fresh world: one draft serves all.
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/bookkeeping';
const PLACEHOLDER = '0199b6a0-0000-7000-8000-00000000abcd';

export const records: CaseModule['records'] = {
  /** Draft terms (version 1) of client X's bookkeeping client. */
  bookkeepingTerms: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      await get('bookkeepingClient');
      const row = await tx.bookkeepingTerms.create({
        data: {
          businessId,
          engagementId: await get('workspace'),
          version: 0,
          packageName: 'Fake Growth Plan',
          startDate: new Date('2030-01-15T00:00:00.000Z'),
          effectiveFrom: new Date('2030-01-15T00:00:00.000Z'),
        },
        select: { id: true },
      });
      return row.id;
    },
  },
  /** BK-CP3: terms of client X's bookkeeping client, sent to client X (their portal shows it). */
  bookkeepingTermsSent: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      await get('bookkeepingClient');
      const { id } = await tx.bookkeepingTerms.create({
        data: {
          businessId,
          engagementId: await get('workspace'),
          version: 0,
          packageName: 'Fake Sent Plan',
          startDate: new Date('2030-01-15T00:00:00.000Z'),
          effectiveFrom: new Date('2030-01-15T00:00:00.000Z'),
        },
        select: { id: true },
      });
      await tx.bookkeepingTerms.update({ where: { id }, data: { status: 'SENT' } });
      return id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  // ---------- BK-CP3: the portal's terms, client X's own sent version ----------
  'GET /api/v1/portal/:firmSlug/me/bookkeeping-terms/:termsId': {
    params: { termsId: 'bookkeepingTermsSent' },
  },
  // Found, but the answer names another sending of it (the database stamps the real one).
  'POST /api/v1/portal/:firmSlug/me/bookkeeping-terms/:termsId/accept': {
    params: { termsId: 'bookkeepingTermsSent' },
    body: { sentAt: '2030-01-01T00:00:00.000Z' },
    expect: 409,
  },
  'POST /api/v1/portal/:firmSlug/me/bookkeeping-terms/:termsId/decline': {
    params: { termsId: 'bookkeepingTermsSent' },
    body: { sentAt: '2030-01-01T00:00:00.000Z' },
    expect: 409,
  },

  [`GET ${BASE}/clients/:id/terms`]: { params: { id: 'bookkeepingClient' } },
  [`GET ${BASE}/clients/:id/terms/history`]: { params: { id: 'bookkeepingClient' } },
  [`GET ${BASE}/clients/:id/terms/payment-schedule`]: { params: { id: 'bookkeepingClient' } },
  [`POST ${BASE}/clients/:id/terms`]: {
    params: { id: 'bookkeepingClient' },
    // Review 2 (E01b): the package chosen from Services & Pricing.
    bodyIds: { catalogServiceId: 'bookkeepingCatalogService' },
    body: {},
  },
  [`GET ${BASE}/terms/:termsId`]: { params: { termsId: 'bookkeepingTerms' } },
  [`PATCH ${BASE}/terms/:termsId`]: {
    params: { termsId: 'bookkeepingTerms' },
    // Review 2 (E01b): the package chosen from Services & Pricing.
    bodyIds: { catalogServiceId: 'bookkeepingCatalogService' },
    body: { monthlyFeeCents: 29_000 },
  },
  [`POST ${BASE}/terms/:termsId/send`]: { params: { termsId: 'bookkeepingTerms' }, body: {} },
  // Found, but a draft is not SENT.
  [`POST ${BASE}/terms/:termsId/back-to-draft`]: {
    params: { termsId: 'bookkeepingTerms' },
    expect: 409,
  },
  [`POST ${BASE}/terms/:termsId/activate`]: {
    params: { termsId: 'bookkeepingTerms' },
    body: { requireSigned: false },
  },
  // Found, but a draft is not in force.
  [`POST ${BASE}/terms/:termsId/terminate`]: {
    params: { termsId: 'bookkeepingTerms' },
    body: { reason: 'Fake reason', effectiveDate: '2030-12-31' },
    expect: 409,
  },
  [`POST ${BASE}/terms/:termsId/notices`]: {
    params: { termsId: 'bookkeepingTerms' },
    body: { kind: 'NOTE', reason: 'Fake note' },
    expect: 409,
  },
  [`PUT ${BASE}/terms/:termsId/agreement`]: {
    params: { termsId: 'bookkeepingTerms' },
    bodyIds: {
      agreementDocumentId: 'workspaceDocument',
      signedAgreementDocumentId: 'workspaceDocument',
      esignRequestId: 'esignDraft',
    },
    body: {
      agreementDocumentId: PLACEHOLDER,
      signedAgreementDocumentId: PLACEHOLDER,
      esignRequestId: PLACEHOLDER,
    },
  },
};
