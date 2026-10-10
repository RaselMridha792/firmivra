// An Owner's answers to Firmivra Support's requests to enter the firm (R8).
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** A Super Admin's pending request to enter firm P. */
  supportRequest: {
    async create({ tx, businessId, person }) {
      const admin = await person('support', 'STAFF');
      const row = await tx.supportAccessGrant.create({
        data: { businessId, adminUserId: admin.id, reason: 'Fake support reason' },
      });
      return row.id;
    },
  },
  /** A request firm P's Owner approved: an active grant (requests start unapproved). */
  supportGrant: {
    async create({ tx, businessId, owner, person }) {
      const admin = await person('support', 'STAFF');
      const { id } = await tx.supportAccessGrant.create({
        data: { businessId, adminUserId: admin.id, reason: 'Fake support reason' },
      });
      await tx.supportAccessGrant.update({
        where: { id },
        data: { grantedByUserId: owner.id, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      return id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/support-access/:id/approve': {
    params: { id: 'supportRequest' },
    body: { hours: 2 },
  },
  'POST /api/v1/business/support-access/:id/decline': { params: { id: 'supportRequest' } },
  'POST /api/v1/business/support-access/:id/revoke': { params: { id: 'supportGrant' } },
};
