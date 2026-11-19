import {
  ApiRequestError,
  CreatePortalCustomTab,
  DEFAULT_PORTAL_LAYOUT,
  type MyCustomTab,
  PORTAL_TAB_LABELS,
  type PortalCustomTab,
  PortalTab,
  type PortalTabLayoutItem,
  type PortalTabs,
  type PortalTabsClient,
  UpdatePortalCustomTab,
  UpdatePortalTabsRequest,
} from '@firmivra/types';
import { clientFixtures, firstClientId } from './clients';
import { mockPortalAccountType } from './portal-account-type';

/** Kept for the browser tab's session, so a reload (or a spec's init script) keeps the switches. */
const KEY = 'firmivra-mock:portal-tabs';
const LAYOUT_KEY = 'firmivra-mock:portal-tab-layout';
const CUSTOM_KEY = 'firmivra-mock:portal-custom-tabs';

/** Every tab on at first, as a firm that never switched one. One state for Settings and the portal. */
let tabs: PortalTabs['tabs'] | null = null;
let layout: PortalTabLayoutItem[] | null = null;
/** CP-5d, CP-5e: the firm's live custom tabs, in their order (archived ones leave the list). */
let custom: PortalCustomTab[] | null = null;

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

function currentCustom(): PortalCustomTab[] {
  if (custom) return custom;
  try {
    const stored = JSON.parse(sessionStorage.getItem(CUSTOM_KEY) ?? '[]') as PortalCustomTab[];
    custom = Array.isArray(stored) ? stored : [];
  } catch {
    custom = [];
  }
  return custom;
}

/**
 * CP-5e: the custom tabs the mock portal client (client 1) sees: only in a business portal, on,
 * and for everyone or chosen by name. The mock client has no tags, so a tab targeted only at tags
 * stays hidden, as for an untagged client.
 */
export function mockMyCustomTabs(): MyCustomTab[] {
  if (mockPortalAccountType() !== 'BUSINESS') return [];
  return currentCustom()
    .filter(
      (t) => t.enabled && (t.audience === 'ALL' || t.clients.some((c) => c.id === firstClientId)),
    )
    .map(({ id, label, module }) => ({ id, label, module }));
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
      return { tabs: { ...current() }, layout: currentLayout(), custom: [] };
    },
    update: async (body) => {
      manage();
      const input = UpdatePortalTabsRequest.parse(body);
      if (input.layout) {
        const names = input.layout.map((i) =>
          (i.label ?? PORTAL_TAB_LABELS[i.tab]).trim().toLowerCase(),
        );
        const customNames = currentCustom().map((t) => t.label.trim().toLowerCase());
        if (new Set(names).size !== names.length || names.some((n) => customNames.includes(n)))
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
      return { tabs: { ...tabs }, layout: currentLayout(), custom: [] };
    },
    customList: async () => {
      manage();
      return { items: structuredClone(currentCustom()) };
    },
    customCreate: async (body) => {
      manage();
      const input = CreatePortalCustomTab.parse(body);
      nameFree(input.label);
      const tab: PortalCustomTab = {
        id: crypto.randomUUID(),
        label: input.label,
        module: input.module,
        enabled: true,
        audience: input.audience,
        tagIds: input.tagIds,
        clients: clientsOf(input.clientIds),
      };
      custom = [...currentCustom(), tab];
      keep(CUSTOM_KEY, custom);
      return structuredClone(tab);
    },
    customUpdate: async (id, body) => {
      manage();
      const input = UpdatePortalCustomTab.parse(body);
      const found = currentCustom().find((t) => t.id === id);
      if (!found) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      if (input.label !== undefined) nameFree(input.label, id);
      const next: PortalCustomTab = {
        ...found,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.audience !== undefined
          ? {
              audience: input.audience,
              tagIds: input.tagIds ?? [],
              clients: clientsOf(input.clientIds ?? []),
            }
          : {}),
      };
      custom = currentCustom().map((t) => (t.id === id ? next : t));
      keep(CUSTOM_KEY, custom);
      return structuredClone(next);
    },
    customArchive: async (id) => {
      manage();
      if (!currentCustom().some((t) => t.id === id))
        throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      custom = currentCustom().filter((t) => t.id !== id);
      keep(CUSTOM_KEY, custom);
      return { items: structuredClone(custom) };
    },
    mine: async () => ({
      tabs: { ...current() },
      layout: currentLayout(),
      custom: mockMyCustomTabs(),
      businessPortal: mockPortalAccountType() === 'BUSINESS',
    }),
  };
}

/** 409 DUPLICATE_LABEL: a built-in tab (by its current name) or another custom tab has it. */
function nameFree(label: string, exceptId?: string) {
  const name = label.trim().toLowerCase();
  const taken =
    currentLayout().some((i) => i.label.trim().toLowerCase() === name) ||
    currentCustom().some((t) => t.id !== exceptId && t.label.trim().toLowerCase() === name);
  if (taken) throw new ApiRequestError(409, 'DUPLICATE_LABEL', 'Another tab already has this name');
}

/** The chosen clients with their names, as the API returns them. */
const clientsOf = (ids: string[]) =>
  [...new Set(ids)]
    .map((id) => ({
      id,
      name: clientFixtures().find((c) => c.id === id)?.displayName ?? 'Client',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
