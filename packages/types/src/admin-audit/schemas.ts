import { z } from 'zod';
import {
  AuditActorType,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
  SecurityAlertStatus,
} from '../db-enums.js';

// Super Admin Audit & Security (R55): the platform's audit and security event log across firms,
// one event's investigation record, response actions, investigation notes, security alerts,
// exports and the platform security policy. Designs: docs/mockups/super-admin/audit-security/
// (the dashboard, two Event Details frames, Security Settings, the developer instructions).
// Tables: R0 stage B4 (docs/work/R0-stage-b4-audit.md): audit_logs with its normalized event
// fields, security_alerts, audit_investigation_notes, platform_security_policy.
// Routes: /api/v1/admin/audit/..., Super Admin only (403 otherwise; a cross-firm event is 404 to
// anyone else, never "exists"). Audit rows are never edited: a correction, a review or a response
// is a new row that names the event (`relatedEventId`), and notes are additive.
// The web mock (apps/web/src/mocks/admin-audit-security.ts) shaped these types; where the database
// differs it wins: outcomes are SUCCESS, FAILURE and DENIED; categories include SYSTEM; the
// security settings stay within the database's floors (audit retention of at least a year, MFA
// always required for Super Admins).
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export {
  AuditActorType as AdminAuditActorType,
  AuditCategory as AdminAuditCategory,
  AuditOutcome as AdminAuditOutcome,
  AuditSeverity as AdminAuditSeverity,
  SecurityAlertStatus as AdminSecurityAlertStatus,
};

export const AdminAuditEventId = z.uuid();
export const AdminSecurityAlertId = z.uuid();
export const AdminAuditNoteId = z.uuid();

/** Stable `error.code` values of these routes, besides the generic ones. */
export const AdminAuditErrorCode = z.enum([
  /** 409: the response action is not available for this event (see `actions[].reason`). */
  'ACTION_UNAVAILABLE',
  /** 409: the alert's status does not allow this (a closed alert never changes). */
  'ALERT_STATE',
  /** 409: the note was retracted or edited already, or is not yours. */
  'NOTE_STATE',
  /** 409: someone saved the security policy after it was loaded; reload and reapply. */
  'SAVE_CONFLICT',
  /** 409: more rows than one export holds; narrow the filters. */
  'EXPORT_TOO_LARGE',
]);
export type AdminAuditErrorCode = z.infer<typeof AdminAuditErrorCode>;

/** The dashboard's tabs: filters of one event list (docx §5). */
export const AdminAuditView = z.enum([
  'audit',
  'security',
  'login',
  'permissions',
  'data',
  'integrations',
  'policies',
]);
export type AdminAuditView = z.infer<typeof AdminAuditView>;

/** What a Super Admin can do from an event (Event Details' buttons). */
export const AdminAuditResponseAction = z.enum([
  'MARK_REVIEWED',
  'SEND_ALERT',
  'RESET_PASSWORD',
  'UNLOCK_ACCOUNT',
  'FORCE_LOGOUT',
  'SUSPEND_USER',
  'RESET_MFA',
  'DISABLE_INTEGRATION',
]);
export type AdminAuditResponseAction = z.infer<typeof AdminAuditResponseAction>;

// ---------- Events ----------

export const AdminAuditActor = z.object({
  type: AuditActorType,
  id: z.uuid().nullable(),
  name: z.string(),
  /** The role when the action happened (a snapshot); null when not recorded. */
  role: z.string().nullable(),
});
export type AdminAuditActor = z.infer<typeof AdminAuditActor>;

/** `id: null` is Firmivra itself (a platform event), not a firm. */
export const AdminAuditFirmRef = z.object({ id: z.uuid().nullable(), name: z.string() });
export type AdminAuditFirmRef = z.infer<typeof AdminAuditFirmRef>;

/** From the request: telemetry, never proof. The browser and system are read from the user agent. */
export const AdminAuditDevice = z.object({
  ip: z.string().nullable(),
  /** Approximate place from the IP; null until a lookup exists. */
  location: z.string().nullable(),
  /** "Chrome / Windows". */
  label: z.string(),
  browser: z.string().nullable(),
  os: z.string().nullable(),
  mobile: z.boolean(),
  userAgent: z.string().nullable(),
});
export type AdminAuditDevice = z.infer<typeof AdminAuditDevice>;

export const AdminAuditTarget = z.object({
  /** The record type, e.g. "membership", "invoice". */
  type: z.string(),
  id: z.string().nullable(),
  name: z.string().nullable(),
});
export type AdminAuditTarget = z.infer<typeof AdminAuditTarget>;

/** A field-level change; a masked value never carries the secret itself. */
export const AdminAuditChange = z.object({
  field: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  masked: z.boolean(),
});
export type AdminAuditChange = z.infer<typeof AdminAuditChange>;

export const AdminAuditRisk = z.object({
  /** 0 to 100; null when no rule scored it. */
  score: z.number().int().nullable(),
  rule: z.string().nullable(),
  reason: z.string().nullable(),
});
export type AdminAuditRisk = z.infer<typeof AdminAuditRisk>;

/**
 * One row of the log. Rows written before the normalized fields existed get their category,
 * severity and outcome from their action (`auth.sign_in_failed` is AUTHENTICATION, MEDIUM,
 * FAILURE); `classified` is false for them.
 */
export const AdminAuditEvent = z.object({
  id: z.uuid(),
  /** The human event ID: EVT-YYYYMMDD-XXXXXX (the date and the id's last six characters). */
  reference: z.string(),
  /** The action as written, e.g. `auth.sign_in_failed`. */
  type: z.string(),
  /** The action as the list shows it, e.g. "Sign In Failed". */
  action: z.string(),
  category: AuditCategory,
  severity: AuditSeverity,
  outcome: AuditOutcome,
  classified: z.boolean(),
  /** The newest alert raised from this event, if any. */
  alertState: SecurityAlertStatus.nullable(),
  /** UTC, stamped by the database. */
  at: DateTime,
  /** "Sign In Failed: Fake Owner" or the target. */
  summary: z.string(),
  actor: AdminAuditActor,
  firm: AdminAuditFirmRef,
  authMethod: z.string().nullable(),
  sessionId: z.string().nullable(),
  requestId: z.string().nullable(),
  device: AdminAuditDevice,
  target: AdminAuditTarget,
  /** The user an event is about (the account response actions apply to). */
  subjectUserId: z.uuid().nullable(),
  /** The event this one responds to (a response, a review). */
  relatedEventId: z.uuid().nullable(),
  /** When a Super Admin marked it reviewed (a later `audit.event_reviewed` row). */
  reviewedAt: DateTime.nullable(),
  risk: AdminAuditRisk,
  /** How many records a bulk action touched. */
  itemCount: z.number().int().nullable(),
});
export type AdminAuditEvent = z.infer<typeof AdminAuditEvent>;

const Page = z.coerce.number().int().min(1).optional().default(1);
const PageSize = z.coerce.number().int().min(1).max(100).optional().default(25);

export const AdminAuditEventQuery = z.strictObject({
  view: AdminAuditView.optional().default('audit'),
  /** Actor name, target, record id, IP, action or event reference. */
  search: z.string().trim().max(100).optional(),
  /** A firm id, or `platform` for Firmivra's own events. */
  firm: z.union([z.uuid(), z.literal('platform')]).optional(),
  /** An actor's user id. */
  user: z.uuid().optional(),
  action: z.string().trim().max(100).optional(),
  category: AuditCategory.optional(),
  severity: AuditSeverity.optional(),
  outcome: AuditOutcome.optional(),
  alert: z.union([SecurityAlertStatus, z.literal('NONE')]).optional(),
  /** A record type (`target.type`). */
  resource: z.string().trim().max(60).optional(),
  /** Inclusive moments; left out: the last 14 days. */
  from: DateTime.optional(),
  to: DateTime.optional(),
  sort: z.enum(['at', 'severity', 'action']).optional().default('at'),
  descending: z.union([z.boolean(), z.stringbool()]).optional().default(true),
  page: Page,
  pageSize: PageSize,
});
export type AdminAuditEventQuery = z.input<typeof AdminAuditEventQuery>;

export const AdminAuditEventPage = z.object({
  items: z.array(AdminAuditEvent),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminAuditEventPage = z.infer<typeof AdminAuditEventPage>;

/** The filters' choices: firms, people seen in the log, actions and record types. */
export const AdminAuditFacets = z.object({
  firms: z.array(z.object({ id: z.uuid(), name: z.string() })),
  users: z.array(z.object({ id: z.uuid(), name: z.string() })),
  actions: z.array(z.string()),
  resources: z.array(z.string()),
});
export type AdminAuditFacets = z.infer<typeof AdminAuditFacets>;

export const AdminAuditSummaryQuery = z.strictObject({
  from: DateTime.optional(),
  to: DateTime.optional(),
});
export type AdminAuditSummaryQuery = z.input<typeof AdminAuditSummaryQuery>;

/** `value` counts the selected range; `previous` the range of equal length just before it. */
export const AdminAuditMetric = z.object({
  value: z.number().int(),
  previous: z.number().int(),
});
export type AdminAuditMetric = z.infer<typeof AdminAuditMetric>;

/** The dashboard's cards. `activeSessions` is null: sessions are firm data (see the PR). */
export const AdminAuditSummary = z.object({
  from: DateTime,
  to: DateTime,
  openAlerts: AdminAuditMetric,
  failedLogins: AdminAuditMetric,
  highRiskEvents: AdminAuditMetric,
  criticalEvents: AdminAuditMetric,
  permissionChanges: AdminAuditMetric,
  activeSessions: AdminAuditMetric.nullable(),
});
export type AdminAuditSummary = z.infer<typeof AdminAuditSummary>;

// ---------- One event ----------

export const AdminAuditNote = z.object({
  id: z.uuid(),
  author: z.object({ id: z.uuid(), name: z.string() }),
  text: z.string(),
  at: DateTime,
  /** The note this one corrects (an edit is a new note). */
  supersedesId: z.uuid().nullable(),
  retractedAt: DateTime.nullable(),
  isYours: z.boolean(),
});
export type AdminAuditNote = z.infer<typeof AdminAuditNote>;

export const AdminSecurityAlert = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  firm: AdminAuditFirmRef,
  ruleId: z.string(),
  severity: AuditSeverity,
  title: z.string(),
  summary: z.string().nullable(),
  riskScore: z.number().int().nullable(),
  status: SecurityAlertStatus,
  assignedTo: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  acknowledgedAt: DateTime.nullable(),
  closedAt: DateTime.nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: DateTime,
});
export type AdminSecurityAlert = z.infer<typeof AdminSecurityAlert>;

export const AdminAuditAvailableAction = z.object({
  action: AdminAuditResponseAction,
  label: z.string(),
  enabled: z.boolean(),
  /** Why it is not available now. */
  reason: z.string().nullable(),
});
export type AdminAuditAvailableAction = z.infer<typeof AdminAuditAvailableAction>;

/** GET /admin/audit/events/{id}: Event Details. */
export const AdminAuditEventDetail = z.object({
  event: AdminAuditEvent,
  /** The metadata's own fields, secrets and personal values masked. */
  changes: z.array(AdminAuditChange),
  /** The rows that name this one (responses, reviews), oldest first: the Timeline. */
  timeline: z.array(AdminAuditEvent),
  /** The same actor, session, IP or target in the 24 hours around it, newest first. */
  related: z.array(AdminAuditEvent),
  relatedTotal: z.number().int(),
  alerts: z.array(AdminSecurityAlert),
  notes: z.array(AdminAuditNote),
  /** The newer and the older event in the log's default order. */
  previousId: z.uuid().nullable(),
  nextId: z.uuid().nullable(),
  actions: z.array(AdminAuditAvailableAction),
});
export type AdminAuditEventDetail = z.infer<typeof AdminAuditEventDetail>;

/** POST /admin/audit/events/{id}/respond. */
export const AdminAuditRespondRequest = z.strictObject({
  action: AdminAuditResponseAction,
  reason: z.string().trim().max(1000).optional(),
});
export type AdminAuditRespondRequest = z.input<typeof AdminAuditRespondRequest>;

/** What the action wrote: its own audit row, and the alert it raised (SEND_ALERT). */
export const AdminAuditRespondResult = z.object({
  event: AdminAuditEvent,
  alert: AdminSecurityAlert.nullable(),
});
export type AdminAuditRespondResult = z.infer<typeof AdminAuditRespondResult>;

/** An investigation note, or its correction (`POST /notes/{id}/edit`). */
export const AdminAuditNoteRequest = z.strictObject({
  text: z.string().trim().min(1, 'Write the note').max(4000, 'Use at most 4000 characters'),
});
export type AdminAuditNoteRequest = z.input<typeof AdminAuditNoteRequest>;

// ---------- Alerts ----------

export const AdminSecurityAlertQuery = z.strictObject({
  status: SecurityAlertStatus.optional(),
  severity: AuditSeverity.optional(),
  firm: z.union([z.uuid(), z.literal('platform')]).optional(),
  page: Page,
  pageSize: PageSize,
});
export type AdminSecurityAlertQuery = z.input<typeof AdminSecurityAlertQuery>;

export const AdminSecurityAlertPage = z.object({
  items: z.array(AdminSecurityAlert),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminSecurityAlertPage = z.infer<typeof AdminSecurityAlertPage>;

/** Resolve (a note is required) or dismiss (optional). */
export const AdminCloseAlertRequest = z.strictObject({
  note: z.string().trim().max(2000).optional(),
});
export type AdminCloseAlertRequest = z.input<typeof AdminCloseAlertRequest>;

export const AdminResolveAlertRequest = z.strictObject({
  note: z.string().trim().min(1, 'Say how it was resolved').max(2000),
});
export type AdminResolveAlertRequest = z.input<typeof AdminResolveAlertRequest>;

/** Assign to a Super Admin (their user id), or null to unassign. */
export const AdminAssignAlertRequest = z.strictObject({ userId: z.uuid().nullable() });
export type AdminAssignAlertRequest = z.input<typeof AdminAssignAlertRequest>;

// ---------- Export ----------

export const AdminAuditExportRequest = z.strictObject({
  query: AdminAuditEventQuery.omit({ page: true, pageSize: true }).optional(),
  format: z.enum(['CSV', 'JSON']),
});
export type AdminAuditExportRequest = z.input<typeof AdminAuditExportRequest>;

/** The file, built in the answer (at most `ADMIN_AUDIT_EXPORT_MAX` rows); audited. */
export const AdminAuditExport = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
  rowCount: z.number().int(),
});
export type AdminAuditExport = z.infer<typeof AdminAuditExport>;
export const ADMIN_AUDIT_EXPORT_MAX = 10_000;

// ---------- Security Settings (platform_security_policy) ----------

const IpOrNetwork = z
  .string()
  .trim()
  .max(43)
  .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Use an IP address or network like 203.0.113.0/24');

/**
 * The Security Settings page, within the database's floors. Two-factor sign-in is always required
 * for Super Admins: `ALL` adds every user. Audit records are kept at least a year.
 */
export const AdminSecuritySettings = z
  .strictObject({
    mfa: z.strictObject({ scope: z.enum(['ALL', 'ADMINS']) }),
    /** At least one; Authenticator App is what the staff and admin pools use today. */
    methods: z
      .strictObject({
        authenticatorApp: z.boolean(),
        sms: z.boolean(),
        email: z.boolean(),
        hardwareKey: z.boolean(),
      })
      .refine((m) => Object.values(m).some(Boolean), 'Allow at least one method'),
    password: z.strictObject({
      minLength: z.number().int().min(8).max(128),
      uppercase: z.boolean(),
      lowercase: z.boolean(),
      numbers: z.boolean(),
      special: z.boolean(),
      /** 0 is never (no forced rotation is Firmivra's recommendation). */
      expirationDays: z.union([
        z.literal(0),
        z.literal(30),
        z.literal(60),
        z.literal(90),
        z.literal(180),
        z.literal(365),
      ]),
      preventReuseCount: z.number().int().min(0).max(24),
    }),
    session: z.strictObject({
      idleTimeoutMinutes: z.number().int().min(5).max(1440),
      maxLifetimeHours: z.number().int().min(1).max(720),
      rememberMeDays: z.number().int().min(0).max(30),
      /** 0 is unlimited. */
      concurrentSessions: z.number().int().min(0).max(20),
      selfManage: z.boolean(),
      reauthSensitive: z.boolean(),
      reauthWindowMinutes: z.number().int().min(1).max(60),
      reauthDeviceSwitch: z.boolean(),
    }),
    protection: z.strictObject({
      maxFailedAttempts: z.number().int().min(3).max(20),
      lockoutMinutes: z.number().int().min(1).max(1440),
      notifySuspicious: z.boolean(),
      autoLock: z.boolean(),
      emailAdminOnLockout: z.boolean(),
      verifyNewDevices: z.boolean(),
    }),
    ip: z.strictObject({
      mode: z.enum(['ANY', 'ALLOW_LIST', 'BLOCK_LIST']),
      allowList: z.array(IpOrNetwork).max(100),
      blockList: z.array(IpOrNetwork).max(100),
    }),
    notifications: z.strictObject({
      failedLogins: z.boolean(),
      newDevice: z.boolean(),
      passwordChanges: z.boolean(),
      mfaDisabled: z.boolean(),
      accountLocked: z.boolean(),
      suspicious: z.boolean(),
      /** In-app alerts are always on; these add channels. */
      email: z.boolean(),
      sms: z.boolean(),
      minimumSeverity: AuditSeverity.exclude(['INFO']),
    }),
    retention: z.strictObject({
      /** 365 to 3650 days. */
      retentionDays: z.number().int().min(365).max(3650),
      archiveAfterDays: z.number().int().min(30).max(3650),
    }),
    exports: z.strictObject({
      roles: z.array(z.enum(['SUPER_ADMINS', 'SECURITY_ADMINS', 'AUDITORS'])).max(3),
      requireReauth: z.boolean(),
      linkExpiryHours: z.number().int().min(1).max(168),
    }),
  })
  .refine((s) => s.retention.archiveAfterDays <= s.retention.retentionDays, {
    path: ['retention', 'archiveAfterDays'],
    message: 'Archive on or before the end of retention',
  })
  .refine((s) => s.ip.mode !== 'ALLOW_LIST' || s.ip.allowList.length > 0, {
    path: ['ip', 'allowList'],
    message: 'Add at least one address to allow',
  });
export type AdminSecuritySettings = z.infer<typeof AdminSecuritySettings>;

/** GET /admin/audit/policy. `version` goes back on PUT (409 SAVE_CONFLICT when stale). */
export const AdminSecuritySettingsRecord = z.object({
  version: z.number().int(),
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
  /** Whether audit retention may change here (fixed by policy otherwise). */
  retentionEditable: z.boolean(),
  settings: AdminSecuritySettings,
});
export type AdminSecuritySettingsRecord = z.infer<typeof AdminSecuritySettingsRecord>;

export const SaveAdminSecuritySettingsRequest = z.strictObject({
  version: z.number().int().min(1),
  settings: AdminSecuritySettings,
});
export type SaveAdminSecuritySettingsRequest = z.input<typeof SaveAdminSecuritySettingsRequest>;

/** Firmivra's recommended defaults ("Reset to Default"). No forced password rotation. */
export const ADMIN_SECURITY_DEFAULTS: AdminSecuritySettings = {
  mfa: { scope: 'ADMINS' },
  methods: { authenticatorApp: true, sms: false, email: false, hardwareKey: false },
  password: {
    minLength: 12,
    uppercase: true,
    lowercase: true,
    numbers: true,
    special: false,
    expirationDays: 0,
    preventReuseCount: 5,
  },
  session: {
    idleTimeoutMinutes: 30,
    maxLifetimeHours: 12,
    rememberMeDays: 0,
    concurrentSessions: 0,
    selfManage: true,
    reauthSensitive: true,
    reauthWindowMinutes: 10,
    reauthDeviceSwitch: false,
  },
  protection: {
    maxFailedAttempts: 5,
    lockoutMinutes: 15,
    notifySuspicious: true,
    autoLock: true,
    emailAdminOnLockout: true,
    verifyNewDevices: false,
  },
  ip: { mode: 'ANY', allowList: [], blockList: [] },
  notifications: {
    failedLogins: true,
    newDevice: true,
    passwordChanges: true,
    mfaDisabled: true,
    accountLocked: true,
    suspicious: true,
    email: true,
    sms: false,
    minimumSeverity: 'HIGH',
  },
  retention: { retentionDays: 2555, archiveAfterDays: 365 },
  exports: { roles: ['SUPER_ADMINS'], requireReauth: true, linkExpiryHours: 24 },
};
