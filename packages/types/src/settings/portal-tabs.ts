import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';

/**
 * The portal tabs a firm turns on and off (Client Portal guide 5; Rasel, Oct 24: the parts
 * without schema). Five of `PortalModule`'s values: Business Documents & Resources has none yet,
 * so it stays on (R0 adds it with the tab's label and order).
 */
export const PortalTab = z.enum([
  'INTAKE_FORMS',
  'DOCUMENTS',
  'TAX_RETURNS',
  'INVOICES_PAYMENTS',
  'MESSAGES',
]);
export type PortalTab = z.infer<typeof PortalTab>;

/** Each tab's name as clients see it in the portal. */
export const PORTAL_TAB_LABELS: Record<PortalTab, string> = {
  INTAKE_FORMS: 'Intake Form',
  DOCUMENTS: 'My Uploaded Documents',
  TAX_RETURNS: 'Tax Returns',
  INVOICES_PAYMENTS: 'Receipts & Invoices',
  MESSAGES: 'Messages and Notes',
};

/** Each tab on (true) or off. A tab the firm never switched is on. */
export const PortalTabs = z.object({ tabs: z.record(PortalTab, z.boolean()) });
export type PortalTabs = z.infer<typeof PortalTabs>;

/** PUT /business/settings/portal-tabs: only the tabs sent change. */
export const UpdatePortalTabsRequest = z.strictObject({
  tabs: z
    .partialRecord(PortalTab, z.boolean())
    .refine((tabs) => Object.keys(tabs).length > 0, 'Choose at least one tab'),
});
export type UpdatePortalTabsRequest = z.infer<typeof UpdatePortalTabsRequest>;

const FIRM = '/business/settings/portal-tabs';

/**
 * `api.portalTabs` (apps/web/src/lib/api.ts). Owner and Admin read and change the firm's tabs;
 * a signed-in client reads them for the portal's menu (`mine`). A hidden tab is also refused on
 * the portal API: 403 MODULE_OFF. Hiding a tab never deletes anything.
 */
export function createPortalTabsClient(request: ApiRequest) {
  return {
    get: async (): Promise<PortalTabs> => request(PortalTabs, FIRM),
    update: async (body: UpdatePortalTabsRequest): Promise<PortalTabs> =>
      request(PortalTabs, FIRM, { method: 'PUT', body: parseInput(UpdatePortalTabsRequest, body) }),
    mine: async (firmSlug: string): Promise<PortalTabs> =>
      request(PortalTabs, `/portal/${encodeURIComponent(firmSlug)}/me/tabs`),
  };
}
export type PortalTabsClient = ReturnType<typeof createPortalTabsClient>;
