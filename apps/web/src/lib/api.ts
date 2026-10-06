import { createApiClient, createClientSignUpsClient } from '@firmivra/types';

/**
 * Browser API client. Same origin (/api/v1 on the current host), so the API's HttpOnly
 * session cookie for this host is sent automatically and never touched by JavaScript.
 */
export const api = {
  ...createApiClient({ baseUrl: '/api/v1' }),
  /** Firm site: pending client sign-ups, approve and decline (docs/api/client-auth.yaml). */
  clientSignUps: createClientSignUpsClient({ baseUrl: '/api/v1' }),
};
