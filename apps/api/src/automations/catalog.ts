import type {
  AutomationActionTypeInfo,
  AutomationConditionField,
  AutomationEvent,
  AutomationFieldType,
  AutomationOperator,
} from '@firmivra/types';

// What a rule can start from and do. This is data the API serves (GET /automations/catalog): a new
// event or action is a new entry here and a loader or an executor, never a new screen. The events
// below read the firm's own records; the actions call the other modules' own services.

export const MODULES: Record<string, { label: string; destination: string }> = {
  CLIENTS: { label: 'Clients', destination: '/clients' },
  LEADS: { label: 'Leads', destination: '/leads' },
  APPOINTMENTS: { label: 'Appointments', destination: '/appointments' },
  INTAKE_FORMS: { label: 'Intake Forms', destination: '/intake' },
  DOCUMENTS: { label: 'Documents', destination: '/documents' },
  TAX_RETURNS: { label: 'Tax Returns', destination: '/tax-returns' },
  BOOKKEEPING: { label: 'Bookkeeping', destination: '/bookkeeping' },
  PAYROLL: { label: 'Payroll', destination: '/payroll' },
  TAX_PLANNING: { label: 'Tax Planning', destination: '/tax-planning' },
  BUSINESS_ADVISORY: { label: 'Business Advisory', destination: '/advisory' },
  INVOICES_PAYMENTS: { label: 'Invoices & Payments', destination: '/invoices' },
  COMMUNICATIONS: { label: 'Communications', destination: '/communications' },
  TASKS: { label: 'Tasks', destination: '/tasks' },
  COMPLIANCE_DEADLINES: { label: 'Compliance & Deadlines', destination: '/compliance' },
  STAFF_MANAGEMENT: { label: 'Staff Management', destination: '/staff' },
  INTEGRATIONS: { label: 'Integrations', destination: '/integrations' },
  CUSTOM: { label: 'Custom', destination: '/automations' },
};

/** The operators each field type takes. */
export const OPERATORS: Record<AutomationFieldType, AutomationOperator[]> = {
  TEXT: ['IS', 'IS_NOT', 'CONTAINS', 'EXISTS', 'NOT_EXISTS'],
  NUMBER: ['IS', 'GREATER_THAN', 'LESS_THAN', 'EXISTS'],
  MONEY: ['IS', 'GREATER_THAN', 'LESS_THAN', 'EXISTS'],
  DATE: ['BEFORE', 'AFTER', 'EXISTS', 'NOT_EXISTS'],
  STATUS: ['IS', 'IS_NOT', 'INCLUDES', 'EXCLUDES'],
  BOOLEAN: ['IS'],
  LIST: ['INCLUDES', 'EXCLUDES', 'EXISTS'],
};

const options = (values: string[]) =>
  values.map((value) => ({
    value,
    label: value
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase()),
  }));

const field = (
  key: string,
  label: string,
  type: AutomationFieldType,
  choices: string[] = [],
): AutomationConditionField => ({
  field: key,
  label,
  type,
  operators: OPERATORS[type],
  options: options(choices),
});

const CLIENT_TYPE = field('clientType', 'Client type', 'STATUS', ['INDIVIDUAL', 'BUSINESS']);
const CLIENT_STATUS = field('status', 'Client status', 'STATUS', [
  'NEW',
  'PENDING_DOCUMENTS',
  'IN_PROGRESS',
  'ACTIVE',
  'ON_HOLD',
  'INACTIVE',
]);
const LEAD_FIELDS = [
  field('stage', 'Lead stage', 'STATUS', [
    'SUBMITTED',
    'CONTACTED',
    'IN_FOLLOW_UP',
    'APPOINTMENT_SCHEDULED',
    'QUALIFIED',
    'CONVERTED',
    'DECLINED',
    'LOST',
  ]),
  field('source', 'Lead source', 'STATUS', [
    'BEGIN_ONLINE',
    'WEBSITE_FORM',
    'FACEBOOK_AD',
    'INSTAGRAM',
    'GOOGLE_AD',
    'REFERRAL',
    'PHONE_CALL',
    'WALK_IN',
    'EMAIL',
    'EVENT',
    'OTHER',
  ]),
];
const INTAKE_STATUS = field('status', 'Intake status', 'STATUS', [
  'SENT',
  'IN_PROGRESS',
  'SUBMITTED',
  'NEEDS_CORRECTION',
  'UNDER_REVIEW',
  'COMPLETED',
]);

const statuses = (key: string, label: string, values: string[]) =>
  field(key, label, 'STATUS', values);
const RETURN_STATUSES = [
  'IN_PREPARATION',
  'WAITING_ON_CLIENT',
  'READY_FOR_REVIEW',
  'READY_FOR_SIGNATURE',
  'READY_TO_FILE',
  'TRANSMITTED',
  'ACCEPTED',
  'REJECTED',
  'CLOSED',
];
const RETURN_FIELDS = [
  CLIENT_TYPE,
  statuses('workflowStatus', 'Workflow status', RETURN_STATUSES),
  field('taxYear', 'Tax year', 'NUMBER'),
];
const RETURN_MOVE = [
  ...RETURN_FIELDS,
  statuses('newStatus', 'New status', RETURN_STATUSES),
  statuses('previousStatus', 'Previous status', RETURN_STATUSES),
];
const PLAN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'IN_PROGRESS',
  'AWAITING_CLIENT',
  'READY_FOR_REVIEW',
  'IMPLEMENTED',
  'CLOSED',
];
const PLAN_FIELDS = [
  CLIENT_TYPE,
  statuses('status', 'Plan status', PLAN_STATUSES),
  field('planYear', 'Plan year', 'NUMBER'),
];
const ADVISORY_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'FINALIZED',
  'SENT',
  'IN_PROGRESS',
  'COMPLETED',
  'ARCHIVED',
];
const ADVISORY_FIELDS = [CLIENT_TYPE, statuses('status', 'Plan status', ADVISORY_STATUSES)];
const move = (values: string[]) => [
  CLIENT_TYPE,
  statuses('newStatus', 'New status', values),
  statuses('previousStatus', 'Previous status', values),
];
const BOOKKEEPING_MOVE = move([
  'ON_TRACK',
  'NEEDS_ATTENTION',
  'MISSING_DOCUMENTS',
  'OVERDUE',
  'NOT_STARTED',
]);
const PAYROLL_MOVE = move([
  'ON_TRACK',
  'PROCESSING',
  'ACTION_REQUIRED',
  'PAST_DUE',
  'NOT_STARTED',
  'ON_HOLD',
  'ARCHIVED',
]);

/**
 * AU-F08 to F14: an event that is a change the source module records (audit-events.ts): it runs
 * once for each change, right away or a set time after it.
 */
const change = (
  code: string,
  module: AutomationEvent['module'],
  label: string,
  example: string,
  recordKind: string,
  conditionFields: AutomationConditionField[],
): EventDef => ({
  code,
  module,
  label,
  example,
  recordKind,
  timings: ['IMMEDIATE', 'AFTER'],
  conditionFields,
});
const PRIORITY = (key = 'priority') => field(key, 'Priority', 'STATUS', ['LOW', 'MEDIUM', 'HIGH']);

type EventDef = Omit<AutomationEvent, 'confirmation' | 'anchor' | 'hasClient'> &
  Partial<Pick<AutomationEvent, 'confirmation' | 'hasClient'>>;

/** AU-F18 to F20: a change about the firm itself (a team member, a connection, a send): no client. */
const firmEvent = (...args: Parameters<typeof change>): EventDef => ({
  ...change(...args),
  hasClient: false,
});
const ROLES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'STAFF',
  'BOOKKEEPER',
  'TAX_PREPARER',
  'CLIENT_SUPPORT',
  'BUSINESS_CONSULTANT',
  'READ_ONLY',
];
const ROLE = statuses('role', 'Role', ROLES);
const PROVIDER = field('provider', 'Provider', 'TEXT');
const CHANNEL = statuses('channel', 'Channel', ['EMAIL', 'SMS', 'ANNOUNCEMENT']);

/**
 * AU-F04, F06: what a timing counts from, for the events with a date on their record (the date the
 * loader measures from, matching.ts). Every other event counts from the moment it happens.
 */
const ANCHORS: Record<string, string> = {
  'client.created': 'the client is added',
  'invoice.overdue': 'the due date',
  'deadline.approaching': 'the due date',
  'task.overdue': 'the due date',
  'appointment.upcoming': 'the start time',
  'lead.follow_up_due': 'the follow-up time',
  'intake.due': 'the due date',
  'document.request_due': 'the due date',
  'tax_return.due': 'the filing due date',
};

const EVENT_DEFS: EventDef[] = [
  {
    code: 'client.created',
    module: 'CLIENTS',
    label: 'New client added',
    example: 'When a new client is added to the firm',
    recordKind: 'client',
    timings: ['IMMEDIATE'],
    conditionFields: [
      CLIENT_TYPE,
      field('status', 'Client status', 'STATUS', [
        'NEW',
        'PENDING_DOCUMENTS',
        'IN_PROGRESS',
        'ACTIVE',
        'ON_HOLD',
        'INACTIVE',
      ]),
      field('source', 'Source', 'TEXT'),
    ],
  },
  // ---------- Clients (AU-F08) ----------
  change(
    'client.assignment_changed',
    'CLIENTS',
    'Assigned staff changed',
    'When a client is assigned to someone else',
    'client',
    [CLIENT_TYPE, CLIENT_STATUS],
  ),
  change(
    'client.tags_changed',
    'CLIENTS',
    'Tags added or removed',
    'When a client’s tags change',
    'client',
    [CLIENT_TYPE, CLIENT_STATUS],
  ),
  change(
    'client.profile_changed',
    'CLIENTS',
    'Profile details changed',
    'When a client’s profile details are updated',
    'client',
    [CLIENT_TYPE, CLIENT_STATUS],
  ),
  change('client.archived', 'CLIENTS', 'Client archived', 'When a client is archived', 'client', [
    CLIENT_TYPE,
  ]),
  change(
    'client.reactivated',
    'CLIENTS',
    'Client reactivated',
    'When an archived client is restored',
    'client',
    [CLIENT_TYPE, CLIENT_STATUS],
  ),
  // ---------- Leads (AU-F09) ----------
  change(
    'lead.created',
    'LEADS',
    'Lead created',
    'When a lead comes in from your website or is added by your team',
    'lead',
    LEAD_FIELDS,
  ),
  change(
    'lead.stage_changed',
    'LEADS',
    'Lead stage changed',
    'When someone moves a lead to another stage',
    'lead',
    LEAD_FIELDS,
  ),
  change(
    'lead.assignment_changed',
    'LEADS',
    'Lead assigned staff changed',
    'When a lead is assigned to someone else',
    'lead',
    LEAD_FIELDS,
  ),
  {
    code: 'lead.follow_up_due',
    module: 'LEADS',
    label: 'Lead follow-up due',
    example: 'When a lead’s next follow-up is coming up or has passed',
    recordKind: 'lead',
    timings: ['BEFORE', 'AFTER'],
    conditionFields: [
      ...LEAD_FIELDS,
      field('followUpType', 'Follow-up type', 'STATUS', [
        'CALL',
        'EMAIL',
        'SMS',
        'APPOINTMENT',
        'SEND_DOCUMENTS',
        'FOLLOW_UP',
        'CLOSE_LEAD',
      ]),
    ],
  },
  change(
    'lead.converted',
    'LEADS',
    'Lead converted to client',
    'When a lead becomes a client',
    'lead',
    LEAD_FIELDS,
  ),
  change(
    'lead.disqualified',
    'LEADS',
    'Lead marked not qualified',
    'When someone marks a lead not qualified',
    'lead',
    LEAD_FIELDS,
  ),
  // ---------- Intake Forms (AU-F10) ----------
  change(
    'intake.sent',
    'INTAKE_FORMS',
    'Intake form sent',
    'When a form is sent to a client',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS],
  ),
  change(
    'intake.submitted',
    'INTAKE_FORMS',
    'Intake form submitted',
    'When a client submits a form for the first time',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS],
  ),
  change(
    'intake.returned',
    'INTAKE_FORMS',
    'Intake form returned for corrections',
    'When your team asks the client to correct a form',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS],
  ),
  change(
    'intake.resubmitted',
    'INTAKE_FORMS',
    'Intake form resubmitted',
    'When a client sends a corrected form (a new version)',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS],
  ),
  change(
    'intake.approved',
    'INTAKE_FORMS',
    'Intake form approved',
    'When your team marks a form reviewed',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS],
  ),
  {
    code: 'intake.due',
    module: 'INTAKE_FORMS',
    label: 'Intake form due or overdue',
    example: 'When a form the client hasn’t finished is coming due or is past due',
    recordKind: 'intake',
    timings: ['BEFORE', 'AFTER'],
    conditionFields: [CLIENT_TYPE, INTAKE_STATUS],
  },
  // ---------- Documents (AU-F11) ----------
  change(
    'document.requested',
    'DOCUMENTS',
    'Documents requested',
    'When a document request is sent to a client',
    'document_request',
    [CLIENT_TYPE],
  ),
  {
    code: 'document.request_due',
    module: 'DOCUMENTS',
    label: 'Requested documents due or overdue',
    example: 'When an open document request is coming due or is past due',
    recordKind: 'document_request',
    timings: ['BEFORE', 'AFTER'],
    conditionFields: [CLIENT_TYPE],
  },
  change(
    'document.uploaded',
    'DOCUMENTS',
    'Document uploaded',
    'When a document is uploaded (a refused upload doesn’t count)',
    'document',
    [CLIENT_TYPE],
  ),
  change(
    'document.approved',
    'DOCUMENTS',
    'Document approved',
    'When your team verifies or completes a document’s review',
    'document',
    [CLIENT_TYPE],
  ),
  change(
    'document.returned',
    'DOCUMENTS',
    'Document returned for a replacement',
    'When your team asks the client for a replacement',
    'document',
    [CLIENT_TYPE],
  ),
  change(
    'document.request_completed',
    'DOCUMENTS',
    'Document request completed',
    'When every document of a request is in and the request is marked complete',
    'document_request',
    [CLIENT_TYPE],
  ),
  change(
    'document.archived',
    'DOCUMENTS',
    'Document archived',
    'When a document is archived',
    'document',
    [CLIENT_TYPE],
  ),
  change(
    'document.restored',
    'DOCUMENTS',
    'Document restored',
    'When an archived document is restored',
    'document',
    [CLIENT_TYPE],
  ),
  // ---------- Tax Returns (AU-F12) ----------
  change(
    'tax_return.created',
    'TAX_RETURNS',
    'Tax return created',
    'When a tax return is created for a client',
    'tax_return',
    RETURN_FIELDS,
  ),
  change(
    'tax_return.status_changed',
    'TAX_RETURNS',
    'Workflow status changed',
    'When a return moves to another status, such as Ready for Review, Transmitted or Accepted',
    'tax_return',
    RETURN_MOVE,
  ),
  {
    code: 'tax_return.due',
    module: 'TAX_RETURNS',
    label: 'Filing due date approaching or passed',
    example: 'When a return not yet transmitted is coming due or is past its due date',
    recordKind: 'tax_return',
    timings: ['BEFORE', 'AFTER'],
    conditionFields: RETURN_FIELDS,
  },
  change(
    'tax_return.amended',
    'TAX_RETURNS',
    'Amended return created',
    'When an amended return is started from a filed one',
    'tax_return',
    RETURN_FIELDS,
  ),
  change(
    'tax_return.archived',
    'TAX_RETURNS',
    'Tax return archived',
    'When a return is archived',
    'tax_return',
    RETURN_FIELDS,
  ),
  change(
    'tax_return.reopened',
    'TAX_RETURNS',
    'Tax return reopened',
    'When an archived return is restored',
    'tax_return',
    RETURN_FIELDS,
  ),
  // ---------- Tax Planning (AU-F13) ----------
  change(
    'tax_plan.created',
    'TAX_PLANNING',
    'Tax plan created',
    'When a tax plan is started for a client',
    'tax_plan',
    PLAN_FIELDS,
  ),
  change(
    'tax_plan.status_changed',
    'TAX_PLANNING',
    'Plan status changed',
    'When a plan moves to another status, such as Ready for Review',
    'tax_plan',
    [
      ...PLAN_FIELDS,
      statuses('newStatus', 'New status', PLAN_STATUSES),
      statuses('previousStatus', 'Previous status', PLAN_STATUSES),
    ],
  ),
  change(
    'tax_plan.finalized',
    'TAX_PLANNING',
    'Plan finalized',
    'When a plan version is finalized',
    'tax_plan',
    PLAN_FIELDS,
  ),
  change(
    'tax_plan.shared',
    'TAX_PLANNING',
    'Plan shared with client',
    'When a finalized plan is sent to the client',
    'tax_plan',
    PLAN_FIELDS,
  ),
  change(
    'tax_plan.archived',
    'TAX_PLANNING',
    'Tax plan archived',
    'When a plan is archived',
    'tax_plan',
    PLAN_FIELDS,
  ),
  // ---------- Business Advisory (AU-F14) ----------
  change(
    'advisory.engagement_created',
    'BUSINESS_ADVISORY',
    'Advisory engagement created',
    'When a client joins the advisory program',
    'advisory_client',
    [CLIENT_TYPE],
  ),
  change(
    'advisory_plan.created',
    'BUSINESS_ADVISORY',
    'Advisory plan created',
    'When an advisory plan is started',
    'advisory_plan',
    ADVISORY_FIELDS,
  ),
  change(
    'advisory_plan.status_changed',
    'BUSINESS_ADVISORY',
    'Advisory status changed',
    'When an advisory plan moves to another status, such as In Review or Completed',
    'advisory_plan',
    [
      ...ADVISORY_FIELDS,
      statuses('newStatus', 'New status', ADVISORY_STATUSES),
      statuses('previousStatus', 'Previous status', ADVISORY_STATUSES),
    ],
  ),
  change(
    'advisory_plan.finalized',
    'BUSINESS_ADVISORY',
    'Advisory plan finalized',
    'When an advisory plan version is finalized',
    'advisory_plan',
    ADVISORY_FIELDS,
  ),
  change(
    'advisory_plan.shared',
    'BUSINESS_ADVISORY',
    'Advisory deliverable shared',
    'When a finalized plan is sent to the client',
    'advisory_plan',
    ADVISORY_FIELDS,
  ),
  change(
    'advisory.engagement_archived',
    'BUSINESS_ADVISORY',
    'Advisory engagement archived',
    'When a client is archived from the advisory program',
    'advisory_client',
    [CLIENT_TYPE],
  ),
  // ---------- Bookkeeping (AU-F16) ----------
  change(
    'bookkeeping.enrolled',
    'BOOKKEEPING',
    'Client enrolled in bookkeeping',
    'When a client is added to bookkeeping',
    'bookkeeping_client',
    [CLIENT_TYPE],
  ),
  change(
    'bookkeeping.status_changed',
    'BOOKKEEPING',
    'Bookkeeping status changed',
    'When a client’s bookkeeping moves to another status',
    'bookkeeping_client',
    BOOKKEEPING_MOVE,
  ),
  change(
    'bookkeeping.assignment_changed',
    'BOOKKEEPING',
    'Bookkeeper assigned or changed',
    'When a client’s bookkeeping is assigned to someone',
    'bookkeeping_client',
    [CLIENT_TYPE],
  ),
  change(
    'bookkeeping.period_opened',
    'BOOKKEEPING',
    'Bookkeeping period opened',
    'When a new period is opened for a client',
    'bookkeeping_period',
    [CLIENT_TYPE],
  ),
  change(
    'bookkeeping.reconciliation_started',
    'BOOKKEEPING',
    'Reconciliation started',
    'When a reconciliation is started for an account',
    'bookkeeping_reconciliation',
    [CLIENT_TYPE],
  ),
  change(
    'bookkeeping.report_ready',
    'BOOKKEEPING',
    'Bookkeeping report ready',
    'When a report is added for a client',
    'bookkeeping_report',
    [CLIENT_TYPE],
  ),
  change(
    'bookkeeping.connection_disconnected',
    'BOOKKEEPING',
    'Accounting connection disconnected',
    'When a client’s accounting connection is disconnected',
    'bookkeeping_connection',
    [CLIENT_TYPE],
  ),
  // ---------- Payroll (AU-F17): a step recorded here never runs or submits payroll ----------
  change(
    'payroll.enrolled',
    'PAYROLL',
    'Client enrolled in payroll',
    'When a client is added to payroll',
    'payroll_client',
    [CLIENT_TYPE],
  ),
  change(
    'payroll.status_changed',
    'PAYROLL',
    'Payroll status changed',
    'When a client’s payroll service moves to another status',
    'payroll_client',
    PAYROLL_MOVE,
  ),
  change(
    'payroll.run_created',
    'PAYROLL',
    'Payroll run created',
    'When a payroll run is started for a period',
    'payroll_run',
    [CLIENT_TYPE],
  ),
  change(
    'payroll.run_ready',
    'PAYROLL',
    'Payroll run ready for review',
    'When a run is marked ready for review',
    'payroll_run',
    [CLIENT_TYPE],
  ),
  change(
    'payroll.run_approved',
    'PAYROLL',
    'Payroll run approved',
    'When a reviewer approves a run',
    'payroll_run',
    [CLIENT_TYPE],
  ),
  change(
    'payroll.run_returned',
    'PAYROLL',
    'Payroll run returned',
    'When a run is reopened for changes',
    'payroll_run',
    [CLIENT_TYPE],
  ),
  change(
    'payroll.run_submitted',
    'PAYROLL',
    'Payroll run submitted',
    'When your team records that a run was submitted to the provider',
    'payroll_run',
    [CLIENT_TYPE],
  ),
  change(
    'payroll.run_completed',
    'PAYROLL',
    'Payroll run completed',
    'When your team records that a run completed',
    'payroll_run',
    [CLIENT_TYPE],
  ),
  change(
    'payroll.report_ready',
    'PAYROLL',
    'Payroll report ready',
    'When a payroll report is added for a client',
    'payroll_report',
    [CLIENT_TYPE],
  ),
  // ---------- Communications (AU-F18), the client's own ----------
  change(
    'communication.consent_changed',
    'COMMUNICATIONS',
    'Client unsubscribed or messaging consent changed',
    'When a client opts out, reports spam or opts back in, by email or text',
    'client',
    [
      CLIENT_TYPE,
      statuses('channel', 'Channel', ['EMAIL', 'SMS']),
      statuses('consentStatus', 'Consent', [
        'OPTED_IN',
        'OPTED_OUT',
        'BOUNCED',
        'INVALID',
        'COMPLAINED',
      ]),
    ],
  ),
  // ---------- AU-F18 to F20: the firm's own events, with no client ----------
  // Each is a change the source module records in its audit log (audit-events.ts), or a sync run
  // that finished (matching.ts). Only an action that needs no client (Notify staff) fits them. A
  // trigger only tells: it never grants or changes anyone's rights.
  firmEvent(
    'staff.invited',
    'STAFF_MANAGEMENT',
    'Team member invited',
    'When someone is invited to join the firm',
    'membership',
    [ROLE],
  ),
  firmEvent(
    'staff.invitation_accepted',
    'STAFF_MANAGEMENT',
    'Invitation accepted',
    'When an invited person joins the firm',
    'membership',
    [ROLE],
  ),
  firmEvent(
    'staff.role_changed',
    'STAFF_MANAGEMENT',
    'Role changed',
    'When a team member’s role changes',
    'membership',
    [statuses('newRole', 'New role', ROLES), statuses('previousRole', 'Previous role', ROLES)],
  ),
  firmEvent(
    'staff.permissions_changed',
    'STAFF_MANAGEMENT',
    'Permissions changed',
    'When a team member’s permissions are saved or overridden',
    'membership',
    [ROLE],
  ),
  firmEvent(
    'staff.team_changed',
    'STAFF_MANAGEMENT',
    'Team assignment changed',
    'When the members of a team change',
    'team',
    [],
  ),
  firmEvent(
    'staff.deactivated',
    'STAFF_MANAGEMENT',
    'Team member deactivated',
    'When a team member is deactivated',
    'membership',
    [ROLE],
  ),
  firmEvent(
    'staff.reactivated',
    'STAFF_MANAGEMENT',
    'Team member reactivated',
    'When a deactivated team member is reactivated',
    'membership',
    [ROLE],
  ),
  firmEvent(
    'integration.connected',
    'INTEGRATIONS',
    'Connection established',
    'When the firm connects a provider',
    'integration_connection',
    [PROVIDER],
  ),
  firmEvent(
    'integration.reconnected',
    'INTEGRATIONS',
    'Connection recovered',
    'When the firm reconnects a provider',
    'integration_connection',
    [PROVIDER],
  ),
  firmEvent(
    'integration.disconnected',
    'INTEGRATIONS',
    'Connection disconnected',
    'When the firm disconnects a provider',
    'integration_connection',
    [PROVIDER],
  ),
  firmEvent(
    'integration.sync_completed',
    'INTEGRATIONS',
    'Sync completed',
    'When a sync with a provider finishes, in full or in part',
    'integration_connection',
    [PROVIDER, statuses('syncStatus', 'Result', ['SUCCEEDED', 'PARTIAL'])],
  ),
  firmEvent(
    'integration.sync_failed',
    'INTEGRATIONS',
    'Sync failed',
    'When a sync with a provider fails',
    'integration_connection',
    [PROVIDER],
  ),
  firmEvent(
    'integration.reauthorization_needed',
    'INTEGRATIONS',
    'Reauthentication required',
    'When a sync fails because the provider’s authorization expired, was revoked or lacks a permission',
    'integration_connection',
    [PROVIDER],
  ),
  firmEvent(
    'communication.draft_created',
    'COMMUNICATIONS',
    'Communication draft created',
    'When someone creates an email, text or announcement draft',
    'communication',
    [CHANNEL],
  ),
  firmEvent(
    'communication.scheduled',
    'COMMUNICATIONS',
    'Communication scheduled',
    'When a communication is scheduled to send',
    'communication',
    [CHANNEL],
  ),
  firmEvent(
    'communication.sent',
    'COMMUNICATIONS',
    'Communication sent or announcement published',
    'When a campaign starts sending or an announcement is published',
    'communication',
    [CHANNEL],
  ),
  firmEvent(
    'communication.delivered',
    'COMMUNICATIONS',
    'Communication delivered',
    'When the last message of a campaign has gone out (some may have failed)',
    'communication',
    [CHANNEL],
  ),
  firmEvent(
    'communication.failed',
    'COMMUNICATIONS',
    'Communication failed',
    'When a scheduled send can’t start, or not one message of a campaign went out',
    'communication',
    [CHANNEL],
  ),
  firmEvent(
    'communication.announcement_expired',
    'COMMUNICATIONS',
    'Announcement expired',
    'When a published announcement stops showing',
    'communication',
    [CHANNEL],
  ),
  {
    code: 'invoice.overdue',
    module: 'INVOICES_PAYMENTS',
    label: 'Invoice overdue',
    example: 'When an open invoice is past its due date',
    recordKind: 'invoice',
    timings: ['IMMEDIATE', 'AFTER'],
    conditionFields: [
      CLIENT_TYPE,
      field('totalCents', 'Invoice total', 'MONEY'),
      field('daysOverdue', 'Days overdue', 'NUMBER'),
    ],
  },
  {
    code: 'deadline.approaching',
    module: 'COMPLIANCE_DEADLINES',
    label: 'Deadline approaching',
    example: 'When a client’s deadline is coming up',
    recordKind: 'deadline',
    timings: ['BEFORE'],
    conditionFields: [
      CLIENT_TYPE,
      field('deadlineType', 'Deadline type', 'STATUS', [
        'TAX_FILING',
        'ESTIMATED_TAX',
        'ELECTION',
        'BOOKKEEPING',
        'PAYROLL',
        'SALES_TAX',
        'STATE_FILING',
        'ANNUAL_REPORT',
        'LICENSE_PERMIT',
        'ADVISORY',
        'OTHER',
      ]),
      PRIORITY(),
    ],
  },
  {
    code: 'task.overdue',
    module: 'TASKS',
    label: 'Task overdue',
    example: 'When an open task is past its due date',
    recordKind: 'task',
    timings: ['IMMEDIATE', 'AFTER'],
    conditionFields: [CLIENT_TYPE, PRIORITY(), field('daysOverdue', 'Days overdue', 'NUMBER')],
  },
  {
    code: 'appointment.upcoming',
    module: 'APPOINTMENTS',
    label: 'Appointment coming up',
    example: 'When a scheduled appointment is about to start',
    recordKind: 'appointment',
    timings: ['BEFORE'],
    conditionFields: [
      CLIENT_TYPE,
      field('locationKind', 'Where', 'STATUS', ['IN_PERSON', 'PHONE', 'VIDEO']),
    ],
  },
];
/**
 * AU-F30 to F33: external outcomes a member may confirm by hand (Manual Event Confirmation, on in
 * Automation Settings). No verified integration sends them yet, so Integration verified is not
 * available. A confirmation only records the known fact: it never files, submits or pays.
 */
const confirmed = (
  code: string,
  module: AutomationEvent['module'],
  label: string,
  example: string,
  recordKind: string,
): EventDef => ({
  code,
  module,
  label,
  example,
  recordKind,
  timings: ['IMMEDIATE', 'AFTER'],
  conditionFields: [CLIENT_TYPE],
  confirmation: { integrationAvailable: false },
});
export const CONFIRMABLE_EVENTS: EventDef[] = [
  confirmed(
    'tax_return.accepted',
    'TAX_RETURNS',
    'Return accepted (confirmed)',
    'When someone confirms the tax authority accepted a return',
    'tax_return',
  ),
  confirmed(
    'tax_return.rejected',
    'TAX_RETURNS',
    'Return rejected (confirmed)',
    'When someone confirms the tax authority rejected a return',
    'tax_return',
  ),
  confirmed(
    'payroll.filing_confirmed',
    'PAYROLL',
    'Payroll filing confirmed',
    'When someone confirms a payroll run’s filing was received',
    'payroll_run',
  ),
  confirmed(
    'deadline.filing_confirmed',
    'COMPLIANCE_DEADLINES',
    'Deadline filing confirmed',
    'When someone confirms the filing for a deadline was received',
    'deadline',
  ),
];

/**
 * AU-F22: what a client's or a lead's record carries for conditions: its tags (by id) and its
 * assigned member (by user id). The choices are the firm's own live tags and active members,
 * filled in when the firm's catalog is served (`firmCatalog`); a value that is no longer one of
 * them simply never matches.
 */
export const TAGS_FIELD = field('tags', 'Tags', 'LIST');
export const ASSIGNEE_FIELD = field('assignedUserId', 'Assigned staff', 'STATUS');
const PEOPLE_FIELDS = (recordKind: string) =>
  recordKind === 'client' || recordKind === 'lead' ? [TAGS_FIELD, ASSIGNEE_FIELD] : [];

export const EVENTS: AutomationEvent[] = [...EVENT_DEFS, ...CONFIRMABLE_EVENTS].map((e) => ({
  ...e,
  conditionFields: [...e.conditionFields, ...PEOPLE_FIELDS(e.recordKind)],
  anchor: ANCHORS[e.code] ?? (e.confirmation ? 'it is confirmed' : 'it happens'),
  confirmation: e.confirmation ?? null,
  hasClient: e.hasClient ?? true,
}));
export const eventOf = (code: string) => EVENTS.find((e) => e.code === code);

export const VARIABLES = [
  { key: 'client.name', label: 'Client name' },
  { key: 'client.firstName', label: 'Client first name' },
  { key: 'firm.name', label: 'Firm name' },
  { key: 'record.label', label: 'The record (invoice number, task title...)' },
  { key: 'date.today', label: 'Today’s date' },
];
export const VARIABLE_KEYS = new Set(VARIABLES.map((v) => v.key));

export const ACTIONS: AutomationActionTypeInfo[] = [
  {
    type: 'CREATE_TASK',
    module: 'TASKS',
    label: 'Create task',
    description: 'Makes a task for the client, through the Tasks module.',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'title',
        label: 'Task title',
        type: 'TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: 'Merge fields like {{client.name}} are filled in.',
      },
      {
        key: 'details',
        label: 'Details',
        type: 'LONG_TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'priority',
        label: 'Priority',
        type: 'SELECT',
        required: false,
        choices: options(['LOW', 'MEDIUM', 'HIGH']),
        templateKind: null,
        help: null,
      },
      {
        key: 'dueInDays',
        label: 'Due in (days)',
        type: 'NUMBER',
        required: false,
        choices: [],
        templateKind: null,
        help: 'From the day the action runs.',
      },
      {
        key: 'assigneeUserId',
        label: 'Assign to',
        type: 'MEMBER',
        required: false,
        choices: [],
        templateKind: null,
        help: 'A member of the firm; left empty, the client’s own assignee.',
      },
    ],
  },
  {
    type: 'SEND_CLIENT_MESSAGE',
    module: 'COMMUNICATIONS',
    label: 'Send client message',
    description:
      'Sends a portal message to the client (with the portal’s own notice), through the Messages module.',
    requiresIntegration: null,
    contactsClient: true,
    needsClient: true,
    fields: [
      {
        key: 'templateId',
        label: 'Message template',
        type: 'TEMPLATE',
        required: false,
        choices: [],
        templateKind: 'PORTAL_MESSAGE',
        help: 'An active template offered to Automations; or write the message below.',
      },
      {
        key: 'subject',
        label: 'Subject',
        type: 'TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'body',
        label: 'Message',
        type: 'LONG_TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: 'Merge fields like {{client.firstName}} are filled in.',
      },
    ],
  },
  {
    type: 'SEND_CLIENT_EMAIL',
    module: 'COMMUNICATIONS',
    label: 'Send client email',
    description:
      'Emails the client through Messages, with its recipient and consent checks, the firm’s Messages settings and its delivery log (AU-F25).',
    requiresIntegration: null,
    contactsClient: true,
    needsClient: true,
    fields: [
      {
        key: 'templateId',
        label: 'Email template',
        type: 'TEMPLATE',
        required: false,
        choices: [],
        templateKind: 'EMAIL',
        help: 'An active email template offered to Automations (a welcome email, say); or write the email below.',
      },
      {
        key: 'subject',
        label: 'Subject',
        type: 'TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'body',
        label: 'Email',
        type: 'LONG_TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: 'Merge fields like {{client.firstName}} are filled in.',
      },
    ],
  },
  {
    type: 'REQUEST_DOCUMENTS',
    module: 'DOCUMENTS',
    label: 'Request documents',
    description:
      'Asks the client for a document through Documents, under their oldest open service of the kind you choose (AU-F27).',
    requiresIntegration: null,
    contactsClient: true,
    needsClient: true,
    fields: [
      {
        key: 'serviceKind',
        label: 'Service',
        type: 'SELECT',
        required: true,
        choices: options([
          'ANNUAL_TAX',
          'QUARTERLY_TAX',
          'BOOKKEEPING',
          'PAYROLL',
          'TAX_PLANNING',
          'BUSINESS_DEVELOPMENT',
          'OTHER',
        ]),
        templateKind: null,
        help: 'The client’s oldest open service of this kind. With none open, nothing is requested and the step fails.',
      },
      {
        key: 'title',
        label: 'Document needed',
        type: 'TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: 'What the client sees, for example “Your W-2 for {{date.today}}”.',
      },
      {
        key: 'instructions',
        label: 'Instructions',
        type: 'LONG_TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'categoryId',
        label: 'Category',
        type: 'DOCUMENT_CATEGORY',
        required: false,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'dueInDays',
        label: 'Due in (days)',
        type: 'NUMBER',
        required: false,
        choices: [],
        templateKind: null,
        help: 'From the day the action runs.',
      },
    ],
  },
  {
    type: 'ASSIGN_CLIENT',
    module: 'CLIENTS',
    label: 'Assign client',
    description:
      'Makes a member of your firm the client’s assigned member; their open tasks move along, as in Clients (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'assigneeUserId',
        label: 'Assign to',
        type: 'MEMBER',
        required: true,
        choices: [],
        templateKind: null,
        help: 'An active member of your firm. A rule owned by a Staff member can’t reassign.',
      },
    ],
  },
  {
    type: 'ADD_CLIENT_TAGS',
    module: 'CLIENTS',
    label: 'Add client tags',
    description: 'Adds your firm’s tags to the client (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'tagIds',
        label: 'Tags',
        type: 'TAGS',
        required: true,
        choices: [],
        templateKind: null,
        help: 'Your firm’s tags. A tag archived later fails the step.',
      },
    ],
  },
  {
    type: 'REMOVE_CLIENT_TAGS',
    module: 'CLIENTS',
    label: 'Remove client tags',
    description: 'Removes those tags from the client (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'tagIds',
        label: 'Tags',
        type: 'TAGS',
        required: true,
        choices: [],
        templateKind: null,
        help: 'Your firm’s tags. A tag archived later fails the step.',
      },
    ],
  },
  {
    type: 'ADD_CLIENT_NOTE',
    module: 'CLIENTS',
    label: 'Add client note',
    description: 'Adds an internal note to the client’s record.',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'body',
        label: 'Note',
        type: 'LONG_TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: null,
      },
    ],
  },
  {
    type: 'NOTIFY_STAFF',
    module: 'COMMUNICATIONS',
    label: 'Notify staff',
    description:
      'Puts a notice in the bell of members of your firm (no email or text). It names the rule and the client, and opens the run (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: false,
    fields: [
      {
        key: 'memberUserIds',
        label: 'Notify',
        type: 'MEMBERS',
        required: false,
        choices: [],
        templateKind: null,
        help: 'Left empty: the client’s assigned member and the Owners and Admins (only the Owners and Admins when there is no client). A member who can’t see the client is skipped.',
      },
    ],
  },
];
export const actionOf = (type: string) => ACTIONS.find((a) => a.type === type);
