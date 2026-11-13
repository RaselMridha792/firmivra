// The Client Portal module (firm workspace): Lock and Unlock Portal Access, by the client's id.
// Firm P's Owner locks and unlocks its client X (200); firm Q gets 404 and changes nothing.
import type { CaseModule } from '../world.js';

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/client-portal/clients/:id/lock': {
    params: { id: 'client' },
    body: { reason: 'Fake reason' },
  },
  'POST /api/v1/business/client-portal/clients/:id/unlock': { params: { id: 'client' } },
};
