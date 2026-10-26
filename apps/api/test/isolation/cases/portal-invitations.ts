// Send Portal Invitation (Business Advisory B3): a client's portal access and the firm's
// invitation, by the client's id. Client X has a portal login, so the firm's own Owner gets the
// API's 409 HAS_LOGIN on send and 409 NOT_OPEN on revoke (the positive control); firm Q gets 404.
// The signed-out page opens a sealed link whose firm must be the slug's (portal-invitations e2e).
import type { CaseModule } from '../world.js';

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id/portal-access': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/portal-invitation': {
    params: { id: 'client' },
    body: { confirm: true },
    expect: 409,
  },
  'POST /api/v1/business/clients/:id/portal-invitation/revoke': {
    params: { id: 'client' },
    expect: 409,
  },
};

export const excluded: CaseModule['excluded'] = {
  'POST /api/v1/portal/:firmSlug/invitation':
    "Public, signed out: opens only a sealed link made for the slug's firm and its client's " +
    'current email; another firm, a changed or replaced link is 410 (portal-invitations e2e)',
};
