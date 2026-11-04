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

/**
 * AU-F08 to F11: an event that is a change the source module records (audit-events.ts): it runs
 * once for each change, right away or a set time after it.
 */
const change = (
  code: string,
  module: AutomationEvent['module'],
  label: string,
  example: string,
  recordKind: string,
  conditionFields: AutomationConditionField[],
): AutomationEvent => ({
  code,
  module,
  label,
  example,
  recordKind,
  timings: ['IMMEDIATE', 'AFTER'],
  conditionFields,
});
const PRIORITY = (key = 'priority') => field(key, 'Priority', 'STATUS', ['LOW', 'MEDIUM', 'HIGH']);

export const EVENTS: AutomationEvent[] = [
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
    type: 'ADD_CLIENT_NOTE',
    module: 'CLIENTS',
    label: 'Add client note',
    description: 'Adds an internal note to the client’s record.',
    requiresIntegration: null,
    contactsClient: false,
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
];
export const actionOf = (type: string) => ACTIONS.find((a) => a.type === type);
