'use client';

import type { PortalTab } from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/** The page each switchable tab opens (Settings > Client Portal > Features). */
export const TAB_PAGES: Record<string, PortalTab> = {
  intake: 'INTAKE_FORMS',
  documents: 'DOCUMENTS',
  taxes: 'TAX_RETURNS',
  invoices: 'INVOICES_PAYMENTS',
  messages: 'MESSAGES',
};

/**
 * Whether a portal page's tab is on, by its first path segment ("messages"). A page that is no
 * switchable tab is always on, and so is every tab until the firm's answer arrives (the API
 * refuses a hidden tab's routes on its own).
 */
export function usePortalTabs(slug: string) {
  const query = useApiQuery(['portal-tabs', slug], () => api.portalTabs.mine(slug));
  return (page: string) => {
    const tab = TAB_PAGES[page];
    return !tab || query.data?.tabs[tab] !== false;
  };
}
