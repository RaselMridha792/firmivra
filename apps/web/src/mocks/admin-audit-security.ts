import {
  ADMIN_SECURITY_DEFAULTS,
  AdminSecuritySettings,
  ApiRequestError,
  type AdminAuditActorType,
} from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';
import {
  AUDIT_ADMIN,
  AUDIT_ADMIN_DEVICE,
  auditUuid,
  makeEvent,
  seedAuditStore,
} from './admin-audit-security-data';

/**
 * Mock data for the Super Admin Audit & Security module (S02): the audit and security event log,
 * one event's investigation record, response actions, investigation notes, exports and the
 * platform security policy. There is no Super Admin audit API or contract yet, so the types and
 * the client live here; outside mock mode every call fails like an unreachable API. Synthetic
 * data only; nothing is built until the first call (data in admin-audit-security-data.ts).
 */
const MODULE = 'adminAuditSecurity';

/** No Super Admin audit API yet: outside mock mode every call fails like an unreachable API. */
async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const CATEGORIES = [
  'AUTHENTICATION',
  'AUTHORIZATION',
  'DATA',
  'INTEGRATION',
  'SECURITY',
  'SYSTEM',
] as const;
export type EventCategory = (typeof CATEGORIES)[number];
/** The database's outcomes (a detection that stopped something is DENIED). */
export const OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const ALERT_STATES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'] as const;
export type AlertState = (typeof ALERT_STATES)[number];
/** The dashboard's tabs (docx §5: the supporting areas are filters of one event list). */
export const AUDIT_VIEWS = [
  'audit',
  'security',
  'login',
  'permissions',
  'data',
  'integrations',
  'policies',
] as const;
export type AuditView = (typeof AUDIT_VIEWS)[number];
export const RESPONSE_ACTIONS = [
  'RESET_PASSWORD',
  'UNLOCK_ACCOUNT',
  'FORCE_LOGOUT',
  'MARK_REVIEWED',
  'SEND_ALERT',
  'SUSPEND_USER',
  'RESET_MFA',
  'DISABLE_INTEGRATION',
] as const;
export type ResponseAction = (typeof RESPONSE_ACTIONS)[number];
/** What each severity means (docx §6): the Risk Assessment line when no rule explained it. */
export const SEVERITY_MEANINGS: Record<Severity, string> = {
  INFO: 'Info: routine successful activity.',
  LOW: 'Low: a minor policy or operational signal.',
  MEDIUM: 'Medium: suspicious or privileged activity that needs awareness.',
  HIGH: 'High: a probable security risk or a major admin privilege change.',
  CRITICAL: 'Critical: a confirmed or immediate threat.',
};
/** Recommended steps by category (docx §3): guidance, not findings about one event. */
export const CATEGORY_GUIDANCE: Record<EventCategory, string[]> = {
  AUTHENTICATION: [
    'Verify if this activity is from the legitimate user.',
    'Contact the user if the activity is suspicious.',
    "If unauthorized, reset the user's password.",
    'Review recent account activity.',
  ],
  AUTHORIZATION: [
    'Confirm the change was requested and approved.',
    'Check that the new access follows least privilege.',
    'Revert the change if it was not authorized.',
  ],
  DATA: [
    'Confirm the user needed this data for their work.',
    'Check the related records for other unexpected changes.',
    'Restore the record if the change was not authorized.',
  ],
  INTEGRATION: [
    "Check the integration's connection and credentials.",
    'Rotate the credentials if they may be exposed.',
    'Disable the integration if the activity is not expected.',
  ],
  SECURITY: [
    'Review the change and who made it.',
    "Confirm it matches the platform's security policy.",
    'Send a security alert if it was not expected.',
  ],
  SYSTEM: ['Confirm the change was expected.', 'Review who made it and when.'],
};

export type AccountStatus = 'ACTIVE' | 'LOCKED' | 'SUSPENDED';

export interface AuditActor {
  /** Who acted (the database's actor types): a person is STAFF, CLIENT or PLATFORM. */
  type: AdminAuditActorType;
  id: string | null;
  name: string;
  email: string | null;
  /** The role when the action happened (a snapshot); null when not recorded. */
  role: string | null;
}
/** `id: null` is Firmivra itself (platform scope), not a firm. */
export interface AuditFirmRef {
  id: string | null;
  name: string;
}
export interface AuditDevice {
  ip: string | null;
  /** Approximate, from the IP address; null when enrichment is off or failed. */
  location: string | null;
  label: string;
  browserName: string;
  osName: string;
  browser: string;
  os: string;
  mobile: boolean;
  userAgent: string | null;
}
export interface AuditTarget {
  type: string;
  id: string;
  name: string;
  relatedRecord: string | null;
  /** The related admin record, when there is a page for it. */
  href: string | null;
}
export interface AuditFact {
  label: string;
  value: string;
}
/** A field-level change; masked values never carry the secret itself. */
export interface AuditChange {
  field: string;
  before: string | null;
  after: string | null;
  masked: boolean;
}
export type RiskKind =
  'attempts' | 'device' | 'time' | 'lock' | 'privilege' | 'data' | 'integration' | 'location';
export interface AuditRisk {
  score: number | null;
  rule: string | null;
  reason: string;
  indicators: { kind: RiskKind; label: string }[];
}
export type AuditTone = 'danger' | 'warning' | 'info' | 'success';
export interface AuditTimelineEntry {
  id: string;
  at: string;
  label: string;
  tone: AuditTone;
}
/** A Quick Info line: plain text, or a moment shown in the viewer's time zone. */
export interface QuickFact {
  label: string;
  value?: string;
  at?: string;
  /** `time`: the time only; `datetime`: date and time. */
  show?: 'time' | 'datetime';
}
export interface AuditActionTaken {
  id: string;
  action: ResponseAction;
  label: string;
  by: string;
  at: string;
  reason: string | null;
  /** The audit event the action wrote. */
  eventId: string;
}
export interface InvestigationNote {
  id: string;
  author: string;
  at: string;
  text: string;
}

export interface AuditEvent {
  id: string;
  /** The human event ID: EVT-YYYYMMDD-NNNNNN. */
  reference: string;
  /** The taxonomy name (docx §6), e.g. `login.failed`. */
  type: string;
  /** The action as the list shows it, e.g. "Login Failed". */
  action: string;
  category: EventCategory;
  severity: Severity;
  outcome: Outcome;
  alertState: AlertState | null;
  /** UTC, written by the server. */
  at: string;
  title: string;
  summary: string;
  details: string;
  description: string;
  actor: AuditActor;
  firm: AuditFirmRef;
  source: string;
  authMethod: string | null;
  sessionId: string | null;
  requestId: string;
  referrerUrl: string | null;
  device: AuditDevice;
  target: AuditTarget;
  /** The user that response actions apply to (the actor, or the user an automatic event is about). */
  subjectUserId: string | null;
  facts: AuditFact[];
  changes: AuditChange[];
  risk: AuditRisk;
  recommendations: string[];
  quickInfo: QuickFact[];
  timeline: AuditTimelineEntry[];
  actionsTaken: AuditActionTaken[];
  notes: InvestigationNote[];
  /** The event this one responds to (a response action or a note). */
  relatedEventId: string | null;
  reviewedAt: string | null;
}

export interface AuditEventQuery {
  view?: AuditView;
  search?: string;
  /** A firm id, or `platform` for Firmivra's own events. */
  firm?: string;
  user?: string;
  action?: string;
  severity?: Severity;
  outcome?: Outcome;
  alert?: AlertState | 'NONE';
  resource?: string;
  /** ISO moments, inclusive. */
  from?: string;
  to?: string;
  /** The API sorts by these three. */
  sort?: 'at' | 'action' | 'severity';
  descending?: boolean;
  page?: number;
  pageSize?: number;
}
export interface AuditEventPage {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
}
export interface AuditFacets {
  firms: { id: string; name: string }[];
  users: { id: string; name: string }[];
  actions: string[];
  resources: string[];
}
/** `value` counts the selected range; `current` and `previous` the last 7 days and the 7 before. */
export interface AuditMetric {
  value: number;
  current: number;
  previous: number;
}
export interface AuditSummary {
  securityAlerts: AuditMetric;
  failedLogins: AuditMetric;
  /** Null when not available (the API: sessions are firm data). */
  activeSessions: AuditMetric | null;
  highRiskEvents: AuditMetric;
}
export interface AccountState {
  userId: string;
  status: AccountStatus;
  mfaEnabled: boolean;
  lastSuccessfulLoginAt: string | null;
  passwordResetRequired: boolean;
  activeSessions: number;
}
export interface AvailableAction {
  action: ResponseAction;
  label: string;
  enabled: boolean;
  /** Why it is not available now. */
  reason: string | null;
}
export interface AuditEventDetail {
  event: AuditEvent;
  account: AccountState | null;
  related: AuditEvent[];
  relatedTotal: number;
  /** The newer and the older event in the log's default order. */
  previousId: string | null;
  nextId: string | null;
  actions: AvailableAction[];
}
export type ExportFormat = 'CSV' | 'JSON';
export interface AuditExport {
  fileName: string;
  mimeType: string;
  content: string;
  rowCount: number;
  /** The short-lived link's end (docx §5, Export History). */
  expiresAt: string;
}

// Security Settings & Policies (docx §4), in the contract's shape (packages/types/src/admin-audit):
// MFA is always required for Super Admins (`ALL` adds every user) and audit records are kept at
// least a year. The page's choices stay within those floors; a stored value outside a list is
// shown as it is.
export type SecuritySettings = AdminSecuritySettings;
export type MfaScope = SecuritySettings['mfa']['scope'];
export type IpMode = SecuritySettings['ip']['mode'];
export type MinimumSeverity = SecuritySettings['notifications']['minimumSeverity'];
/** Who may export: each level includes the ones before it. */
export const EXPORT_ROLES = ['SUPER_ADMINS', 'SECURITY_ADMINS', 'AUDITORS'] as const;
export type ExportRoles = (typeof EXPORT_ROLES)[number];
export const PASSWORD_EXPIRATION_DAYS = [0, 30, 60, 90, 180, 365] as const;
export const IDLE_TIMEOUT_MINUTES = [15, 30, 60, 120, 240] as const;
export const REMEMBER_ME_DAYS = [0, 1, 7, 14, 30] as const;
/** 0 is unlimited. */
export const CONCURRENT_SESSIONS = [1, 3, 5, 10, 0] as const;
export const MAX_FAILED_ATTEMPTS = [3, 5, 10] as const;
export const LOCKOUT_MINUTES = [15, 30, 60, 1440] as const;
/** One year at least (the database's floor), ten at most. */
export const RETENTION_DAYS = [365, 730, 1095, 1825, 2555, 3650] as const;

export interface SecuritySettingsRecord {
  /** Optimistic concurrency: a save names the version it started from. */
  version: number;
  updatedAt: string;
  updatedBy: string | null;
  /** Whether audit retention may change here (fixed by policy otherwise). */
  retentionEditable: boolean;
  settings: SecuritySettings;
}

/** Firmivra's recommended defaults ("Reset to Default"). No forced password rotation (docx §4). */
export const DEFAULT_SECURITY_SETTINGS: SecuritySettings = ADMIN_SECURITY_DEFAULTS;

/** The widest export level the roles reach. */
export const exportLevel = (roles: readonly string[]): ExportRoles =>
  roles.includes('AUDITORS')
    ? 'AUDITORS'
    : roles.includes('SECURITY_ADMINS')
      ? 'SECURITY_ADMINS'
      : 'SUPER_ADMINS';
/** The roles a level allows: Super Admins always, then the rest up to it. */
export const exportRolesFor = (level: ExportRoles): ExportRoles[] =>
  EXPORT_ROLES.slice(0, EXPORT_ROLES.indexOf(level) + 1);

export const EXPORT_ROLE_LABELS: Record<ExportRoles, string> = {
  SUPER_ADMINS: 'Super Admins only',
  SECURITY_ADMINS: 'Super Admins and Security Admins',
  AUDITORS: 'Super Admins, Security Admins and Auditors',
};
export const MFA_SCOPE_LABELS: Record<MfaScope, string> = {
  ALL: 'Required for all users',
  ADMINS: 'Required for admin users only',
};
export const IP_MODE_LABELS: Record<IpMode, string> = {
  ANY: 'Allow access from any IP',
  ALLOW_LIST: 'Restrict to specific IP addresses',
  BLOCK_LIST: 'Block specific IP addresses',
};
/** "high and critical" for HIGH: the alerts sent by email or SMS. */
export const SEVERITY_FLOOR_LABELS: Record<MinimumSeverity, string> = {
  LOW: 'low, medium, high and critical',
  MEDIUM: 'medium, high and critical',
  HIGH: 'high and critical',
  CRITICAL: 'critical',
};
export const daysLabel = (days: number) =>
  days === 0 ? 'Never' : `${days} ${days === 1 ? 'day' : 'days'}`;
/** 365 → "1 year", 2555 → "7 years"; other counts in days. */
export const retentionLabel = (days: number) =>
  days % 365 === 0 ? `${days / 365} ${days === 365 ? 'year' : 'years'}` : daysLabel(days);
export const minutesLabel = (minutes: number) =>
  minutes % 1440 === 0
    ? `${minutes / 1440} ${minutes === 1440 ? 'day' : 'days'}`
    : minutes % 60 === 0
      ? `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`
      : `${minutes} minutes`;
export const sessionsLabel = (count: number) => (count === 0 ? 'Unlimited' : `${count} per user`);
const yesNo = (value: boolean) => (value ? 'Yes' : 'No');
const onOff = (value: boolean) => (value ? 'On' : 'Off');
const listText = (values: string[]) => (values.length ? values.join(', ') : 'None');
const hoursLabel = (hours: number) => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

const MFA_RANK: Record<MfaScope, number> = { ADMINS: 1, ALL: 2 };
const EXPORT_RANK: Record<ExportRoles, number> = {
  SUPER_ADMINS: 0,
  SECURITY_ADMINS: 1,
  AUDITORS: 2,
};

interface SettingField {
  label: string;
  show: (s: SecuritySettings) => string;
  /** A change that weakens protection for everyone: the save asks for confirmation. */
  highImpact?: (before: SecuritySettings, after: SecuritySettings) => boolean;
}
const SETTING_FIELDS: SettingField[] = [
  {
    label: 'MFA requirement',
    show: (s) => MFA_SCOPE_LABELS[s.mfa.scope],
    highImpact: (b, a) => MFA_RANK[a.mfa.scope] < MFA_RANK[b.mfa.scope],
  },
  { label: 'Authenticator app', show: (s) => yesNo(s.methods.authenticatorApp) },
  { label: 'SMS text message', show: (s) => yesNo(s.methods.sms) },
  { label: 'Email verification', show: (s) => yesNo(s.methods.email) },
  { label: 'Hardware security key', show: (s) => yesNo(s.methods.hardwareKey) },
  {
    label: 'Minimum password length',
    show: (s) => `${s.password.minLength} characters`,
    highImpact: (b, a) => a.password.minLength < b.password.minLength,
  },
  { label: 'Require uppercase', show: (s) => yesNo(s.password.uppercase) },
  { label: 'Require lowercase', show: (s) => yesNo(s.password.lowercase) },
  { label: 'Require numbers', show: (s) => yesNo(s.password.numbers) },
  { label: 'Require special characters', show: (s) => yesNo(s.password.special) },
  { label: 'Password expiration', show: (s) => daysLabel(s.password.expirationDays) },
  {
    label: 'Earlier passwords that cannot be reused',
    show: (s) => String(s.password.preventReuseCount),
  },
  {
    label: 'Session timeout (inactivity)',
    show: (s) => minutesLabel(s.session.idleTimeoutMinutes),
  },
  { label: 'Longest session', show: (s) => hoursLabel(s.session.maxLifetimeHours) },
  { label: 'Remember me', show: (s) => daysLabel(s.session.rememberMeDays) },
  { label: 'Concurrent sessions', show: (s) => sessionsLabel(s.session.concurrentSessions) },
  { label: 'Users manage their active sessions', show: (s) => onOff(s.session.selfManage) },
  {
    label: 'Re-authentication for sensitive actions',
    show: (s) => onOff(s.session.reauthSensitive),
    highImpact: (b, a) => b.session.reauthSensitive && !a.session.reauthSensitive,
  },
  {
    label: 'Re-authentication window',
    show: (s) => minutesLabel(s.session.reauthWindowMinutes),
  },
  {
    label: 'Re-authentication when switching devices',
    show: (s) => onOff(s.session.reauthDeviceSwitch),
  },
  {
    label: 'Max failed login attempts',
    show: (s) => `${s.protection.maxFailedAttempts} attempts`,
    highImpact: (b, a) => a.protection.maxFailedAttempts > b.protection.maxFailedAttempts,
  },
  { label: 'Lockout duration', show: (s) => minutesLabel(s.protection.lockoutMinutes) },
  { label: 'Notify on suspicious activity', show: (s) => yesNo(s.protection.notifySuspicious) },
  {
    label: 'Automatic account lock',
    show: (s) => onOff(s.protection.autoLock),
    highImpact: (b, a) => b.protection.autoLock && !a.protection.autoLock,
  },
  {
    label: 'Email Super Admin on lockout',
    show: (s) => onOff(s.protection.emailAdminOnLockout),
  },
  {
    label: 'Email verification for new devices',
    show: (s) => onOff(s.protection.verifyNewDevices),
  },
  {
    label: 'IP access',
    show: (s) => IP_MODE_LABELS[s.ip.mode],
    highImpact: () => true,
  },
  {
    label: 'Approved IP addresses',
    show: (s) => listText(s.ip.allowList),
    highImpact: (_, a) => a.ip.mode === 'ALLOW_LIST',
  },
  {
    label: 'Blocked IP addresses',
    show: (s) => listText(s.ip.blockList),
    highImpact: (_, a) => a.ip.mode === 'BLOCK_LIST',
  },
  { label: 'Alert: failed login attempts', show: (s) => onOff(s.notifications.failedLogins) },
  { label: 'Alert: new device login', show: (s) => onOff(s.notifications.newDevice) },
  { label: 'Alert: password changes', show: (s) => onOff(s.notifications.passwordChanges) },
  { label: 'Alert: MFA disabled', show: (s) => onOff(s.notifications.mfaDisabled) },
  { label: 'Alert: account locked', show: (s) => onOff(s.notifications.accountLocked) },
  { label: 'Alert: suspicious activity', show: (s) => onOff(s.notifications.suspicious) },
  { label: 'Alerts by email', show: (s) => onOff(s.notifications.email) },
  { label: 'Alerts by SMS', show: (s) => onOff(s.notifications.sms) },
  {
    label: 'Alerts sent by email or SMS',
    show: (s) => SEVERITY_FLOOR_LABELS[s.notifications.minimumSeverity],
  },
  {
    label: 'Audit log retention',
    show: (s) => retentionLabel(s.retention.retentionDays),
    highImpact: (b, a) => a.retention.retentionDays < b.retention.retentionDays,
  },
  { label: 'Archive audit logs after', show: (s) => retentionLabel(s.retention.archiveAfterDays) },
  {
    label: 'Who can export logs',
    show: (s) => EXPORT_ROLE_LABELS[exportLevel(s.exports.roles)],
    highImpact: (b, a) =>
      EXPORT_RANK[exportLevel(a.exports.roles)] > EXPORT_RANK[exportLevel(b.exports.roles)],
  },
  {
    label: 'Re-authentication to export logs',
    show: (s) => onOff(s.exports.requireReauth),
    highImpact: (b, a) => b.exports.requireReauth && !a.exports.requireReauth,
  },
  { label: 'Export links last', show: (s) => hoursLabel(s.exports.linkExpiryHours) },
];

export interface SettingChange {
  label: string;
  before: string;
  after: string;
  highImpact: boolean;
}
/** The changed policy fields, for the save summary and the `policy.changed` audit event. */
export function describeSettingsChanges(
  before: SecuritySettings,
  after: SecuritySettings,
): SettingChange[] {
  return SETTING_FIELDS.filter((field) => field.show(before) !== field.show(after)).map(
    (field) => ({
      label: field.label,
      before: field.show(before),
      after: field.show(after),
      highImpact: field.highImpact?.(before, after) ?? false,
    }),
  );
}

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(\/([0-9]|[12]\d|3[0-2]))?$/;
const IPV6 = /^(?=.*:.*:)[0-9a-f:]{2,39}(\/(\d|[1-9]\d|1[01]\d|12[0-8]))?$/i;
/** One IPv4 or IPv6 address, optionally a CIDR range (203.0.113.0/24). */
export const isIpEntry = (value: string) => IPV4.test(value) || IPV6.test(value);

export type SettingsErrorKey =
  'minLength' | 'methods' | 'ipMode' | 'allowList' | 'blockList' | 'options';
export type SettingsErrors = Partial<Record<SettingsErrorKey, string>>;

/**
 * The policy's rules for the form's field errors; anything else the contract refuses (its floors
 * and ranges) is `options`. The API checks the same contract again.
 */
export function validateSecuritySettings(s: SecuritySettings): SettingsErrors {
  const errors: SettingsErrors = {};
  const { minLength } = s.password;
  if (!Number.isInteger(minLength) || minLength < 8 || minLength > 128)
    errors.minLength = 'Enter a whole number from 8 to 128.';
  const { authenticatorApp, sms, email, hardwareKey } = s.methods;
  if (!authenticatorApp && !sms && !email && !hardwareKey)
    errors.methods = 'Allow at least one method: MFA is always on for Super Admins.';
  const badAllow = s.ip.allowList.filter((entry) => !isIpEntry(entry));
  const badBlock = s.ip.blockList.filter((entry) => !isIpEntry(entry));
  if (badAllow.length) errors.allowList = `Not an IP address or range: ${badAllow.join(', ')}`;
  if (badBlock.length) errors.blockList = `Not an IP address or range: ${badBlock.join(', ')}`;
  if (s.ip.mode === 'ALLOW_LIST' && !s.ip.allowList.length)
    errors.ipMode = 'Add at least one approved IP address first (Manage IP List).';
  if (s.ip.mode === 'BLOCK_LIST' && !s.ip.blockList.length)
    errors.ipMode = 'Add at least one blocked IP address first (Manage IP List).';
  if (!Object.keys(errors).length) {
    const checked = AdminSecuritySettings.safeParse(s);
    if (!checked.success)
      errors.options = checked.error.issues[0]?.message ?? 'Choose one of the listed options.';
  }
  return errors;
}

// The store: built on first use, changed by the calls below while the page is open.
export interface MockAccount {
  userId: string;
  name: string;
  status: AccountStatus;
  mfaEnabled: boolean;
  lastSuccessfulLoginAt: string | null;
  passwordResetRequired: boolean;
}
export interface MockSession {
  id: string;
  userId: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
}
export interface AuditStore {
  events: AuditEvent[];
  accounts: MockAccount[];
  sessions: MockSession[];
  disabledIntegrations: string[];
  settings: SecuritySettingsRecord;
  /** The next number for new events, actions and notes. */
  next: number;
}
let store: AuditStore | undefined;
const db = (): AuditStore => (store ??= seedAuditStore(mockedEmpty(MODULE)));

const invalid = (message: string) => new ApiRequestError(400, 'VALIDATION_FAILED', message);
const notFound = () => new ApiRequestError(404, 'NOT_FOUND', 'Event not found');
const copy = <T>(value: T): T => structuredClone(value);
const time = (iso: string) => Date.parse(iso);
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};
const newestFirst = (a: AuditEvent, b: AuditEvent) =>
  time(b.at) - time(a.at) || b.reference.localeCompare(a.reference);

/** The tab a row belongs to (docx §5 and §6). */
function inView(event: AuditEvent, view: AuditView): boolean {
  switch (view) {
    case 'security':
      return event.alertState !== null || event.category === 'SECURITY';
    case 'login':
      return event.category === 'AUTHENTICATION';
    case 'permissions':
      return event.category === 'AUTHORIZATION';
    case 'data':
      return event.category === 'DATA';
    case 'integrations':
      return event.category === 'INTEGRATION';
    case 'policies':
      return event.type === 'policy.changed';
    default:
      return true;
  }
}

interface Range {
  from: number | null;
  to: number | null;
}
function parseRange(from?: string, to?: string): Range {
  const start = from ? time(from) : null;
  const end = to ? time(to) : null;
  if (start !== null && Number.isNaN(start)) throw invalid('Choose a valid start date.');
  if (end !== null && Number.isNaN(end)) throw invalid('Choose a valid end date.');
  if (start !== null && end !== null && start > end)
    throw invalid('The start date must be on or before the end date.');
  return { from: start, to: end };
}
const within = (range: Range, at: number) =>
  (range.from === null || at >= range.from) && (range.to === null || at <= range.to);

function filterEvents(query: AuditEventQuery): AuditEvent[] {
  const search = (query.search ?? '')
    .replace(/[\p{Cc}\p{Cs}]/gu, ' ')
    .trim()
    .toLowerCase();
  if (search.length > 100) throw invalid('Search is limited to 100 characters.');
  const range = parseRange(query.from, query.to);
  return db().events.filter((event) => {
    if (!inView(event, query.view ?? 'audit')) return false;
    if (!within(range, time(event.at))) return false;
    if (query.firm && (event.firm.id ?? 'platform') !== query.firm) return false;
    if (query.user && event.actor.id !== query.user) return false;
    if (query.action && event.action !== query.action) return false;
    if (query.severity && event.severity !== query.severity) return false;
    if (query.outcome && event.outcome !== query.outcome) return false;
    if (query.alert && (event.alertState ?? 'NONE') !== query.alert) return false;
    if (query.resource && event.target.type !== query.resource) return false;
    if (!search) return true;
    return [
      event.reference,
      event.id,
      event.actor.name,
      event.actor.email ?? '',
      event.action,
      event.details,
      event.firm.name,
      event.target.id,
      event.target.name,
      event.device.ip ?? '',
    ].some((text) => text.toLowerCase().includes(search));
  });
}

function sortEvents(events: AuditEvent[], query: AuditEventQuery): AuditEvent[] {
  const by = query.sort ?? 'at';
  const sign = (query.descending ?? true) ? -1 : 1;
  const key = (event: AuditEvent): string | number =>
    by === 'action'
      ? event.action
      : by === 'severity'
        ? SEVERITY_RANK[event.severity]
        : time(event.at);
  return [...events].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    const compared =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
    return compared * sign || newestFirst(a, b);
  });
}

const ACTION_LABELS: Record<ResponseAction, string> = {
  RESET_PASSWORD: 'Reset Password',
  UNLOCK_ACCOUNT: 'Unlock Account',
  FORCE_LOGOUT: 'Force Logout (All Devices)',
  MARK_REVIEWED: 'Mark as Reviewed',
  SEND_ALERT: 'Send Security Alert',
  SUSPEND_USER: 'Suspend User',
  RESET_MFA: 'Reset MFA',
  DISABLE_INTEGRATION: 'Disable Integration',
};

function accountOf(s: AuditStore, event: AuditEvent): AccountState | null {
  const account = s.accounts.find((item) => item.userId === event.subjectUserId);
  if (!account) return null;
  const { name: _name, ...state } = account;
  return {
    ...state,
    activeSessions: s.sessions.filter((item) => item.userId === account.userId && !item.endedAt)
      .length,
  };
}

/** Response actions for this event type and its subject's current state (docx §3). */
function actionsFor(s: AuditStore, event: AuditEvent): AvailableAction[] {
  const account = accountOf(s, event);
  const list: AvailableAction[] = [];
  const add = (action: ResponseAction, enabled: boolean, reason: string) =>
    list.push({ action, label: ACTION_LABELS[action], enabled, reason: enabled ? null : reason });
  const suspended = account?.status === 'SUSPENDED';
  if (account) {
    add('RESET_PASSWORD', !suspended, 'The account is suspended.');
    add('UNLOCK_ACCOUNT', account.status === 'LOCKED', 'The account is not locked.');
    add('FORCE_LOGOUT', account.activeSessions > 0, 'There are no active sessions.');
  }
  add('MARK_REVIEWED', event.reviewedAt === null, 'This event was already reviewed.');
  add(
    'SEND_ALERT',
    !event.actionsTaken.some((item) => item.action === 'SEND_ALERT'),
    'An alert was already sent for this event.',
  );
  if (account && SEVERITY_RANK[event.severity] >= SEVERITY_RANK.HIGH) {
    add('SUSPEND_USER', !suspended, 'The account is already suspended.');
    add('RESET_MFA', account.mfaEnabled, 'MFA is not set up for this user.');
  }
  if (event.target.type === 'Integration')
    add(
      'DISABLE_INTEGRATION',
      !s.disabledIntegrations.includes(event.target.id),
      'The integration is already disabled.',
    );
  return list;
}

const HOUR_MS = 3_600_000;
/** Nearby events with the same actor, session, IP or target, plus linked responses. */
function relatedTo(s: AuditStore, event: AuditEvent): AuditEvent[] {
  const at = time(event.at);
  return s.events
    .filter((other) => {
      if (other.id === event.id) return false;
      if (other.relatedEventId === event.id || event.relatedEventId === other.id) return true;
      if (Math.abs(time(other.at) - at) > 24 * HOUR_MS) return false;
      return (
        (event.actor.id !== null && other.actor.id === event.actor.id) ||
        (event.sessionId !== null && other.sessionId === event.sessionId) ||
        (event.subjectUserId !== null && other.subjectUserId === event.subjectUserId) ||
        other.target.id === event.target.id
      );
    })
    .sort(newestFirst);
}

function detailOf(s: AuditStore, event: AuditEvent): AuditEventDetail {
  const ordered = [...s.events].sort(newestFirst);
  const index = ordered.findIndex((item) => item.id === event.id);
  const related = relatedTo(s, event);
  return copy({
    event,
    account: accountOf(s, event),
    related: related.slice(0, 10),
    relatedTotal: related.length,
    previousId: ordered[index - 1]?.id ?? null,
    nextId: ordered[index + 1]?.id ?? null,
    actions: actionsFor(s, event),
  });
}

/** A new event written by the signed-in Super Admin (the mock's Morgan Admin). */
function record(
  s: AuditStore,
  fields: Pick<AuditEvent, 'type' | 'action' | 'category' | 'severity' | 'details' | 'target'> &
    Partial<Omit<AuditEvent, 'id' | 'reference'>>,
): AuditEvent {
  const event = makeEvent({
    n: s.next++,
    at: new Date().toISOString(),
    actor: AUDIT_ADMIN,
    firm: { id: null, name: 'Firmivra' },
    device: AUDIT_ADMIN_DEVICE,
    source: 'Super Admin Console',
    authMethod: 'Password + MFA',
    outcome: 'SUCCESS',
    ...fields,
  });
  s.events.push(event);
  return event;
}

const csvCell = (value: string) => {
  // A cell that starts like a formula is kept as text when a spreadsheet opens the file.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

export const adminAuditSecurity = {
  /** The filter choices, from the events themselves. */
  facets: async (): Promise<AuditFacets> => {
    await ready();
    const s = db();
    const firms = new Map<string, string>();
    const users = new Map<string, string>();
    for (const event of s.events) {
      firms.set(event.firm.id ?? 'platform', event.firm.name);
      if (event.actor.id) users.set(event.actor.id, event.actor.name);
    }
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      firms: [...firms].map(([id, name]) => ({ id, name })).sort(byName),
      users: [...users].map(([id, name]) => ({ id, name })).sort(byName),
      actions: [...new Set(s.events.map((event) => event.action))].sort(),
      resources: [...new Set(s.events.map((event) => event.target.type))].sort(),
    };
  },

  /** The top cards for a date range; the trend compares the range's last 7 days with the 7 before. */
  summary: async (range: { from?: string; to?: string }): Promise<AuditSummary> => {
    await ready();
    const s = db();
    const bounds = parseRange(range.from, range.to);
    const end = bounds.to ?? Date.now();
    const lastWeek = (at: number) => at > end - WEEK_MS && at <= end;
    const weekBefore = (at: number) => at > end - 2 * WEEK_MS && at <= end - WEEK_MS;
    const metric = (times: number[], inRange = (at: number) => within(bounds, at)) => ({
      value: times.filter(inRange).length,
      current: times.filter(lastWeek).length,
      previous: times.filter(weekBefore).length,
    });
    const times = (keep: (event: AuditEvent) => boolean) =>
      s.events.filter(keep).map((event) => time(event.at));
    const active = s.sessions.filter((session) => !session.endedAt);
    return {
      securityAlerts: metric(
        times((event) => event.alertState === 'OPEN' || event.alertState === 'ACKNOWLEDGED'),
      ),
      failedLogins: metric(times((event) => event.type === 'login.failed')),
      highRiskEvents: metric(times((event) => SEVERITY_RANK[event.severity] >= 3)),
      // A session counts when it is still open and was used in the range.
      activeSessions: {
        ...metric(active.map((session) => time(session.startedAt))),
        value: active.filter(
          (session) =>
            time(session.startedAt) <= end &&
            (bounds.from === null || time(session.lastSeenAt) >= bounds.from),
        ).length,
      },
    };
  },

  /** One page of the filtered log (server-side paging: the browser never holds the whole log). */
  events: async (query: AuditEventQuery = {}): Promise<AuditEventPage> => {
    await ready();
    const pageSize = query.pageSize ?? 8;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw invalid('Choose a page size from 1 to 100.');
    const rows = sortEvents(filterEvents(query), query);
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), pageCount);
    return copy({
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    });
  },

  /** The full investigative record, by the immutable event id. */
  event: async (id: string): Promise<AuditEventDetail> => {
    await ready();
    const s = db();
    const event = s.events.find((item) => item.id === id);
    if (!event) throw notFound();
    return detailOf(s, event);
  },

  /**
   * A response action on the event's user, session or integration (never on the event itself).
   * It writes a new linked audit event and returns the refreshed record.
   */
  respond: async (body: {
    eventId: string;
    action: ResponseAction;
    reason?: string;
  }): Promise<AuditEventDetail> => {
    await ready();
    const reason = (body.reason ?? '').trim();
    if (reason.length > 500) throw invalid('Keep the reason to 500 characters.');
    const s = db();
    const event = s.events.find((item) => item.id === body.eventId);
    if (!event) throw notFound();
    const available = actionsFor(s, event).find((item) => item.action === body.action);
    if (!available)
      throw new ApiRequestError(422, 'UNPROCESSABLE', 'This action does not apply here.');
    if (!available.enabled) throw new ApiRequestError(409, 'CONFLICT', available.reason ?? '');
    const account = s.accounts.find((item) => item.userId === event.subjectUserId);
    const name = account?.name ?? event.actor.name;
    const userTarget = account
      ? { type: 'User Account', id: account.userId, name, relatedRecord: null, href: null }
      : event.target;
    const endSessions = () => {
      const open = s.sessions.filter((item) => item.userId === account?.userId && !item.endedAt);
      const now = new Date().toISOString();
      for (const session of open) session.endedAt = now;
      return open.length;
    };
    const base = {
      relatedEventId: event.id,
      subjectUserId: event.subjectUserId,
      firm: event.firm,
      facts: reason ? [{ label: 'Reason', value: reason }] : [],
    };
    let written: AuditEvent;
    switch (body.action) {
      case 'RESET_PASSWORD':
        if (account) account.passwordResetRequired = true;
        written = record(s, {
          ...base,
          type: 'password.reset',
          action: 'Required Password Reset',
          category: 'AUTHENTICATION',
          severity: 'MEDIUM',
          details: `Password reset required for ${name}`,
          target: userTarget,
        });
        break;
      case 'UNLOCK_ACCOUNT':
        if (account) account.status = 'ACTIVE';
        written = record(s, {
          ...base,
          type: 'account.unlocked',
          action: 'Unlocked Account',
          category: 'SECURITY',
          severity: 'LOW',
          details: `Unlocked the account of ${name}`,
          target: userTarget,
        });
        break;
      case 'FORCE_LOGOUT': {
        const count = endSessions();
        written = record(s, {
          ...base,
          type: 'session.revoked',
          action: 'Revoked Sessions',
          category: 'AUTHENTICATION',
          severity: 'MEDIUM',
          details: `Signed ${name} out of ${count} ${count === 1 ? 'session' : 'sessions'}`,
          target: userTarget,
        });
        break;
      }
      case 'SUSPEND_USER': {
        if (account) account.status = 'SUSPENDED';
        const count = endSessions();
        written = record(s, {
          ...base,
          type: 'account.suspended',
          action: 'Suspended Account',
          category: 'SECURITY',
          severity: 'HIGH',
          details: `Suspended ${name} and ended ${count} ${count === 1 ? 'session' : 'sessions'}`,
          target: userTarget,
        });
        break;
      }
      case 'RESET_MFA':
        if (account) account.mfaEnabled = false;
        written = record(s, {
          ...base,
          type: 'mfa.reset',
          action: 'Reset MFA',
          category: 'SECURITY',
          severity: 'MEDIUM',
          details: `Reset MFA for ${name}: they set it up again at the next sign-in`,
          target: userTarget,
        });
        break;
      case 'DISABLE_INTEGRATION':
        s.disabledIntegrations.push(event.target.id);
        written = record(s, {
          ...base,
          type: 'integration.disabled',
          action: 'Disabled Integration',
          category: 'INTEGRATION',
          severity: 'MEDIUM',
          details: `Disabled ${event.target.name}`,
          target: event.target,
        });
        break;
      case 'SEND_ALERT':
        event.alertState ??= 'OPEN';
        written = record(s, {
          ...base,
          type: 'security_alert.created',
          action: 'Sent Security Alert',
          category: 'SECURITY',
          severity: event.severity === 'INFO' ? 'LOW' : event.severity,
          details: `Alert about ${event.reference} sent to Super Admins (in-app and email)`,
          target: {
            type: 'Audit Event',
            id: event.reference,
            name: event.title,
            relatedRecord: null,
            href: null,
          },
        });
        break;
      case 'MARK_REVIEWED': {
        const hadAlert = event.alertState === 'OPEN' || event.alertState === 'ACKNOWLEDGED';
        event.reviewedAt = new Date().toISOString();
        if (hadAlert) event.alertState = 'RESOLVED';
        written = record(s, {
          ...base,
          type: hadAlert ? 'security_alert.resolved' : 'event.reviewed',
          action: hadAlert ? 'Resolved Alert' : 'Marked as Reviewed',
          category: 'SECURITY',
          severity: 'INFO',
          details: `${event.reference} reviewed${hadAlert ? ' and its alert resolved' : ''}`,
          target: {
            type: 'Audit Event',
            id: event.reference,
            name: event.title,
            relatedRecord: null,
            href: null,
          },
        });
        break;
      }
      default:
        throw new ApiRequestError(422, 'UNPROCESSABLE', 'This action does not apply here.');
    }
    event.actionsTaken.push({
      id: auditUuid('0e05', s.next++),
      action: body.action,
      label: available.label,
      by: AUDIT_ADMIN.name,
      at: written.at,
      reason: reason || null,
      eventId: written.id,
    });
    event.timeline.push({
      id: auditUuid('0e05', s.next++),
      at: written.at,
      label: `${written.action} by ${AUDIT_ADMIN.name}`,
      tone: 'info',
    });
    return detailOf(s, event);
  },

  /** An additive investigation note; it writes its own audit event (never the note's text). */
  addNote: async (body: { eventId: string; text: string }): Promise<InvestigationNote> => {
    await ready();
    const text = body.text.trim();
    if (!text) throw invalid('Write the note first.');
    if (text.length > 2000) throw invalid('Keep the note to 2,000 characters.');
    const s = db();
    const event = s.events.find((item) => item.id === body.eventId);
    if (!event) throw notFound();
    const written = record(s, {
      type: 'note.added',
      action: 'Added Investigation Note',
      category: 'SECURITY',
      severity: 'INFO',
      details: `Investigation note added to ${event.reference}`,
      target: {
        type: 'Audit Event',
        id: event.reference,
        name: event.title,
        relatedRecord: null,
        href: null,
      },
      relatedEventId: event.id,
      subjectUserId: event.subjectUserId,
      firm: event.firm,
    });
    const note = {
      id: auditUuid('0e05', s.next++),
      author: AUDIT_ADMIN.name,
      at: written.at,
      text,
    };
    event.notes.push(note);
    event.timeline.push({
      id: auditUuid('0e05', s.next++),
      at: written.at,
      label: `Investigation note added by ${AUDIT_ADMIN.name}`,
      tone: 'info',
    });
    return copy(note);
  },

  /** The filtered rows as a file; the export itself is audited (docx §5, Export History). */
  exportEvents: async (body: {
    query: AuditEventQuery;
    format: ExportFormat;
  }): Promise<AuditExport> => {
    await ready();
    if (body.format !== 'CSV' && body.format !== 'JSON') throw invalid('Choose CSV or JSON.');
    const rows = sortEvents(filterEvents(body.query), body.query);
    const s = db();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
    // The table's visible fields, plus the immutable event id and the UTC timestamp.
    const columns: [string, (event: AuditEvent) => string][] = [
      ['eventId', (event) => event.id],
      ['reference', (event) => event.reference],
      ['timestampUtc', (event) => event.at],
      ['severity', (event) => event.severity],
      ['category', (event) => event.category],
      ['action', (event) => event.action],
      ['actor', (event) => event.actor.name],
      ['actorEmail', (event) => event.actor.email ?? ''],
      ['firm', (event) => event.firm.name],
      ['resourceType', (event) => event.target.type],
      ['resourceId', (event) => event.target.id],
      ['details', (event) => event.details],
      ['ipAddress', (event) => event.device.ip ?? ''],
      ['device', (event) => event.device.label],
      ['outcome', (event) => event.outcome],
    ];
    const content =
      body.format === 'JSON'
        ? JSON.stringify(
            rows.map((event) =>
              Object.fromEntries(columns.map(([key, read]) => [key, read(event)])),
            ),
            null,
            2,
          )
        : [
            columns.map(([key]) => key).join(','),
            ...rows.map((event) => columns.map(([, read]) => csvCell(read(event))).join(',')),
          ].join('\r\n');
    const stamp = now.toISOString().slice(0, 10).replaceAll('-', '');
    record(s, {
      type: 'export.created',
      action: 'Exported Audit Logs',
      category: 'DATA',
      severity: 'MEDIUM',
      details: `Exported ${rows.length} audit ${rows.length === 1 ? 'event' : 'events'} (${body.format})`,
      target: {
        type: 'Export',
        id: `EXP-${stamp}-${s.next}`,
        name: `Audit logs ${body.format}`,
        relatedRecord: null,
        href: null,
      },
      facts: [
        { label: 'Export Type', value: body.format },
        { label: 'Rows', value: String(rows.length) },
        { label: 'Filter Scope', value: body.query.view ? `Tab: ${body.query.view}` : 'All' },
        { label: 'Link Expires', value: '15 minutes after creation' },
      ],
    });
    return {
      fileName: `firmivra-audit-events-${stamp}.${body.format.toLowerCase()}`,
      mimeType: body.format === 'JSON' ? 'application/json' : 'text/csv',
      content,
      rowCount: rows.length,
      expiresAt,
    };
  },

  settings: async (): Promise<SecuritySettingsRecord> => {
    await ready();
    return copy(db().settings);
  },

  /**
   * Validates, refuses a stale version (409 CONFLICT, so two admins never overwrite each other),
   * saves atomically and writes one `policy.changed` event with the changed fields.
   */
  saveSettings: async (body: {
    version: number;
    settings: SecuritySettings;
  }): Promise<SecuritySettingsRecord> => {
    await ready();
    const errors = Object.values(validateSecuritySettings(body.settings));
    if (errors[0]) throw invalid(errors[0]);
    const s = db();
    if (body.version !== s.settings.version)
      throw new ApiRequestError(409, 'SAVE_CONFLICT', 'The settings were changed by someone else.');
    const changes = describeSettingsChanges(s.settings.settings, body.settings);
    if (!changes.length) return copy(s.settings);
    const written = record(s, {
      type: 'policy.changed',
      action: 'Updated Security Settings',
      category: 'SECURITY',
      severity: changes.some((change) => change.highImpact) ? 'HIGH' : 'MEDIUM',
      details: `Changed ${changes.length} security ${changes.length === 1 ? 'setting' : 'settings'}`,
      target: {
        type: 'Security Policy',
        id: 'POLICY-PLATFORM',
        name: 'Platform security settings',
        relatedRecord: null,
        href: '/audit-security/settings',
      },
      changes: changes.map((change) => ({
        field: change.label,
        before: change.before,
        after: change.after,
        masked: false,
      })),
    });
    s.settings = {
      ...s.settings,
      version: s.settings.version + 1,
      updatedAt: written.at,
      updatedBy: AUDIT_ADMIN.name,
      settings: copy(body.settings),
    };
    return copy(s.settings);
  },
};
