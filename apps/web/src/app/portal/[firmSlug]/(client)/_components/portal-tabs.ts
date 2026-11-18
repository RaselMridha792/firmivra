'use client';

import { DEFAULT_PORTAL_LAYOUT, type PortalTab, type PortalTabs } from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/** The page each switchable tab opens (Settings > Client Portal > Features). */
type More = keyof NonNullable<PortalTabs['more']>;
export const TAB_PAGES: Record<string, PortalTab | More> = {
  intake: 'INTAKE_FORMS',
  business: 'BUSINESS_RESOURCES',
  documents: 'DOCUMENTS',
  taxes: 'TAX_RETURNS',
  invoices: 'INVOICES_PAYMENTS',
  messages: 'MESSAGES',
  // Hidden for this client only (the firm's Client Portal module, Portal Content).
  appointments: 'APPOINTMENTS',
  requests: 'TASKS_REQUESTS',
};

/** Each built-in tab's page (its first path segment). */
export const PAGE_OF: Record<PortalTab, string> = {
  INTAKE_FORMS: 'intake',
  BUSINESS_RESOURCES: 'business',
  DOCUMENTS: 'documents',
  TAX_RETURNS: 'taxes',
  INVOICES_PAYMENTS: 'invoices',
  MESSAGES: 'messages',
};

/** The business-only tab's page (Business Documents & Resources). */
export const BUSINESS_PAGE = 'business';

function useMine(slug: string) {
  return useApiQuery(['portal-tabs', slug], () => api.portalTabs.mine(slug));
}

/** Whether the firm (or the client's own switch) turned a page's tab off. */
function switchedOff(data: PortalTabs | undefined, page: string): boolean {
  const tab = TAB_PAGES[page];
  if (!tab) return false;
  const on = tab in (data?.tabs ?? {}) ? data?.tabs[tab as PortalTab] : data?.more?.[tab as More];
  return on === false;
}

/**
 * Whether a portal page's tab is on, by its first path segment ("messages"). A page that is no
 * switchable tab is always on, and so is every tab until the firm's answer arrives (the API
 * refuses a hidden tab's routes on its own).
 */
export function usePortalTabs(slug: string) {
  const query = useMine(slug);
  return (page: string) => {
    const data = query.data;
    // CP-9.3: a Personal portal never lists the business-only tab (its page says why by address).
    if (page === BUSINESS_PAGE && data?.businessPortal === false) return false;
    return !switchedOff(data, page);
  };
}

/**
 * The portal's folder tabs in the firm's order and under the firm's names (CP-5b, CP-5c), as
 * `[label, page]`, with whether the firm switched each page off (its page then says so instead of
 * its content). The default order and names show until the firm's answer arrives.
 */
export function usePortalMenu(slug: string) {
  const query = useMine(slug);
  const layout = query.data?.layout ?? DEFAULT_PORTAL_LAYOUT;
  return {
    items: layout.map((item): [label: string, page: string] => [item.label, PAGE_OF[item.tab]]),
    firmOff: (page: string) => switchedOff(query.data, page),
  };
}
