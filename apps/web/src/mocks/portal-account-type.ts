/**
 * The mock portal client's account type: BUSINESS unless a spec set this session key to
 * INDIVIDUAL (Client Portal guide 9.3, CP-9.3). The tabs and content mocks read it, so the menu
 * and the resources answer alike, as the API's do.
 */
export const MOCK_ACCOUNT_TYPE_KEY = 'firmivra-mock:portal-account-type';

export function mockPortalAccountType(): 'INDIVIDUAL' | 'BUSINESS' {
  try {
    return sessionStorage.getItem(MOCK_ACCOUNT_TYPE_KEY) === 'INDIVIDUAL'
      ? 'INDIVIDUAL'
      : 'BUSINESS';
  } catch {
    return 'BUSINESS';
  }
}
