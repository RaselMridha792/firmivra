import { createApiClient } from '@firmivra/types';
import { createMeMock } from '../mocks/me';
import { mocked } from './mock';

/**
 * Browser API client. Same origin (/api/v1 on the current host), so the API's HttpOnly
 * session cookie for this host is sent automatically and never touched by JavaScript.
 *
 * Screens call `api.<module>.<fn>()` through useApiQuery / useApiMutation, never fetch.
 * Each API module adds one line here, choosing its mock in mock mode (lib/mock.ts):
 *   taxStatuses: dev && mocked('taxStatuses') ? createTaxStatusesMock() : createTaxStatusesClient(request),
 * See "Adding a module" in packages/types/README.md.
 */
const options = { baseUrl: '/api/v1' };
/** False in production builds, where the compiler then drops every mock from the bundle. */
const dev = process.env.NODE_ENV !== 'production';

export const api = {
  ...createApiClient(options),
  // The signed-in user and their firm (`me`, `currentBusiness`), for <RequireRole> in mock mode.
  ...(dev && mocked('me') ? createMeMock() : {}),
};
