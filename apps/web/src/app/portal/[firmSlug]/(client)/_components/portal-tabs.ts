'use client';

import type { PortalTab, PortalTabs } from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/** The page each switchable tab opens (Settings > Client Portal > Features). */
type More = keyof NonNullable<PortalTabs['more']>;
export const TAB_PAGES: Record<string, PortalTab | More> = {
  intake: 'INTAKE_FORMS',
  documents: 'DOCUMENTS',
  taxes: 'TAX_RETURNS',
  invoices: 'INVOICES_PAYMENTS',
  messages: 'MESSAGES',
  // Hidden for this client only (the firm's Client Portal module, Portal Content).
  appointments: 'APPOINTMENTS',
  requests: 'TASKS_REQUESTS',
};

/** The business-only tab's page (Business Documents & Resources). */
export const BUSINESS_PAGE = 'business';

/**
 * Whether a portal page's tab is on, by its first path segment ("messages"). A page that is no
 * switchable tab is always on, and so is every tab until the firm's answer arrives (the API
 * refuses a hidden tab's routes on its own).
 */
export function usePortalTabs(slug: string) {
  const query = useApiQuery(['portal-tabs', slug], () => api.portalTabs.mine(slug));
  return (page: string) => {
    const data = query.data;
    // CP-9.3: a Personal portal never lists the business-only tab (its page says why by address).
    if (page === BUSINESS_PAGE) return data?.businessPortal !== false;
    const tab = TAB_PAGES[page];
    if (!tab) return true;
    const on = tab in (data?.tabs ?? {}) ? data?.tabs[tab as PortalTab] : data?.more?.[tab as More];
    return on !== false;
  };
}
