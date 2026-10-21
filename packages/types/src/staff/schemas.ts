import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { CalendarDate } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  MembershipRole,
  PermissionCapability,
  PermissionModule,
  ScanStatus,
  StaffAccessLevel,
  StaffAccessLocation,
  StaffAuthMethod,
  StaffDocumentType,
  StaffEmploymentType,
  StaffPayFrequency,
  StaffPayType,
} from '../schemas.js';
import { TeamMemberStatus } from '../team/schemas.js';
import { megabytes, UPLOAD_LIMITS } from '../documents/schemas.js';

// Staff Management (R42 contract, for Tumit's screens): the directory, Create/Edit Staff in four
// steps, drafts, staff documents, the account access and security page, and bulk upload.
// Designs: docs/mockups/firm-workspace/staff-management/source/. Brief for the API session:
// docs/work/briefs/staff-management-contract.md (built on docs/work/briefs/r35-staff-roles-api.md).
// API: /api/v1/business/staff/... Owner and Admin change; Manager (grid STAFF_MANAGEMENT view)
// reads. The target must be a role the actor manages (ROLES_MANAGED_BY); nobody changes
// themselves; the last active owner is protected (LAST_ACTIVE_OWNER).
// Never in a request or response: passwords, activation tokens, MFA secrets, recovery codes.
// Pay (`compensation`) and staff documents are shown only to the acting Owner or Admin (the
// database walls them off); everyone else gets `compensation: null` and 403 on documents.
// Responses are plain objects (a field the API adds later is dropped); requests are strict.

const DateTime = z.iso.datetime({ offset: true });

/** A membership id in a path: anything else gets 400 VALIDATION_FAILED. */
export const StaffId = z.uuid();
export const StaffDraftId = z.uuid();
export const StaffDocumentId = z.uuid();
export const StaffSessionId = z.uuid();

/** A person picker's row: managers, department heads, team leads, "Copy Permissions from". */
export const StaffRef = z.object({
  /** The membership id. */
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  jobTitle: z.string().nullable(),
  /** No avatar storage yet: always null until a profile-photo upload exists (Staff Management). */
  avatarUrl: z.string().nullable().optional(),
});
export type StaffRef = z.infer<typeof StaffRef>;

export const NamedRef = z.object({ id: z.uuid(), name: z.string() });
export type NamedRef = z.infer<typeof NamedRef>;

/** The MFA column of Users & Roles and the 2FA row of Security Settings. */
export const StaffMfaState = z.enum(['ENABLED', 'DISABLED', 'PENDING']);
export type StaffMfaState = z.infer<typeof StaffMfaState>;

/** An open invite: shown as "Invited Sep 25, 2026"; expired ones offer Resend. */
export const StaffInvite = z.object({ sentAt: DateTime, expiresAt: DateTime });
export type StaffInvite = z.infer<typeof StaffInvite>;

// ---------- Directory (Staff Management page) ----------

/** Directory filter "All Statuses"; DEACTIVATED shows as Inactive. */
export const StaffStatusFilter = z.enum(['all', 'active', 'inactive', 'invited', 'locked']);
export type StaffStatusFilter = z.infer<typeof StaffStatusFilter>;

const Page = z.coerce.number().int().min(1).max(10_000).optional().default(1);
const PageSize = z.coerce
  .number()
  .int()
  .refine((n) => [10, 25, 50, 100].includes(n), 'Use 10, 25, 50 or 100 per page')
  .optional()
  .default(10);

/** GET /business/staff: search matches name, email and job title. Sorted by name. */
export const StaffListQuery = z.strictObject({
  search: SearchText.optional(),
  departmentId: z.uuid().optional(),
  status: StaffStatusFilter.optional().default('all'),
  role: MembershipRole.optional(),
  page: Page,
  pageSize: PageSize,
});
export type StaffListQuery = z.input<typeof StaffListQuery>;

/** One directory row (Name, Job Title, Department, Role, Status, Last Login, Actions). */
export const StaffListItem = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable().optional(),
  jobTitle: z.string().nullable(),
  departments: z.array(NamedRef),
  role: MembershipRole,
  /** The firm's own role they have (its `basedOn` is `role`), or null. */
  customRole: NamedRef.nullable().optional(),
  accessLevel: StaffAccessLevel,
  status: TeamMemberStatus,
  /** Null until they first sign in; for INVITED the row shows the invite instead. */
  lastLoginAt: DateTime.nullable(),
  mfa: StaffMfaState,
  invite: StaffInvite.nullable(),
  /** The signed-in person: the row hides actions on themselves. */
  isYou: z.boolean(),
});
export type StaffListItem = z.infer<typeof StaffListItem>;

/** "Showing 1-7 of 7 staff members" with numbered pages. */
export const StaffListResponse = z.object({
  items: z.array(StaffListItem).max(100),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type StaffListResponse = z.infer<typeof StaffListResponse>;

/** GET /business/staff/summary: the four KPI cards. Percentages are worked out by the screen. */
export const StaffSummary = z.object({
  total: z.number().int(),
  /** "+2 this month": members whose invite was sent this calendar month (firm time zone). */
  addedThisMonth: z.number().int(),
  active: z.number().int(),
  /** DEACTIVATED. */
  inactive: z.number().int(),
  invited: z.number().int(),
  locked: z.number().int(),
  /** ACTIVE departments. */
  departments: z.number().int(),
});
export type StaffSummary = z.infer<typeof StaffSummary>;

/** GET /business/staff/options: the Create/Edit Staff dropdowns, in one call. */
export const StaffFormOptions = z.object({
  departments: z.array(NamedRef),
  teams: z.array(NamedRef.extend({ departmentId: z.uuid() })),
  /** Active members, for Supervisor / Manager. */
  managers: z.array(StaffRef),
  /** The roles the signed-in person may give (ROLES_MANAGED_BY), with the screen's description. */
  roles: z.array(z.object({ role: MembershipRole, label: z.string(), description: z.string() })),
  /** The firm's live custom roles the signed-in person may give (their `basedOn` is in `roles`). */
  customRoles: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        basedOn: MembershipRole,
        description: z.string().nullable(),
      }),
    )
    .optional(),
  /** Titles already used at the firm, for "Select or enter job title". Free text is allowed. */
  jobTitles: z.array(z.string()),
  /**
   * Offices or branches already used at the firm. No firm locations table yet: the distinct
   * staff_profiles.office values until Settings > Company Profile adds locations.
   */
  offices: z.array(z.string()),
  workSchedules: z.array(z.string()),
  /** Service codes (FIRM_SERVICES) for Service Area(s) and Primary Service Specialty. */
  serviceAreas: z.array(z.object({ code: z.string(), label: z.string() })),
});
export type StaffFormOptions = z.infer<typeof StaffFormOptions>;

// ---------- One member (Edit Staff, Access & Security header, Success page) ----------

export const StaffProfileDetails = z.object({
  employmentType: StaffEmploymentType.nullable(),
  workSchedule: z.string().nullable(),
  office: z.string().nullable(),
  hireDate: CalendarDate.nullable(),
  endDate: CalendarDate.nullable(),
  supervisor: StaffRef.nullable(),
  /** IANA name. */
  timeZone: z.string().nullable(),
  employeeId: z.string().nullable(),
  primaryTeam: NamedRef.nullable(),
  backupTeam: NamedRef.nullable(),
  primarySpecialty: z.string().nullable(),
  maxWorkload: z.number().int().nullable(),
  acceptsNewClients: z.boolean(),
});
export type StaffProfileDetails = z.infer<typeof StaffProfileDetails>;

/** The last successful sign-in: "Logged in from Chrome on MacOS, Atlanta, GA, USA". */
export const StaffLastLogin = z.object({
  at: DateTime,
  device: z.string().nullable(),
  /** Approximate, from the IP; null when unknown. Telemetry, not proof of place. */
  place: z.string().nullable(),
});
export type StaffLastLogin = z.infer<typeof StaffLastLogin>;

export const StaffNote = z.object({
  text: z.string(),
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type StaffNote = z.infer<typeof StaffNote>;

/** GET /business/staff/{id}. `version` goes back on PATCH to catch a concurrent edit. */
export const StaffDetail = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  /** Split from the login's one name field (first word / the rest) until it holds both. */
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  avatarUrl: z.string().nullable().optional(),
  role: MembershipRole,
  /** The firm's own role they have (its `basedOn` is `role`), or null. */
  customRole: NamedRef.nullable().optional(),
  status: TeamMemberStatus,
  jobTitle: z.string().nullable(),
  departments: z.array(NamedRef),
  serviceAreas: z.array(z.string()),
  accessLevel: StaffAccessLevel,
  accessStartsOn: CalendarDate.nullable(),
  /** "Member since Mar 15, 2024": joined, or invited when not yet joined. */
  memberSince: DateTime,
  profile: StaffProfileDetails,
  mfa: StaffMfaState,
  lastLogin: StaffLastLogin.nullable(),
  invite: StaffInvite.nullable(),
  /** Owner and Admin only; null for everyone else (the Notes card is then hidden). */
  notes: StaffNote.nullable(),
  isYou: z.boolean(),
  version: z.string(),
});
export type StaffDetail = z.infer<typeof StaffDetail>;

// ---------- Create / Edit Staff: the four steps ----------

const Name = text(60);
const Phone = text(40);
const Ids = z.array(z.uuid()).max(20);

/** Step 1, Account Information (with the role part of step 2). */
export const StaffAccountInput = z.strictObject({
  firstName: Name,
  lastName: Name,
  email: Email,
  phone: clearable(Phone),
  departmentIds: Ids.min(1, 'Choose at least one department'),
  jobTitle: text(100),
  role: MembershipRole,
  serviceAreas: z.array(z.string().max(40)).max(20).optional(),
  accessLevel: StaffAccessLevel.optional(),
  accessStartsOn: CalendarDate.nullable().optional(),
});
export type StaffAccountInput = z.input<typeof StaffAccountInput>;

/** Send Notifications For: the five security notices. */
export const StaffSecurityNotices = z.strictObject({
  newDeviceLogin: z.boolean(),
  failedLogins: z.boolean(),
  passwordChanges: z.boolean(),
  securityAlerts: z.boolean(),
  lockouts: z.boolean(),
});
export type StaffSecurityNotices = z.infer<typeof StaffSecurityNotices>;

const IpOrNetwork = z
  .string()
  .trim()
  .max(43)
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Use an IP address or network like 203.0.113.0/24');
const CountryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use a two-letter country code');

/**
 * Step 3, Access & Security (staff_security_settings). Two-factor sign-in is always required for
 * staff, so there is no switch to turn it off. Passwords are never set here: the person gets a
 * secure, time-limited activation link and chooses their own (the design's "Set custom password"
 * is not offered; see the contract).
 */
export const StaffAccessInput = z.strictObject({
  requirePasswordChange: z.boolean().optional(),
  allowedAuthMethods: z.array(StaffAuthMethod).min(1).max(4).optional(),
  restrictDevices: z.boolean().optional(),
  /** Minutes, 5 to 480; null uses the firm's default (the checkbox off). */
  autoLogoutMinutes: z.number().int().min(5).max(480).nullable().optional(),
  disableOn: CalendarDate.nullable().optional(),
  accessLocation: StaffAccessLocation.optional(),
  allowedIps: z.array(IpOrNetwork).max(20).optional(),
  allowedCountries: z.array(CountryCode).max(50).optional(),
  maxConcurrentSessions: z.number().int().min(1).max(10).optional(),
  signOutOtherSessions: z.boolean().optional(),
  allowTrustedDevices: z.boolean().optional(),
  recoveryEmail: clearable(Email),
  notices: StaffSecurityNotices.optional(),
});
export type StaffAccessInput = z.input<typeof StaffAccessInput>;

/** Step 4, Employment Information and Team Assignment (staff_profiles, team_members). */
export const StaffDetailsInput = z.strictObject({
  employmentType: StaffEmploymentType.nullable().optional(),
  workSchedule: clearable(text(80)),
  office: clearable(text(100)),
  hireDate: CalendarDate.nullable().optional(),
  endDate: CalendarDate.nullable().optional(),
  supervisorId: z.uuid().nullable().optional(),
  timeZone: clearable(text(100)),
  employeeId: clearable(text(40)),
  primaryTeamId: z.uuid().nullable().optional(),
  backupTeamId: z.uuid().nullable().optional(),
  primarySpecialty: clearable(text(40)),
  maxWorkload: z.number().int().min(1).max(10_000).nullable().optional(),
  acceptsNewClients: z.boolean().optional(),
});
export type StaffDetailsInput = z.input<typeof StaffDetailsInput>;

/** Step 4, Compensation Information (staff_compensation). Owner and Admin only. */
export const StaffCompensation = z.object({
  payType: StaffPayType.nullable(),
  /** Cents of USD. */
  rateCents: z.number().int().nullable(),
  payFrequency: StaffPayFrequency.nullable(),
  commission: z.string().nullable(),
  payrollId: z.string().nullable(),
  updatedAt: DateTime.nullable(),
});
export type StaffCompensation = z.infer<typeof StaffCompensation>;

export const StaffCompensationInput = z.strictObject({
  payType: StaffPayType.nullable().optional(),
  rateCents: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
  payFrequency: StaffPayFrequency.nullable().optional(),
  commission: clearable(text(200)),
  payrollId: clearable(text(40)),
});
export type StaffCompensationInput = z.input<typeof StaffCompensationInput>;

/** One cell of the permission grid as a change: granted or taken away. */
export const PermissionGrant = z.strictObject({
  module: PermissionModule,
  capability: PermissionCapability,
  granted: z.boolean(),
});
export type PermissionGrant = z.infer<typeof PermissionGrant>;

/**
 * Step 2's grid when it differs from the role's: the whole grid the screen shows (the API keeps
 * only the cells that differ from the role, in member_permissions).
 */
export const PermissionGrants = z.array(PermissionGrant).max(24 * 7);

/**
 * POST /business/staff: Submit & Send Invitation. Creates the member and sends the secure invite
 * in one call. `idempotencyKey` makes a retry return the first result instead of a second member.
 * `draftId` is deleted on success.
 */
export const CreateStaffRequest = z.strictObject({
  idempotencyKey: z.uuid(),
  account: StaffAccountInput,
  permissions: PermissionGrants.optional(),
  access: StaffAccessInput.optional(),
  details: StaffDetailsInput.optional(),
  compensation: StaffCompensationInput.optional(),
  /** "Send welcome email with login instructions". Off: created as INVITED, no email yet. */
  sendWelcomeEmail: z.boolean().default(true),
  /**
   * "(and text, if selected)": an SMS that says an email is waiting, never a link or code.
   * No SMS sender for staff yet (Communications module): ignored until it exists.
   */
  sendWelcomeText: z.boolean().optional(),
  draftId: StaffDraftId.optional(),
});
export type CreateStaffRequest = z.input<typeof CreateStaffRequest>;

/** The invitation's outcome: FAILED keeps the member and offers Resend (never a duplicate). */
export const InvitationOutcome = z.object({
  status: z.enum(['SENT', 'FAILED', 'NOT_SENT']),
  sentAt: DateTime.nullable(),
  expiresAt: DateTime.nullable(),
});
export type InvitationOutcome = z.infer<typeof InvitationOutcome>;

/** The Success page: the member as created and how the invite went. */
export const CreateStaffResponse = z.object({
  staff: StaffDetail,
  invitation: InvitationOutcome,
});
export type CreateStaffResponse = z.infer<typeof CreateStaffResponse>;

/**
 * PATCH /business/staff/{id}: Save Changes on Edit Staff. Only the groups and fields sent change.
 * `version` from GET; a newer version on the server is 409 SAVE_CONFLICT (reload and reapply).
 */
export const UpdateStaffRequest = z
  .strictObject({
    version: z.string().min(1).max(100),
    account: StaffAccountInput.partial().optional(),
    details: StaffDetailsInput.optional(),
    /** "Send notification of changes" (Edit Staff, step 3): email the member what changed. */
    notifyMember: z.boolean().optional(),
  })
  .refine((b) => b.account !== undefined || b.details !== undefined, 'Change something first');
export type UpdateStaffRequest = z.input<typeof UpdateStaffRequest>;

// ---------- Drafts (Save as Draft) ----------

/** What Save as Draft keeps: the form so far, never pay (it is not walled off in a draft). */
export const StaffDraftData = z.strictObject({
  account: StaffAccountInput.partial().optional(),
  permissions: PermissionGrants.optional(),
  access: StaffAccessInput.optional(),
  details: StaffDetailsInput.optional(),
  sendWelcomeEmail: z.boolean().optional(),
});
export type StaffDraftData = z.input<typeof StaffDraftData>;

export const StaffDraft = z.object({
  id: z.uuid(),
  /** 1 Account Information, 2 Role & Permissions, 3 Access & Security, 4 Additional Details. */
  step: z.number().int().min(1).max(4),
  data: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type StaffDraft = z.infer<typeof StaffDraft>;

export const StaffDraftList = z.object({ items: z.array(StaffDraft) });
export type StaffDraftList = z.infer<typeof StaffDraftList>;

export const SaveStaffDraftRequest = z.strictObject({
  step: z.number().int().min(1).max(4),
  data: StaffDraftData,
});
export type SaveStaffDraftRequest = z.input<typeof SaveStaffDraftRequest>;

// ---------- Access & Security page ----------

/** GET /business/staff/{id}/security: Account Status and Security Settings cards. */
export const StaffSecurity = z.object({
  status: TeamMemberStatus,
  accessLevel: StaffAccessLevel,
  role: MembershipRole,
  lastLogin: StaffLastLogin.nullable(),
  /** Always true for staff; shown as "Enabled" once they enrolled (mfa ENABLED). */
  mfaRequired: z.literal(true),
  mfa: StaffMfaState,
  passwordChangedAt: DateTime.nullable(),
  requirePasswordChange: z.boolean(),
  allowedAuthMethods: z.array(StaffAuthMethod),
  restrictDevices: z.boolean(),
  autoLogoutMinutes: z.number().int().nullable(),
  disableOn: CalendarDate.nullable(),
  accessLocation: StaffAccessLocation,
  allowedIps: z.array(z.string()),
  allowedCountries: z.array(z.string()),
  maxConcurrentSessions: z.number().int(),
  signOutOtherSessions: z.boolean(),
  allowTrustedDevices: z.boolean(),
  recoveryEmail: z.string().nullable(),
  recoveryEmailVerified: z.boolean(),
  notices: StaffSecurityNotices,
  lockedAt: DateTime.nullable(),
  lockedReason: z.string().nullable(),
});
export type StaffSecurity = z.infer<typeof StaffSecurity>;

/** A signed-in browser or device (Active Sessions). */
export const StaffSessionItem = z.object({
  id: z.uuid(),
  /** "MacBook Pro / Chrome". */
  device: z.string(),
  place: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: DateTime,
  lastActiveAt: DateTime,
  /** Seen in the last 5 minutes: "Active now". */
  activeNow: z.boolean(),
});
export type StaffSessionItem = z.infer<typeof StaffSessionItem>;

export const StaffSessionList = z.object({ items: z.array(StaffSessionItem) });
export type StaffSessionList = z.infer<typeof StaffSessionList>;

const CursorQuery = z.strictObject({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export const StaffCursorQuery = CursorQuery;
export type StaffCursorQuery = z.input<typeof StaffCursorQuery>;

/** One sign-in attempt (Login History): the audit log's auth.signed_in / auth.sign_in_failed. */
export const StaffLoginEvent = z.object({
  at: DateTime,
  outcome: z.enum(['SUCCESS', 'FAILED']),
  place: z.string().nullable(),
  ip: z.string().nullable(),
  device: z.string().nullable(),
});
export type StaffLoginEvent = z.infer<typeof StaffLoginEvent>;

export const StaffLoginHistory = z.object({
  items: z.array(StaffLoginEvent).max(100),
  nextCursor: z.string().nullable(),
});
export type StaffLoginHistory = z.infer<typeof StaffLoginHistory>;

/** Recent Activity and Activity & Audit: audit rows by or about the member. */
export const StaffActivityItem = z.object({
  id: z.uuid(),
  at: DateTime,
  /** The audit action, for example "auth.signed_in" or "client.viewed". */
  action: z.string(),
  /** The screen's words: "Logged in (Web)", "Viewed client records". */
  label: z.string(),
  /** The other person when the member was the target ("Role changed by Octavia Holder"). */
  actorName: z.string().nullable(),
});
export type StaffActivityItem = z.infer<typeof StaffActivityItem>;

export const StaffActivityPage = z.object({
  items: z.array(StaffActivityItem).max(100),
  nextCursor: z.string().nullable(),
});
export type StaffActivityPage = z.infer<typeof StaffActivityPage>;

/** Where a granted or refused cell comes from. */
export const PermissionSource = z.enum(['ROLE_DEFAULT', 'FIRM_ROLE', 'MEMBER']);
export type PermissionSource = z.infer<typeof PermissionSource>;

export const PermissionCell = z.object({
  module: PermissionModule,
  capability: PermissionCapability,
  granted: z.boolean(),
  source: PermissionSource,
});
export type PermissionCell = z.infer<typeof PermissionCell>;

/** GET /business/staff/{id}/permissions: Access Summary and the Permissions tab. */
export const StaffPermissions = z.object({
  role: MembershipRole,
  /** Their custom role, whose grid stands in for the role's (cells with source FIRM_ROLE). */
  customRole: NamedRef.nullable().optional(),
  /** Every module and capability (24 x 7 cells). */
  cells: z.array(PermissionCell),
  updatedAt: DateTime.nullable(),
});
export type StaffPermissions = z.infer<typeof StaffPermissions>;

export const SetStaffPermissionsRequest = z.strictObject({
  grants: PermissionGrants,
  /** Required (true) when the change gives more than the role: else 409 PERMISSION_ESCALATION. */
  acknowledgeEscalation: z.boolean().optional(),
});
export type SetStaffPermissionsRequest = z.input<typeof SetStaffPermissionsRequest>;

/**
 * One cell of a person's own permissions (Octavia's review, Oct 20, section 3): INHERIT follows
 * the role (the firm's grid for it), ALLOW and DENY are the person's whatever the role says, also
 * when ALLOW matches the role today (so a later change to the role does not take it away).
 */
export const PermissionOverrideMode = z.enum(['INHERIT', 'ALLOW', 'DENY']);
export type PermissionOverrideMode = z.infer<typeof PermissionOverrideMode>;

/**
 * PATCH /business/staff/{id}/permissions: Inherit, Allow or Deny for the cells sent; the others
 * stay as they are. Owner and Admin; never the Owner. 400 PERMISSION_NEEDS_VIEW when a module
 * would have a capability without View; 409 PERMISSION_ESCALATION when an ALLOW gives more than
 * the role (resend with acknowledgeEscalation). Answers the member's permissions, where a cell
 * with an override has source MEMBER.
 */
export const SetStaffOverridesRequest = z.strictObject({
  overrides: z
    .array(
      z.strictObject({
        module: PermissionModule,
        capability: PermissionCapability,
        mode: PermissionOverrideMode,
      }),
    )
    .min(1)
    .max(24 * 7)
    .refine(
      (cells) => new Set(cells.map((c) => `${c.module}:${c.capability}`)).size === cells.length,
      'Send each cell once',
    ),
  acknowledgeEscalation: z.boolean().optional(),
});
export type SetStaffOverridesRequest = z.input<typeof SetStaffOverridesRequest>;

/** High-risk actions (reset password or MFA, lock, sign out all): a reason and a confirm. */
export const StaffSecurityActionRequest = z.strictObject({
  reason: clearable(text(500, 'many')),
  confirm: z.literal(true, { error: 'Confirm the action first' }),
});
export type StaffSecurityActionRequest = z.input<typeof StaffSecurityActionRequest>;

/** Lock Account: a reason is required. */
export const LockStaffRequest = z.strictObject({
  reason: text(500, 'many'),
  confirm: z.literal(true, { error: 'Confirm the action first' }),
});
export type LockStaffRequest = z.input<typeof LockStaffRequest>;

/** Answer of a security action: what happened, for the toast. Never a link or code. */
export const StaffActionResult = z.object({
  ok: z.literal(true),
  status: TeamMemberStatus,
  /** Sessions signed out by the action (sign out all, lock, deactivate, reset). */
  sessionsRevoked: z.number().int(),
  invitation: InvitationOutcome.nullable(),
});
export type StaffActionResult = z.infer<typeof StaffActionResult>;

export const SetStaffNoteRequest = z.strictObject({
  /** Empty clears the note. */
  text: z.string().trim().max(500, 'Use at most 500 characters'),
});
export type SetStaffNoteRequest = z.input<typeof SetStaffNoteRequest>;

// ---------- Staff documents ----------

/** The documents' limit (100 MB); a larger file goes up as a multipart upload. */
export const STAFF_DOCUMENT_LIMITS = {
  maxBytes: UPLOAD_LIMITS.maxBytes,
  contentTypes: [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
} as const;

export const StaffDocumentContentType = z.enum(STAFF_DOCUMENT_LIMITS.contentTypes);

export const StaffDocument = z.object({
  id: z.uuid(),
  type: StaffDocumentType,
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  /** Download only when CLEAN. */
  scanStatus: ScanStatus,
  uploadedBy: z.string().nullable(),
  createdAt: DateTime,
  archivedAt: DateTime.nullable(),
});
export type StaffDocument = z.infer<typeof StaffDocument>;

export const StaffDocumentList = z.object({ items: z.array(StaffDocument) });
export type StaffDocumentList = z.infer<typeof StaffDocumentList>;

/** Step 1 of an upload: where to PUT the file (UploadTicket). `replacesId` archives that one. */
export const CreateStaffDocumentUploadRequest = z.strictObject({
  type: StaffDocumentType,
  fileName: text(200),
  contentType: StaffDocumentContentType,
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(STAFF_DOCUMENT_LIMITS.maxBytes, `Max size: ${megabytes(STAFF_DOCUMENT_LIMITS.maxBytes)}`),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  replacesId: StaffDocumentId.optional(),
});
export type CreateStaffDocumentUploadRequest = z.input<typeof CreateStaffDocumentUploadRequest>;

export const ConfirmStaffDocumentUploadRequest = z.strictObject({
  uploadToken: z.string().min(1).max(8192),
});
export type ConfirmStaffDocumentUploadRequest = z.input<typeof ConfirmStaffDocumentUploadRequest>;

/** Reclassify. */
export const UpdateStaffDocumentRequest = z.strictObject({ type: StaffDocumentType });
export type UpdateStaffDocumentRequest = z.input<typeof UpdateStaffDocumentRequest>;

/** A short-lived signed link (View / Download). */
export const StaffDocumentLink = z.object({ url: z.string(), expiresAt: DateTime });
export type StaffDocumentLink = z.infer<typeof StaffDocumentLink>;

// ---------- Bulk Upload Staff ----------

/** The columns a row can map to. */
export const StaffImportField = z.enum([
  'firstName',
  'lastName',
  'email',
  'phone',
  'jobTitle',
  'role',
  'department',
  'employmentType',
  'office',
  'hireDate',
  'employeeId',
]);
export type StaffImportField = z.infer<typeof StaffImportField>;

/**
 * POST /business/staff/import/preview: the browser reads the CSV or XLSX and sends its rows as
 * text, with the column map. Nothing is saved; the answer's `previewToken` goes to import.
 */
export const StaffImportPreviewRequest = z.strictObject({
  fileName: text(200),
  /** Source column name to field; unmapped columns are ignored. */
  columnMap: z.record(z.string().max(100), StaffImportField),
  rows: z
    .array(z.record(z.string().max(100), z.string().max(500)))
    .min(1)
    .max(500),
});
export type StaffImportPreviewRequest = z.input<typeof StaffImportPreviewRequest>;

export const StaffImportRowError = z.object({
  /** 1-based row of the file (after the header). */
  row: z.number().int(),
  field: StaffImportField.nullable(),
  message: z.string(),
});
export type StaffImportRowError = z.infer<typeof StaffImportRowError>;

export const StaffImportPreview = z.object({
  previewToken: z.string(),
  toCreate: z.number().int(),
  toUpdate: z.number().int(),
  invalid: z.number().int(),
  errors: z.array(StaffImportRowError),
});
export type StaffImportPreview = z.infer<typeof StaffImportPreview>;

export const StaffImportRequest = z.strictObject({
  previewToken: z.string().min(1).max(500),
  sendInvitations: z.boolean(),
});
export type StaffImportRequest = z.input<typeof StaffImportRequest>;

export const StaffImportResult = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  failed: z.number().int(),
  invitationsSent: z.number().int(),
  /** CSV of the failed rows with their errors; null when none failed. */
  errorFileUrl: z.string().nullable(),
});
export type StaffImportResult = z.infer<typeof StaffImportResult>;

/** Stable `error.code` values of this module, besides the generic ones and TeamErrorCode. */
export const StaffErrorCode = z.enum([
  /** 409: a member or open invite at this firm already has this email (route to that record). */
  'DUPLICATE_EMAIL',
  /** 409: someone saved this member after it was loaded; reload and reapply. */
  'SAVE_CONFLICT',
  /** 409: the grid gives more than the role; resend with acknowledgeEscalation. */
  'PERMISSION_ESCALATION',
  /** 403: the actor cannot give this permission or role. */
  'CANNOT_GRANT',
  /** 400: Create, Edit, Delete, Approve or Manage without View in a module. */
  'PERMISSION_NEEDS_VIEW',
  /** 409: the department or team is not active. */
  'GROUP_INACTIVE',
  /** 409: the file is still being scanned or failed the scan. */
  'DOCUMENT_NOT_READY',
  /** 400: an import preview that expired or belongs to someone else. */
  'IMPORT_PREVIEW_EXPIRED',
]);
export type StaffErrorCode = z.infer<typeof StaffErrorCode>;
