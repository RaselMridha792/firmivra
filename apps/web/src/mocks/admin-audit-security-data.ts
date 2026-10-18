import type {
  AuditActor,
  AuditDevice,
  AuditEvent,
  AuditFirmRef,
  AuditRisk,
  AuditStore,
  AuditTarget,
  AuditTone,
  EventCategory,
  MockAccount,
  MockSession,
  Severity,
} from './admin-audit-security';

/**
 * Synthetic fixtures for mocks/admin-audit-security.ts: invented firms, people, devices and
 * documentation IP ranges (192.0.2.x, 198.51.100.x, 203.0.113.x). Times are relative to the first
 * call, so the default date range always has data. Nothing runs on import.
 */

/** uuid-shaped ids in this module's block: 0e01 events, 0e02 people, 0e03 firms, 0e04 sessions. */
export const auditUuid = (block: string, n: number) =>
  `0199d1a0-${block}-7000-8000-${String(n).padStart(12, '0')}`;

/** The mock Super Admin, the same person mocks/admin-auth.ts signs in. */
export const AUDIT_ADMIN: AuditActor = {
  type: 'USER',
  id: '0199b6a2-0000-7000-8000-0000000000a1',
  name: 'Morgan Admin',
  email: 'morgan.admin@example.test',
  role: 'Super Admin',
};

const DEVICES = {
  chromeWindows: {
    label: 'Chrome on Windows',
    browserName: 'Chrome',
    osName: 'Windows',
    browser: 'Chrome 129',
    os: 'Windows 11',
    mobile: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  },
  safariIphone: {
    label: 'Safari on iPhone',
    browserName: 'Safari',
    osName: 'iPhone',
    browser: 'Safari 17.1',
    os: 'iOS 17.0',
    mobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  },
  chromeMac: {
    label: 'Chrome on Mac',
    browserName: 'Chrome',
    osName: 'Mac',
    browser: 'Chrome 129',
    os: 'macOS 14',
    mobile: false,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  },
  edgeWindows: {
    label: 'Edge on Windows',
    browserName: 'Edge',
    osName: 'Windows',
    browser: 'Edge 129',
    os: 'Windows 11',
    mobile: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  },
  server: {
    label: 'Server (API)',
    browserName: 'API',
    osName: 'Server',
    browser: 'Not applicable',
    os: 'Not applicable',
    mobile: false,
    userAgent: null,
  },
} satisfies Record<string, Omit<AuditDevice, 'ip' | 'location'>>;
type DeviceName = keyof typeof DEVICES;

export const AUDIT_ADMIN_DEVICE: AuditDevice = {
  ...DEVICES.chromeMac,
  ip: '198.51.100.10',
  location: 'Columbus, OH, USA',
};

export type EventSeed = Partial<Omit<AuditEvent, 'id' | 'reference'>> &
  Pick<
    AuditEvent,
    | 'at'
    | 'type'
    | 'action'
    | 'category'
    | 'severity'
    | 'details'
    | 'actor'
    | 'firm'
    | 'device'
    | 'target'
  > & { n: number };

const RISK_REASONS: Record<Severity, string> = {
  INFO: 'Info: routine successful activity.',
  LOW: 'Low: a minor policy or operational signal.',
  MEDIUM: 'Medium: suspicious or privileged activity that needs awareness.',
  HIGH: 'High: a probable security risk or a major admin privilege change.',
  CRITICAL: 'Critical: a confirmed or immediate threat.',
};
const RISK_SCORES: Record<Severity, number> = {
  INFO: 5,
  LOW: 20,
  MEDIUM: 45,
  HIGH: 75,
  CRITICAL: 95,
};
const RECOMMENDATIONS: Record<EventCategory, string[]> = {
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
};
const TONES: Record<Severity, AuditTone> = {
  INFO: 'info',
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
};
const OUTCOME_TEXT = {
  SUCCESS: 'Success',
  FAILED: 'Failed',
  BLOCKED: 'Blocked',
  DETECTED: 'Detected',
};

/** One event with the defaults every event has; `fields` override them. */
export function makeEvent({ n, ...fields }: EventSeed): AuditEvent {
  const outcome = fields.outcome ?? 'SUCCESS';
  const source = fields.source ?? 'Web Application';
  const event: AuditEvent = {
    id: auditUuid('0e01', n),
    reference: `EVT-${fields.at.slice(0, 10).replaceAll('-', '')}-${String(1000 + n).padStart(6, '0')}`,
    outcome,
    alertState: null,
    title: fields.action,
    summary: `${fields.details}.`,
    description: `${fields.actor.name}: ${fields.details}. Outcome: ${OUTCOME_TEXT[outcome].toLowerCase()}.`,
    source,
    authMethod: null,
    sessionId: null,
    requestId: `req_01JAUD${String(n).padStart(4, '0')}${((n * 7919) % 1_000_000).toString(36).toUpperCase().padStart(4, '0')}`,
    referrerUrl: null,
    subjectUserId: fields.actor.type === 'USER' ? fields.actor.id : null,
    facts: [],
    changes: [],
    risk: {
      score: RISK_SCORES[fields.severity],
      rule: null,
      reason: RISK_REASONS[fields.severity],
      indicators: [],
    },
    recommendations:
      fields.severity === 'INFO'
        ? [
            'No action is needed for routine activity.',
            'Review recent account activity if anything looks unusual.',
          ]
        : RECOMMENDATIONS[fields.category],
    quickInfo: [
      { label: 'Recorded', at: fields.at, show: 'datetime' },
      { label: 'Source', value: source },
      { label: 'Outcome', value: OUTCOME_TEXT[outcome] },
    ],
    timeline: [
      {
        id: auditUuid('0e06', n),
        at: fields.at,
        label: 'Event recorded',
        tone: TONES[fields.severity],
      },
    ],
    actionsTaken: [],
    notes: [],
    relatedEventId: null,
    reviewedAt: null,
    ...fields,
  };
  return event;
}

interface Person {
  actor: AuditActor;
  firm: AuditFirmRef;
  device: AuditDevice;
  /** The user account's short id, as the resource id. */
  code: string;
}

const userTarget = (who: Person): AuditTarget => ({
  type: 'User Account',
  id: who.code,
  name: who.actor.name,
  relatedRecord: who.firm.id ? who.firm.name : null,
  href: null,
});

const risk = (
  severity: Severity,
  indicators: AuditRisk['indicators'],
  rule: string | null = null,
): AuditRisk => ({
  score: RISK_SCORES[severity],
  rule,
  reason: RISK_REASONS[severity],
  indicators,
});

/** The store's first state; `empty` builds it with no events or sessions (the empty state). */
export function seedAuditStore(empty: boolean): AuditStore {
  const now = Date.now();
  const ago = (minutes: number, seconds = 0) =>
    new Date(now - minutes * 60_000 - seconds * 1000).toISOString();
  const settings: AuditStore['settings'] = {
    version: 3,
    updatedAt: ago(4 * 1440 + 95),
    updatedBy: AUDIT_ADMIN.name,
    settings: {
      mfa: { enabled: true, scope: 'ALL' },
      methods: { authenticatorApp: true, sms: true, email: true, hardwareKey: false },
      password: {
        minLength: 12,
        uppercase: true,
        lowercase: true,
        numbers: true,
        special: true,
        expirationDays: 90,
      },
      session: {
        idleTimeoutMinutes: 30,
        rememberMeDays: 7,
        concurrentSessions: 5,
        selfManage: true,
        reauthSensitive: true,
        reauthDeviceSwitch: false,
      },
      protection: {
        maxFailedAttempts: 5,
        lockoutMinutes: 30,
        notifySuspicious: true,
        autoLock: true,
        emailAdminOnLockout: true,
        verifyNewDevices: false,
      },
      ip: { mode: 'ANY', allowList: ['203.0.113.0/24'], blockList: [] },
      notifications: {
        failedLogins: true,
        newDevice: true,
        passwordChanges: true,
        mfaDisabled: true,
        accountLocked: true,
        suspicious: true,
        email: true,
        sms: false,
      },
      retention: { period: 'ONE_YEAR', exportRoles: 'SUPER_ADMINS', exportReauth: true },
    },
  };
  if (empty)
    return {
      events: [],
      accounts: [],
      sessions: [],
      disabledIntegrations: [],
      settings,
      next: 1000,
    };

  const platform: AuditFirmRef = { id: null, name: 'Firmivra' };
  const firm = (n: number, name: string): AuditFirmRef => ({ id: auditUuid('0e03', n), name });
  const riverside = firm(1, 'Sample Riverside Tax Co');
  const harbor = firm(2, 'Harbor Lane Realty Group');
  const northfield = firm(3, 'Northfield Bookkeeping');
  const maple = firm(4, 'Maple Street Catering Co');
  const cedar = firm(5, 'Cedar Point Payroll');
  const person = (
    n: number,
    name: string,
    role: string,
    home: AuditFirmRef,
    device: DeviceName,
    ip: string,
    location: string,
    code: string,
  ): Person => ({
    actor: {
      type: 'USER',
      id: auditUuid('0e02', n),
      name,
      email: `${name.toLowerCase().replace(' ', '.')}@example.test`,
      role,
    },
    firm: home,
    device: { ...DEVICES[device], ip, location },
    code,
  });
  const avery = person(
    1,
    'Avery Collins',
    'Admin',
    riverside,
    'chromeWindows',
    '192.0.2.24',
    'Atlanta, GA, USA',
    'USR-01024',
  );
  const marcus = person(
    2,
    'Marcus Bell',
    'Staff',
    harbor,
    'safariIphone',
    '203.0.113.45',
    'Atlanta, GA, USA',
    'USR-02345',
  );
  const priya = person(
    3,
    'Priya Shah',
    'Admin',
    northfield,
    'chromeMac',
    '198.51.100.17',
    'Denver, CO, USA',
    'USR-03117',
  );
  const ryan = person(
    4,
    'Ryan Ortiz',
    'Staff',
    maple,
    'chromeWindows',
    '203.0.113.88',
    'Austin, TX, USA',
    'USR-04410',
  );
  const karen = person(
    5,
    'Karen Liu',
    'Admin',
    cedar,
    'chromeMac',
    '192.0.2.50',
    'Portland, OR, USA',
    'USR-05276',
  );
  const daniel = person(
    6,
    'Daniel Brooks',
    'Staff',
    riverside,
    'edgeWindows',
    '198.51.100.23',
    'Atlanta, GA, USA',
    'USR-06093',
  );
  const ashley = person(
    7,
    'Ashley Moore',
    'Platform Admin',
    platform,
    'chromeWindows',
    '203.0.113.12',
    'Chicago, IL, USA',
    'USR-07001',
  );
  const trevor = person(
    8,
    'Trevor Hall',
    'Staff',
    northfield,
    'safariIphone',
    '192.0.2.77',
    'Denver, CO, USA',
    'USR-08552',
  );
  const people = [avery, marcus, priya, ryan, karen, daniel, ashley, trevor];
  const monitor: AuditActor = {
    type: 'SYSTEM',
    id: null,
    name: 'Firmivra Security Monitor',
    email: null,
    role: 'System',
  };
  const webhook: AuditActor = {
    type: 'SERVICE',
    id: auditUuid('0e02', 20),
    name: 'Payments Webhook',
    email: null,
    role: 'Service',
  };
  const payrollSync: AuditActor = {
    type: 'SERVICE',
    id: auditUuid('0e02', 21),
    name: 'Payroll Sync',
    email: null,
    role: 'Service',
  };
  const server = (ip: string): AuditDevice => ({ ...DEVICES.server, ip, location: null });
  const by = (who: Person) => ({ actor: who.actor, firm: who.firm, device: who.device });
  const lockout = settings.settings.protection.lockoutMinutes;

  // Marcus Bell's three failed logins (designs: firmivra-security-event-details.jpg and
  // firmivra-audit-security-event-dashboard.jpg): the third locks the account and raises an alert.
  const third = 300;
  const chainSession = auditUuid('0e04', 200);
  const chain = {
    ...by(marcus),
    category: 'AUTHENTICATION' as const,
    type: 'login.failed',
    action: 'Login Failed',
    authMethod: 'Password',
    sessionId: chainSession,
    referrerUrl: 'https://app.example.test/sign-in',
    target: userTarget(marcus),
  };
  const failedAt = [ago(third, 142), ago(third, 89), ago(third)];
  const lockedAt = ago(third, -0.4);
  const alertAt = ago(third, -1);
  const unlockAt = new Date(Date.parse(failedAt[2] ?? lockedAt) + lockout * 60_000).toISOString();

  const events: AuditEvent[] = [
    makeEvent({
      n: 1,
      at: ago(185),
      ...by(avery),
      type: 'policy.changed',
      action: 'Updated Settings',
      category: 'SECURITY',
      severity: 'MEDIUM',
      details: 'Changed password policy requirements',
      summary: 'A firm admin changed the firm password policy.',
      description:
        'The firm admin raised the minimum password length and now requires special characters for every staff password at the firm.',
      authMethod: 'Password + MFA',
      sessionId: auditUuid('0e04', 1),
      target: {
        type: 'Firm Settings',
        id: 'SET-PASSWORD',
        name: 'Password policy',
        relatedRecord: riverside.name,
        href: null,
      },
      changes: [
        {
          field: 'Minimum password length',
          before: '10 characters',
          after: '12 characters',
          masked: false,
        },
        { field: 'Require special characters', before: 'No', after: 'Yes', masked: false },
      ],
      risk: risk('MEDIUM', [
        { kind: 'privilege', label: 'Security policy changed by a firm admin' },
      ]),
    }),
    makeEvent({
      n: 2,
      at: failedAt[2] ?? lockedAt,
      ...chain,
      severity: 'HIGH',
      outcome: 'BLOCKED',
      alertState: 'OPEN',
      title: 'Login Failed',
      summary: 'Multiple failed login attempts detected.',
      details: 'Invalid password (3 attempts)',
      description:
        'The user entered an incorrect password 3 times within 2 minutes. The account was temporarily locked according to security policy.',
      facts: [
        { label: 'Failure Reason', value: 'Invalid password (3 attempts)' },
        { label: 'Attempts', value: '3' },
        { label: 'Time Window', value: '3 attempts within 2 minutes' },
        { label: 'Result', value: 'Account temporarily locked' },
        {
          label: 'Additional Details',
          value: `User will remain locked for ${lockout} minutes based on security policy.`,
        },
      ],
      risk: risk(
        'HIGH',
        [
          { kind: 'attempts', label: 'Multiple failed login attempts' },
          { kind: 'device', label: 'Login from new device' },
          { kind: 'time', label: 'Unusual time for this user' },
          { kind: 'lock', label: 'Account temporarily locked' },
        ],
        'AUTH-02: 3 failed logins within 2 minutes from a new device',
      ),
      quickInfo: [
        { label: 'First Failed Attempt', at: failedAt[0], show: 'time' },
        { label: 'Last Failed Attempt', at: failedAt[2], show: 'time' },
        { label: 'Lockout Duration', value: `${lockout} minutes (per security policy)` },
        { label: 'Automatic Unlock', at: unlockAt, show: 'datetime' },
      ],
      timeline: [
        {
          id: auditUuid('0e06', 21),
          at: failedAt[0] ?? lockedAt,
          label: 'Failed login attempt (1 of 3)',
          tone: 'danger',
        },
        {
          id: auditUuid('0e06', 22),
          at: failedAt[1] ?? lockedAt,
          label: 'Failed login attempt (2 of 3)',
          tone: 'danger',
        },
        {
          id: auditUuid('0e06', 23),
          at: failedAt[2] ?? lockedAt,
          label: 'Failed login attempt (3 of 3)',
          tone: 'danger',
        },
        {
          id: auditUuid('0e06', 24),
          at: lockedAt,
          label: 'Account locked (automatic)',
          tone: 'danger',
        },
        {
          id: auditUuid('0e06', 25),
          at: alertAt,
          label: 'Security alert triggered',
          tone: 'danger',
        },
      ],
    }),
    makeEvent({
      n: 3,
      at: ago(380),
      ...by(priya),
      type: 'record.created',
      action: 'Added User',
      category: 'DATA',
      severity: 'LOW',
      details: 'Added new team member (Jordan Pike)',
      authMethod: 'Password + MFA',
      sessionId: auditUuid('0e04', 7),
      target: {
        type: 'User Account',
        id: 'USR-03188',
        name: 'Jordan Pike',
        relatedRecord: northfield.name,
        href: null,
      },
      changes: [
        { field: 'Role', before: null, after: 'Staff', masked: false },
        { field: 'Email', before: null, after: 'j••••@example.test', masked: true },
      ],
    }),
    makeEvent({
      n: 4,
      at: ago(1440 + 245),
      ...by(ryan),
      type: 'export.created',
      action: 'Exported Data',
      category: 'DATA',
      severity: 'MEDIUM',
      details: 'Exported 248 client records (Leads CSV)',
      authMethod: 'Password + MFA',
      sessionId: auditUuid('0e04', 11),
      target: {
        type: 'Export',
        id: 'EXP-5521',
        name: 'Leads CSV',
        relatedRecord: maple.name,
        href: null,
      },
      facts: [
        { label: 'Export Type', value: 'CSV' },
        { label: 'Rows', value: '248' },
        { label: 'Filter Scope', value: 'Leads: all stages' },
        { label: 'Link Expires', value: '15 minutes after creation' },
      ],
      risk: risk('MEDIUM', [{ kind: 'data', label: 'Large export of client records' }]),
    }),
    makeEvent({
      n: 5,
      at: ago(1440 + 490),
      ...by(karen),
      type: 'integration.connected',
      action: 'Updated Integration',
      category: 'INTEGRATION',
      severity: 'LOW',
      details: 'Connected Stripe (test mode)',
      authMethod: 'Password + MFA',
      sessionId: auditUuid('0e04', 15),
      target: {
        type: 'Integration',
        id: 'INT-0042',
        name: 'Stripe',
        relatedRecord: cedar.name,
        href: '/integrations',
      },
      changes: [
        { field: 'Mode', before: null, after: 'Test', masked: false },
        { field: 'Secret key', before: null, after: 'sk_test_••••4242', masked: true },
      ],
    }),
    makeEvent({
      n: 6,
      at: ago(1440 + 655),
      ...by(daniel),
      type: 'record.deleted',
      action: 'Deleted Record',
      category: 'DATA',
      severity: 'HIGH',
      details: 'Deleted client document (Tax Return 2024)',
      authMethod: 'Password + MFA',
      sessionId: auditUuid('0e04', 20),
      target: {
        type: 'Client Document',
        id: 'DOC-88213',
        name: 'Tax Return 2024.pdf',
        relatedRecord: 'Client CL-1042',
        href: null,
      },
      risk: risk('HIGH', [
        { kind: 'data', label: 'Permanent deletion of a client document' },
        { kind: 'time', label: "Outside the firm's usual hours" },
      ]),
    }),
    makeEvent({
      n: 7,
      at: ago(2 * 1440 + 65),
      ...by(ashley),
      type: 'permission.changed',
      action: 'Changed Permission',
      category: 'AUTHORIZATION',
      severity: 'MEDIUM',
      details: 'Updated role permissions (Sales Agent)',
      authMethod: 'Password + MFA',
      source: 'Super Admin Console',
      sessionId: auditUuid('0e04', 24),
      target: {
        type: 'Role',
        id: 'ROLE-SALES-AGENT',
        name: 'Sales Agent',
        relatedRecord: null,
        href: null,
      },
      changes: [
        { field: 'Leads: Export', before: 'Not allowed', after: 'Allowed', masked: false },
        { field: 'Pipeline: Edit', before: 'Not allowed', after: 'Allowed', masked: false },
      ],
      risk: risk('MEDIUM', [{ kind: 'privilege', label: 'Role gained export access' }]),
    }),
    makeEvent({
      n: 8,
      at: ago(2 * 1440 + 1080),
      ...by(trevor),
      type: 'login.success',
      action: 'Login Success',
      category: 'AUTHENTICATION',
      severity: 'INFO',
      details: 'Successful login',
      authMethod: 'Password + MFA',
      sessionId: auditUuid('0e04', 31),
      target: userTarget(trevor),
    }),
    makeEvent({
      n: 9,
      at: failedAt[0] ?? lockedAt,
      ...chain,
      severity: 'LOW',
      outcome: 'DETECTED',
      details: 'Invalid password (1st attempt)',
      title: 'Login Failed (1st attempt)',
      facts: [{ label: 'Failure Reason', value: 'Invalid password' }],
    }),
    makeEvent({
      n: 10,
      at: failedAt[1] ?? lockedAt,
      ...chain,
      severity: 'MEDIUM',
      outcome: 'DETECTED',
      details: 'Invalid password (2nd attempt)',
      title: 'Login Failed (2nd attempt)',
      facts: [{ label: 'Failure Reason', value: 'Invalid password' }],
    }),
    makeEvent({
      n: 11,
      at: lockedAt,
      actor: monitor,
      firm: harbor,
      device: server('198.51.100.5'),
      source: 'Security rules',
      type: 'account.locked',
      action: 'Locked Account',
      category: 'SECURITY',
      severity: 'MEDIUM',
      details: `Locked Marcus Bell for ${lockout} minutes after 3 failed logins`,
      target: userTarget(marcus),
      subjectUserId: marcus.actor.id,
      relatedEventId: auditUuid('0e01', 2),
    }),
    makeEvent({
      n: 12,
      at: alertAt,
      actor: monitor,
      firm: harbor,
      device: server('198.51.100.5'),
      source: 'Security rules',
      type: 'security_alert.created',
      action: 'Raised Security Alert',
      category: 'SECURITY',
      severity: 'MEDIUM',
      details: 'Alert: repeated failed logins for Marcus Bell',
      target: userTarget(marcus),
      subjectUserId: marcus.actor.id,
      relatedEventId: auditUuid('0e01', 2),
    }),
  ];

  // Everyday activity over the 3 weeks before, so every tab, filter and page has rows.
  type Template = (who: Person, cycle: number, i: number) => Omit<EventSeed, 'n' | 'at'>;
  const templates: Template[] = [
    (who) => ({
      ...by(who),
      type: 'login.success',
      action: 'Login Success',
      category: 'AUTHENTICATION',
      severity: 'INFO',
      details: 'Successful login',
      authMethod: 'Password + MFA',
      target: userTarget(who),
    }),
    (who) => ({
      ...by(who),
      type: 'logout',
      action: 'Logout',
      category: 'AUTHENTICATION',
      severity: 'INFO',
      details: 'Signed out',
      target: userTarget(who),
    }),
    (who) => ({
      ...by(who),
      type: 'login.failed',
      action: 'Login Failed',
      category: 'AUTHENTICATION',
      severity: 'LOW',
      outcome: 'FAILED',
      details: 'Invalid password (1 attempt)',
      authMethod: 'Password',
      target: userTarget(who),
      facts: [
        { label: 'Failure Reason', value: 'Invalid password' },
        { label: 'Attempts', value: '1' },
      ],
    }),
    (who) => ({
      ...by(who),
      type: 'mfa.challenge.success',
      action: 'MFA Passed',
      category: 'AUTHENTICATION',
      severity: 'INFO',
      details: 'Authenticator app code accepted',
      authMethod: 'Password + MFA',
      target: userTarget(who),
    }),
    (who) => ({
      ...by(who),
      type: 'mfa.challenge.failed',
      action: 'MFA Failed',
      category: 'AUTHENTICATION',
      severity: 'MEDIUM',
      outcome: 'FAILED',
      details: 'Wrong authenticator code (2 attempts)',
      authMethod: 'Password + MFA',
      target: userTarget(who),
      risk: risk('MEDIUM', [{ kind: 'attempts', label: 'Repeated wrong MFA codes' }]),
    }),
    (who, _cycle, i) => {
      const other = people[(i + 1) % people.length] ?? who;
      return {
        ...by(who),
        type: 'role.assigned',
        action: 'Role Assigned',
        category: 'AUTHORIZATION',
        severity: 'MEDIUM',
        details: `Assigned the Admin role to ${other.actor.name}`,
        target: userTarget(other),
        subjectUserId: other.actor.id,
        changes: [{ field: 'Role', before: 'Staff', after: 'Admin', masked: false }],
        risk: risk('MEDIUM', [{ kind: 'privilege', label: 'Admin privileges granted' }]),
      };
    },
    (who, _cycle, i) => ({
      ...by(who),
      type: 'record.updated',
      action: 'Updated Record',
      category: 'DATA',
      severity: 'LOW',
      details: 'Updated client profile (contact details)',
      target: {
        type: 'Client',
        id: `CL-${1040 + i}`,
        name: `Client CL-${1040 + i}`,
        relatedRecord: who.firm.id ? who.firm.name : null,
        href: null,
      },
      changes: [
        { field: 'Phone', before: '(555) 010-01••', after: '(555) 010-02••', masked: true },
        { field: 'Mailing city', before: 'Springfield', after: 'Riverton', masked: false },
      ],
    }),
    (who) => ({
      ...by(who),
      type: 'integration.tested',
      action: 'Tested Integration',
      category: 'INTEGRATION',
      severity: 'INFO',
      details: 'Connection test passed (QuickBooks Online)',
      target: {
        type: 'Integration',
        id: 'INT-0031',
        name: 'QuickBooks Online',
        relatedRecord: who.firm.id ? who.firm.name : null,
        href: '/integrations',
      },
    }),
    (who) => ({
      ...by(who),
      type: 'password.reset',
      action: 'Password Reset',
      category: 'AUTHENTICATION',
      severity: 'LOW',
      details: 'Password changed from a reset link',
      target: userTarget(who),
    }),
    (who) => ({
      ...by(who),
      device: { ...who.device, ip: '198.51.100.140', location: 'Lisbon, Portugal' },
      type: 'login.failed',
      action: 'Login Failed',
      category: 'AUTHENTICATION',
      severity: 'MEDIUM',
      outcome: 'FAILED',
      details: 'Unknown device (2 attempts)',
      authMethod: 'Password',
      target: userTarget(who),
      facts: [
        { label: 'Failure Reason', value: 'Invalid password from an unknown device' },
        { label: 'Attempts', value: '2' },
      ],
      risk: risk('MEDIUM', [
        { kind: 'device', label: 'Login from new device' },
        { kind: 'attempts', label: 'Repeated failed logins' },
      ]),
    }),
    (who, _cycle, i) => ({
      ...by(who),
      type: 'export.created',
      action: 'Exported Data',
      category: 'DATA',
      severity: 'MEDIUM',
      details: `Exported ${60 + i * 7} invoices (CSV)`,
      target: {
        type: 'Export',
        id: `EXP-${5400 + i}`,
        name: 'Invoices CSV',
        relatedRecord: who.firm.id ? who.firm.name : null,
        href: null,
      },
      facts: [
        { label: 'Export Type', value: 'CSV' },
        { label: 'Rows', value: String(60 + i * 7) },
      ],
    }),
    (who) => ({
      actor: webhook,
      firm: who.firm,
      device: server('198.51.100.200'),
      source: 'API',
      type: 'webhook.failed',
      action: 'Webhook Failed',
      category: 'INTEGRATION',
      severity: 'MEDIUM',
      outcome: 'FAILED',
      details: 'Delivery failed: endpoint returned 500',
      target: {
        type: 'Integration',
        id: 'INT-0042',
        name: 'Stripe',
        relatedRecord: who.firm.id ? who.firm.name : null,
        href: '/integrations',
      },
      risk: risk('MEDIUM', [{ kind: 'integration', label: 'Webhook deliveries failing' }]),
    }),
    (who, cycle) => ({
      ...by(who),
      device: { ...who.device, ip: '198.51.100.140', location: 'Lisbon, Portugal' },
      type: 'suspicious_login.detected',
      action: 'Suspicious Login',
      category: 'SECURITY',
      severity: 'MEDIUM',
      outcome: 'DETECTED',
      alertState: (['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const)[cycle % 3] ?? 'OPEN',
      details: 'Sign-in from a new country',
      source: 'Security rules',
      target: userTarget(who),
      risk: risk(
        'MEDIUM',
        [
          { kind: 'location', label: 'Sign-in from a new country' },
          { kind: 'time', label: 'Unusual time for this user' },
        ],
        'GEO-01: sign-in from a country this user has not used',
      ),
    }),
    (_who, cycle) => ({
      actor: payrollSync,
      firm: cedar,
      device: server('203.0.113.200'),
      source: 'API',
      type: 'integration.auth_failed',
      action: 'Integration Auth Failed',
      category: 'INTEGRATION',
      severity: 'HIGH',
      outcome: 'FAILED',
      alertState: cycle === 0 ? 'OPEN' : 'RESOLVED',
      details: 'API key rejected (Payroll Sync)',
      target: {
        type: 'Integration',
        id: 'INT-0057',
        name: 'Payroll Sync',
        relatedRecord: cedar.name,
        href: '/integrations',
      },
      risk: risk(
        'HIGH',
        [{ kind: 'integration', label: 'Repeated authentication failures' }],
        'INT-03: 5 rejected API keys within 10 minutes',
      ),
    }),
    (who) => ({
      ...by(who),
      type: 'secret.rotated',
      action: 'Rotated Secret',
      category: 'SECURITY',
      severity: 'LOW',
      details: 'Rotated webhook signing secret',
      target: {
        type: 'Integration Secret',
        id: 'SEC-0042',
        name: 'Webhook signing secret',
        relatedRecord: null,
        href: null,
      },
      changes: [
        {
          field: 'Signing secret',
          before: 'whsec_••••91c2',
          after: 'whsec_••••0f7a',
          masked: true,
        },
      ],
    }),
    (who) => ({
      ...by(who),
      type: 'policy.changed',
      action: 'Updated Settings',
      category: 'SECURITY',
      severity: 'MEDIUM',
      details: 'Changed session timeout (30 to 60 minutes)',
      target: {
        type: 'Firm Settings',
        id: 'SET-SESSION',
        name: 'Session policy',
        relatedRecord: who.firm.id ? who.firm.name : null,
        href: null,
      },
      changes: [
        { field: 'Session timeout', before: '30 minutes', after: '60 minutes', masked: false },
      ],
    }),
  ];
  for (let i = 0; i < 48; i += 1) {
    const cycle = Math.floor(i / templates.length);
    const template = templates[i % templates.length];
    const who = people[(i * 3 + cycle) % people.length];
    if (!template || !who) continue;
    events.push(
      makeEvent({
        n: 101 + i,
        at: ago(3 * 1440 + 30 + i * 470 + (i % 5) * 17),
        ...template(who, cycle, i),
      }),
    );
  }

  const accounts = people.map((who, i): MockAccount => ({
    userId: who.actor.id ?? '',
    name: who.actor.name,
    status: who === marcus ? 'LOCKED' : 'ACTIVE',
    mfaEnabled: true,
    lastSuccessfulLoginAt: who === marcus ? ago(third + 2 * 1440 + 58) : ago(60 + i * 97),
    passwordResetRequired: false,
  }));

  // Open sessions per person; on even rows the last one has ended.
  const sessions: MockSession[] = [];
  const counts = [5, 2, 5, 4, 5, 3, 6, 4];
  people.forEach((who, i) => {
    const count = counts[i] ?? 1;
    for (let k = 0; k < count; k += 1) {
      sessions.push({
        id: auditUuid('0e04', sessions.length + 1),
        userId: who.actor.id ?? '',
        startedAt: ago(60 * (6 + i * 13 + k * 41)),
        lastSeenAt: ago(5 + i * 7 + k * 11),
        endedAt: k === count - 1 && i % 2 === 0 ? ago(30) : null,
      });
    }
  });

  return { events, accounts, sessions, disabledIntegrations: [], settings, next: 1000 };
}
