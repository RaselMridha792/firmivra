import {
  ApiRequestError,
  DEFAULT_PORTAL_LAYOUT,
  PORTAL_TAB_LABELS,
  PortalTab,
  type PortalTabLayoutItem,
  type PortalTabs,
  type PortalTabsClient,
  UpdatePortalTabsRequest,
} from '@firmivra/types';
import { mockPortalAccountType } from './portal-account-type';

/** Kept for the browser tab's session, so a reload (or a spec's init script) keeps the switches. */
const KEY = 'firmivra-mock:portal-tabs';
const LAYOUT_KEY = 'firmivra-mock:portal-tab-layout';

/** Every tab on at first, as a firm that never switched one. One state for Settings and the portal. */
let tabs: PortalTabs['tabs'] | null = null;
let layout: PortalTabLayoutItem[] | null = null;

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

/** CP-5b, CP-5c: the firm's order and names; the defaults until a save. */
function currentLayout(): PortalTabLayoutItem[] {
  if (layout) return layout;
  try {
    const stored = JSON.parse(sessionStorage.getItem(LAYOUT_KEY) ?? 'null') as
      PortalTabLayoutItem[] | null;
    layout = Array.isArray(stored) && stored.length === 6 ? stored : DEFAULT_PORTAL_LAYOUT;
  } catch {
    layout = DEFAULT_PORTAL_LAYOUT;
  }
  return layout;
}

/** Whether the firm's switch for a tab is on (other mocks follow it, as the API's routes do). */
export const mockTabOn = (tab: PortalTab): boolean => current()[tab];

const keep = (key: string, value: unknown) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // No storage (private window): the settings last until the page reloads.
  }
};

/**
 * `api.portalTabs` in mock mode. `role: 'STAFF'` gets the API's 403 on the firm side. The portal
 * reads the same state, so a tab switched off, renamed or moved in Settings changes the mock
 * portal's menu. Two tabs never share a name (409 DUPLICATE_LABEL), as with the API.
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
      return { tabs: { ...current() }, layout: currentLayout() };
    },
    update: async (body) => {
      manage();
      const input = UpdatePortalTabsRequest.parse(body);
      if (input.layout) {
        const names = input.layout.map((i) =>
          (i.label ?? PORTAL_TAB_LABELS[i.tab]).trim().toLowerCase(),
        );
        if (new Set(names).size !== names.length)
          throw new ApiRequestError(409, 'DUPLICATE_LABEL', 'Another tab already has this name');
        layout = input.layout.map((i) => ({
          tab: i.tab,
          label: i.label ?? PORTAL_TAB_LABELS[i.tab],
          renamed: i.label !== null,
        }));
        keep(LAYOUT_KEY, layout);
      }
      tabs = { ...current(), ...(input.tabs ?? {}) };
      keep(KEY, tabs);
      return { tabs: { ...tabs }, layout: currentLayout() };
    },
    mine: async () => ({
      tabs: { ...current() },
      layout: currentLayout(),
      businessPortal: mockPortalAccountType() === 'BUSINESS',
    }),
  };
}
