import {
  createApiClient,
  createClientsClient,
  createClientSignUpsClient,
  createEngagementsClient,
  createMyProfileClient,
  createMyServicesClient,
  createMyTaxReturnsClient,
  createRequest,
  createSettingsClient,
  createTaxReturnsClient,
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
  /** Settings, the setup wizard, and the firm's Terms and Privacy (docs/api/settings.yaml). */
  settings: createSettingsClient(request),
  /** Pending client sign-ups, approve and decline (docs/api/client-auth.yaml). */
  clientSignUps: createClientSignUpsClient(request),
  /** Client records (R10): firm side. */
  clients: createClientsClient(request),
  engagements: createEngagementsClient(request),
  taxReturns: createTaxReturnsClient(request),
  /** Client records (R10): the signed-in client's own, per firm (portal). */
  myProfile: (firmSlug: string) => createMyProfileClient(request, firmSlug),
  myServices: (firmSlug: string) => createMyServicesClient(request, firmSlug),
  myTaxReturns: (firmSlug: string) => createMyTaxReturnsClient(request, firmSlug),
};
