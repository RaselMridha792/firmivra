import {
  ActivateAutomationRuleRequest,
  type AutomationActionLog,
  type AutomationActionTypeInfo,
  type AutomationCatalog,
  type AutomationCheck,
  type AutomationsClient,
  AutomationDefinition,
  type AutomationDefinitionView,
  type AutomationEvent,
  type AutomationPreview,
  type AutomationRuleDetail,
  AutomationRulesQuery,
  type AutomationRunDetail,
  type AutomationRunRow,
  AutomationRunsQuery,
  type AutomationSettingsView,
  type AutomationTemplateDetail,
  AutomationTemplatesQuery,
  ApiRequestError,
  CreateAutomationRuleRequest,
  CreateAutomationTemplateRequest,
  ExportAutomationLogsRequest,
  ImportAutomationTemplateRequest,
  type MemberRef,
  parseInput,
  PauseAutomationRuleRequest,
  PreviewAutomationRequest,
  RerunAutomationRequest,
  SaveAutomationDefinitionRequest,
  SaveAutomationSettingsRequest,
  SaveRuleAsTemplateRequest,
  TestAutomationRuleRequest,
  UpdateAutomationRuleRequest,
  UpdateAutomationTemplateRequest,
  UseAutomationTemplateRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { teamFixtures } from './team';

/**
 * Mock data for `api.automations` (R55 contract, Automations). Synthetic rules, clients and runs
 * only, dated around today. It checks input with the contract's schemas and answers its codes:
 * DUPLICATE_NAME, SAVE_CONFLICT, NOT_READY, RULE_ARCHIVED, INVALID_STATUS, INVALID_DEFINITION,
 * RERUN_NOT_ALLOWED, NOT_A_MEMBER, TEMPLATE_UNAVAILABLE. The match preview is counted, not
 * executed: no mock rule ever runs. `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=automations) starts
 * with no rules, templates or runs.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const DAY = 86_400_000;
const uuid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const nowIso = () => new Date().toISOString();
const ago = (days: number, hour = 9) => {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const KEVIN: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000001', name: 'Kevin Martin' };
const memberOf = (userId: string): MemberRef | undefined => {
  const known = [mockMe, KEVIN].find((m) => m.userId === userId);
  if (known) return known;
  const mate = teamFixtures().find((m) => m.user.id === userId);
  return mate ? { userId, name: mate.user.name } : undefined;
};

const MODULES: [AutomationCatalog['modules'][number]['module'], string, string][] = [
  ['CLIENTS', 'Clients', '/clients'],
  ['LEADS', 'Leads', '/leads'],
  ['APPOINTMENTS', 'Appointments', '/calendar'],
  ['INTAKE_FORMS', 'Intake Forms', '/intake-forms'],
  ['DOCUMENTS', 'Documents', '/documents'],
  ['TAX_RETURNS', 'Tax Returns', '/modules/tax-returns'],
  ['BOOKKEEPING', 'Bookkeeping', '/modules/bookkeeping'],
  ['PAYROLL', 'Payroll', '/payroll'],
  ['TAX_PLANNING', 'Tax Planning', '/modules/tax-planning'],
  ['BUSINESS_ADVISORY', 'Business Advisory', '/modules/business-advisory'],
  ['INVOICES_PAYMENTS', 'Invoices & Payments', '/invoices'],
  ['COMMUNICATIONS', 'Communications', '/modules/communications'],
  ['TASKS', 'Tasks', '/tasks'],
  ['COMPLIANCE_DEADLINES', 'Compliance & Deadlines', '/compliance'],
  ['STAFF_MANAGEMENT', 'Staff Management', '/team'],
  ['INTEGRATIONS', 'Integrations', '/modules/integrations'],
  ['CUSTOM', 'Custom Rules', '/automations'],
];

const COND = (
  field: string,
  label: string,
  type: 'STATUS' | 'TEXT' | 'MONEY',
  options: [string, string][] = [],
) => ({
  field,
  label,
  type,
  operators:
    type === 'MONEY'
      ? [...(['GREATER_THAN', 'LESS_THAN', 'IS'] as const)]
      : [...(['IS', 'IS_NOT', 'INCLUDES', 'EXCLUDES'] as const)],
  options: options.map(([value, l]) => ({ value, label: l })),
});
const clientFields = () => [
  COND('clientType', 'Client Type', 'STATUS', [
    ['BUSINESS', 'Business Client'],
    ['INDIVIDUAL', 'Individual Client'],
  ]),
  COND('entityType', 'Entity Type', 'STATUS', [
    ['LLC_SINGLE', 'LLC (Single-Member)'],
    ['LLC_MULTI', 'LLC (Multi-Member)'],
    ['S_CORP', 'S Corporation'],
    ['PARTNERSHIP', 'Partnership'],
  ]),
  COND('service', 'Service', 'STATUS', [
    ['TAX_PREP', 'Tax Preparation'],
    ['BOOKKEEPING', 'Bookkeeping'],
    ['PAYROLL', 'Payroll'],
  ]),
  COND('state', 'State', 'STATUS', [
    ['GA', 'Georgia'],
    ['NC', 'North Carolina'],
    ['FL', 'Florida'],
  ]),
];

/** [code, module, label, example, phrase after an offset, timings, extra fields]. */
const buildEvents = (): [
  string,
  AutomationEvent['module'],
  string,
  string,
  string,
  AutomationEvent['timings'],
  ReturnType<typeof COND>[],
][] => [
  [
    'compliance.deadline_approaching',
    'COMPLIANCE_DEADLINES',
    'Deadline Approaching',
    'If a client’s estimated tax payment is due April 15, this rule will run before it.',
    'due date',
    ['BEFORE', 'AFTER'],
    [
      COND('deadlineType', 'Deadline Type', 'STATUS', [
        ['TAX_FILING', 'Tax Filing'],
        ['ESTIMATED_TAX', 'Estimated Tax'],
        ['ANNUAL_REPORT', 'Annual Report'],
      ]),
    ],
  ],
  [
    'compliance.deadline_overdue',
    'COMPLIANCE_DEADLINES',
    'Deadline Overdue',
    'When a deadline passes without being completed.',
    'due date has passed',
    ['IMMEDIATE'],
    [],
  ],
  [
    'clients.client_created',
    'CLIENTS',
    'Client Added',
    'When a new client is added.',
    'client added',
    ['IMMEDIATE', 'AFTER'],
    [],
  ],
  [
    'leads.lead_created',
    'LEADS',
    'New Lead',
    'When a lead comes in.',
    'lead created',
    ['IMMEDIATE', 'AFTER'],
    [],
  ],
  [
    'appointments.appointment_upcoming',
    'APPOINTMENTS',
    'Appointment Upcoming',
    'Before a booked appointment.',
    'appointment',
    ['BEFORE'],
    [],
  ],
  [
    'appointments.appointment_missed',
    'APPOINTMENTS',
    'Appointment Missed',
    'When a client does not show up.',
    'missed appointment',
    ['IMMEDIATE', 'AFTER'],
    [],
  ],
  [
    'intake_forms.form_submitted',
    'INTAKE_FORMS',
    'Form Submitted',
    'When a client submits an intake form.',
    'form submitted',
    ['IMMEDIATE'],
    [],
  ],
  [
    'documents.document_uploaded',
    'DOCUMENTS',
    'Document Uploaded',
    'When a client uploads a document.',
    'document uploaded',
    ['IMMEDIATE'],
    [],
  ],
  [
    'tax_returns.status_changed',
    'TAX_RETURNS',
    'Return Status Changed',
    'When a return moves to a new status.',
    'status change',
    ['IMMEDIATE'],
    [
      COND('returnStatus', 'Return Status', 'STATUS', [
        ['READY', 'Ready for Review'],
        ['FILED', 'Filed'],
      ]),
    ],
  ],
  [
    'invoices.invoice_overdue',
    'INVOICES_PAYMENTS',
    'Invoice Overdue',
    'When an invoice is past its due date.',
    'invoice due date',
    ['AFTER'],
    [COND('balance', 'Balance Due', 'MONEY')],
  ],
  [
    'invoices.payment_received',
    'INVOICES_PAYMENTS',
    'Payment Received',
    'When a payment arrives.',
    'payment',
    ['IMMEDIATE'],
    [],
  ],
  [
    'payroll.run_completed',
    'PAYROLL',
    'Payroll Run Completed',
    'When a payroll run is completed.',
    'payroll run',
    ['IMMEDIATE'],
    [],
  ],
  [
    'bookkeeping.month_closed',
    'BOOKKEEPING',
    'Month Closed',
    'When a month of books is closed.',
    'month close',
    ['IMMEDIATE', 'AFTER'],
    [],
  ],
  [
    'tasks.task_overdue',
    'TASKS',
    'Task Overdue',
    'When a task passes its due date.',
    'task due date',
    ['AFTER'],
    [],
  ],
  [
    'staff_management.member_added',
    'STAFF_MANAGEMENT',
    'Team Member Added',
    'When someone joins the team.',
    'team member added',
    ['IMMEDIATE'],
    [],
  ],
  [
    'custom.scheduled_check',
    'CUSTOM',
    'Scheduled Check',
    'On a schedule you set.',
    'scheduled time',
    ['SCHEDULED'],
    [],
  ],
];
let eventCache: ReturnType<typeof buildEvents> | undefined;
const events = () => (eventCache ??= buildEvents());
const phraseOf = (code: string) => events().find((e) => e[0] === code)?.[4] ?? 'event';
const labelOf = (code: string) => events().find((e) => e[0] === code)?.[2] ?? code;

const ACTIONS: AutomationActionTypeInfo[] = [
  {
    type: 'CREATE_TASK',
    module: 'TASKS',
    label: 'Create a task',
    description: 'Creates a task in Tasks, from a template if you pick one.',
    contactsClient: false,
    requiresIntegration: null,
    fields: [
      {
        key: 'templateId',
        label: 'Task Template',
        type: 'TEMPLATE',
        required: false,
        choices: [],
        templateKind: 'TASK',
        help: null,
      },
      {
        key: 'assignee',
        label: 'Assign To',
        type: 'MEMBER',
        required: false,
        choices: [],
        templateKind: null,
        help: null,
      },
      {
        key: 'dueRule',
        label: 'Due Date',
        type: 'DATE_RULE',
        required: false,
        choices: [
          { value: 'SAME_DAY', label: 'Same day' },
          { value: 'PLUS_3', label: '3 days later' },
          { value: 'PLUS_7', label: '7 days later' },
        ],
        templateKind: null,
        help: null,
      },
    ],
  },
  {
    type: 'SEND_EMAIL',
    module: 'COMMUNICATIONS',
    label: 'Send client email',
    description: 'Sends an approved email template to the client.',
    contactsClient: true,
    requiresIntegration: null,
    fields: [
      {
        key: 'templateId',
        label: 'Email Template',
        type: 'TEMPLATE',
        required: true,
        choices: [],
        templateKind: 'EMAIL',
        help: 'Only active email templates that are included in automations.',
      },
    ],
  },
  {
    type: 'SEND_SMS',
    module: 'COMMUNICATIONS',
    label: 'Send SMS (optional)',
    description: 'Sends an approved text template to the client.',
    contactsClient: true,
    requiresIntegration: null,
    fields: [
      {
        key: 'templateId',
        label: 'SMS Template',
        type: 'TEMPLATE',
        required: true,
        choices: [],
        templateKind: 'SMS',
        help: null,
      },
    ],
  },
  {
    type: 'SEND_PORTAL_MESSAGE',
    module: 'COMMUNICATIONS',
    label: 'Send portal message',
    description: 'Posts a secure message in the client portal.',
    contactsClient: true,
    requiresIntegration: null,
    fields: [
      {
        key: 'templateId',
        label: 'Portal Message Template',
        type: 'TEMPLATE',
        required: true,
        choices: [],
        templateKind: 'PORTAL_MESSAGE',
        help: null,
      },
    ],
  },
  {
    type: 'NOTIFY_STAFF',
    module: 'STAFF_MANAGEMENT',
    label: 'Send internal notification',
    description: 'Tells a team member inside Firmivra.',
    contactsClient: false,
    requiresIntegration: null,
    fields: [
      {
        key: 'notify',
        label: 'Notify',
        type: 'SELECT',
        required: true,
        choices: [
          { value: 'ASSIGNED', label: 'Assigned team member' },
          { value: 'MANAGER', label: 'Manager' },
          { value: 'ALL', label: 'The whole team' },
        ],
        templateKind: null,
        help: null,
      },
    ],
  },
  {
    type: 'ATTACH_DOCUMENT',
    module: 'DOCUMENTS',
    label: 'Attach document (optional)',
    description: 'Attaches a resource to the message or task.',
    contactsClient: false,
    requiresIntegration: null,
    fields: [
      {
        key: 'templateId',
        label: 'Document Template',
        type: 'TEMPLATE',
        required: true,
        choices: [],
        templateKind: 'DOCUMENT_REQUEST',
        help: null,
      },
    ],
  },
  {
    type: 'UPDATE_STATUS',
    module: 'CLIENTS',
    label: 'Update status',
    description: 'Changes the status of the record.',
    contactsClient: false,
    requiresIntegration: null,
    fields: [
      {
        key: 'status',
        label: 'New Status',
        type: 'SELECT',
        required: true,
        choices: [
          { value: 'OVERDUE', label: 'Overdue' },
          { value: 'ACTION_REQUIRED', label: 'Action Required' },
          { value: 'ON_TRACK', label: 'On Track' },
        ],
        templateKind: null,
        help: null,
      },
    ],
  },
  {
    type: 'ADD_TAG',
    module: 'CLIENTS',
    label: 'Add a tag',
    description: 'Tags the client.',
    contactsClient: false,
    requiresIntegration: null,
    fields: [
      {
        key: 'tag',
        label: 'Tag',
        type: 'TEXT',
        required: true,
        choices: [],
        templateKind: null,
        help: null,
      },
    ],
  },
];
const VARIABLES = [
  { key: 'client.name', label: 'Client name' },
  { key: 'deadline.name', label: 'Deadline name' },
  { key: 'deadline.dueOn', label: 'Deadline due date' },
];

const buildCatalog = (): AutomationCatalog => ({
  modules: MODULES.map(([module, label, destination]) => ({ module, label, destination })),
  events: events().map(([code, module, label, example, , timings, extra]) => ({
    code,
    module,
    label,
    example,
    recordKind: module === 'COMPLIANCE_DEADLINES' ? 'deadline' : module.toLowerCase(),
    timings,
    conditionFields: [...clientFields(), ...extra],
  })),
  actions: ACTIONS,
  variables: VARIABLES,
});
let catalogCache: AutomationCatalog | undefined;
const catalog = () => (catalogCache ??= buildCatalog());

type Def = ReturnType<typeof parseInput<typeof AutomationDefinition>>;
const viewOf = (d: Def): AutomationDefinitionView => ({
  trigger: {
    module: d.trigger.module,
    event: d.trigger.event,
    timing: d.trigger.timing,
    offsetValue: d.trigger.offsetValue ?? null,
    offsetUnit: d.trigger.offsetUnit ?? null,
  },
  matchMode: d.matchMode,
  conditions: d.conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: c.value ?? null,
  })),
  actions: d.actions.map((a) => ({
    id: a.id,
    type: a.type,
    config: a.config,
    delayMinutes: a.delayMinutes,
    dependsOn: a.dependsOn ?? null,
  })),
  settings: {
    preventDuplicatesDays: d.settings.preventDuplicatesDays ?? 7,
    logAll: d.settings.logAll,
    notifyOnFailureUserIds: d.settings.notifyOnFailureUserIds,
    addToCalendar: d.settings.addToCalendar,
    quietHours: d.settings.quietHours ?? null,
    safetyThreshold: d.settings.safetyThreshold ?? null,
  },
});
const unit = (n: number, u: string) => `${n} ${u.toLowerCase()}${n === 1 ? '' : 's'}`;
const triggerText = (t: AutomationDefinitionView['trigger']) =>
  t.timing === 'BEFORE' && t.offsetValue !== null
    ? `${unit(t.offsetValue, t.offsetUnit ?? 'DAY')} before ${phraseOf(t.event)}`
    : t.timing === 'AFTER' && t.offsetValue !== null
      ? `${unit(t.offsetValue, t.offsetUnit ?? 'DAY')} after ${phraseOf(t.event)}`
      : t.timing === 'SCHEDULED'
        ? labelOf(t.event)
        : labelOf(t.event);
const actionLabel = (type: string) =>
  ACTIONS.find((a) => a.type === type)?.label.replace(' (optional)', '') ?? type;
const actionsText = (v: AutomationDefinitionView) =>
  v.actions.map((a) => actionLabel(a.type)).join(' & ') || '—';
const appliesText = (v: AutomationDefinitionView) => {
  if (v.conditions.length === 0) return 'All clients';
  return v.conditions
    .map((c) => {
      const f = clientFields().find((x) => x.field === c.field);
      const val = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
      const opt = f?.options.find((o) => o.value === val)?.label;
      return `${f?.label ?? c.field}: ${opt ?? val}`;
    })
    .join(v.matchMode === 'ANY' ? ' or ' : ', ');
};

interface Rec {
  detail: AutomationRuleDetail;
  defs: Map<number, AutomationDefinitionView>;
  runCounts: Map<number, number>;
}
interface Starter {
  id: string;
  d: AutomationTemplateDetail;
}

const CLIENT_NAMES = [
  'Taylor Construction LLC',
  'SL Beauty Studio',
  'Green Leaf Events',
  'Pure Balance Wellness',
  'KM Logistics',
  'Nova Creations',
  'Wright & Co.',
  'Johnson Family',
  'Urban Eats LLC',
  'Diaz, Maria',
];

export function createAutomationsMock({
  role = 'OWNER',
  empty = false,
}: Options = {}): AutomationsClient {
  let next = 1000;
  const id = (block: string) => uuid(block, next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const rules: Rec[] = [];
  const templates: Starter[] = [];
  const runs: AutomationRunDetail[] = [];
  let settings: AutomationSettingsView = {
    quietHours: { start: '20:00', end: '07:00' },
    defaultDedupeDays: 7,
    maxDepth: 3,
    safetyThreshold: 500,
    failureAlertUsers: [mockMe],
    minutesSavedPerAction: 5,
    logRetentionDays: 365,
    timezone: 'America/New_York',
    updatedAt: null,
  };

  const matchCount = (v: AutomationDefinitionView) =>
    v.conditions.length === 0 ? 48 : Math.floor(48 / 2 ** v.conditions.length);
  const checksOf = (v: AutomationDefinitionView): AutomationCheck[] => {
    const out: AutomationCheck[] = [];
    v.actions.forEach((a, i) => {
      const info = ACTIONS.find((x) => x.type === a.type);
      if (!info) {
        out.push({
          code: 'INVALID_ACTION_CONFIG',
          severity: 'BLOCK',
          message: `Action ${i + 1} is not a known action.`,
          path: `actions.${i}`,
        });
        return;
      }
      for (const f of info.fields.filter((x) => x.required)) {
        const val = a.config[f.key];
        if (val === undefined || val === null || val === '') {
          out.push({
            code: f.type === 'TEMPLATE' ? 'MISSING_TEMPLATE' : 'INVALID_ACTION_CONFIG',
            severity: 'BLOCK',
            message: `${info.label}: choose ${f.label.toLowerCase()}.`,
            path: `actions.${i}.config.${f.key}`,
          });
        }
      }
    });
    const ev = events().find((e) => e[0] === v.trigger.event);
    if (!ev)
      out.push({
        code: 'MISSING_TRIGGER',
        severity: 'BLOCK',
        message: 'Choose what starts this automation.',
        path: 'trigger',
      });
    else if (!ev[5].includes(v.trigger.timing))
      out.push({
        code: 'MISSING_TRIGGER',
        severity: 'BLOCK',
        message: 'That timing is not available for this event.',
        path: 'trigger.timing',
      });
    for (const [i, c] of v.conditions.entries()) {
      if (c.value === null || c.value === '' || (Array.isArray(c.value) && c.value.length === 0)) {
        out.push({
          code: 'INVALID_CONDITION',
          severity: 'BLOCK',
          message: `Condition ${i + 1} needs a value.`,
          path: `conditions.${i}`,
        });
      }
    }
    const n = matchCount(v);
    if (n === 0)
      out.push({
        code: 'NO_MATCHES',
        severity: 'WARN',
        message: 'No record matches these conditions right now.',
        path: null,
      });
    if (n > (v.settings.safetyThreshold ?? settings.safetyThreshold))
      out.push({
        code: 'HIGH_VOLUME',
        severity: 'WARN',
        message: `${n} records match. That is above the safety threshold.`,
        path: null,
      });
    if (
      v.actions.some((a) => ACTIONS.find((x) => x.type === a.type)?.contactsClient) &&
      v.trigger.timing === 'IMMEDIATE' &&
      v.trigger.event.startsWith('clients.')
    ) {
      out.push({
        code: 'BAD_CONTACT_DATA',
        severity: 'WARN',
        message: 'A new client may not have an email address yet.',
        path: null,
      });
    }
    return out;
  };
  const rowFields = (r: Rec) => {
    const d = r.detail;
    const v = d.definition;
    d.triggerSummary = v ? triggerText(v.trigger) : '—';
    d.appliesTo = v ? appliesText(v) : '—';
    d.actionsSummary = v ? actionsText(v) : '—';
    d.activationBlockers = v
      ? checksOf(v)
          .filter((c) => c.severity === 'BLOCK')
          .map((c) => c.message)
      : ['The rule has no definition yet.'];
    d.canEdit = role !== 'STAFF' && d.status !== 'ARCHIVED';
    d.canActivate =
      role !== 'STAFF' && d.status !== 'ARCHIVED' && d.activationBlockers.length === 0;
    d.needsAttention = d.status === 'ACTIVE' && d.lastRunStatus === 'FAILED';
    d.archived = d.status === 'ARCHIVED';
    d.etag = `e${next++}`;
    d.updatedAt = nowIso();
  };
  const makeRule = (v: {
    name: string;
    description?: string | null;
    category: AutomationEvent['module'];
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
    status?: 'DRAFT' | 'ACTIVE' | 'PAUSED';
    def: Def;
    lastRun?: { days: number; status: AutomationRuleDetail['lastRunStatus'] };
    expiresOn?: string | null;
  }): Rec => {
    const view = viewOf(v.def);
    const at = nowIso();
    const detail: AutomationRuleDetail = {
      id: id('a100'),
      name: v.name,
      description: v.description ?? null,
      category: v.category,
      priority: v.priority ?? 'MEDIUM',
      status: v.status ?? 'DRAFT',
      owner: mockMe,
      triggerSummary: '',
      appliesTo: '',
      actionsSummary: '',
      currentVersion: 1,
      lastRunAt: v.lastRun ? ago(v.lastRun.days) : null,
      lastRunStatus: v.lastRun?.status ?? null,
      expiresOn: v.expiresOn ?? null,
      needsAttention: false,
      archived: false,
      updatedAt: at,
      definition: view,
      versions: [{ version: 1, createdBy: mockMe, createdAt: at, runCount: 0 }],
      stats: { runs: 0, succeeded: 0, failed: 0, skipped: 0 },
      activationBlockers: [],
      createdAt: at,
      canEdit: true,
      canActivate: true,
      etag: 'e0',
    };
    const r: Rec = { detail, defs: new Map([[1, view]]), runCounts: new Map() };
    rowFields(r);
    return r;
  };
  const def = (
    mod: AutomationEvent['module'],
    event: string,
    timing: 'IMMEDIATE' | 'BEFORE' | 'AFTER',
    value: number | null,
    conditions: { field: string; operator: 'IS'; value: string }[],
    actions: {
      type: string;
      config?: Record<string, string | number | boolean | string[] | null>;
    }[],
  ): Def =>
    parseInput(AutomationDefinition, {
      trigger: {
        module: mod,
        event,
        timing,
        ...(value !== null ? { offsetValue: value, offsetUnit: 'DAY' as const } : {}),
      },
      conditions,
      actions: actions.map((a, i) => ({
        id: `a${i + 1}`,
        type: a.type,
        config: a.config ?? {},
        delayMinutes: 0,
      })),
    });
  const T1 = uuid('7100', 1001);
  const seedRules = () => {
    const mk = (
      n: string,
      cat: AutomationEvent['module'],
      d: Def,
      status: 'ACTIVE' | 'DRAFT' | 'PAUSED',
      days: number,
      prio: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM',
      lastStatus: AutomationRuleDetail['lastRunStatus'] = 'SUCCESS',
    ) =>
      rules.push(
        makeRule({
          name: n,
          category: cat,
          def: d,
          status,
          priority: prio,
          lastRun: status === 'ACTIVE' ? { days, status: lastStatus } : undefined,
        }),
      );
    mk(
      'Create Task – 14 Days Before Deadline',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_approaching',
        'BEFORE',
        14,
        [],
        [{ type: 'CREATE_TASK', config: { dueRule: 'SAME_DAY' } }],
      ),
      'ACTIVE',
      17,
      'HIGH',
    );
    mk(
      'Client Reminder – 7 Days Before',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_approaching',
        'BEFORE',
        7,
        [],
        [{ type: 'SEND_EMAIL', config: { templateId: T1 } }],
      ),
      'ACTIVE',
      17,
    );
    mk(
      'Client Reminder – 1 Day Before',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_approaching',
        'BEFORE',
        1,
        [],
        [
          { type: 'SEND_EMAIL', config: { templateId: T1 } },
          { type: 'SEND_SMS', config: { templateId: T1 } },
        ],
      ),
      'ACTIVE',
      17,
    );
    mk(
      'Mark Overdue & Notify',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_overdue',
        'IMMEDIATE',
        null,
        [],
        [
          { type: 'UPDATE_STATUS', config: { status: 'OVERDUE' } },
          { type: 'NOTIFY_STAFF', config: { notify: 'ASSIGNED' } },
        ],
      ),
      'ACTIVE',
      17,
      'HIGH',
    );
    mk(
      'Create Recurring Deadlines',
      'CLIENTS',
      def(
        'CLIENTS',
        'clients.client_created',
        'IMMEDIATE',
        null,
        [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
        [{ type: 'ADD_TAG', config: { tag: 'Recurring' } }],
      ),
      'ACTIVE',
      18,
    );
    mk(
      'Send Extension Reminder',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_approaching',
        'BEFORE',
        30,
        [],
        [{ type: 'SEND_EMAIL', config: { templateId: T1 } }],
      ),
      'ACTIVE',
      17,
    );
    mk(
      'Sales Tax Filing Reminder',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_approaching',
        'BEFORE',
        7,
        [{ field: 'service', operator: 'IS', value: 'BOOKKEEPING' }],
        [{ type: 'SEND_EMAIL', config: { templateId: T1 } }],
      ),
      'ACTIVE',
      19,
      'MEDIUM',
      'FAILED',
    );
    mk(
      'Incorporation Follow Up',
      'CLIENTS',
      def(
        'CLIENTS',
        'clients.client_created',
        'AFTER',
        7,
        [],
        [{ type: 'CREATE_TASK', config: {} }],
      ),
      'ACTIVE',
      20,
    );
    mk(
      'Invoice Overdue Notice',
      'INVOICES_PAYMENTS',
      def(
        'INVOICES_PAYMENTS',
        'invoices.invoice_overdue',
        'AFTER',
        3,
        [],
        [{ type: 'SEND_EMAIL', config: { templateId: T1 } }],
      ),
      'PAUSED',
      0,
    );
    mk(
      'Appointment Reminder – 24 Hours',
      'APPOINTMENTS',
      def(
        'APPOINTMENTS',
        'appointments.appointment_upcoming',
        'BEFORE',
        1,
        [],
        [{ type: 'SEND_SMS', config: { templateId: T1 } }],
      ),
      'ACTIVE',
      18,
    );
    mk(
      'Document Upload Notification',
      'DOCUMENTS',
      def(
        'DOCUMENTS',
        'documents.document_uploaded',
        'IMMEDIATE',
        null,
        [],
        [{ type: 'NOTIFY_STAFF', config: { notify: 'ASSIGNED' } }],
      ),
      'ACTIVE',
      18,
    );
    mk(
      'New Lead Follow-Up (draft)',
      'LEADS',
      def(
        'LEADS',
        'leads.lead_created',
        'IMMEDIATE',
        null,
        [],
        [{ type: 'SEND_EMAIL', config: {} }],
      ),
      'DRAFT',
      0,
    );
  };
  const seedTemplates = () => {
    const mk = (name: string, cat: AutomationEvent['module'], d: Def, desc: string) => {
      const view = viewOf(d);
      templates.push({
        id: id('a200'),
        d: {
          id: uuid('a200', next),
          name,
          description: desc,
          category: cat,
          starter: true,
          requiredIntegrations: [],
          integrationsMissing: [],
          triggerSummary: triggerText(view.trigger),
          actionsSummary: actionsText(view),
          archived: false,
          updatedAt: nowIso(),
          definition: view,
          createdBy: null,
        },
      });
      templates[templates.length - 1]!.d.id = templates[templates.length - 1]!.id;
    };
    mk(
      'Estimated Tax Payment Workflow',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_approaching',
        'BEFORE',
        14,
        [{ field: 'service', operator: 'IS', value: 'TAX_PREP' }],
        [
          { type: 'CREATE_TASK', config: {} },
          { type: 'SEND_EMAIL', config: { templateId: T1 } },
        ],
      ),
      'Task and reminder before an estimated payment is due.',
    );
    mk(
      'Quarterly Bookkeeping Follow Up',
      'BOOKKEEPING',
      def(
        'BOOKKEEPING',
        'bookkeeping.month_closed',
        'AFTER',
        3,
        [],
        [{ type: 'SEND_EMAIL', config: { templateId: T1 } }],
      ),
      'Check in after the books are closed.',
    );
    mk(
      'Annual Report Reminder (All States)',
      'COMPLIANCE_DEADLINES',
      def(
        'COMPLIANCE_DEADLINES',
        'compliance.deadline_approaching',
        'BEFORE',
        60,
        [{ field: 'deadlineType', operator: 'IS', value: 'ANNUAL_REPORT' }],
        [
          { type: 'SEND_EMAIL', config: { templateId: T1 } },
          { type: 'CREATE_TASK', config: {} },
        ],
      ),
      'Reminder and task before an annual report is due.',
    );
    mk(
      'New Business Client Setup',
      'CLIENTS',
      def(
        'CLIENTS',
        'clients.client_created',
        'IMMEDIATE',
        null,
        [{ field: 'clientType', operator: 'IS', value: 'BUSINESS' }],
        [
          { type: 'CREATE_TASK', config: {} },
          { type: 'NOTIFY_STAFF', config: { notify: 'ASSIGNED' } },
        ],
      ),
      'Setup tasks for a new business client.',
    );
    mk(
      'Tax Return Due Date Reminders',
      'TAX_RETURNS',
      def(
        'TAX_RETURNS',
        'tax_returns.status_changed',
        'IMMEDIATE',
        null,
        [],
        [{ type: 'SEND_EMAIL', config: { templateId: T1 } }],
      ),
      'Tell the client when the return changes status.',
    );
    mk(
      'Payroll Tax Filing Workflow',
      'PAYROLL',
      def(
        'PAYROLL',
        'payroll.run_completed',
        'IMMEDIATE',
        null,
        [],
        [{ type: 'CREATE_TASK', config: {} }],
      ),
      'Create the filing task after a payroll run.',
    );
  };
  const seedRuns = () => {
    const actionsFor = (
      r: Rec,
      status: AutomationRunDetail['status'],
      base: Date,
    ): AutomationActionLog[] =>
      (r.detail.definition?.actions ?? []).map((a, i) => {
        const failed = status === 'FAILED' && i === 0;
        const skipped = (status === 'FAILED' && i > 0) || status === 'SKIPPED';
        const st = failed
          ? 'FAILED'
          : skipped
            ? 'SKIPPED'
            : status === 'PENDING'
              ? 'PENDING'
              : 'SUCCESS';
        return {
          actionKey: a.id,
          position: i,
          type: a.type,
          label: actionLabel(a.type),
          status: st,
          attempts: st === 'PENDING' ? 0 : 1,
          retryable: failed,
          errorCode: failed ? 'INVALID_EMAIL' : null,
          detail: failed
            ? 'Invalid email address'
            : st === 'SKIPPED'
              ? 'Skipped'
              : st === 'PENDING'
                ? null
                : 'Done',
          scheduledFor: null,
          result: null,
          startedAt: st === 'PENDING' ? null : new Date(base.getTime() + i * 2000).toISOString(),
          finishedAt:
            st === 'PENDING' ? null : new Date(base.getTime() + i * 2000 + 1500).toISOString(),
        };
      });
    const mix: AutomationRunDetail['status'][] = [
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      'SUCCESS',
      'FAILED',
      'SKIPPED',
      'SUCCESS',
      'PENDING',
      'PARTIAL_SUCCESS',
    ];
    for (let n = 0; n < 60; n += 1) {
      const r = rules[n % (rules.length - 1)]!;
      if (!r.detail.definition) continue;
      const status = mix[(n * 7) % mix.length]!;
      const at = new Date(Date.now() - (n * 11 + (n % 5)) * 3_600_000 * 4);
      const acts = actionsFor(r, status, at);
      const ok = acts.filter((a) => a.status === 'SUCCESS').length;
      const bad = acts.filter((a) => a.status === 'FAILED').length;
      const client = CLIENT_NAMES[n % CLIENT_NAMES.length]!;
      const detail: AutomationRunDetail = {
        id: uuid('a300', n + 1),
        rule: { id: r.detail.id, name: r.detail.name },
        ruleVersion: 1,
        trigger: r.detail.triggerSummary,
        triggerModule: r.detail.category,
        client: { id: uuid('1d00', (n % CLIENT_NAMES.length) + 1), name: client },
        recordKind: 'deadline',
        recordId: uuid('2d00', n + 1),
        status,
        dryRun: false,
        actionCount: acts.length,
        actionsSucceeded: ok,
        actionsFailed: bad,
        durationMs: status === 'PENDING' ? null : 4000 + (n % 9) * 1000,
        startedAt: status === 'PENDING' ? null : at.toISOString(),
        createdAt: at.toISOString(),
        sourceEventKey: `${r.detail.id}:${n}`,
        correlationId: uuid('a400', n + 1),
        depth: 0,
        parentRunId: null,
        finishedAt: status === 'PENDING' ? null : new Date(at.getTime() + 5000).toISOString(),
        error:
          status === 'FAILED'
            ? {
                code: 'INVALID_EMAIL',
                message: 'Email could not be delivered.',
                remediation: `Fix the email address of ${client}, then re-run.`,
              }
            : null,
        actions: acts,
        ruleSnapshot: r.detail.definition!,
        ruleChanged: false,
        related: [{ kind: 'deadline', id: uuid('2d00', n + 1), label: 'View Deadline' }],
        rerun: { count: 0, lastAt: null, lastBy: null, lastReason: null },
        retryableActionKeys: status === 'FAILED' ? [acts[0]!.actionKey] : [],
        canRerun: status === 'FAILED',
      };
      runs.push(detail);
      r.detail.stats.runs += 1;
      if (status === 'SUCCESS' || status === 'PARTIAL_SUCCESS') r.detail.stats.succeeded += 1;
      if (status === 'FAILED') r.detail.stats.failed += 1;
      if (status === 'SKIPPED') r.detail.stats.skipped += 1;
    }
    runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };
  if (!empty) {
    seedRules();
    seedTemplates();
    seedRuns();
  }

  const find = (ruleId: string) => {
    const r = rules.find((x) => x.detail.id === ruleId);
    if (!r) throw fail(404, 'NOT_FOUND', 'That rule was not found.');
    return r;
  };
  const rowOf = (r: Rec) => {
    const {
      definition,
      versions,
      stats,
      activationBlockers,
      createdAt,
      canEdit,
      canActivate,
      etag,
      ...row
    } = r.detail;
    void definition;
    void versions;
    void stats;
    void activationBlockers;
    void createdAt;
    void canEdit;
    void canActivate;
    void etag;
    return row;
  };
  const unique = (name: string, except?: string) => {
    if (
      rules.some(
        (r) =>
          r.detail.id !== except &&
          r.detail.status !== 'ARCHIVED' &&
          r.detail.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw fail(409, 'DUPLICATE_NAME', 'A rule with this name already exists.');
    }
  };
  const notArchived = (r: Rec) => {
    if (r.detail.status === 'ARCHIVED')
      throw fail(409, 'RULE_ARCHIVED', 'Restore the rule before changing it.');
  };
  const conflict = (r: Rec, etag: string | undefined) => {
    if (etag !== undefined && etag !== r.detail.etag)
      throw fail(409, 'SAVE_CONFLICT', 'Someone saved this rule after you opened it.');
  };
  const owner = (userId: string | null | undefined) => {
    if (!userId) return null;
    const m = memberOf(userId);
    if (!m) throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
    return m;
  };
  const previewOf = (v: AutomationDefinitionView): AutomationPreview => {
    const checks = checksOf(v);
    const n = matchCount(v);
    const tpl = [
      ...new Set(
        v.actions
          .map((a) => a.config['templateId'])
          .filter((x): x is string => typeof x === 'string'),
      ),
    ];
    return {
      triggerPreview: triggerText(v.trigger),
      matchCount: n,
      sample: CLIENT_NAMES.slice(0, Math.min(5, n)).map((name, i) => ({
        recordKind: 'deadline',
        recordId: uuid('2d00', i + 1),
        label: `${labelOf(v.trigger.event)} · ${name}`,
        client: { id: uuid('1d00', i + 1), name },
      })),
      plannedActions: v.actions.map((a) => ({
        id: a.id,
        type: a.type,
        label: actionLabel(a.type),
        delayMinutes: a.delayMinutes,
        summary: `${actionLabel(a.type)}${a.delayMinutes ? `, after ${a.delayMinutes} minutes` : ''}`,
      })),
      templates: tpl.map((t, i) => ({
        id: t,
        name: `Template ${i + 1}`,
        kind: 'EMAIL',
        active: true,
      })),
      integrations: [],
      checks,
      canActivate: !checks.some((c) => c.severity === 'BLOCK'),
    };
  };
  const filterRuns = (q: ReturnType<typeof AutomationRunsQuery.parse>) => {
    const term = q.search?.toLowerCase();
    const tab = (s: AutomationRunDetail['status']) =>
      q.tab === 'all' ||
      (q.tab === 'success' && (s === 'SUCCESS' || s === 'PARTIAL_SUCCESS')) ||
      (q.tab === 'failed' && s === 'FAILED') ||
      (q.tab === 'skipped' && s === 'SKIPPED') ||
      (q.tab === 'pending' && (s === 'PENDING' || s === 'RUNNING'));
    return runs.filter(
      (r) =>
        tab(r.status) &&
        (!q.from || r.createdAt.slice(0, 10) >= q.from) &&
        (!q.to || r.createdAt.slice(0, 10) <= q.to) &&
        (!q.ruleId || r.rule.id === q.ruleId) &&
        (!q.module || r.triggerModule === q.module) &&
        (!q.clientId || r.client?.id === q.clientId) &&
        (q.dryRun === undefined || r.dryRun === q.dryRun) &&
        (!term ||
          `${r.rule.name} ${r.client?.name ?? ''} ${r.trigger}`.toLowerCase().includes(term)),
    );
  };
  const runRow = (r: AutomationRunDetail): AutomationRunRow => ({
    id: r.id,
    rule: r.rule,
    ruleVersion: r.ruleVersion,
    trigger: r.trigger,
    triggerModule: r.triggerModule,
    client: r.client,
    recordKind: r.recordKind,
    recordId: r.recordId,
    status: r.status,
    dryRun: r.dryRun,
    actionCount: r.actionCount,
    actionsSucceeded: r.actionsSucceeded,
    actionsFailed: r.actionsFailed,
    durationMs: r.durationMs,
    startedAt: r.startedAt,
    createdAt: r.createdAt,
  });
  const page = <T>(rows: T[], q: { page: number; pageSize: number }) => ({
    items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    total: rows.length,
    page: q.page,
    pageSize: q.pageSize,
  });
  const tplRow = (t: Starter) => {
    const { definition, createdBy, ...row } = t.d;
    void definition;
    void createdBy;
    return row;
  };

  return {
    overview: () =>
      run(() => {
        const month = runs.filter(
          (r) => Date.now() - Date.parse(r.createdAt) < 30 * DAY && !r.dryRun,
        );
        const prev = runs.filter((r) => Date.now() - Date.parse(r.createdAt) >= 30 * DAY);
        const kpi = (value: number, before: number | null) => ({
          value,
          deltaPercent: before && before > 0 ? Math.round(((value - before) / before) * 100) : null,
          comparedTo: before !== null ? 'last month' : null,
        });
        const acts = (t: string) =>
          month.reduce(
            (n, r) => n + r.actions.filter((a) => a.type === t && a.status === 'SUCCESS').length,
            0,
          );
        const active = rules.filter((r) => r.detail.status === 'ACTIVE');
        const failed24 = runs.filter(
          (r) => r.status === 'FAILED' && Date.now() - Date.parse(r.createdAt) < DAY,
        ).length;
        const attention = rules.filter((r) => r.detail.needsAttention).length;
        const okActions = month.reduce((n, r) => n + r.actionsSucceeded, 0);
        return {
          activeRules: kpi(active.length, null),
          tasksCreated: kpi(acts('CREATE_TASK'), prev.length ? 1 : null),
          clientNotifications: kpi(
            acts('SEND_EMAIL') + acts('SEND_SMS') + acts('SEND_PORTAL_MESSAGE'),
            prev.length ? 1 : null,
          ),
          timeSavedMinutes: kpi(okActions * settings.minutesSavedPerAction, null),
          health: {
            status:
              attention + failed24 === 0
                ? ('HEALTHY' as const)
                : failed24 > 2
                  ? ('FAILING' as const)
                  : ('ATTENTION' as const),
            failedRuns24h: failed24,
            rulesNeedingAttention: attention,
            pendingRuns: runs.filter((r) => r.status === 'PENDING').length,
          },
          recent: runs.slice(0, 10).map(runRow),
          canCreate: role !== 'STAFF',
          canManage: role !== 'STAFF',
        };
      }),
    catalog: () => run(() => catalog()),
    rules: (q = {}) =>
      run(() => {
        const query = parseInput(AutomationRulesQuery, q);
        const term = query.search?.toLowerCase();
        const rows = rules
          .filter(
            (r) =>
              (query.includeArchived === true || r.detail.status !== 'ARCHIVED') &&
              (!query.status || r.detail.status === query.status) &&
              (!query.category || r.detail.category === query.category) &&
              (!query.ownerUserId || r.detail.owner?.userId === query.ownerUserId) &&
              (query.needsAttention === undefined ||
                r.detail.needsAttention === query.needsAttention) &&
              (!term ||
                `${r.detail.name} ${r.detail.triggerSummary} ${r.detail.actionsSummary}`
                  .toLowerCase()
                  .includes(term)),
          )
          .sort((a, b) => {
            const key = {
              name: (r: Rec) => r.detail.name.toLowerCase(),
              status: (r: Rec) => r.detail.status,
              lastRun: (r: Rec) => r.detail.lastRunAt ?? '',
              updated: (r: Rec) => r.detail.updatedAt,
            }[query.sort];
            const x = key(a);
            const y = key(b);
            const c = x < y ? -1 : x > y ? 1 : 0;
            return query.direction === 'desc' ? -c : c;
          });
        return page(rows.map(rowOf), query);
      }),
    createRule: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateAutomationRuleRequest, body);
        unique(input.name);
        const r = makeRule({
          name: input.name,
          description: input.description ?? null,
          category: input.category,
          priority: input.priority,
          def: input.definition,
          expiresOn: input.expiresOn ?? null,
        });
        r.detail.owner = owner(input.ownerUserId) ?? mockMe;
        rowFields(r);
        if (input.activate) {
          if (!r.detail.canActivate)
            throw fail(
              409,
              'NOT_READY',
              r.detail.activationBlockers[0] ?? 'The rule is not ready.',
            );
          r.detail.status = 'ACTIVE';
          rowFields(r);
        }
        rules.unshift(r);
        return r.detail;
      }),
    rule: (ruleId) => run(() => find(ruleId).detail),
    updateRule: (ruleId, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdateAutomationRuleRequest, body);
        const r = find(ruleId);
        notArchived(r);
        conflict(r, input.etag);
        if (input.name !== undefined) {
          unique(input.name, r.detail.id);
          r.detail.name = input.name;
        }
        if (input.description !== undefined) r.detail.description = input.description;
        if (input.category !== undefined) r.detail.category = input.category;
        if (input.priority !== undefined) r.detail.priority = input.priority;
        if (input.ownerUserId !== undefined) r.detail.owner = owner(input.ownerUserId);
        if (input.expiresOn !== undefined) r.detail.expiresOn = input.expiresOn;
        rowFields(r);
        return r.detail;
      }),
    saveDefinition: (ruleId, body) =>
      run(() => {
        manage();
        const input = parseInput(SaveAutomationDefinitionRequest, body);
        const r = find(ruleId);
        notArchived(r);
        conflict(r, input.etag);
        const v = viewOf(input.definition);
        const ver = (r.detail.currentVersion ?? 0) + 1;
        r.defs.set(ver, v);
        r.detail.definition = v;
        r.detail.currentVersion = ver;
        r.detail.versions.unshift({
          version: ver,
          createdBy: mockMe,
          createdAt: nowIso(),
          runCount: 0,
        });
        rowFields(r);
        return r.detail;
      }),
    version: (ruleId, version) =>
      run(() => {
        const r = find(ruleId);
        const v = r.defs.get(version);
        const row = r.detail.versions.find((x) => x.version === version);
        if (!v || !row) throw fail(404, 'NOT_FOUND', 'That version was not found.');
        return { ...row, definition: v };
      }),
    activate: (ruleId, body = {}) =>
      run(() => {
        manage();
        const input = parseInput(ActivateAutomationRuleRequest, body);
        const r = find(ruleId);
        notArchived(r);
        conflict(r, input.etag);
        if (r.detail.status === 'ACTIVE')
          throw fail(409, 'INVALID_STATUS', 'This rule is already active.');
        if (!r.detail.canActivate)
          throw fail(409, 'NOT_READY', r.detail.activationBlockers[0] ?? 'The rule is not ready.');
        r.detail.status = 'ACTIVE';
        rowFields(r);
        return r.detail;
      }),
    pause: (ruleId, body = {}) =>
      run(() => {
        manage();
        const input = parseInput(PauseAutomationRuleRequest, body);
        const r = find(ruleId);
        notArchived(r);
        conflict(r, input.etag);
        if (r.detail.status !== 'ACTIVE')
          throw fail(409, 'INVALID_STATUS', 'Only an active rule can be paused.');
        r.detail.status = 'PAUSED';
        rowFields(r);
        return r.detail;
      }),
    duplicateRule: (ruleId) =>
      run(() => {
        manage();
        const r = find(ruleId);
        let name = `${r.detail.name} (Copy)`;
        let n = 2;
        while (rules.some((x) => x.detail.name === name)) name = `${r.detail.name} (Copy ${n++})`;
        const d = r.detail.definition;
        if (!d) throw fail(409, 'INVALID_DEFINITION', 'This rule has no definition to copy.');
        const c = makeRule({
          name,
          description: r.detail.description,
          category: r.detail.category,
          priority: r.detail.priority,
          def: parseInput(AutomationDefinition, d),
        });
        rules.unshift(c);
        return c.detail;
      }),
    archiveRule: (ruleId) =>
      run(() => {
        manage();
        const r = find(ruleId);
        r.detail.status = 'ARCHIVED';
        rowFields(r);
        return r.detail;
      }),
    restoreRule: (ruleId) =>
      run(() => {
        manage();
        const r = find(ruleId);
        if (r.detail.status !== 'ARCHIVED')
          throw fail(409, 'INVALID_STATUS', 'Only an archived rule can be restored.');
        unique(r.detail.name, r.detail.id);
        r.detail.status = 'DRAFT';
        rowFields(r);
        return r.detail;
      }),
    validate: (body) =>
      run(() => {
        const input = parseInput(PreviewAutomationRequest, body);
        return previewOf(viewOf(input.definition));
      }),
    testRule: (ruleId, body = {}) =>
      run(() => {
        const input = parseInput(TestAutomationRuleRequest, body);
        const r = find(ruleId);
        const v = input.version ? r.defs.get(input.version) : r.detail.definition;
        if (!v) throw fail(404, 'NOT_FOUND', 'That version was not found.');
        return previewOf(v);
      }),
    saveRuleAsTemplate: (ruleId, body) =>
      run(() => {
        manage();
        const input = parseInput(SaveRuleAsTemplateRequest, body);
        const r = find(ruleId);
        if (!r.detail.definition)
          throw fail(409, 'INVALID_DEFINITION', 'This rule has no definition to save.');
        if (templates.some((t) => t.d.name.toLowerCase() === input.name.toLowerCase()))
          throw fail(409, 'DUPLICATE_NAME', 'A template with this name already exists.');
        const t: Starter = {
          id: id('a200'),
          d: {
            id: '',
            name: input.name,
            description: input.description ?? null,
            category: r.detail.category,
            starter: false,
            requiredIntegrations: [],
            integrationsMissing: [],
            triggerSummary: r.detail.triggerSummary,
            actionsSummary: r.detail.actionsSummary,
            archived: false,
            updatedAt: nowIso(),
            definition: r.detail.definition,
            createdBy: mockMe,
          },
        };
        t.d.id = t.id;
        templates.unshift(t);
        return t.d;
      }),
    templates: (q = {}) =>
      run(() => {
        const query = parseInput(AutomationTemplatesQuery, q);
        const term = query.search?.toLowerCase();
        return page(
          templates
            .filter(
              (t) =>
                (query.includeArchived === true || !t.d.archived) &&
                (!query.category || t.d.category === query.category) &&
                (!term || `${t.d.name} ${t.d.description ?? ''}`.toLowerCase().includes(term)),
            )
            .map(tplRow),
          query,
        );
      }),
    createTemplate: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateAutomationTemplateRequest, body);
        if (templates.some((t) => t.d.name.toLowerCase() === input.name.toLowerCase()))
          throw fail(409, 'DUPLICATE_NAME', 'A template with this name already exists.');
        const v = viewOf(input.definition);
        const t: Starter = {
          id: id('a200'),
          d: {
            id: '',
            name: input.name,
            description: input.description ?? null,
            category: input.category,
            starter: false,
            requiredIntegrations: input.requiredIntegrations,
            integrationsMissing: [],
            triggerSummary: triggerText(v.trigger),
            actionsSummary: actionsText(v),
            archived: false,
            updatedAt: nowIso(),
            definition: v,
            createdBy: mockMe,
          },
        };
        t.d.id = t.id;
        templates.unshift(t);
        return t.d;
      }),
    template: (templateId) =>
      run(() => {
        const t = templates.find((x) => x.id === templateId);
        if (!t) throw fail(404, 'NOT_FOUND', 'That template was not found.');
        return t.d;
      }),
    updateTemplate: (templateId, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdateAutomationTemplateRequest, body);
        const t = templates.find((x) => x.id === templateId);
        if (!t) throw fail(404, 'NOT_FOUND', 'That template was not found.');
        if (input.name !== undefined) t.d.name = input.name;
        if (input.description !== undefined) t.d.description = input.description;
        if (input.category !== undefined) t.d.category = input.category;
        if (input.definition) {
          t.d.definition = viewOf(input.definition);
          t.d.triggerSummary = triggerText(t.d.definition.trigger);
          t.d.actionsSummary = actionsText(t.d.definition);
        }
        t.d.updatedAt = nowIso();
        return t.d;
      }),
    archiveTemplate: (templateId) =>
      run(() => {
        manage();
        const t = templates.find((x) => x.id === templateId);
        if (!t) throw fail(404, 'NOT_FOUND', 'That template was not found.');
        t.d.archived = true;
        return t.d;
      }),
    restoreTemplate: (templateId) =>
      run(() => {
        manage();
        const t = templates.find((x) => x.id === templateId);
        if (!t) throw fail(404, 'NOT_FOUND', 'That template was not found.');
        t.d.archived = false;
        return t.d;
      }),
    useTemplate: (templateId, body = {}) =>
      run(() => {
        manage();
        const input = parseInput(UseAutomationTemplateRequest, body);
        const t = templates.find((x) => x.id === templateId);
        if (!t || t.d.archived)
          throw fail(409, 'TEMPLATE_UNAVAILABLE', 'That template is not available.');
        if (t.d.integrationsMissing.length)
          throw fail(409, 'INTEGRATION_INACTIVE', 'Connect the integration first.');
        let name = input.name ?? t.d.name;
        let n = 2;
        while (rules.some((x) => x.detail.name.toLowerCase() === name.toLowerCase()))
          name = `${input.name ?? t.d.name} (${n++})`;
        const r = makeRule({
          name,
          description: t.d.description,
          category: t.d.category,
          def: parseInput(AutomationDefinition, t.d.definition),
        });
        rules.unshift(r);
        return r.detail;
      }),
    importTemplate: (body) =>
      run(() => {
        manage();
        const input = parseInput(ImportAutomationTemplateRequest, body);
        if (templates.some((t) => t.d.name.toLowerCase() === input.template.name.toLowerCase()))
          throw fail(409, 'DUPLICATE_NAME', 'A template with this name already exists.');
        const v = viewOf(parseInput(AutomationDefinition, input.template.definition));
        const t: Starter = {
          id: id('a200'),
          d: {
            id: '',
            name: input.template.name,
            description: input.template.description ?? null,
            category: input.template.category,
            starter: false,
            requiredIntegrations: input.template.requiredIntegrations ?? [],
            integrationsMissing: [],
            triggerSummary: triggerText(v.trigger),
            actionsSummary: actionsText(v),
            archived: false,
            updatedAt: nowIso(),
            definition: v,
            createdBy: mockMe,
          },
        };
        t.d.id = t.id;
        templates.unshift(t);
        return t.d;
      }),
    exportTemplate: (templateId) =>
      run(() => {
        const t = templates.find((x) => x.id === templateId);
        if (!t) throw fail(404, 'NOT_FOUND', 'That template was not found.');
        return {
          format: 'firmivra.automation-template' as const,
          schemaVersion: 1 as const,
          template: {
            name: t.d.name,
            description: t.d.description,
            category: t.d.category,
            definition: t.d.definition as never,
            requiredIntegrations: t.d.requiredIntegrations,
          },
        };
      }),
    installStarters: () =>
      run(() => {
        manage();
        if (templates.length === 0) seedTemplates();
        return { available: 6, installed: 0, alreadyThere: templates.length };
      }),
    runs: (q = {}) =>
      run(() => {
        const query = parseInput(AutomationRunsQuery, q);
        return page(filterRuns(query).map(runRow), query);
      }),
    runsSummary: (q = {}) =>
      run(() => {
        const query = parseInput(AutomationRunsQuery, { ...q, tab: 'all' });
        const all = filterRuns(query);
        const n = (f: (s: AutomationRunDetail['status']) => boolean) =>
          all.filter((r) => f(r.status)).length;
        return {
          total: all.length,
          success: n((s) => s === 'SUCCESS' || s === 'PARTIAL_SUCCESS'),
          failed: n((s) => s === 'FAILED'),
          skipped: n((s) => s === 'SKIPPED'),
          pending: n((s) => s === 'PENDING' || s === 'RUNNING'),
        };
      }),
    runDetail: (runId) =>
      run(() => {
        const r = runs.find((x) => x.id === runId);
        if (!r) throw fail(404, 'NOT_FOUND', 'That run was not found.');
        return r;
      }),
    rerun: (runId, body) =>
      run(() => {
        manage();
        const input = parseInput(RerunAutomationRequest, body);
        const r = runs.find((x) => x.id === runId);
        if (!r) throw fail(404, 'NOT_FOUND', 'That run was not found.');
        if (!r.canRerun) throw fail(409, 'RERUN_NOT_ALLOWED', 'Only a failed run can be re-run.');
        const current = rules.find((x) => x.detail.id === r.rule.id);
        if (
          current &&
          current.detail.currentVersion !== r.ruleVersion &&
          !input.confirmRuleChanged
        ) {
          throw fail(
            409,
            'RERUN_NOT_ALLOWED',
            'The rule changed since this run. Confirm to use the saved version.',
          );
        }
        r.actions = r.actions.map((a) =>
          a.status === 'FAILED' || a.status === 'SKIPPED'
            ? {
                ...a,
                status: 'SUCCESS' as const,
                attempts: a.attempts + 1,
                retryable: false,
                errorCode: null,
                detail: 'Done on re-run',
              }
            : a,
        );
        r.status = 'SUCCESS';
        r.error = null;
        r.actionsSucceeded = r.actions.length;
        r.actionsFailed = 0;
        r.canRerun = false;
        r.retryableActionKeys = [];
        r.rerun = {
          count: r.rerun.count + 1,
          lastAt: nowIso(),
          lastBy: mockMe,
          lastReason: input.reason,
        };
        return r;
      }),
    exportLogs: (body) =>
      run(() => {
        const input = parseInput(ExportAutomationLogsRequest, body);
        const rows = filterRuns(parseInput(AutomationRunsQuery, input.filter));
        return {
          url: 'mock:download/automation-logs.csv',
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          rowCount: rows.length,
          fileName: 'automation-logs.csv',
        };
      }),
    settings: () => run(() => settings),
    saveSettings: (body) =>
      run(() => {
        manage();
        const input = parseInput(SaveAutomationSettingsRequest, body);
        const { failureAlertUserIds, ...rest } = input;
        settings = { ...settings, ...rest, updatedAt: nowIso() };
        if (failureAlertUserIds) {
          settings.failureAlertUsers = failureAlertUserIds.map((u) => {
            const m = memberOf(u);
            if (!m) throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
            return m;
          });
        }
        return settings;
      }),
  };
}
