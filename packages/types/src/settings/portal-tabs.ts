import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';

/**
 * The six built-in portal tabs a firm turns on and off, renames and reorders (Client Portal guide
 * 5; Review One CP-5a to CP-5c), in their default order. Six of `PortalModule`'s values.
 */
export const PortalTab = z.enum([
  'INTAKE_FORMS',
  'BUSINESS_RESOURCES',
  'DOCUMENTS',
  'TAX_RETURNS',
  'INVOICES_PAYMENTS',
  'MESSAGES',
]);
export type PortalTab = z.infer<typeof PortalTab>;

/** Each tab's default name as clients see it in the portal. */
export const PORTAL_TAB_LABELS: Record<PortalTab, string> = {
  INTAKE_FORMS: 'Intake Form',
  BUSINESS_RESOURCES: 'Business Documents & Resources',
  DOCUMENTS: 'My Uploaded Documents',
  TAX_RETURNS: 'Tax Returns',
  INVOICES_PAYMENTS: 'Receipts & Invoices',
  MESSAGES: 'Messages and Notes',
};

/** A tab name the firm gives: one line of 1 to 40 characters. */
export const PortalTabLabel = z
  .string()
  .trim()
  .min(1, 'Enter a tab name')
  .max(40, 'Use at most 40 characters')
  .regex(/^[^\p{Cc}\u200B-\u200D\uFEFF]+$/u, 'Remove the special characters');

/** CP-5b, CP-5c: one built-in tab in the firm's order, with its name as clients see it. */
export const PortalTabLayoutItem = z.object({
  tab: PortalTab,
  label: z.string(),
  /** True when the firm gave it a name of its own (`label` then is that name). */
  renamed: z.boolean(),
});
export type PortalTabLayoutItem = z.infer<typeof PortalTabLayoutItem>;

/** The default layout: every tab in its default order, under its default name. */
export const DEFAULT_PORTAL_LAYOUT: PortalTabLayoutItem[] = PortalTab.options.map((tab) => ({
  tab,
  label: PORTAL_TAB_LABELS[tab],
  renamed: false,
}));

/** Each tab on (true) or off. A tab the firm never switched is on. */
export const PortalTabs = z.object({
  tabs: z.record(PortalTab, z.boolean()),
  /** CP-5b, CP-5c: the six tabs in the firm's order, each with its name as clients see it. */
  layout: z.array(PortalTabLayoutItem).length(6).default(DEFAULT_PORTAL_LAYOUT),
  /**
   * `mine` only: the areas with no firm switch, as the Client Portal module set them for this
   * client (on unless turned off for them). The five `tabs` there are this client's too.
   */
  more: z
    .object({ APPOINTMENTS: z.boolean(), TASKS_REQUESTS: z.boolean(), REPORTS: z.boolean() })
    .optional(),
  /**
   * `mine` only (Client Portal guide 9.3, CP-9.3): false for a Personal (Individual) portal, which
   * never lists business-only tabs; the API refuses their content too (403 BUSINESS_ONLY). A
   * client with no client record counts as Individual, as there.
   */
  businessPortal: z.boolean().optional(),
});
export type PortalTabs = z.infer<typeof PortalTabs>;

/**
 * PUT /business/settings/portal-tabs: only the switches sent change; `layout`, when sent, is the
 * whole order (each tab once) with each tab's own name, or null for its default name. Two tabs
 * never share a name (409 DUPLICATE_LABEL from the API, ignoring case).
 */
export const UpdatePortalTabsRequest = z
  .strictObject({
    tabs: z.partialRecord(PortalTab, z.boolean()).optional(),
    layout: z
      .array(z.strictObject({ tab: PortalTab, label: PortalTabLabel.nullable() }))
      .length(6, 'Send every tab once')
      .refine((items) => new Set(items.map((i) => i.tab)).size === 6, 'Send every tab once')
      .optional(),
  })
  .refine(
    (body) => Object.keys(body.tabs ?? {}).length > 0 || body.layout !== undefined,
    'Choose at least one tab',
  );
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
