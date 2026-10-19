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
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/clients/:id/terms`]: { params: { id: 'bookkeepingClient' } },
  [`GET ${BASE}/clients/:id/terms/history`]: { params: { id: 'bookkeepingClient' } },
  [`GET ${BASE}/clients/:id/terms/payment-schedule`]: { params: { id: 'bookkeepingClient' } },
  [`POST ${BASE}/clients/:id/terms`]: { params: { id: 'bookkeepingClient' }, body: {} },
  [`GET ${BASE}/terms/:termsId`]: { params: { termsId: 'bookkeepingTerms' } },
  [`PATCH ${BASE}/terms/:termsId`]: {
    params: { termsId: 'bookkeepingTerms' },
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
