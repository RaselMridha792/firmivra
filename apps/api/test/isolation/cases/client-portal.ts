// The Client Portal module (firm workspace), by the client's id: the header, summary, pending
// actions, activity and login history (firm P's Owner 200; firm Q 404), and Lock and Unlock Portal
// Access (firm P's Owner locks and unlocks its client X; firm Q gets 404 and changes nothing).
import type { CaseModule } from '../world.js';

const client = { params: { id: 'client' } };

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/client-portal/clients/:id': client,
  'GET /api/v1/business/client-portal/clients/:id/summary': client,
  'GET /api/v1/business/client-portal/clients/:id/pending-actions': client,
  'GET /api/v1/business/client-portal/clients/:id/activity': client,
  'GET /api/v1/business/client-portal/clients/:id/logins': client,
  'POST /api/v1/business/client-portal/clients/:id/lock': {
    params: { id: 'client' },
    body: { reason: 'Fake reason' },
  },
  'POST /api/v1/business/client-portal/clients/:id/unlock': client,
  'GET /api/v1/business/client-portal/clients/:id/visibility': client,
  'PUT /api/v1/business/client-portal/clients/:id/visibility': {
    params: { id: 'client' },
    body: { areas: { REPORTS: false } },
  },
  // Client X's login is ACTIVE: firm P deactivates it and gets it back.
  'POST /api/v1/business/client-portal/clients/:id/deactivate': client,
  // Not deactivated in this world: firm P's Owner gets the state's 409.
  'POST /api/v1/business/client-portal/clients/:id/reactivate': { ...client, expect: 409 },
  'POST /api/v1/business/client-portal/clients/:id/reset-access': client,
  'POST /api/v1/business/client-portal/clients/:id/mfa/reset': client,
  'GET /api/v1/business/client-portal/clients/:id/documents/summary': client,
  'GET /api/v1/business/client-portal/clients/:id/forms/summary': client,
};
