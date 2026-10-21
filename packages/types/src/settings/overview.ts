import { z } from 'zod';
import { AdminActivityItem } from './activity.js';
import { LocationRow } from './locations.js';

// Settings > Overview (R42 contract): the KPI row, Company Applications, Quick Settings (static
// links) and Recent Administrative Activity. Owner and Admin only.
// The design shows platform numbers (Active Companies, Pending Applications, Company
// Applications) that belong to the Super Admin console (admin site, R4: api.firmApplications).
// A firm never sees other companies: those fields are optional and the firm API leaves them out.

const DateTime = z.iso.datetime({ offset: true });

/** A KPI with "↑ 4" this month. */
export const CountWithChange = z.object({
  value: z.number().int(),
  addedThisMonth: z.number().int(),
});
export type CountWithChange = z.infer<typeof CountWithChange>;

// The activity row lives in activity.ts (Locations uses it too); exported from here as before.
export { AdminActivityItem, AdminActivityTone } from './activity.js';

/** A Company Applications row (platform only). */
export const SettingsApplicationRow = z.object({
  id: z.uuid(),
  company: z.string(),
  applicant: z.string(),
  submittedAt: DateTime,
  status: z.enum(['PENDING_REVIEW', 'DOCUMENTS_NEEDED', 'APPROVED', 'REJECTED']),
});
export type SettingsApplicationRow = z.infer<typeof SettingsApplicationRow>;

/** GET /business/settings/overview. */
export const SettingsOverview = z.object({
  /** "Staff Users 28 ↑ 4": this firm's members (not deactivated), each counted once. */
  staffUsers: CountWithChange,
  /** Security events that need review: failed sign-in bursts, MFA resets, lockouts (7 days). */
  securityAlerts: z.number().int(),
  /** Platform admins only (Super Admin console); left out for a firm. */
  activeCompanies: CountWithChange.optional(),
  /** Platform admins only; left out for a firm. */
  pendingApplications: z.number().int().optional(),
  /** Platform admins only; left out for a firm. */
  applications: z.array(SettingsApplicationRow).optional(),
  /** The 5 newest. "View All" opens the audit log. */
  recentActivity: z.array(AdminActivityItem).max(20),
  // R1 (Oct 21, Settings review): Locations. Optional so the existing shape still parses.
  /** "Active Locations 2 ↑ 1": ACTIVE locations, and how many became so this month. */
  activeLocations: CountWithChange.optional(),
  /** Plan usage: ACTIVE locations against the plan's (null: no limit). */
  locationAllowance: z
    .object({
      used: z.number().int().nonnegative(),
      allowed: z.number().int().nonnegative().nullable(),
    })
    .optional(),
  /** Location Management: the first 5 rows (primary first); "View All" opens Settings > Locations. */
  locations: z.array(LocationRow).max(5).optional(),
});
export type SettingsOverview = z.infer<typeof SettingsOverview>;
