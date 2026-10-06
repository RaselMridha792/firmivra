import { it, expect } from 'vitest';
import { ListAdminApplicationsQuery } from '../src/firm-applications.js';
it('validates filters and rejects tenant injection', () => {
  expect(ListAdminApplicationsQuery.parse({ limit: '1' }).limit).toBe(1);
  expect(ListAdminApplicationsQuery.safeParse({ businessId: 'forged' }).success).toBe(false);
  expect(ListAdminApplicationsQuery.safeParse({ status: 'FAKE' }).success).toBe(false);
});
