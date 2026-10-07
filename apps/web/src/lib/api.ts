import {
  createApiClient,
  createClientsClient,
  createClientSignUpsClient,
  createEngagementsClient,
  createFirmApplicationsClient,
  createMyProfileClient,
  createMyServicesClient,
  createMyTaxReturnsClient,
  createRequest,
  createTaxReturnsClient,
  createTaxStatusesClient,
} from '@firmivra/types';
import { createClientSignUpsMock } from '../mocks/client-auth';
import { createFirmApplicationsMock } from '../mocks/firm-applications';
import { createMeMock } from '../mocks/me';
import { createTaxStatusesMock } from '../mocks/tax-statuses';
import { MOCK_ROLE, mocked } from './mock';
import { sessionFetch } from './session';

/**
 * Same origin (/api/v1 on the current host). sessionFetch refreshes the session once on a 401
 * and opens the sign-in page if that fails (lib/session.ts).
 */
const options = { baseUrl: '/api/v1', fetch: sessionFetch };
const request = createRequest(options);
/** False in production builds, where the compiler then drops every mock from the bundle. */
const dev = process.env.NODE_ENV !== 'production';

/**
 * Browser API client. The API's HttpOnly session cookie for this host is sent automatically and
 * never touched by JavaScript. Screens call `api.<module>.<fn>()` through useApiQuery and
 * useApiMutation, never fetch. Each module registers one line here, choosing its mock in mock mode
 * (lib/mock.ts, mocks/<module>.ts):
 *   taxStatuses: dev && mocked('taxStatuses') ? createTaxStatusesMock({ role: MOCK_ROLE }) : createTaxStatusesClient(request),
 * See "Adding a module" in packages/types/README.md.
 */
export const api = {
  ...createApiClient(options),
  // The signed-in user and their firm (`me`, `currentBusiness`), for the layouts in mock mode.
  ...(dev && mocked('me') ? createMeMock() : {}),
  taxStatuses:
    dev && mocked('taxStatuses')
      ? createTaxStatusesMock({ role: MOCK_ROLE })
      : createTaxStatusesClient(request),
  /** Pending client sign-ups, approve and decline (docs/api/client-auth.yaml). */
  clientSignUps:
    dev && mocked('clientSignUps')
      ? createClientSignUpsMock({ role: MOCK_ROLE })
      : createClientSignUpsClient(request),
  /** Client records (R10): firm side. */
  clients: createClientsClient(request),
  engagements: createEngagementsClient(request),
  taxReturns: createTaxReturnsClient(request),
  /** Client records (R10): the signed-in client's own, per firm (portal). */
  myProfile: (firmSlug: string) => createMyProfileClient(request, firmSlug),
  myServices: (firmSlug: string) => createMyServicesClient(request, firmSlug),
  myTaxReturns: (firmSlug: string) => createMyTaxReturnsClient(request, firmSlug),
  /** Firm applications (R4): the public apply form, and the Super Admin's applications, firms and dashboard. */
  firmApplications:
    dev && mocked('firmApplications')
      ? createFirmApplicationsMock()
      : createFirmApplicationsClient(request),
};
