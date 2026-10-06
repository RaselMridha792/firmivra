import type { BusinessSummary, MeResponse } from '@firmivra/types';
import { MOCK_ROLE, mockDelay } from '../lib/mock';

/**
 * Mock of the signed-in staff user and their firm (`api.me`, `api.currentBusiness`), for
 * <RequireRole> and screens in mock mode. Synthetic data only. Pick the role with
 * NEXT_PUBLIC_API_MOCK_ROLE=OWNER | ADMIN | STAFF to check what each role sees.
 */
export const mockBusiness: BusinessSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'lvp',
  name: 'LVP Accounting & Taxes',
  status: 'ACTIVE',
};

export function createMeMock() {
  const me: MeResponse = {
    user: {
      id: '00000000-0000-4000-8000-000000000101',
      email: 'owner@lvp.test',
      name: 'Mock User',
      pool: 'STAFF',
    },
    memberships: [{ business: mockBusiness, role: MOCK_ROLE, status: 'ACTIVE' }],
    clientAccounts: [],
    platformAdmin: false,
  };
  return {
    me: async () => (await mockDelay(), me),
    currentBusiness: async () => (await mockDelay(), mockBusiness),
  };
}
