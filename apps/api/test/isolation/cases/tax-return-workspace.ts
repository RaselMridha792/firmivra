// The Tax Returns workspace (R55), part 1: a return by id, Create New Return's body.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const PLACEHOLDER = randomUUID();

export const records: CaseModule['records'] = {
  /** Client X's 2024 return, filed (R10's way), so it can be amended. */
  filedTaxReturn: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taxReturn.create({
        data: {
          businessId,
          clientId: await get('client'),
          taxYear: 2024,
          filingType: 'INDIVIDUAL',
          status: 'FILED',
          filedOn: new Date('2025-04-10T00:00:00Z'),
        },
      });
      return row.id;
    },
  },
};

const ret = { id: 'taxReturn' };

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/tax-returns': {
    params: {},
    // An amendment of client X's filed return (no duplicate check), with its people.
    bodyIds: {
      clientId: 'client',
      engagementId: 'engagement',
      preparerUserId: 'adminUser',
      reviewerUserId: 'adminUser',
      amendsReturnId: 'filedTaxReturn',
    },
    body: {
      taxYear: 2024,
      filingType: 'INDIVIDUAL',
      amendReason: 'Fake reason',
      clientId: PLACEHOLDER,
      engagementId: PLACEHOLDER,
      preparerUserId: PLACEHOLDER,
      reviewerUserId: PLACEHOLDER,
      amendsReturnId: PLACEHOLDER,
    },
  },
  'GET /api/v1/business/tax-returns/:id': { params: ret },
  'PATCH /api/v1/business/tax-returns/:id/details': {
    params: ret,
    bodyIds: {
      preparerUserId: 'adminUser',
      reviewerUserId: 'adminUser',
      engagementId: 'engagement',
    },
    body: { preparerUserId: PLACEHOLDER, reviewerUserId: PLACEHOLDER, engagementId: PLACEHOLDER },
  },
  'POST /api/v1/business/tax-returns/:id/status': {
    params: ret,
    body: { workflowStatus: 'WAITING_ON_CLIENT' },
  },
  'GET /api/v1/business/tax-returns/:id/history': { params: ret },
  'GET /api/v1/business/tax-returns/:id/activity': { params: ret },
  'POST /api/v1/business/tax-returns/:id/archive': { params: ret },
  'POST /api/v1/business/tax-returns/:id/restore': { params: ret },
  'POST /api/v1/business/tax-returns/:id/amend': {
    params: { id: 'filedTaxReturn' },
    body: { reason: 'Fake reason' },
  },
  'POST /api/v1/business/tax-returns/:id/carry-forward': {
    params: ret,
    body: { taxYear: 2030 },
  },
};
