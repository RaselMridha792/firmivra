// Appointments Review 2 (A2, R56): Settings > Appointment Settings' rooms and equipment. Another
// firm's room, item or office is 404 (test/e2e/appointment-resources.e2e.test.ts).
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/appointment-resources';
const fresh = (what: string) => `Fake ${what} ${randomUUID().slice(0, 8)}`;

export const records: CaseModule['records'] = {
  /** An item for any office, so any appointment of the firm may book it. */
  firmEquipment: {
    async create({ tx, businessId }) {
      const row = await tx.firmEquipment.create({ data: { businessId, name: fresh('item') } });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}/rooms`]: {
    params: {},
    bodyIds: { officeId: 'firmOffice' },
    body: () => ({ name: fresh('room') }),
  },
  [`PATCH ${BASE}/rooms/:id`]: {
    params: { id: 'firmRoom' },
    body: () => ({ name: fresh('room') }),
  },
  [`POST ${BASE}/rooms/:id/archive`]: { params: { id: 'firmRoom' } },
  [`POST ${BASE}/equipment`]: {
    params: {},
    bodyIds: { officeId: 'firmOffice' },
    body: () => ({ name: fresh('item') }),
  },
  [`PATCH ${BASE}/equipment/:id`]: {
    params: { id: 'firmEquipment' },
    bodyIds: { officeId: 'firmOffice' },
    body: { description: 'Fake description' },
  },
  [`POST ${BASE}/equipment/:id/archive`]: { params: { id: 'firmEquipment' } },
  [`POST ${BASE}/equipment/:id/restore`]: { params: { id: 'firmEquipment' } },
};
