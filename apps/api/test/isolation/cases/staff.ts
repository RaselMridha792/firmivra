// The Staff Management directory (R55): one member by id.
import type { CaseModule } from '../world.js';

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/staff/:id': { params: { id: 'staffMembership' } },
};
