import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
// Who sees a custom tab, among business clients: all, or a targeted audience: clients with one of
// its tags (TAGS) or chosen by name (CLIENTS). A targeted tab may name both kinds; it shows to
// clients with one of its tags and to its chosen clients.
import { PortalTabAudience } from '../db-enums.js';

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

// ---------- Custom tabs (CP-5d, CP-5e) ----------

/** The existing function a custom tab reuses (guide 7.3): document upload or business resources. */
export const PortalCustomTabModule = z.enum(['DOCUMENTS', 'BUSINESS_RESOURCES']);
export type PortalCustomTabModule = z.infer<typeof PortalCustomTabModule>;
export const PORTAL_CUSTOM_TAB_MODULES: Record<PortalCustomTabModule, string> = {
  DOCUMENTS: 'Document upload',
  BUSINESS_RESOURCES: 'Business resources',
};

/**
 * CP-5d, CP-5e: a tab the firm added. It shows only in business portals (guide 9.3), to its
 * audience, after the built-in tabs. Archiving hides it for good and deletes nothing: files
 * uploaded through it stay with their client.
 */
export const PortalCustomTab = z.object({
  id: z.uuid(),
  label: z.string(),
  module: PortalCustomTabModule,
  enabled: z.boolean(),
  audience: PortalTabAudience,
  tagIds: z.array(z.uuid()),
  /** The chosen clients, with their names for the firm's list. */
  clients: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type PortalCustomTab = z.infer<typeof PortalCustomTab>;

export const PortalCustomTabList = z.object({ items: z.array(PortalCustomTab).max(50) });
export type PortalCustomTabList = z.infer<typeof PortalCustomTabList>;

const Targets = {
  audience: PortalTabAudience,
  tagIds: z.array(z.uuid()).max(50),
  clientIds: z.array(z.uuid()).max(200),
};
/**
 * The audience and its targets agree: ALL names none, TAGS at least one tag, CLIENTS at least one
 * client. A targeted audience may also name the other kind (it shows to both).
 */
const targetsAgree = (t: { audience?: string; tagIds?: string[]; clientIds?: string[] }) =>
  t.audience === undefined ||
  (t.audience === 'ALL' && !t.tagIds?.length && !t.clientIds?.length) ||
  (t.audience === 'TAGS' && (t.tagIds?.length ?? 0) > 0) ||
  (t.audience === 'CLIENTS' && (t.clientIds?.length ?? 0) > 0);
const TARGETS_MESSAGE =
  'Choose at least one tag or client for this audience; all business clients takes neither';

/** POST /business/settings/portal-tabs/custom. Two tabs never share a name (409 DUPLICATE_LABEL). */
export const CreatePortalCustomTab = z
  .strictObject({
    label: PortalTabLabel,
    module: PortalCustomTabModule,
    audience: Targets.audience.default('ALL'),
    tagIds: Targets.tagIds.default([]),
    clientIds: Targets.clientIds.default([]),
  })
  .refine(targetsAgree, { message: TARGETS_MESSAGE, path: ['audience'] });
export type CreatePortalCustomTab = z.input<typeof CreatePortalCustomTab>;

/** PATCH .../custom/{id}: the name, on or off, or the audience with all its targets. */
export const UpdatePortalCustomTab = z
  .strictObject({
    label: PortalTabLabel.optional(),
    enabled: z.boolean().optional(),
    audience: Targets.audience.optional(),
    tagIds: Targets.tagIds.optional(),
    clientIds: Targets.clientIds.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Change at least one thing')
  .refine(targetsAgree, { message: TARGETS_MESSAGE, path: ['audience'] });
export type UpdatePortalCustomTab = z.input<typeof UpdatePortalCustomTab>;

/** A custom tab as the signed-in client's menu lists it. */
export const MyCustomTab = z.object({
  id: z.uuid(),
  label: z.string(),
  module: PortalCustomTabModule,
});
export type MyCustomTab = z.infer<typeof MyCustomTab>;

/** Each tab on (true) or off. A tab the firm never switched is on. */
export const PortalTabs = z.object({
  tabs: z.record(PortalTab, z.boolean()),
  /** CP-5b, CP-5c: the six tabs in the firm's order, each with its name as clients see it. */
  layout: z.array(PortalTabLayoutItem).length(6).default(DEFAULT_PORTAL_LAYOUT),
  /** `mine` only (CP-5d, CP-5e): the custom tabs this client sees, after the built-in ones. */
  custom: z.array(MyCustomTab).default([]),
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
    /** CP-5d, CP-5e: the firm's custom tabs (live ones), Owner and Admin. */
    customList: async (): Promise<PortalCustomTabList> =>
      request(PortalCustomTabList, `${FIRM}/custom`),
    customCreate: async (body: CreatePortalCustomTab): Promise<PortalCustomTab> =>
      request(PortalCustomTab, `${FIRM}/custom`, {
        method: 'POST',
        body: parseInput(CreatePortalCustomTab, body),
      }),
    customUpdate: async (id: string, body: UpdatePortalCustomTab): Promise<PortalCustomTab> =>
      request(PortalCustomTab, `${FIRM}/custom/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: parseInput(UpdatePortalCustomTab, body),
      }),
    /** Hides the tab for good; files uploaded through it stay with their client. */
    customArchive: async (id: string): Promise<PortalCustomTabList> =>
      request(PortalCustomTabList, `${FIRM}/custom/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        body: {},
      }),
    mine: async (firmSlug: string): Promise<PortalTabs> =>
      request(PortalTabs, `/portal/${encodeURIComponent(firmSlug)}/me/tabs`),
  };
}
export type PortalTabsClient = ReturnType<typeof createPortalTabsClient>;
