import {
  createApiClient,
  createClientSignUpsClient,
  createRequest,
  createTaxStatusesClient,
} from '@firmivra/types';

/** Same origin (/api/v1 on the current host). */
const options = { baseUrl: '/api/v1' };
const request = createRequest(options);

/**
 * Browser API client. The API's HttpOnly session cookie for this host is sent automatically and
 * never touched by JavaScript. Screens call `api.<module>.<fn>()`; each module registers one
 * line here (its client from @firmivra/types) and keeps typed fixtures in src/mocks/<module>.ts.
 */
export const api = {
  ...createApiClient(options),
  taxStatuses: createTaxStatusesClient(request),
  /** Pending client sign-ups, approve and decline (docs/api/client-auth.yaml). */
  clientSignUps: createClientSignUpsClient(request),
};
