import { US_STATES } from '@firmivra/types';
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
  TEXT: ['IS', 'IS_NOT', 'CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS'],
  NUMBER: ['IS', 'GREATER_THAN', 'LESS_THAN', 'EXISTS'],
  MONEY: ['IS', 'GREATER_THAN', 'LESS_THAN', 'EXISTS'],
  DATE: ['BEFORE', 'AFTER', 'ON', 'WITHIN_LAST', 'WITHIN_NEXT', 'EXISTS', 'NOT_EXISTS'],
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
/**
 * AU-F27 Update allowed field (the lead, Nov 7): the client fields a rule may set. Never Inactive,
 * which stays behind APPROVE; name, email, phone, account type and the tax-year status stay out.
 */
export const RULE_CLIENT_STATUSES = [
  'NEW',
  'PENDING_DOCUMENTS',
  'IN_PROGRESS',
  'ACTIVE',
  'ON_HOLD',
] as const;
export const RULE_CLIENT_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
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
// AU-F22: the record's own service, due date and dates (the firm's days).
const SERVICE_KIND = statuses('serviceKind', 'Service', [
  'ANNUAL_TAX',
  'QUARTERLY_TAX',
  'BOOKKEEPING',
  'PAYROLL',
  'TAX_PLANNING',
  'BUSINESS_DEVELOPMENT',
  'OTHER',
]);
const DUE_ON = field('dueOn', 'Due date', 'DATE');
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
  // AU-F08 Client Status Changed (old/new): Update client status (AU-F27) is what changes it.
  change(
    'client.status_changed',
    'CLIENTS',
    'Client status changed',
    'When a client’s status changes, for example from New to In progress',
    'client',
    move(CLIENT_STATUS.options.map((o) => o.value)),
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
    [CLIENT_TYPE, INTAKE_STATUS, SERVICE_KIND],
  ),
  change(
    'intake.submitted',
    'INTAKE_FORMS',
    'Intake form submitted',
    'When a client submits a form for the first time',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS, SERVICE_KIND],
  ),
  change(
    'intake.returned',
    'INTAKE_FORMS',
    'Intake form returned for corrections',
    'When your team asks the client to correct a form',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS, SERVICE_KIND],
  ),
  change(
    'intake.resubmitted',
    'INTAKE_FORMS',
    'Intake form resubmitted',
    'When a client sends a corrected form (a new version)',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS, SERVICE_KIND],
  ),
  change(
    'intake.approved',
    'INTAKE_FORMS',
    'Intake form approved',
    'When your team marks a form reviewed',
    'intake',
    [CLIENT_TYPE, INTAKE_STATUS, SERVICE_KIND],
  ),
  {
    code: 'intake.due',
    module: 'INTAKE_FORMS',
    label: 'Intake form due or overdue',
    example: 'When a form the client hasn’t finished is coming due or is past due',
    recordKind: 'intake',
    timings: ['BEFORE', 'AFTER'],
    conditionFields: [CLIENT_TYPE, INTAKE_STATUS, SERVICE_KIND, DUE_ON],
  },
  // ---------- Documents (AU-F11) ----------
  change(
    'document.requested',
    'DOCUMENTS',
    'Documents requested',
    'When a document request is sent to a client',
    'document_request',
    [CLIENT_TYPE, SERVICE_KIND],
  ),
  {
    code: 'document.request_due',
    module: 'DOCUMENTS',
    label: 'Requested documents due or overdue',
    example: 'When an open document request is coming due or is past due',
    recordKind: 'document_request',
    timings: ['BEFORE', 'AFTER'],
    conditionFields: [CLIENT_TYPE, SERVICE_KIND, DUE_ON],
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
    [CLIENT_TYPE, SERVICE_KIND],
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
    conditionFields: [...RETURN_FIELDS, DUE_ON],
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
      // What is still owed (the total less what was paid, online or offline), and whether any was.
      field('balanceCents', 'Balance due', 'MONEY'),
      statuses('paymentStatus', 'Payment status', ['UNPAID', 'PARTLY_PAID']),
      field('daysOverdue', 'Days overdue', 'NUMBER'),
      DUE_ON,
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
      statuses('deadlineStatus', 'Deadline status', [
        'UPCOMING',
        'IN_PROGRESS',
        'WAITING_ON_CLIENT',
      ]),
      statuses('jurisdiction', 'Jurisdiction', ['FEDERAL', 'STATE', 'LOCAL', 'INTERNAL']),
      field('taxYear', 'Tax year', 'NUMBER'),
      DUE_ON,
    ],
  },
  {
    code: 'task.overdue',
    module: 'TASKS',
    label: 'Task overdue',
    example: 'When an open task is past its due date',
    recordKind: 'task',
    timings: ['IMMEDIATE', 'AFTER'],
    conditionFields: [
      CLIENT_TYPE,
      PRIORITY(),
      field('daysOverdue', 'Days overdue', 'NUMBER'),
      statuses('taskProgress', 'Task progress', [
        'NOT_STARTED',
        'PENDING',
        'IN_PROGRESS',
        'WAITING',
        'BLOCKED',
      ]),
      field('taskAssignedUserId', 'Task assignee', 'STATUS'),
      DUE_ON,
    ],
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
      // The firm's own appointment types (filled in per firm, as tags and members are).
      field('appointmentTypeId', 'Appointment type', 'STATUS'),
      // Pending until someone confirms it: a pending appointment never reads as confirmed.
      statuses('confirmation', 'Confirmation', ['PENDING', 'CONFIRMED']),
      SERVICE_KIND,
      field('startsOn', 'Appointment date', 'DATE'),
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

/**
 * AU-F22: the client's own context on every event about one client's record (a task, an invoice,
 * a form, a return...), read from the client when the event is loaded (matching.ts). A client's
 * own events already have its status, tags and assignee, so they take only the state and dates.
 * The dates are the firm's days; "last activity" is the client's recorded activity, not a contact.
 * Members, tags and the firm's appointment types are the firm's own choices (`firmCatalog`).
 */
export const CLIENT_TAGS_FIELD = field('clientTags', 'Client tags', 'LIST');
export const MEMBER_FIELDS = ['assignedUserId', 'clientAssignedUserId', 'taskAssignedUserId'];
const CLIENT_DATES: AutomationConditionField[] = [
  {
    field: 'clientState',
    label: 'Client state',
    type: 'STATUS',
    operators: OPERATORS.STATUS,
    options: Object.entries(US_STATES).map(([value, label]) => ({ value, label })),
  },
  field('clientCreatedOn', 'Client added on', 'DATE'),
  field('clientLastActivityOn', 'Client’s last activity', 'DATE'),
];
const CLIENT_CONTEXT = (e: EventDef): AutomationConditionField[] => {
  if (e.hasClient === false || e.recordKind === 'lead') return [];
  if (e.recordKind === 'client') return CLIENT_DATES;
  return [
    { ...CLIENT_STATUS, field: 'clientStatus' },
    CLIENT_TAGS_FIELD,
    field('clientAssignedUserId', 'Client’s assigned staff', 'STATUS'),
    ...CLIENT_DATES,
  ];
};

export const EVENTS: AutomationEvent[] = [...EVENT_DEFS, ...CONFIRMABLE_EVENTS].map((e) => ({
  ...e,
  conditionFields: [...e.conditionFields, ...PEOPLE_FIELDS(e.recordKind), ...CLIENT_CONTEXT(e)],
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
      {
        key: 'taskTemplateId',
        label: 'Task template',
        type: 'TASK_TEMPLATE',
        required: false,
        choices: [],
        templateKind: null,
        help: 'One of your task templates: it fills in what you leave out here.',
      },
      {
        key: 'clientVisible',
        label: 'Visible to client',
        type: 'TOGGLE',
        required: false,
        choices: [],
        templateKind: null,
        help: 'The client sees the task in their portal.',
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
    type: 'SEND_CLIENT_SMS',
    module: 'COMMUNICATIONS',
    label: 'Send client text message',
    description:
      'Texts the client through Messages, with its consent, opt-in and provider checks and its delivery log. With texting off or not set up, nothing is sent and the step says why (AU-F26).',
    requiresIntegration: null,
    contactsClient: true,
    needsClient: true,
    fields: [
      {
        key: 'body',
        label: 'Text message',
        type: 'LONG_TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: 'Up to 1,600 characters. Merge fields like {{client.firstName}} are filled in.',
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
    type: 'SEND_INTAKE',
    module: 'INTAKE_FORMS',
    label: 'Send intake form',
    description:
      'Sends the client one of your published intake forms through Intake Forms, under their open service for that form (AU-F27).',
    requiresIntegration: null,
    contactsClient: true,
    needsClient: true,
    fields: [
      {
        key: 'formId',
        label: 'Intake form',
        type: 'INTAKE_FORM',
        required: true,
        choices: [],
        templateKind: null,
        help: 'A form with a published version. The client needs an open service for the form’s service.',
      },
      {
        key: 'channel',
        label: 'Send by',
        type: 'SELECT',
        required: true,
        choices: options(['PORTAL', 'EMAIL']),
        templateKind: null,
        help: null,
      },
      {
        key: 'subject',
        label: 'Subject',
        type: 'TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'message',
        label: 'Message',
        type: 'LONG_TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: 'Up to 500 characters. Merge fields like {{client.firstName}} are filled in.',
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
    type: 'UPDATE_CLIENT_STATUS',
    module: 'CLIENTS',
    label: 'Update client status',
    description:
      'Sets the client’s status, as Clients records it, from an allowed list; a rule never sets Inactive (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'status',
        label: 'New status',
        type: 'SELECT',
        required: true,
        choices: options([...RULE_CLIENT_STATUSES]),
        templateKind: null,
        help: 'Inactive needs an approval, so a rule can’t set it.',
      },
    ],
  },
  {
    type: 'UPDATE_CLIENT_PRIORITY',
    module: 'CLIENTS',
    label: 'Update client priority',
    description: 'Sets or clears the client’s priority (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'priority',
        label: 'Priority',
        type: 'SELECT',
        required: true,
        choices: options([...RULE_CLIENT_PRIORITIES, 'NONE']),
        templateKind: null,
        help: 'None clears it.',
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
    type: 'CREATE_DEADLINE',
    module: 'COMPLIANCE_DEADLINES',
    label: 'Create deadline',
    description:
      'Adds a deadline for the client through Compliance & Deadlines, due a set number of days after the action runs (AU-F26).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'name',
        label: 'Deadline name',
        type: 'TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: 'Merge fields like {{client.name}} are filled in.',
      },
      {
        key: 'deadlineType',
        label: 'Type',
        type: 'SELECT',
        required: true,
        choices: options([
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
        templateKind: null,
        help: null,
      },
      {
        key: 'dueInDays',
        label: 'Due in (days)',
        type: 'NUMBER',
        required: true,
        choices: [],
        templateKind: null,
        help: 'From the day the action runs.',
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
        key: 'clientVisible',
        label: 'Visible to client',
        type: 'TOGGLE',
        required: false,
        choices: [],
        templateKind: null,
        help: null,
      },
    ],
  },
  {
    type: 'ADD_SERVICE',
    module: 'CLIENTS',
    label: 'Add service',
    description:
      'Adds one of your services to the client through Engagements. It starts no billing, and a client who already has it open gets nothing new (AU-F26).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: true,
    fields: [
      {
        key: 'serviceId',
        label: 'Service',
        type: 'SERVICE',
        required: true,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'title',
        label: 'Title',
        type: 'TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: 'Left empty: the service’s name.',
      },
    ],
  },
  // AU-F27 Create Follow Up or Appointment Request: a request is never a booking.
  {
    type: 'INVITE_TO_BOOK',
    module: 'APPOINTMENTS',
    label: 'Invite client to book',
    description:
      'Sends the client a portal message with a link to book a time in their portal. Nothing is booked until the client picks a time (AU-F27).',
    requiresIntegration: null,
    contactsClient: true,
    needsClient: true,
    fields: [
      {
        key: 'subject',
        label: 'Subject',
        type: 'TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'message',
        label: 'Message',
        type: 'LONG_TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: 'The link to the client’s Appointments page is added below it. Merge fields like {{client.firstName}} are filled in.',
      },
    ],
  },
  {
    type: 'SCHEDULE_LEAD_FOLLOW_UP',
    module: 'LEADS',
    label: 'Schedule lead follow-up',
    description: 'Sets the lead’s next follow-up through Leads, for an open lead only (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: false,
    recordKind: 'lead',
    fields: [
      {
        key: 'followUpType',
        label: 'Follow-up',
        type: 'SELECT',
        required: true,
        choices: options(['CALL', 'EMAIL', 'SMS', 'APPOINTMENT', 'SEND_DOCUMENTS', 'FOLLOW_UP']),
        templateKind: null,
        help: null,
      },
      {
        key: 'dueInDays',
        label: 'Due in (days)',
        type: 'NUMBER',
        required: true,
        choices: [],
        templateKind: null,
        help: 'From the moment the action runs.',
      },
      {
        key: 'notes',
        label: 'Note',
        type: 'LONG_TEXT',
        required: false,
        choices: [],
        templateKind: null,
        help: 'Up to 500 characters.',
      },
    ],
  },
  {
    type: 'REQUEST_APPROVAL',
    module: 'TAX_RETURNS',
    label: 'Request approval',
    description:
      'Adds a pending review step to the tax return for a reviewer. Automations never decides it, and nobody approves their own request or return (AU-F27).',
    requiresIntegration: null,
    contactsClient: false,
    needsClient: false,
    recordKind: 'tax_return',
    fields: [
      {
        key: 'step',
        label: 'Step',
        type: 'TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: 'For example “Final Review / Approval”.',
      },
      {
        key: 'reviewerUserId',
        label: 'Reviewer',
        type: 'MEMBER',
        required: true,
        choices: [],
        templateKind: null,
        help: 'Not the rule’s owner, and not the return’s preparer.',
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
