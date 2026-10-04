import { createApiClient } from '@firmivra/types';

/**
 * Browser API client. Same origin (/api/v1 on the current host), so the API's HttpOnly
 * session cookie for this host is sent automatically and never touched by JavaScript.
 */
export const api = createApiClient({ baseUrl: '/api/v1' });
