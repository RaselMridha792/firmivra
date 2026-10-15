import { z } from 'zod';

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

/** The icon and colour of an activity row. */
export const AdminActivityTone = z.enum(['success', 'warning', 'info', 'user', 'system']);
export type AdminActivityTone = z.infer<typeof AdminActivityTone>;

/** One Recent Administrative Activity row, from the firm's audit log. */
export const AdminActivityItem = z.object({
  id: z.uuid(),
  at: DateTime,
  /** The audit action, for example "settings.branding_updated". */
  action: z.string(),
  /** The screen's words: "Branding settings updated", "New staff user added - T. Williams". */
  label: z.string(),
  tone: AdminActivityTone,
});
export type AdminActivityItem = z.infer<typeof AdminActivityItem>;

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
  /** "Staff Users 28 ↑ 4": this firm's members (not deactivated). */
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
});
export type SettingsOverview = z.infer<typeof SettingsOverview>;
