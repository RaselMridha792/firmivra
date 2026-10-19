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
