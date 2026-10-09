// The firm's team and each member's working hours.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** A Staff member of firm P; also records their membership as staffMembership. */
  staffUser: {
    async create({ tx, businessId, person, set }) {
      const login = await person('staff-p', 'STAFF');
      const membership = await tx.membership.create({
        data: { businessId, userId: login.id, role: 'STAFF', status: 'ACTIVE' },
      });
      set('staffMembership', membership.id);
      return login.id;
    },
  },
  staffMembership: {
    async create({ get }) {
      await get('staffUser');
      return get('staffMembership');
    },
  },
};

export const cases: CaseModule['cases'] = {
  'PATCH /api/v1/business/team/:id': { params: { id: 'staffMembership' }, body: { role: 'ADMIN' } },
  'POST /api/v1/business/team/:id/deactivate': { params: { id: 'staffMembership' } },
  // Found, but an active member has no open invite.
  'POST /api/v1/business/team/:id/resend-invite': {
    params: { id: 'staffMembership' },
    expect: 409,
  },
  'PUT /api/v1/business/availability/:userId/working-hours': {
    params: { userId: 'staffUser' },
    body: { hours: [] },
  },
};
