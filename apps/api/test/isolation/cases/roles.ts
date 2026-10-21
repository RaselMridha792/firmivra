// A firm's own roles (Settings > Users & Roles, R55). A write case runs in a fresh world, so one
// record serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business';

export const records: CaseModule['records'] = {
  /** A live custom role, based on Tax Preparer (Create Staff's case gives that role). */
  customRole: {
    async create({ tx, businessId }) {
      const row = await tx.customRole.create({
        data: {
          businessId,
          name: `Fake role ${randomUUID().slice(0, 8)}`,
          basedOn: 'TAX_PREPARER',
        },
        select: { id: true },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/roles/custom/:id`]: { params: { id: 'customRole' } },
  [`PATCH ${BASE}/roles/custom/:id`]: {
    params: { id: 'customRole' },
    body: { description: 'Fake description' },
  },
  [`POST ${BASE}/roles/custom/:id/archive`]: { params: { id: 'customRole' } },
};
