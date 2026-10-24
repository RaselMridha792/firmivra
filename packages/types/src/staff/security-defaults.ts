import { z } from 'zod';
import { StaffAccessLocation, StaffAuthMethod } from '../schemas.js';
import { StaffCountryCode, StaffIpOrNetwork, StaffSecurityNotices } from './schemas.js';

// Staff Settings > New Accounts & Security (Octavia's SM3, review of Oct 23): the security settings
// every new staff account starts from (staff_security_defaults, R1's #1074; one row per firm).
// Create Staff's step 3 starts from them, and an account created without step 3 (Bulk Upload
// Staff) gets them. Changing them changes no existing account: each keeps its own settings
// (Access & Security). Two-factor sign-in is always required and passwords are never set by
// anyone (secure setup links), so neither is a setting. Sign-in does not enforce these settings
// for anyone yet (docs/work/R60-settings-checks.md, check 6). Owner and Admin.

const DateTime = z.iso.datetime({ offset: true });

/** The settings themselves, as staff_security_settings has them. */
const Settings = {
  allowedAuthMethods: z.array(StaffAuthMethod),
  restrictDevices: z.boolean(),
  /** Minutes, 5 to 480; null is no automatic logout. */
  autoLogoutMinutes: z.number().int().nullable(),
  accessLocation: StaffAccessLocation,
  allowedIps: z.array(z.string()),
  allowedCountries: z.array(z.string()),
  maxConcurrentSessions: z.number().int(),
  signOutOtherSessions: z.boolean(),
  allowTrustedDevices: z.boolean(),
  notices: StaffSecurityNotices,
};

/** GET /business/staff-security-defaults (and PUT's answer). */
export const StaffSecurityDefaults = z.object({
  ...Settings,
  /** The firm's staff accounts now (any status): each keeps its own settings on a save. */
  existingAccounts: z.number().int(),
  /** Null until the firm first saves: Firmivra's defaults until then. */
  updatedAt: DateTime.nullable(),
  updatedBy: z.string().nullable(),
  /** Goes back on PUT; a newer save is 409 SAVE_CONFLICT. */
  version: z.string(),
});
export type StaffSecurityDefaults = z.infer<typeof StaffSecurityDefaults>;

/**
 * PUT /business/staff-security-defaults: every setting, replacing the saved ones. The IP list goes
 * with "Specific IP Addresses Only" and the country list with "Specific Countries/Regions Only",
 * each non-empty there and empty otherwise (as the database requires).
 */
export const SaveStaffSecurityDefaultsRequest = z
  .strictObject({
    version: z.string().min(1).max(100),
    allowedAuthMethods: z.array(StaffAuthMethod).min(1).max(4),
    restrictDevices: z.boolean(),
    autoLogoutMinutes: z.number().int().min(5).max(480).nullable(),
    accessLocation: StaffAccessLocation,
    allowedIps: z.array(StaffIpOrNetwork).max(20),
    allowedCountries: z.array(StaffCountryCode).max(50),
    maxConcurrentSessions: z.number().int().min(1).max(10),
    signOutOtherSessions: z.boolean(),
    allowTrustedDevices: z.boolean(),
    notices: StaffSecurityNotices,
  })
  .superRefine((b, ctx) => {
    if (new Set(b.allowedAuthMethods).size !== b.allowedAuthMethods.length)
      ctx.addIssue({ code: 'custom', path: ['allowedAuthMethods'], message: 'Choose each once' });
    const ips = b.accessLocation === 'ALLOWED_IPS';
    const countries = b.accessLocation === 'ALLOWED_COUNTRIES';
    if (ips !== b.allowedIps.length > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['allowedIps'],
        message: ips
          ? 'Add at least one IP address or network'
          : 'IP addresses go with Specific IP Addresses Only',
      });
    if (countries !== b.allowedCountries.length > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['allowedCountries'],
        message: countries
          ? 'Add at least one country'
          : 'Countries go with Specific Countries/Regions Only',
      });
  });
export type SaveStaffSecurityDefaultsRequest = z.input<typeof SaveStaffSecurityDefaultsRequest>;
