import {
  createApiClient,
  createRequest,
  createTaxStatusesClient,
  type MembershipRole,
} from '@firmivra/types';
import { createMeMock } from '../mocks/me';
import { createTaxStatusesMock } from '../mocks/tax-statuses';
import { MOCK_ROLE, mocked } from './mock';

/** Same origin (/api/v1 on the current host). */
const options = { baseUrl: '/api/v1' };
const request = createRequest(options);
/** False in production builds, where the compiler then drops every mock from the bundle. */
const dev = process.env.NODE_ENV !== 'production';

/**
 * Browser API client. The API's HttpOnly session cookie for this host is sent automatically and
 * never touched by JavaScript. Screens call `api.<module>.<fn>()` through useApiQuery and
 * useApiMutation, never fetch. Each module registers one line here, choosing its mock in mock mode
 * (lib/mock.ts, mocks/<module>.ts):
 *   taxStatuses: dev && mocked('taxStatuses') ? createTaxStatusesMock() : createTaxStatusesClient(request),
 * See "Adding a module" in packages/types/README.md.
 */
export const api = {
  ...createApiClient(options),
  // The signed-in user and their firm (`me`, `currentBusiness`), for the layouts in mock mode.
  ...(dev && mocked('me') ? createMeMock() : {}),
  taxStatuses:
    dev && mocked('taxStatuses')
      ? createTaxStatusesMock({ role: MOCK_ROLE as MembershipRole })
      : createTaxStatusesClient(request),
};
