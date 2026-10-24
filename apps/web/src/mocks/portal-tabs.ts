import {
  ApiRequestError,
  PortalTab,
  type PortalTabs,
  type PortalTabsClient,
  UpdatePortalTabsRequest,
} from '@firmivra/types';

/** Kept for the browser tab's session, so a reload (or a spec's init script) keeps the switches. */
const KEY = 'firmivra-mock:portal-tabs';

/** Every tab on at first, as a firm that never switched one. One state for Settings and the portal. */
let tabs: PortalTabs['tabs'] | null = null;
function current(): PortalTabs['tabs'] {
  if (tabs) return tabs;
  const all = Object.fromEntries(PortalTab.options.map((tab) => [tab, true])) as PortalTabs['tabs'];
  try {
    const stored = UpdatePortalTabsRequest.shape.tabs.safeParse(
      JSON.parse(sessionStorage.getItem(KEY) ?? '{}'),
    );
    tabs = { ...all, ...(stored.success ? stored.data : {}) };
  } catch {
    tabs = all;
  }
  return tabs;
}

/**
 * `api.portalTabs` in mock mode. `role: 'STAFF'` gets the API's 403 on the firm side. The portal
 * reads the same state, so a tab switched off in Settings leaves the mock portal's menu.
 */
export function createPortalTabsMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): PortalTabsClient {
  const manage = () => {
    if (options.role === 'STAFF')
      throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
  };
  return {
    get: async () => {
      manage();
      return { tabs: { ...current() } };
    },
    update: async (body) => {
      manage();
      tabs = { ...current(), ...UpdatePortalTabsRequest.parse(body).tabs };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(tabs));
      } catch {
        // No storage (private window): the switches last until the page reloads.
      }
      return { tabs: { ...tabs } };
    },
    mine: async () => ({ tabs: { ...current() } }),
  };
}
