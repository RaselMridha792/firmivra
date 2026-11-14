import { z } from 'zod';
import { PortalModule } from '../db-enums.js';

// The Client Portal module's Portal Content & Visibility and its access actions (Client Portal
// developer instructions 15, 16 and 26). A client's own switches sit on top of the firm's (Settings
// > Client Portal > Features): an area is shown only when both are on. Turning one off hides it
// from the client's menu and refuses its portal routes (403 MODULE_OFF); nothing is deleted, and a
// record still needs its own sharing to show. Owner and Admin change them, audited.

/** Each portal area's name as the Client Portal module lists it. */
export const PORTAL_MODULE_LABELS: Record<PortalModule, string> = {
  TAX_RETURNS: 'Tax Returns',
  DOCUMENTS: 'Documents',
  INVOICES_PAYMENTS: 'Invoices & Payments',
  APPOINTMENTS: 'Appointments',
  INTAKE_FORMS: 'Intake Forms',
  TASKS_REQUESTS: 'Tasks & Requests',
  MESSAGES: 'Messages',
  REPORTS: 'Reports (Client View)',
};

export const ClientPortalArea = z.object({
  module: PortalModule,
  /** The firm's own switch (Settings > Client Portal); always on for an area it has none for. */
  firmOn: z.boolean(),
  /** This client's switch: on unless turned off for them. */
  clientOn: z.boolean(),
  /** What the client sees: both on. */
  visible: z.boolean(),
});
export type ClientPortalArea = z.infer<typeof ClientPortalArea>;

/** GET /business/client-portal/clients/{id}/visibility. */
export const ClientPortalVisibility = z.object({
  areas: z.array(ClientPortalArea),
  /** Owner and Admin. */
  canChange: z.boolean(),
});
export type ClientPortalVisibility = z.infer<typeof ClientPortalVisibility>;

/** PUT .../visibility: only the areas sent change. */
export const UpdateClientPortalVisibilityRequest = z.strictObject({
  areas: z
    .partialRecord(PortalModule, z.boolean())
    .refine((areas) => Object.keys(areas).length > 0, 'Choose at least one area'),
});
export type UpdateClientPortalVisibilityRequest = z.infer<
  typeof UpdateClientPortalVisibilityRequest
>;

/** POST .../deactivate, /reactivate, /reset-access, /mfa/reset: how many logins it changed. */
export const ClientPortalAccessResult = z.object({ changed: z.number().int().nonnegative() });
export type ClientPortalAccessResult = z.infer<typeof ClientPortalAccessResult>;

const Count = z.number().int().nonnegative();

/** GET .../documents/summary: Frame 3's KPIs, of the client's live documents. */
export const ClientPortalDocumentsSummary = z.object({
  total: Count,
  clientUploaded: Count,
  firmShared: Count,
  pendingReview: Count,
  requested: Count,
});
export type ClientPortalDocumentsSummary = z.infer<typeof ClientPortalDocumentsSummary>;

/** GET .../forms/summary: the Intake Forms tab's KPIs, of the client's intakes. */
export const ClientPortalFormsSummary = z.object({
  total: Count,
  completed: Count,
  needsReview: Count,
  inProgress: Count,
  notStarted: Count,
  archived: Count,
});
export type ClientPortalFormsSummary = z.infer<typeof ClientPortalFormsSummary>;
