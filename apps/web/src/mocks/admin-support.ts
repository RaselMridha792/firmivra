import { ApiRequestError } from '@firmivra/types';
import { mockDelay, mocked, mockedEmpty } from '../lib/mock';

/**
 * Super Admin Support (S06): tickets from firms, the support team, and Support Settings. There is
 * no Support API yet: outside mock mode every call fails like an unreachable API, so the pages
 * show their frames with a quiet error line. One store holds the master ticket records; every
 * read derives the dashboard counts, tabs, SLA states and labels from it and from the settings,
 * so a change anywhere shows everywhere. Synthetic data only.
 */
const MODULE = 'adminSupport';
async function ready() {
  await mockDelay();
  if (!mocked(MODULE)) throw new TypeError('Failed to fetch');
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** 10 MB, the design's limit per attachment. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Images, PDFs and documents (docx §2 Attachments). */
export const ATTACHMENT_TYPES = [
  'image/*',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
];

// ---------------------------------------------------------------------------------------------
// Labels and enums

export type TicketStatus =
  'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_CUSTOMER' | 'ESCALATED' | 'RESOLVED' | 'CLOSED';
export const TICKET_STATUSES: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_ON_CUSTOMER: 'Waiting on Customer',
  ESCALATED: 'Escalated',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
/** Statuses a new ticket may start in. */
export const NEW_TICKET_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_CUSTOMER'];
/** Counted as "Open Tickets": being worked on and not waiting on the customer. */
const OPEN_SET: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'ESCALATED'];
const DONE: TicketStatus[] = ['RESOLVED', 'CLOSED'];
export const isActive = (status: TicketStatus) => !DONE.includes(status);

export type TicketSource = 'PORTAL' | 'EMAIL' | 'PHONE' | 'INTERNAL' | 'WEB_FORM';
export const TICKET_SOURCES: Record<TicketSource, string> = {
  PORTAL: 'Portal',
  EMAIL: 'Email',
  PHONE: 'Phone',
  INTERNAL: 'Internal',
  WEB_FORM: 'Web Form',
};

export type SlaState = 'WITHIN' | 'WARNING' | 'BREACHED' | 'PAUSED' | 'MET';
export const SLA_STATES: Record<SlaState, string> = {
  WITHIN: 'Within SLA',
  WARNING: 'Warning',
  BREACHED: 'Breached',
  PAUSED: 'Paused',
  MET: 'Met',
};

/** Named colours from the design tokens (no hex in the UI). */
export type PriorityColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'grey';
export const PRIORITY_COLORS: Record<PriorityColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  grey: 'Grey',
};

export type TargetUnit = 'HOURS' | 'BUSINESS_DAYS';
export interface ResponseTarget {
  amount: number;
  unit: TargetUnit;
}
export const targetLabel = ({ amount, unit }: ResponseTarget) =>
  unit === 'HOURS'
    ? `${amount} ${amount === 1 ? 'hour' : 'hours'}`
    : `${amount} business ${amount === 1 ? 'day' : 'days'}`;

export type AgentRole = 'OWNER' | 'LEAD' | 'AGENT';
export const AGENT_ROLES: Record<AgentRole, string> = {
  OWNER: 'Owner / Super Admin',
  LEAD: 'Support Lead',
  AGENT: 'Support Agent',
};

export type SupportPermission =
  | 'VIEW_ALL'
  | 'VIEW_OWN'
  | 'ASSIGN'
  | 'ESCALATE'
  | 'RESOLVE'
  | 'CLOSE'
  | 'MERGE'
  | 'EDIT_SETTINGS'
  | 'DELETE'
  | 'VIEW_INTERNAL_NOTES'
  | 'MANAGE_CANNED';
export const SUPPORT_PERMISSIONS: Record<SupportPermission, string> = {
  VIEW_ALL: 'View all tickets',
  VIEW_OWN: 'View own tickets',
  ASSIGN: 'Assign tickets',
  ESCALATE: 'Escalate',
  RESOLVE: 'Resolve',
  CLOSE: 'Close',
  MERGE: 'Merge',
  EDIT_SETTINGS: 'Edit settings',
  DELETE: 'Delete tickets',
  VIEW_INTERNAL_NOTES: 'View internal notes',
  MANAGE_CANNED: 'Manage canned responses',
};

export type NotificationEvent =
  | 'NEW_TICKET'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'REPLY'
  | 'ESCALATED'
  | 'SLA_WARNING'
  | 'SLA_BREACH'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REOPENED'
  | 'CUSTOMER_RESPONSE';
export const NOTIFICATION_EVENTS: Record<NotificationEvent, string> = {
  NEW_TICKET: 'New ticket',
  ASSIGNED: 'Assignment',
  REASSIGNED: 'Reassignment',
  REPLY: 'Support reply',
  ESCALATED: 'Escalation',
  SLA_WARNING: 'SLA warning',
  SLA_BREACH: 'SLA breach',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  CUSTOMER_RESPONSE: 'Customer response',
};
export type NotificationRecipient = 'ASSIGNEE' | 'LEAD' | 'ADMINS' | 'CLIENT';
export const NOTIFICATION_RECIPIENTS: Record<NotificationRecipient, string> = {
  ASSIGNEE: 'Assignee',
  LEAD: 'Team Lead',
  ADMINS: 'Admins',
  CLIENT: 'Client',
};
/** Staff-only events never reach the client (internal notes, SLA and escalation). */
export const CLIENT_EVENTS: NotificationEvent[] = [
  'NEW_TICKET',
  'REPLY',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
];
export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS';
export const NOTIFICATION_CHANNELS: Record<NotificationChannel, string> = {
  IN_APP: 'In-app',
  EMAIL: 'Email',
  SMS: 'SMS',
};

export const TIME_ZONES: { value: string; label: string; short: string }[] = [
  { value: 'America/New_York', label: 'Eastern Time', short: 'EST' },
  { value: 'America/Chicago', label: 'Central Time', short: 'CST' },
  { value: 'America/Denver', label: 'Mountain Time', short: 'MST' },
  { value: 'America/Los_Angeles', label: 'Pacific Time', short: 'PST' },
];
export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

// ---------------------------------------------------------------------------------------------
// Shapes

export interface SupportAgent {
  id: string;
  name: string;
  email: string;
  role: AgentRole;
  /** Deactivated members keep their name on history but get no new tickets. */
  active: boolean;
  /** Round robin skips members who are away. */
  available: boolean;
}
export interface FirmContact {
  id: string;
  name: string;
  email: string;
  phone: string;
  primary: boolean;
}
export interface SupportFirm {
  id: string;
  name: string;
  contacts: FirmContact[];
}
export interface SupportDirectory {
  firms: SupportFirm[];
  agents: SupportAgent[];
}
export interface SupportMe {
  agent: SupportAgent;
  permissions: SupportPermission[];
}

export interface SupportCategory {
  id: string;
  name: string;
  description: string;
  active: boolean;
}
export interface SupportPriority {
  id: string;
  name: string;
  description: string;
  color: PriorityColor;
  target: ResponseTarget;
  active: boolean;
  /** 1 is the most urgent: the order of lists, sorting and the High Priority tab. */
  rank: number;
}
export interface DayHours {
  /** 0 is Sunday. */
  day: number;
  open: boolean;
  /** `HH:MM`, 24-hour. */
  start: string;
  end: string;
}
export interface Holiday {
  id: string;
  /** `YYYY-MM-DD` in the support time zone. */
  date: string;
  name: string;
}
export interface BusinessHours {
  timeZone: string;
  days: DayHours[];
  holidays: Holiday[];
  /** BUSINESS counts only open hours; CALENDAR counts every hour. */
  clock: 'BUSINESS' | 'CALENDAR';
}
export interface AssignmentRules {
  /** New tickets without an assignee wait in the Support Team queue. */
  defaultQueue: boolean;
  roundRobin: boolean;
  reassign: boolean;
  reassignAfterHours: number;
}
export interface EscalationRules {
  slaBreach: { enabled: boolean; notify: 'LEAD' | 'ADMINS' };
  highPriority: { enabled: boolean; priorityId: string; target: ResponseTarget };
  critical: { enabled: boolean; priorityId: string; channels: NotificationChannel[] };
}
export interface CannedResponse {
  id: string;
  title: string;
  body: string;
  categoryId: string | null;
  active: boolean;
  createdBy: string;
  updatedAt: string;
}
export interface NotificationRule {
  event: NotificationEvent;
  recipients: NotificationRecipient[];
}
export interface NotificationSettings {
  channels: NotificationChannel[];
  rules: NotificationRule[];
}
export type PermissionGrid = Record<AgentRole, SupportPermission[]>;
export interface SupportSettings {
  categories: SupportCategory[];
  priorities: SupportPriority[];
  businessHours: BusinessHours;
  assignment: AssignmentRules;
  escalation: EscalationRules;
  cannedResponses: CannedResponse[];
  notifications: NotificationSettings;
  permissions: PermissionGrid;
}

export interface TicketSla {
  state: SlaState;
  /** When the next support response is due; null when none is due. */
  dueAt: string | null;
  /** Minutes until `dueAt`; negative once it has passed. */
  minutesLeft: number | null;
}
export interface SupportTicket {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  source: TicketSource;
  priority: { id: string; name: string; color: PriorityColor; rank: number; active: boolean };
  category: { id: string; name: string; active: boolean };
  firm: { id: string; name: string };
  contact: { id: string; name: string; email: string; phone: string };
  assignee: { id: string; name: string; active: boolean } | null;
  createdBy: { name: string; role: 'CLIENT' | 'SUPPORT' };
  createdAt: string;
  /** Last activity. */
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  sla: TicketSla;
  escalation: { reason: string; at: string; by: string } | null;
  mergedInto: { id: string; number: number } | null;
  counts: { messages: number; attachments: number; notes: number };
  /** Changes send it back; a stale one is refused with 409 CONFLICT. */
  version: number;
}
export interface TicketMessage {
  id: string;
  author: { name: string; role: 'CLIENT' | 'SUPPORT' };
  body: string;
  at: string;
  attachments: { id: string; name: string }[];
  /** False for a support reply kept in the conversation without delivering it. */
  sentToClient: boolean;
  mergedFrom: number | null;
}
export interface TicketNote {
  id: string;
  author: string;
  body: string;
  at: string;
  mergedFrom: number | null;
}
export interface TicketAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedBy: string;
  at: string;
  mergedFrom: number | null;
}
export type ActivityType =
  | 'CREATED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'UNASSIGNED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'CATEGORY_CHANGED'
  | 'FIRM_CHANGED'
  | 'MESSAGE'
  | 'CLIENT_REPLY'
  | 'NOTE'
  | 'ATTACHMENT'
  | 'ESCALATED'
  | 'SLA_WARNING'
  | 'SLA_BREACHED'
  | 'RESOLVED'
  | 'REOPENED'
  | 'CLOSED'
  | 'MERGED'
  | 'NOTIFICATION'
  | 'AUTOMATION';
export interface TicketActivity {
  id: string;
  type: ActivityType;
  at: string;
  /** A person's name, or "System" for automation. */
  actor: string;
  from: string | null;
  to: string | null;
  note: string | null;
}
export interface TicketDetail extends SupportTicket {
  description: string;
  messages: TicketMessage[];
  /** Empty without the "View internal notes" permission. */
  notes: TicketNote[];
  attachments: TicketAttachment[];
  activity: TicketActivity[];
}

export type TicketTab =
  'ALL' | 'UNASSIGNED' | 'MINE' | 'HIGH_PRIORITY' | 'OVERDUE' | 'WAITING' | 'ESCALATED' | 'CLOSED';
export interface TicketFilters {
  statuses?: TicketStatus[];
  priorityIds?: string[];
  categoryIds?: string[];
  firmId?: string;
  /** An agent id, or UNASSIGNED. */
  assigneeId?: string;
  source?: TicketSource;
  /** `YYYY-MM-DD`, local days. */
  createdFrom?: string;
  createdTo?: string;
  activityFrom?: string;
  activityTo?: string;
  sla?: SlaState;
  escalated?: 'YES' | 'NO';
  /** A summary card's set: Open Tickets, or Resolved (30 days). */
  set?: 'OPEN' | 'RESOLVED_30';
}
export interface TicketQuery extends TicketFilters {
  tab?: TicketTab;
  search?: string;
  page?: number;
  pageSize?: number;
}
export interface TicketPage {
  items: SupportTicket[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SupportSummary {
  total: number;
  open: number;
  overdue: number;
  waiting: number;
  resolved30: number;
  /** Percent change against 30 days before; null when there is nothing to compare with. */
  trends: Record<'total' | 'open' | 'overdue' | 'waiting' | 'resolved30', number | null>;
  tabs: Record<TicketTab, number>;
}

export interface AttachmentInput {
  name: string;
  type: string;
  size: number;
  /** The picked file; kept so Download gives it back in this session. */
  file?: Blob;
}
/** An agent id; QUEUE leaves it in the Support Team queue; AUTO lets round robin pick. */
export type AssignTo = string;
export interface NewTicket {
  /** One per form opening: a double click or a retry never makes two tickets. */
  requestId: string;
  firmId: string;
  contactId: string;
  subject: string;
  categoryId: string;
  priorityId: string;
  /** Empty until chosen. */
  assignTo: AssignTo;
  status: TicketStatus;
  source: TicketSource;
  description: string;
  attachments: AttachmentInput[];
  internalNote: string;
  notifyAssignee: boolean;
}
export type NewTicketField =
  | 'firmId'
  | 'contactId'
  | 'subject'
  | 'categoryId'
  | 'priorityId'
  | 'assignTo'
  | 'status'
  | 'source'
  | 'description'
  | 'attachments'
  | 'internalNote';

// ---------------------------------------------------------------------------------------------
// Validation, shared by the forms (field errors) and the mock (the API's own check)

const SUBJECT_MAX = 150;
const TEXT_MAX = 5000;

export function attachmentProblem(file: { name: string; type: string; size: number }) {
  const name = file.name.toLowerCase();
  const allowed =
    file.type.startsWith('image/') ||
    ATTACHMENT_TYPES.some((rule) => rule.startsWith('.') && name.endsWith(rule));
  if (!allowed) return `${file.name}: only images, PDFs and documents can be attached.`;
  if (file.size > MAX_ATTACHMENT_BYTES) return `${file.name} is larger than 10 MB.`;
  return null;
}

export function validateNewTicket(
  input: NewTicket,
  directory: SupportDirectory,
  settings: Pick<SupportSettings, 'categories' | 'priorities'>,
): Partial<Record<NewTicketField, string>> {
  const errors: Partial<Record<NewTicketField, string>> = {};
  const firm = directory.firms.find((f) => f.id === input.firmId);
  if (!firm) errors.firmId = 'Select a firm.';
  if (!firm?.contacts.some((c) => c.id === input.contactId)) {
    errors.contactId = 'Select a contact from this firm.';
  }
  const subject = input.subject.trim();
  if (!subject) errors.subject = 'Enter a subject.';
  else if (subject.length > SUBJECT_MAX)
    errors.subject = `Keep it under ${SUBJECT_MAX} characters.`;
  if (!settings.categories.some((c) => c.id === input.categoryId && c.active)) {
    errors.categoryId = 'Select a category.';
  }
  if (!settings.priorities.some((p) => p.id === input.priorityId && p.active)) {
    errors.priorityId = 'Select a priority.';
  }
  const eligible = directory.agents.some((a) => a.id === input.assignTo && a.active);
  if (input.assignTo !== 'QUEUE' && input.assignTo !== 'AUTO' && !eligible) {
    errors.assignTo = 'Select a team member.';
  }
  if (!NEW_TICKET_STATUSES.includes(input.status)) errors.status = 'Select a status.';
  if (!(input.source in TICKET_SOURCES)) errors.source = 'Select a source.';
  const description = input.description.trim();
  if (!description) errors.description = 'Describe the issue.';
  else if (description.length > TEXT_MAX) errors.description = 'This description is too long.';
  const fileProblem = input.attachments.map(attachmentProblem).find(Boolean);
  if (fileProblem) errors.attachments = fileProblem;
  if (input.internalNote.length > TEXT_MAX) errors.internalNote = 'This note is too long.';
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Store

interface StoredAttachment extends TicketAttachment {
  file?: Blob;
}
interface StoredMessage extends TicketMessage {
  attachments: { id: string; name: string }[];
}
interface TicketRecord {
  id: string;
  number: number;
  subject: string;
  description: string;
  status: TicketStatus;
  source: TicketSource;
  priorityId: string;
  categoryId: string;
  firmId: string;
  contactId: string;
  assigneeId: string | null;
  assignedAt: string | null;
  /** The assignee took the ticket (replied, noted or changed it); reassignment stops. */
  acceptedAt: string | null;
  createdBy: { name: string; role: 'CLIENT' | 'SUPPORT' };
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  /** When the response clock started; null while no support response is due. */
  slaStartAt: string | null;
  warnedAt: string | null;
  breachedAt: string | null;
  priorityEscalationChecked: boolean;
  escalation: { reason: string; at: string; by: string } | null;
  mergedInto: string | null;
  deleted: boolean;
  version: number;
  requestId: string | null;
  statusLog: { at: string; status: TicketStatus }[];
  messages: StoredMessage[];
  notes: TicketNote[];
  attachments: StoredAttachment[];
  activity: TicketActivity[];
}
interface Store {
  firms: SupportFirm[];
  agents: SupportAgent[];
  settings: SupportSettings;
  tickets: TicketRecord[];
  nextId: number;
  roundRobin: number;
}

const uuid = (kind: string, n: number) =>
  `0199d1a6-06${kind}-7000-8000-${String(n).padStart(12, '0')}`;
/** The console's mock Super Admin (mocks/admin-auth.ts): the same person, so My Tickets is theirs. */
const ME_ID = '0199b6a2-0000-7000-8000-0000000000a1';

let store: Store | undefined;
const db = (): Store => (store ??= seed());
const nextId = (kind: string) => {
  const s = db();
  s.nextId += 1;
  return uuid(kind, s.nextId);
};

// ---------------------------------------------------------------------------------------------
// The SLA engine: one place for due times, so the dashboard, the ticket and the rules agree.

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':');
  return Number(h ?? 0) * 60 + Number(m ?? 0);
};
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function zoned(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(ms));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY_SHORT.indexOf(get('weekday') ?? ''),
    clock: (Number(get('hour') ?? 0) % 24) * 60 + Number(get('minute') ?? 0),
    seconds: Number(get('second') ?? 0),
  };
}

/** Adds open minutes only: closed days, after-hours and holidays don't count. */
function addBusinessMinutes(startMs: number, minutes: number, hours: BusinessHours): number {
  let at = startMs;
  let left = minutes;
  for (let guard = 0; guard < 800; guard++) {
    const { date, weekday, clock, seconds } = zoned(at, hours.timeZone);
    const day = hours.days.find((d) => d.day === weekday);
    if (day?.open && !hours.holidays.some((h) => h.date === date)) {
      const open = toMinutes(day.start);
      const close = toMinutes(day.end);
      const from = Math.max(clock, open);
      if (from < close) {
        const begin = at + (from - clock) * MINUTE;
        if (left <= close - from) return begin + left * MINUTE;
        left -= close - from;
      }
    }
    at += (24 * 60 - clock) * MINUTE - seconds * 1000;
  }
  return at;
}

function businessDayMinutes(hours: BusinessHours) {
  const day = hours.days.find((d) => d.open);
  return day ? Math.max(60, toMinutes(day.end) - toMinutes(day.start)) : 8 * 60;
}

/** When a clock started at `startMs` with this target runs out. */
function dueTime(startMs: number, target: ResponseTarget, hours: BusinessHours) {
  if (hours.clock === 'CALENDAR') {
    return startMs + target.amount * (target.unit === 'HOURS' ? HOUR : DAY);
  }
  const minutes =
    target.unit === 'HOURS' ? target.amount * 60 : target.amount * businessDayMinutes(hours);
  return addBusinessMinutes(startMs, minutes, hours);
}

function slaOf(record: TicketRecord, settings: SupportSettings, now: number): TicketSla {
  if (DONE.includes(record.status)) {
    return { state: record.breachedAt ? 'BREACHED' : 'MET', dueAt: null, minutesLeft: null };
  }
  if (record.status === 'WAITING_ON_CUSTOMER') {
    return { state: 'PAUSED', dueAt: null, minutesLeft: null };
  }
  const priority = settings.priorities.find((p) => p.id === record.priorityId);
  if (!record.slaStartAt || !priority) return { state: 'WITHIN', dueAt: null, minutesLeft: null };
  const start = Date.parse(record.slaStartAt);
  const due = dueTime(start, priority.target, settings.businessHours);
  const left = due - now;
  const state: SlaState = left < 0 ? 'BREACHED' : left < (due - start) / 4 ? 'WARNING' : 'WITHIN';
  return {
    state,
    dueAt: new Date(due).toISOString(),
    minutesLeft: Math.round(left / MINUTE),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading records

const iso = (ms: number) => new Date(ms).toISOString();

function agentName(id: string | null) {
  return db().agents.find((a) => a.id === id)?.name ?? 'Former team member';
}

function view(record: TicketRecord, now: number): SupportTicket {
  const s = db();
  const priority = s.settings.priorities.find((p) => p.id === record.priorityId);
  const category = s.settings.categories.find((c) => c.id === record.categoryId);
  const firm = s.firms.find((f) => f.id === record.firmId);
  const contact = firm?.contacts.find((c) => c.id === record.contactId);
  const assignee = s.agents.find((a) => a.id === record.assigneeId);
  const merged = s.tickets.find((t) => t.id === record.mergedInto);
  return {
    id: record.id,
    number: record.number,
    subject: record.subject,
    status: record.status,
    source: record.source,
    priority: {
      id: record.priorityId,
      name: priority?.name ?? 'Unknown',
      color: priority?.color ?? 'grey',
      rank: priority?.rank ?? 99,
      active: priority?.active ?? false,
    },
    category: {
      id: record.categoryId,
      name: category?.name ?? 'Unknown',
      active: category?.active ?? false,
    },
    firm: { id: record.firmId, name: firm?.name ?? 'Unknown firm' },
    contact: {
      id: record.contactId,
      name: contact?.name ?? 'Unknown contact',
      email: contact?.email ?? '',
      phone: contact?.phone ?? '',
    },
    assignee: assignee ? { id: assignee.id, name: assignee.name, active: assignee.active } : null,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    firstResponseAt: record.firstResponseAt,
    resolvedAt: record.resolvedAt,
    closedAt: record.closedAt,
    sla: slaOf(record, s.settings, now),
    escalation: record.escalation,
    mergedInto: merged ? { id: merged.id, number: merged.number } : null,
    counts: {
      messages: record.messages.length,
      attachments: record.attachments.length,
      notes: record.notes.length,
    },
    version: record.version,
  };
}

function permissionsOf(role: AgentRole): SupportPermission[] {
  return db().settings.permissions[role];
}
function me(): SupportMe {
  const s = db();
  const agent = s.agents.find((a) => a.id === ME_ID);
  if (!agent) throw new ApiRequestError(403, 'FORBIDDEN', 'Not a support team member');
  return { agent: structuredClone(agent), permissions: [...permissionsOf(agent.role)] };
}
function need(permission: SupportPermission) {
  if (!me().permissions.includes(permission)) {
    throw new ApiRequestError(403, 'FORBIDDEN', 'Missing support permission');
  }
}
/** Tickets this person may see: all of them, or only their own. */
function visible(): TicketRecord[] {
  const { permissions, agent } = me();
  const live = db().tickets.filter((t) => !t.deleted);
  if (permissions.includes('VIEW_ALL')) return live;
  if (permissions.includes('VIEW_OWN')) return live.filter((t) => t.assigneeId === agent.id);
  throw new ApiRequestError(403, 'FORBIDDEN', 'Missing support permission');
}
function find(id: string): TicketRecord {
  const record = visible().find((t) => t.id === id);
  if (!record) throw new ApiRequestError(404, 'NOT_FOUND', 'Ticket not found');
  return record;
}
function fresh(record: TicketRecord, version: number) {
  if (record.version !== version) {
    throw new ApiRequestError(409, 'CONFLICT', 'The ticket changed since it was loaded');
  }
}
const invalid = (message: string) => new ApiRequestError(400, 'VALIDATION_FAILED', message);

function highPriorityRank(settings: SupportSettings) {
  return settings.priorities.find((p) => p.id === settings.escalation.highPriority.priorityId)
    ?.rank;
}

function inTab(ticket: SupportTicket, tab: TicketTab, settings: SupportSettings, meId: string) {
  const active = isActive(ticket.status);
  switch (tab) {
    case 'ALL':
      return true;
    case 'UNASSIGNED':
      return active && !ticket.assignee;
    case 'MINE':
      return ticket.assignee?.id === meId;
    case 'HIGH_PRIORITY':
      return active && ticket.priority.rank <= (highPriorityRank(settings) ?? 2);
    case 'OVERDUE':
      return active && ticket.sla.state === 'BREACHED';
    case 'WAITING':
      return ticket.status === 'WAITING_ON_CUSTOMER';
    case 'ESCALATED':
      return active && ticket.escalation !== null;
    case 'CLOSED':
      return ticket.status === 'CLOSED';
  }
}

/** Local midnight of a `YYYY-MM-DD` day, and the start of the next one. */
function dayStart(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}
function inDays(at: string, from?: string, to?: string) {
  const ms = Date.parse(at);
  if (from && ms < dayStart(from)) return false;
  if (to && ms >= dayStart(to) + DAY) return false;
  return true;
}

function matches(ticket: SupportTicket, record: TicketRecord, search: string) {
  const words = search.toLowerCase().replace(/#/g, '').split(/\s+/).filter(Boolean);
  const haystack = [
    String(ticket.number),
    String(ticket.number).padStart(4, '0'),
    ticket.subject,
    ticket.firm.name,
    ticket.contact.name,
    ticket.contact.email,
    ticket.category.name,
    ticket.assignee?.name ?? 'unassigned',
    record.description,
  ]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function filtered(query: TicketFilters, now: number) {
  return visible()
    .map((record) => ({ record, ticket: view(record, now) }))
    .filter(({ ticket }) => {
      if (query.statuses?.length && !query.statuses.includes(ticket.status)) return false;
      if (query.priorityIds?.length && !query.priorityIds.includes(ticket.priority.id)) {
        return false;
      }
      if (query.categoryIds?.length && !query.categoryIds.includes(ticket.category.id)) {
        return false;
      }
      if (query.firmId && ticket.firm.id !== query.firmId) return false;
      if (query.assigneeId) {
        const id = ticket.assignee?.id ?? 'UNASSIGNED';
        if (id !== query.assigneeId) return false;
      }
      if (query.source && ticket.source !== query.source) return false;
      if (!inDays(ticket.createdAt, query.createdFrom, query.createdTo)) return false;
      if (!inDays(ticket.updatedAt, query.activityFrom, query.activityTo)) return false;
      if (query.sla && ticket.sla.state !== query.sla) return false;
      if (query.escalated === 'YES' && !ticket.escalation) return false;
      if (query.escalated === 'NO' && ticket.escalation) return false;
      if (query.set === 'OPEN' && !OPEN_SET.includes(ticket.status)) return false;
      if (
        query.set === 'RESOLVED_30' &&
        !(ticket.resolvedAt && now - Date.parse(ticket.resolvedAt) <= 30 * DAY)
      ) {
        return false;
      }
      return true;
    });
}

/** The status a ticket had at a past moment, from its status log (for the 30-day trends). */
function statusAt(record: TicketRecord, at: number): TicketStatus | null {
  if (Date.parse(record.createdAt) > at) return null;
  let status: TicketStatus | null = null;
  for (const entry of record.statusLog) {
    if (Date.parse(entry.at) <= at) status = entry.status;
  }
  return status;
}
const change = (current: number, previous: number) =>
  previous === 0 ? null : Math.round(((current - previous) / previous) * 100);

// ---------------------------------------------------------------------------------------------
// Writing records: history, notifications and automation

function log(
  record: TicketRecord,
  type: ActivityType,
  actor: string,
  at: number,
  details: { from?: string | null; to?: string | null; note?: string | null } = {},
) {
  record.activity.push({
    id: nextId('08'),
    type,
    at: iso(at),
    actor,
    from: details.from ?? null,
    to: details.to ?? null,
    note: details.note ?? null,
  });
}

function touch(record: TicketRecord, at: number) {
  record.updatedAt = iso(at);
  record.version += 1;
}

function setStatus(record: TicketRecord, status: TicketStatus, actor: string, at: number) {
  if (record.status === status) return;
  const before = record.status;
  log(record, 'STATUS_CHANGED', actor, at, {
    from: TICKET_STATUSES[before],
    to: TICKET_STATUSES[status],
  });
  record.status = status;
  record.statusLog.push({ at: iso(at), status });
  // Waiting on the customer pauses the clock; coming back restarts it.
  if (status === 'WAITING_ON_CUSTOMER') record.slaStartAt = null;
  if (before === 'WAITING_ON_CUSTOMER' && isActive(status)) record.slaStartAt = iso(at);
}

/** Sends the configured notification for an event and records who got it. */
function notify(record: TicketRecord, event: NotificationEvent, at: number) {
  const { notifications } = db().settings;
  const rule = notifications.rules.find((r) => r.event === event);
  if (!rule || rule.recipients.length === 0 || notifications.channels.length === 0) return;
  const s = db();
  const names = rule.recipients.flatMap((recipient) => {
    if (recipient === 'ASSIGNEE') return record.assigneeId ? [agentName(record.assigneeId)] : [];
    if (recipient === 'CLIENT') {
      if (!CLIENT_EVENTS.includes(event)) return [];
      const firm = s.firms.find((f) => f.id === record.firmId);
      const contact = firm?.contacts.find((c) => c.id === record.contactId);
      return contact ? [contact.name] : [];
    }
    return [NOTIFICATION_RECIPIENTS[recipient]];
  });
  if (names.length === 0) return;
  const channels = notifications.channels
    .filter((c) => c !== 'SMS' || event === 'ESCALATED' || event === 'SLA_BREACH')
    .map((c) => NOTIFICATION_CHANNELS[c]);
  log(record, 'NOTIFICATION', 'System', at, {
    note: `${NOTIFICATION_EVENTS[event]}: ${names.join(', ')} notified by ${channels.join(', ')}`,
  });
}

/** The next available, active member for round robin. */
function roundRobinAgent(): SupportAgent | undefined {
  const s = db();
  const pool = s.agents.filter(
    (a) => a.active && a.available && a.role !== 'OWNER' && permissionsOf(a.role).length > 0,
  );
  if (pool.length === 0) return undefined;
  s.roundRobin = (s.roundRobin + 1) % pool.length;
  return pool[s.roundRobin];
}

function escalate(record: TicketRecord, reason: string, actor: string, at: number) {
  record.escalation = { reason, at: iso(at), by: actor };
  log(record, 'ESCALATED', actor, at, { note: reason });
  if (isActive(record.status)) setStatus(record, 'ESCALATED', actor, at);
  notify(record, 'ESCALATED', at);
}

/** The Escalation and Assignment rules: run on every read, each event recorded once. */
function runRules(now: number) {
  const s = db();
  const { escalation, assignment, businessHours } = s.settings;
  for (const record of s.tickets) {
    if (record.deleted || !isActive(record.status)) continue;
    const sla = slaOf(record, s.settings, now);
    if (sla.state === 'WARNING' && !record.warnedAt) {
      record.warnedAt = iso(now);
      log(record, 'SLA_WARNING', 'System', now, { note: 'Response due soon' });
      notify(record, 'SLA_WARNING', now);
    }
    if (sla.state === 'BREACHED' && !record.breachedAt) {
      const at = sla.dueAt ? Date.parse(sla.dueAt) : now;
      record.breachedAt = iso(at);
      log(record, 'SLA_BREACHED', 'System', at, { note: 'Response time exceeded the target' });
      notify(record, 'SLA_BREACH', at);
      if (escalation.slaBreach.enabled && !record.escalation) {
        escalate(record, 'Response time exceeded the SLA target', 'System', at);
      }
      touch(record, at);
    }
    const high = escalation.highPriority;
    if (
      high.enabled &&
      !record.escalation &&
      !record.priorityEscalationChecked &&
      record.priorityId === high.priorityId &&
      dueTime(Date.parse(record.createdAt), high.target, businessHours) < now
    ) {
      record.priorityEscalationChecked = true;
      escalate(
        record,
        `High priority and not resolved within ${targetLabel(high.target)}`,
        'System',
        now,
      );
      touch(record, now);
    }
    if (
      assignment.reassign &&
      record.assigneeId &&
      !record.acceptedAt &&
      record.assignedAt &&
      addBusinessMinutes(
        Date.parse(record.assignedAt),
        assignment.reassignAfterHours * 60,
        businessHours,
      ) < now
    ) {
      const next = roundRobinAgent();
      if (next && next.id !== record.assigneeId) {
        log(record, 'REASSIGNED', 'System', now, {
          from: agentName(record.assigneeId),
          to: next.name,
          note: `Not accepted within ${assignment.reassignAfterHours} hours`,
        });
        record.assigneeId = next.id;
        record.assignedAt = iso(now);
        notify(record, 'REASSIGNED', now);
        touch(record, now);
      }
    }
  }
}

function critical(record: TicketRecord, at: number) {
  const rule = db().settings.escalation.critical;
  if (!rule.enabled || record.priorityId !== rule.priorityId) return;
  const channels = rule.channels.map((c) => NOTIFICATION_CHANNELS[c]).join(', ');
  log(record, 'AUTOMATION', 'System', at, {
    note: `Critical ticket: Admins notified${channels ? ` by ${channels}` : ''}`,
  });
}

/** The Assign To choice as an agent id, or null for the Support Team queue. */
function resolveAssignee(assignTo: AssignTo): string | null {
  if (assignTo === 'QUEUE') return null;
  if (assignTo === 'AUTO') return roundRobinAgent()?.id ?? null;
  const agent = db().agents.find((a) => a.id === assignTo);
  if (!agent?.active) throw invalid('This team member cannot take new tickets');
  return agent.id;
}

function storeFiles(files: AttachmentInput[], uploadedBy: string, at: number): StoredAttachment[] {
  for (const file of files) {
    const problem = attachmentProblem(file);
    if (problem) throw invalid(problem);
  }
  return files.map((file) => ({
    id: nextId('07'),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    uploadedBy,
    at: iso(at),
    mergedFrom: null,
    ...(file.file ? { file: file.file } : {}),
  }));
}

const settingsCopy = () => structuredClone(db().settings);

function checkName(name: string, field: string) {
  const value = name.trim();
  if (!value) throw invalid(`Enter a ${field}`);
  if (value.length > 80) throw invalid(`Keep the ${field} under 80 characters`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// The client

export interface TicketChange {
  version: number;
  status?: TicketStatus;
  priorityId?: string;
  categoryId?: string;
}

export const adminSupport = {
  me: async (): Promise<SupportMe> => {
    await ready();
    return me();
  },

  directory: async (): Promise<SupportDirectory> => {
    await ready();
    const s = db();
    return structuredClone({ firms: s.firms, agents: s.agents });
  },

  settings: async (): Promise<SupportSettings> => {
    await ready();
    return settingsCopy();
  },

  summary: async (): Promise<SupportSummary> => {
    await ready();
    const now = Date.now();
    runRules(now);
    const s = db();
    const { agent } = me();
    const records = visible();
    const tickets = records.map((record) => view(record, now));
    const then = now - 30 * DAY;
    const count = (test: (t: SupportTicket) => boolean) => tickets.filter(test).length;
    const countThen = (test: (status: TicketStatus) => boolean) =>
      records.filter((r) => {
        const status = statusAt(r, then);
        return status !== null && test(status);
      }).length;
    const within = (at: string | null, from: number, to: number) =>
      at !== null && Date.parse(at) > from && Date.parse(at) <= to;
    const resolvedNow = records.filter((r) => within(r.resolvedAt, then, now)).length;
    const resolvedBefore = records.filter((r) => within(r.resolvedAt, then - 30 * DAY, then));
    const breachedNow = records.filter((r) => within(r.breachedAt, then, now)).length;
    const breachedBefore = records.filter((r) => within(r.breachedAt, then - 30 * DAY, then));
    const summary: SupportSummary = {
      total: tickets.length,
      open: count((t) => OPEN_SET.includes(t.status)),
      overdue: count((t) => isActive(t.status) && t.sla.state === 'BREACHED'),
      waiting: count((t) => t.status === 'WAITING_ON_CUSTOMER'),
      resolved30: resolvedNow,
      trends: {
        total: change(
          tickets.length,
          countThen(() => true),
        ),
        open: change(
          count((t) => OPEN_SET.includes(t.status)),
          countThen((status) => OPEN_SET.includes(status)),
        ),
        overdue: change(breachedNow, breachedBefore.length),
        waiting: change(
          count((t) => t.status === 'WAITING_ON_CUSTOMER'),
          countThen((status) => status === 'WAITING_ON_CUSTOMER'),
        ),
        resolved30: change(resolvedNow, resolvedBefore.length),
      },
      tabs: {
        ALL: 0,
        UNASSIGNED: 0,
        MINE: 0,
        HIGH_PRIORITY: 0,
        OVERDUE: 0,
        WAITING: 0,
        ESCALATED: 0,
        CLOSED: 0,
      },
    };
    for (const tab of Object.keys(summary.tabs) as TicketTab[]) {
      summary.tabs[tab] = count((t) => inTab(t, tab, s.settings, agent.id));
    }
    return summary;
  },

  tickets: async (query: TicketQuery = {}): Promise<TicketPage> => {
    await ready();
    const now = Date.now();
    runRules(now);
    const s = db();
    const { agent } = me();
    const tab = query.tab ?? 'ALL';
    const search = (query.search ?? '').trim();
    const rows = filtered(query, now)
      .filter(({ ticket }) => inTab(ticket, tab, s.settings, agent.id))
      .filter(({ ticket, record }) => !search || matches(ticket, record, search))
      .map(({ ticket }) => ticket)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || b.number - a.number);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 10));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const page = Math.min(Math.max(1, query.page ?? 1), pages);
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  },

  ticket: async (id: string): Promise<TicketDetail> => {
    await ready();
    const now = Date.now();
    runRules(now);
    const record = find(id);
    const notesAllowed = me().permissions.includes('VIEW_INTERNAL_NOTES');
    return structuredClone({
      ...view(record, now),
      description: record.description,
      messages: record.messages,
      notes: notesAllowed ? record.notes : [],
      attachments: record.attachments.map((file) => ({
        id: file.id,
        name: file.name,
        type: file.type,
        size: file.size,
        uploadedBy: file.uploadedBy,
        at: file.at,
        mergedFrom: file.mergedFrom,
      })),
      activity: [...record.activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    });
  },

  /** The file to download or view; seeded files give back a small placeholder. */
  attachmentFile: async (ticketId: string, attachmentId: string): Promise<Blob> => {
    await ready();
    const file = find(ticketId).attachments.find((a) => a.id === attachmentId);
    if (!file) throw new ApiRequestError(404, 'NOT_FOUND', 'Attachment not found');
    return (
      file.file ??
      new Blob([`Sample attachment "${file.name}" (synthetic mock data).`], { type: 'text/plain' })
    );
  },

  createTicket: async (body: NewTicket): Promise<SupportTicket> => {
    await ready();
    const s = db();
    const existing = s.tickets.find((t) => t.requestId === body.requestId);
    if (existing) return view(existing, Date.now());
    const errors = validateNewTicket(body, s, s.settings);
    const first = Object.values(errors)[0];
    if (first) throw invalid(first);
    const { agent } = me();
    const now = Date.now();
    const assigneeId = resolveAssignee(body.assignTo);
    const firm = s.firms.find((f) => f.id === body.firmId);
    const contact = firm?.contacts.find((c) => c.id === body.contactId);
    const files = storeFiles(body.attachments, agent.name, now);
    const fromClient = body.source !== 'INTERNAL';
    const author = fromClient
      ? { name: contact?.name ?? 'Client', role: 'CLIENT' as const }
      : { name: agent.name, role: 'SUPPORT' as const };
    const record: TicketRecord = {
      id: nextId('01'),
      number: Math.max(1000, ...s.tickets.map((t) => t.number)) + 1,
      subject: body.subject.trim(),
      description: body.description.trim(),
      status: body.status,
      source: body.source,
      priorityId: body.priorityId,
      categoryId: body.categoryId,
      firmId: body.firmId,
      contactId: body.contactId,
      assigneeId,
      assignedAt: assigneeId ? iso(now) : null,
      acceptedAt: null,
      createdBy: author,
      createdAt: iso(now),
      updatedAt: iso(now),
      firstResponseAt: null,
      resolvedAt: null,
      closedAt: null,
      slaStartAt: body.status === 'WAITING_ON_CUSTOMER' ? null : iso(now),
      warnedAt: null,
      breachedAt: null,
      priorityEscalationChecked: false,
      escalation: null,
      mergedInto: null,
      deleted: false,
      version: 1,
      requestId: body.requestId,
      statusLog: [{ at: iso(now), status: body.status }],
      messages: [
        {
          id: nextId('05'),
          author,
          body: body.description.trim(),
          at: iso(now),
          attachments: files.map((f) => ({ id: f.id, name: f.name })),
          sentToClient: true,
          mergedFrom: null,
        },
      ],
      notes: body.internalNote.trim()
        ? [
            {
              id: nextId('06'),
              author: agent.name,
              body: body.internalNote.trim(),
              at: iso(now),
              mergedFrom: null,
            },
          ]
        : [],
      attachments: files,
      activity: [],
    };
    log(record, 'CREATED', agent.name, now, {
      note: `Created from ${TICKET_SOURCES[body.source]}`,
    });
    if (assigneeId) {
      log(record, 'ASSIGNED', body.assignTo === 'AUTO' ? 'System' : agent.name, now, {
        to: agentName(assigneeId),
        note: body.assignTo === 'AUTO' ? 'Round robin' : null,
      });
    } else {
      log(record, 'AUTOMATION', 'System', now, { note: 'Placed in the Support Team queue' });
    }
    for (const file of files) log(record, 'ATTACHMENT', agent.name, now, { to: file.name });
    if (record.notes.length) log(record, 'NOTE', agent.name, now);
    notify(record, 'NEW_TICKET', now);
    if (assigneeId && body.notifyAssignee) notify(record, 'ASSIGNED', now);
    critical(record, now);
    s.tickets.push(record);
    return view(record, now);
  },

  /** Status, priority or category from the header and the Ticket Information card. */
  updateTicket: async (id: string, body: TicketChange): Promise<SupportTicket> => {
    await ready();
    const record = find(id);
    fresh(record, body.version);
    const s = db();
    const { agent } = me();
    const now = Date.now();
    if (body.status && body.status !== record.status) {
      if (body.status === 'ESCALATED') throw invalid('Escalate with a reason');
      if (body.status === 'RESOLVED') need('RESOLVE');
      if (body.status === 'CLOSED') need('CLOSE');
      const reopening = !isActive(record.status) && isActive(body.status);
      setStatus(record, body.status, agent.name, now);
      if (body.status === 'RESOLVED') {
        record.resolvedAt = iso(now);
        record.slaStartAt = null;
        notify(record, 'RESOLVED', now);
      }
      if (body.status === 'CLOSED') {
        record.closedAt = iso(now);
        record.slaStartAt = null;
        notify(record, 'CLOSED', now);
      }
      if (reopening) {
        record.resolvedAt = null;
        record.closedAt = null;
        record.slaStartAt = iso(now);
        log(record, 'REOPENED', agent.name, now);
        notify(record, 'REOPENED', now);
      }
    }
    if (body.priorityId && body.priorityId !== record.priorityId) {
      const priority = s.settings.priorities.find((p) => p.id === body.priorityId && p.active);
      if (!priority) throw invalid('Select an active priority');
      log(record, 'PRIORITY_CHANGED', agent.name, now, {
        from: s.settings.priorities.find((p) => p.id === record.priorityId)?.name ?? null,
        to: priority.name,
      });
      record.priorityId = priority.id;
      record.priorityEscalationChecked = false;
      critical(record, now);
    }
    if (body.categoryId && body.categoryId !== record.categoryId) {
      const category = s.settings.categories.find((c) => c.id === body.categoryId && c.active);
      if (!category) throw invalid('Select an active category');
      log(record, 'CATEGORY_CHANGED', agent.name, now, {
        from: s.settings.categories.find((c) => c.id === record.categoryId)?.name ?? null,
        to: category.name,
      });
      record.categoryId = category.id;
    }
    if (record.assigneeId === agent.id) record.acceptedAt ??= iso(now);
    touch(record, now);
    return view(record, now);
  },

  assign: async (
    id: string,
    body: { version: number; assignTo: AssignTo; notify: boolean },
  ): Promise<SupportTicket> => {
    await ready();
    need('ASSIGN');
    const record = find(id);
    fresh(record, body.version);
    const { agent } = me();
    const now = Date.now();
    const next = resolveAssignee(body.assignTo);
    if (next === record.assigneeId) return view(record, now);
    const before = record.assigneeId;
    log(record, before ? (next ? 'REASSIGNED' : 'UNASSIGNED') : 'ASSIGNED', agent.name, now, {
      from: before ? agentName(before) : null,
      to: next ? agentName(next) : 'Support Team queue',
    });
    record.assigneeId = next;
    record.assignedAt = next ? iso(now) : null;
    record.acceptedAt = next === agent.id ? iso(now) : null;
    if (next && body.notify) notify(record, before ? 'REASSIGNED' : 'ASSIGNED', now);
    touch(record, now);
    return view(record, now);
  },

  escalate: async (
    id: string,
    body: { version: number; reason: string },
  ): Promise<SupportTicket> => {
    await ready();
    need('ESCALATE');
    const record = find(id);
    fresh(record, body.version);
    const reason = body.reason.trim();
    if (!reason) throw invalid('Give a reason for the escalation');
    if (reason.length > 500) throw invalid('Keep the reason under 500 characters');
    if (!isActive(record.status)) throw invalid('Reopen the ticket before escalating it');
    const now = Date.now();
    escalate(record, reason, me().agent.name, now);
    touch(record, now);
    return view(record, now);
  },

  merge: async (
    id: string,
    body: { version: number; sourceId: string },
  ): Promise<SupportTicket> => {
    await ready();
    need('MERGE');
    const target = find(id);
    fresh(target, body.version);
    if (body.sourceId === id) throw invalid('Choose another ticket to merge');
    const source = find(body.sourceId);
    if (source.mergedInto) throw invalid('That ticket was already merged');
    const { agent } = me();
    const now = Date.now();
    const from = source.number;
    target.messages.push(...source.messages.map((m) => ({ ...m, mergedFrom: from })));
    target.messages.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    target.notes.push(...source.notes.map((n) => ({ ...n, mergedFrom: from })));
    target.attachments.push(...source.attachments.map((a) => ({ ...a, mergedFrom: from })));
    target.activity.push(
      ...source.activity.map((entry) => ({
        ...entry,
        note: `${entry.note ? `${entry.note} ` : ''}(from #${String(from).padStart(4, '0')})`,
      })),
    );
    log(target, 'MERGED', agent.name, now, {
      from: `#${String(from).padStart(4, '0')}`,
      to: `#${String(target.number).padStart(4, '0')}`,
    });
    log(source, 'MERGED', agent.name, now, {
      from: `#${String(from).padStart(4, '0')}`,
      to: `#${String(target.number).padStart(4, '0')}`,
    });
    source.mergedInto = target.id;
    if (source.status !== 'CLOSED') {
      setStatus(source, 'CLOSED', agent.name, now);
      source.closedAt = iso(now);
      source.slaStartAt = null;
    }
    touch(source, now);
    touch(target, now);
    return view(target, now);
  },

  /** A reply to the client, or an internal note (never shown to the client). */
  reply: async (
    id: string,
    body: {
      mode: 'REPLY' | 'NOTE';
      body: string;
      sendToClient: boolean;
      attachments: AttachmentInput[];
    },
  ): Promise<SupportTicket> => {
    await ready();
    const record = find(id);
    const text = body.body.trim();
    if (!text) throw invalid(body.mode === 'NOTE' ? 'Write the note first' : 'Write a reply first');
    if (text.length > TEXT_MAX) throw invalid('This message is too long');
    const { agent } = me();
    const now = Date.now();
    const files = storeFiles(body.attachments, agent.name, now);
    if (body.mode === 'NOTE') {
      need('VIEW_INTERNAL_NOTES');
      record.notes.push({
        id: nextId('06'),
        author: agent.name,
        body: text,
        at: iso(now),
        mergedFrom: null,
      });
      record.attachments.push(...files);
      log(record, 'NOTE', agent.name, now);
    } else {
      record.messages.push({
        id: nextId('05'),
        author: { name: agent.name, role: 'SUPPORT' },
        body: text,
        at: iso(now),
        attachments: files.map((f) => ({ id: f.id, name: f.name })),
        sentToClient: body.sendToClient,
        mergedFrom: null,
      });
      record.attachments.push(...files);
      log(record, 'MESSAGE', agent.name, now, {
        note: body.sendToClient
          ? 'Sent to the client by email and portal'
          : 'Kept in the conversation',
      });
      if (body.sendToClient) {
        record.firstResponseAt ??= iso(now);
        record.slaStartAt = null;
        notify(record, 'REPLY', now);
      }
    }
    for (const file of files) log(record, 'ATTACHMENT', agent.name, now, { to: file.name });
    if (record.assigneeId === agent.id) record.acceptedAt ??= iso(now);
    touch(record, now);
    return view(record, now);
  },

  addAttachments: async (id: string, files: AttachmentInput[]): Promise<SupportTicket> => {
    await ready();
    const record = find(id);
    if (files.length === 0) throw invalid('Choose a file');
    const { agent } = me();
    const now = Date.now();
    const stored = storeFiles(files, agent.name, now);
    record.attachments.push(...stored);
    for (const file of stored) log(record, 'ATTACHMENT', agent.name, now, { to: file.name });
    touch(record, now);
    return view(record, now);
  },

  changeContact: async (
    id: string,
    body: { version: number; firmId: string; contactId: string },
  ): Promise<SupportTicket> => {
    await ready();
    const record = find(id);
    fresh(record, body.version);
    const s = db();
    const firm = s.firms.find((f) => f.id === body.firmId);
    if (!firm) throw invalid('Select a firm');
    const contact = firm.contacts.find((c) => c.id === body.contactId);
    if (!contact) throw invalid('Select a contact from this firm');
    const now = Date.now();
    const before = s.firms.find((f) => f.id === record.firmId);
    const beforeContact = before?.contacts.find((c) => c.id === record.contactId);
    log(record, 'FIRM_CHANGED', me().agent.name, now, {
      from: `${before?.name ?? 'Unknown firm'} (${beforeContact?.name ?? 'Unknown contact'})`,
      to: `${firm.name} (${contact.name})`,
    });
    record.firmId = firm.id;
    record.contactId = contact.id;
    touch(record, now);
    return view(record, now);
  },

  deleteTicket: async (id: string, body: { version: number }): Promise<{ ok: true }> => {
    await ready();
    need('DELETE');
    const record = find(id);
    fresh(record, body.version);
    record.deleted = true;
    log(record, 'AUTOMATION', me().agent.name, Date.now(), { note: 'Ticket deleted' });
    return { ok: true };
  },

  // Support Settings ---------------------------------------------------------------------------

  saveCategory: async (body: {
    id?: string;
    name: string;
    description: string;
  }): Promise<SupportCategory> => {
    await ready();
    need('EDIT_SETTINGS');
    const { categories } = db().settings;
    const name = checkName(body.name, 'category name');
    const description = body.description.trim().slice(0, 200);
    if (categories.some((c) => c.id !== body.id && c.name.toLowerCase() === name.toLowerCase())) {
      throw new ApiRequestError(409, 'DUPLICATE_NAME', 'A category with this name exists');
    }
    const existing = categories.find((c) => c.id === body.id);
    if (body.id && !existing) throw new ApiRequestError(404, 'NOT_FOUND', 'Category not found');
    if (existing) {
      existing.name = name;
      existing.description = description;
      return { ...existing };
    }
    const created = { id: nextId('09'), name, description, active: true };
    categories.push(created);
    return { ...created };
  },

  setCategoryActive: async (id: string, active: boolean): Promise<SupportCategory> => {
    await ready();
    need('EDIT_SETTINGS');
    const category = db().settings.categories.find((c) => c.id === id);
    if (!category) throw new ApiRequestError(404, 'NOT_FOUND', 'Category not found');
    category.active = active;
    return { ...category };
  },

  savePriority: async (body: {
    id?: string;
    name: string;
    description: string;
    color: PriorityColor;
    target: ResponseTarget;
  }): Promise<SupportPriority> => {
    await ready();
    need('EDIT_SETTINGS');
    const { priorities } = db().settings;
    const name = checkName(body.name, 'priority name');
    if (!(body.color in PRIORITY_COLORS)) throw invalid('Choose a colour');
    const amount = Math.round(body.target.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 999) {
      throw invalid('Enter a response target from 1 to 999');
    }
    if (body.target.unit !== 'HOURS' && body.target.unit !== 'BUSINESS_DAYS') {
      throw invalid('Choose hours or business days');
    }
    if (priorities.some((p) => p.id !== body.id && p.name.toLowerCase() === name.toLowerCase())) {
      throw new ApiRequestError(409, 'DUPLICATE_NAME', 'A priority with this name exists');
    }
    const fields = {
      name,
      description: body.description.trim().slice(0, 200),
      color: body.color,
      target: { amount, unit: body.target.unit },
    };
    const existing = priorities.find((p) => p.id === body.id);
    if (body.id && !existing) throw new ApiRequestError(404, 'NOT_FOUND', 'Priority not found');
    if (existing) {
      Object.assign(existing, fields);
      return structuredClone(existing);
    }
    const created: SupportPriority = {
      id: nextId('0a'),
      ...fields,
      active: true,
      rank: Math.max(0, ...priorities.map((p) => p.rank)) + 1,
    };
    priorities.push(created);
    return structuredClone(created);
  },

  setPriorityActive: async (id: string, active: boolean): Promise<SupportPriority> => {
    await ready();
    need('EDIT_SETTINGS');
    const { priorities } = db().settings;
    const priority = priorities.find((p) => p.id === id);
    if (!priority) throw new ApiRequestError(404, 'NOT_FOUND', 'Priority not found');
    if (!active && priorities.filter((p) => p.active).length === 1 && priority.active) {
      throw new ApiRequestError(422, 'UNPROCESSABLE', 'Keep at least one active priority');
    }
    priority.active = active;
    return structuredClone(priority);
  },

  saveBusinessHours: async (body: Omit<BusinessHours, 'holidays'>): Promise<BusinessHours> => {
    await ready();
    need('EDIT_SETTINGS');
    if (!TIME_ZONES.some((z) => z.value === body.timeZone)) throw invalid('Choose a time zone');
    if (body.days.length !== 7) throw invalid('Set all seven days');
    if (!body.days.some((d) => d.open)) throw invalid('Open at least one day');
    for (const day of body.days) {
      if (day.open && toMinutes(day.end) <= toMinutes(day.start)) {
        throw invalid(`${WEEKDAYS[day.day] ?? 'A day'} must close after it opens`);
      }
    }
    const hours = db().settings.businessHours;
    hours.timeZone = body.timeZone;
    hours.days = structuredClone(body.days);
    hours.clock = body.clock;
    return structuredClone(hours);
  },

  addHoliday: async (body: { date: string; name: string }): Promise<Holiday> => {
    await ready();
    need('EDIT_SETTINGS');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) throw invalid('Choose a date');
    const name = checkName(body.name, 'holiday name');
    const { holidays } = db().settings.businessHours;
    if (holidays.some((h) => h.date === body.date)) {
      throw new ApiRequestError(409, 'DUPLICATE_NAME', 'That date is already a holiday');
    }
    const created = { id: nextId('0c'), date: body.date, name };
    holidays.push(created);
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    return { ...created };
  },

  removeHoliday: async (id: string): Promise<{ ok: true }> => {
    await ready();
    need('EDIT_SETTINGS');
    const hours = db().settings.businessHours;
    hours.holidays = hours.holidays.filter((h) => h.id !== id);
    return { ok: true };
  },

  saveAssignment: async (body: AssignmentRules): Promise<AssignmentRules> => {
    await ready();
    need('EDIT_SETTINGS');
    const after = Math.round(body.reassignAfterHours);
    if (body.reassign && (!Number.isFinite(after) || after < 1 || after > 72)) {
      throw invalid('Reassign after 1 to 72 hours');
    }
    const rules = db().settings;
    rules.assignment = {
      ...body,
      reassignAfterHours: Number.isFinite(after) && after > 0 ? after : 4,
    };
    return { ...rules.assignment };
  },

  saveEscalation: async (body: EscalationRules): Promise<EscalationRules> => {
    await ready();
    need('EDIT_SETTINGS');
    const { priorities } = db().settings;
    if (!priorities.some((p) => p.id === body.highPriority.priorityId)) {
      throw invalid('Choose the priority for the high-priority rule');
    }
    if (!priorities.some((p) => p.id === body.critical.priorityId)) {
      throw invalid('Choose the priority for the critical rule');
    }
    const amount = Math.round(body.highPriority.target.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 999) {
      throw invalid('Enter a time from 1 to 999');
    }
    db().settings.escalation = structuredClone({
      ...body,
      highPriority: { ...body.highPriority, target: { ...body.highPriority.target, amount } },
    });
    return structuredClone(db().settings.escalation);
  },

  saveCanned: async (body: {
    id?: string;
    title: string;
    body: string;
    categoryId: string | null;
  }): Promise<CannedResponse> => {
    await ready();
    need('MANAGE_CANNED');
    const s = db();
    const title = checkName(body.title, 'title');
    const text = body.body.trim();
    if (!text) throw invalid('Write the message');
    if (text.length > TEXT_MAX) throw invalid('This message is too long');
    if (body.categoryId && !s.settings.categories.some((c) => c.id === body.categoryId)) {
      throw invalid('Choose a category');
    }
    const list = s.settings.cannedResponses;
    const existing = list.find((c) => c.id === body.id);
    if (body.id && !existing) throw new ApiRequestError(404, 'NOT_FOUND', 'Response not found');
    const now = iso(Date.now());
    if (existing) {
      Object.assign(existing, { title, body: text, categoryId: body.categoryId, updatedAt: now });
      return { ...existing };
    }
    const created: CannedResponse = {
      id: nextId('0b'),
      title,
      body: text,
      categoryId: body.categoryId,
      active: true,
      createdBy: me().agent.name,
      updatedAt: now,
    };
    list.push(created);
    return { ...created };
  },

  setCannedActive: async (id: string, active: boolean): Promise<CannedResponse> => {
    await ready();
    need('MANAGE_CANNED');
    const canned = db().settings.cannedResponses.find((c) => c.id === id);
    if (!canned) throw new ApiRequestError(404, 'NOT_FOUND', 'Response not found');
    canned.active = active;
    canned.updatedAt = iso(Date.now());
    return { ...canned };
  },

  saveNotifications: async (body: NotificationSettings): Promise<NotificationSettings> => {
    await ready();
    need('EDIT_SETTINGS');
    const rules = body.rules.map((rule) => ({
      event: rule.event,
      recipients: rule.recipients.filter(
        (r) => r !== 'CLIENT' || CLIENT_EVENTS.includes(rule.event),
      ),
    }));
    db().settings.notifications = { channels: [...body.channels], rules };
    return structuredClone(db().settings.notifications);
  },

  savePermissions: async (body: PermissionGrid): Promise<PermissionGrid> => {
    await ready();
    need('EDIT_SETTINGS');
    if (!body.OWNER.includes('EDIT_SETTINGS')) {
      throw new ApiRequestError(
        422,
        'UNPROCESSABLE',
        'The Owner must keep the right to edit settings',
      );
    }
    db().settings.permissions = structuredClone(body);
    return structuredClone(body);
  },
};

// ---------------------------------------------------------------------------------------------
// Seed: built on first use (a mock runs nothing on import)

const FIRMS: [string, string, [string, string][]][] = [
  [
    'Sample Sunrise Tax Group',
    'sunrise-tax',
    [
      ['John Smith', 'john.smith'],
      ['Ana Rivera', 'ana.rivera'],
    ],
  ],
  ['Sample Carter & Associates CPA', 'carter-cpa', [['Emily Carter', 'emily.carter']]],
  ['Sample Riverside Tax Co', 'riverside-tax', [['David Kim', 'david.kim']]],
  ['Sample Mason Bookkeeping', 'mason-books', [['Sara White', 'sara.white']]],
  ['Sample Thompson & Partners', 'thompson-partners', [['Alex Thompson', 'alex.thompson']]],
  ['Sample Bright Path Accounting', 'bright-path', [['Nicole Adams', 'nicole.adams']]],
  ['Sample Greenwood Tax', 'greenwood-tax', [['Michael Green', 'michael.green']]],
  ['Sample Lakeview Payroll', 'lakeview-payroll', [['Chris Lake', 'chris.lake']]],
  ['Sample Parker CPA Firm', 'parker-cpa', [['Jessica Parker', 'jessica.parker']]],
  ['Sample Willow & Co.', 'willow-co', [['Brian Hill', 'brian.hill']]],
];

type AgentKey = 'marcus' | 'priya' | 'daniel' | 'sophia' | 'jordan';
type CategoryKey =
  | 'access'
  | 'billing'
  | 'filing'
  | 'compliance'
  | 'technical'
  | 'general'
  | 'onboarding'
  | 'feature';
type PriorityKey = 'critical' | 'high' | 'medium' | 'low';

interface SeedTicket {
  n: number;
  subject: string;
  firm: number;
  contact?: number;
  category: CategoryKey;
  priority: PriorityKey;
  source: TicketSource;
  assignee?: AgentKey;
  /** Hours ago. */
  created: number;
  /** [who, hours ago, text]; the opening message comes from `body`. */
  thread?: ['CLIENT' | 'SUPPORT', number, string][];
  body: string;
  /** Status changes in order: [status, hours ago]. */
  steps?: [TicketStatus, number][];
  notes?: [AgentKey, number, string][];
  files?: [string, string, number, 'CLIENT' | 'SUPPORT', number][];
  breached?: number;
  escalated?: [number, string, AgentKey | 'SYSTEM'];
}

function seedTickets(): SeedTicket[] {
  return [
    {
      n: 1001,
      subject: 'Unable to log in',
      firm: 0,
      category: 'access',
      priority: 'high',
      source: 'PORTAL',
      assignee: 'marcus',
      created: 85 / 60,
      body: "Hi, I'm unable to log in to my account. I keep getting an invalid credentials error even though I'm using the correct email and password. Can you please help?",
      thread: [
        [
          'SUPPORT',
          68 / 60,
          "Hi John,\n\nThanks for reaching out. I'll be happy to help. Can you please confirm the email address you're using and let me know if you've tried resetting your password?",
        ],
        [
          'CLIENT',
          55 / 60,
          "Yes, it's john.smith@sunrise-tax.example.test. I did try resetting the password but I never received the email.",
        ],
        [
          'SUPPORT',
          30 / 60,
          "Thanks for confirming. I've just resent the password reset email. Please check your inbox (and spam folder) and let me know if you receive it.",
        ],
        [
          'CLIENT',
          15 / 60,
          "Got it! I was able to reset my password and I'm logged in now. Thanks for the help!",
        ],
      ],
      notes: [
        [
          'marcus',
          60 / 60,
          'Reset emails to this domain were delayed by the mail provider this morning.',
        ],
        ['marcus', 25 / 60, 'Resent the reset link manually. Close once the client confirms.'],
      ],
      files: [
        ['login-error.png', 'image/png', 182_000, 'CLIENT', 85 / 60],
        ['browser-console.txt', 'text/plain', 4_200, 'CLIENT', 55 / 60],
        ['reset-steps.pdf', 'application/pdf', 96_000, 'SUPPORT', 30 / 60],
      ],
    },
    {
      n: 1000,
      subject: 'Billing question',
      firm: 1,
      category: 'billing',
      priority: 'medium',
      source: 'EMAIL',
      assignee: 'marcus',
      created: 3,
      body: 'We were charged for six seats this month but only have five staff members. Can you check our invoice?',
      thread: [
        [
          'SUPPORT',
          2,
          "I'm checking the seat count with billing now and will confirm the adjustment shortly.",
        ],
      ],
      steps: [['IN_PROGRESS', 2]],
    },
    {
      n: 999,
      subject: 'Error in application',
      firm: 2,
      category: 'technical',
      priority: 'high',
      source: 'PORTAL',
      created: 1,
      body: 'The client list shows an error banner when we filter by tax year 2025.',
    },
    {
      n: 998,
      subject: 'Feature request',
      firm: 3,
      category: 'feature',
      priority: 'low',
      source: 'PORTAL',
      assignee: 'priya',
      created: 50,
      body: 'Could the document request list be exported to a spreadsheet?',
      thread: [['SUPPORT', 26, 'Thanks for the idea. Which columns would you need in the export?']],
      steps: [
        ['IN_PROGRESS', 26],
        ['WAITING_ON_CUSTOMER', 26],
      ],
    },
    {
      n: 997,
      subject: 'Update user permissions',
      firm: 4,
      category: 'access',
      priority: 'medium',
      source: 'EMAIL',
      created: 2,
      body: 'Please help us give our new staff member access to invoices only.',
    },
    {
      n: 996,
      subject: 'Invoice discrepancy',
      firm: 5,
      category: 'billing',
      priority: 'high',
      source: 'PORTAL',
      assignee: 'daniel',
      created: 9 * 24,
      body: 'The total on invoice 2041 does not match the plan price on our account.',
      notes: [['daniel', 9 * 24 - 2, 'Asked billing for the plan history before replying.']],
      breached: 9 * 24 - 4,
      escalated: [9 * 24 - 4, 'Response time exceeded the SLA target', 'SYSTEM'],
    },
    {
      n: 995,
      subject: 'Need onboarding help',
      firm: 6,
      category: 'onboarding',
      priority: 'medium',
      source: 'PHONE',
      assignee: 'sophia',
      created: 48,
      body: 'We would like a walkthrough of the client portal setup.',
      thread: [['SUPPORT', 30, 'Happy to help. I have sent two times for a walkthrough call.']],
      steps: [['IN_PROGRESS', 30]],
    },
    {
      n: 994,
      subject: 'Integration issue',
      firm: 7,
      category: 'technical',
      priority: 'medium',
      source: 'EMAIL',
      created: 10 * 24,
      body: 'Our payroll export stopped syncing last week.',
      breached: 10 * 24 - 12,
      escalated: [10 * 24 - 12, 'Response time exceeded the SLA target', 'SYSTEM'],
    },
    {
      n: 990,
      subject: 'Bank feed not syncing',
      firm: 0,
      contact: 1,
      category: 'technical',
      priority: 'critical',
      source: 'PHONE',
      assignee: 'marcus',
      created: 12 * 24,
      body: 'None of our bank transactions have imported for two days.',
      notes: [['marcus', 12 * 24 - 1, 'Waiting on the bank connection provider.']],
      breached: 12 * 24 - 1,
      escalated: [12 * 24 - 1, 'Response time exceeded the SLA target', 'SYSTEM'],
    },
    {
      n: 989,
      subject: 'E-file rejected',
      firm: 1,
      category: 'filing',
      priority: 'medium',
      source: 'PORTAL',
      assignee: 'priya',
      created: 2.5,
      body: 'An e-file was rejected with code R0000-504. What should we change?',
    },
    {
      n: 988,
      subject: 'Quarterly notice question',
      firm: 2,
      category: 'compliance',
      priority: 'low',
      source: 'EMAIL',
      assignee: 'priya',
      created: 5 * 24,
      body: 'Does the compliance calendar include state quarterly notices?',
      thread: [['SUPPORT', 4 * 24, 'It does for most states. Which state are you filing in?']],
      steps: [
        ['IN_PROGRESS', 4 * 24],
        ['WAITING_ON_CUSTOMER', 4 * 24],
      ],
    },
    {
      n: 987,
      subject: 'Payroll tax form missing',
      firm: 8,
      category: 'filing',
      priority: 'high',
      source: 'PORTAL',
      assignee: 'daniel',
      created: 24,
      body: 'The 941 form is missing from the payroll reports page.',
      thread: [['SUPPORT', 22, 'Thanks, I can see it too. Our team is regenerating the reports.']],
      steps: [['IN_PROGRESS', 22]],
    },
    {
      n: 986,
      subject: 'Two-factor reset',
      firm: 9,
      category: 'access',
      priority: 'medium',
      source: 'PHONE',
      assignee: 'sophia',
      created: 2,
      body: 'I replaced my phone and can no longer get two-factor codes.',
    },
    {
      n: 993,
      subject: 'Report not loading',
      firm: 8,
      category: 'technical',
      priority: 'low',
      source: 'PORTAL',
      assignee: 'marcus',
      created: 6 * 24,
      body: 'The revenue report spins and never loads.',
      thread: [
        ['SUPPORT', 5 * 24, 'We fixed a slow query behind this report. It should load now.'],
      ],
      steps: [
        ['IN_PROGRESS', 5 * 24 + 2],
        ['RESOLVED', 5 * 24],
      ],
    },
    {
      n: 992,
      subject: 'General question',
      firm: 9,
      category: 'general',
      priority: 'low',
      source: 'EMAIL',
      assignee: 'priya',
      created: 7 * 24,
      body: 'Where can we change the logo shown to our clients?',
      thread: [['SUPPORT', 6 * 24, 'Settings > Company Profile & Branding has the logo upload.']],
      steps: [
        ['RESOLVED', 6 * 24],
        ['CLOSED', 4 * 24],
      ],
    },
    {
      n: 991,
      subject: 'Duplicate charge',
      firm: 4,
      category: 'billing',
      priority: 'high',
      source: 'EMAIL',
      assignee: 'daniel',
      created: 12 * 24,
      body: 'Our card was charged twice for October.',
      thread: [['SUPPORT', 12 * 24 - 2, 'The second charge has been refunded.']],
      steps: [
        ['IN_PROGRESS', 12 * 24 - 2],
        ['RESOLVED', 11 * 24],
      ],
    },
    {
      n: 985,
      subject: 'Login loop',
      firm: 3,
      category: 'access',
      priority: 'medium',
      source: 'PORTAL',
      assignee: 'marcus',
      created: 15 * 24,
      body: 'After signing in we are sent back to the sign-in page.',
      thread: [
        [
          'SUPPORT',
          15 * 24 - 3,
          'Clearing the old session cookie fixes this; we have released a fix too.',
        ],
      ],
      steps: [
        ['RESOLVED', 14 * 24],
        ['CLOSED', 12 * 24],
      ],
    },
    {
      n: 984,
      subject: 'Document upload failed',
      firm: 6,
      category: 'filing',
      priority: 'medium',
      source: 'PORTAL',
      assignee: 'sophia',
      created: 18 * 24,
      body: 'Uploading a 6 MB PDF fails at 90%.',
      thread: [['SUPPORT', 18 * 24 - 4, 'This was a timeout on our side and is fixed now.']],
      steps: [
        ['IN_PROGRESS', 18 * 24 - 4],
        ['RESOLVED', 17 * 24],
      ],
    },
    {
      n: 983,
      subject: 'W-2 template',
      firm: 7,
      category: 'filing',
      priority: 'low',
      source: 'EMAIL',
      assignee: 'priya',
      created: 20 * 24,
      body: 'Is there a template for sending W-2 requests to clients?',
      thread: [['SUPPORT', 20 * 24 - 5, 'Yes: Document Requests > Templates has a W-2 request.']],
      steps: [
        ['RESOLVED', 19 * 24],
        ['CLOSED', 16 * 24],
      ],
    },
    {
      n: 982,
      subject: 'Compliance calendar dates',
      firm: 5,
      category: 'compliance',
      priority: 'medium',
      source: 'WEB_FORM',
      assignee: 'daniel',
      created: 25 * 24,
      body: 'Two state deadlines show the wrong date.',
      thread: [['SUPPORT', 25 * 24 - 6, 'Corrected. Thank you for flagging it.']],
      steps: [['RESOLVED', 24 * 24]],
    },
    {
      n: 981,
      subject: 'Plan upgrade question',
      firm: 1,
      category: 'billing',
      priority: 'low',
      source: 'EMAIL',
      assignee: 'marcus',
      created: 35 * 24,
      body: 'What changes if we move to the Growth plan?',
      thread: [['SUPPORT', 35 * 24 - 3, 'I have sent the plan comparison to your email.']],
      steps: [
        ['RESOLVED', 34 * 24],
        ['CLOSED', 31 * 24],
      ],
    },
    {
      n: 980,
      subject: 'Password expired',
      firm: 2,
      category: 'access',
      priority: 'medium',
      source: 'PHONE',
      assignee: 'jordan',
      created: 40 * 24,
      body: 'My password expired and the reset link does not arrive.',
      thread: [['SUPPORT', 40 * 24 - 2, 'Reset link resent from a different sender.']],
      steps: [
        ['RESOLVED', 39 * 24],
        ['CLOSED', 37 * 24],
      ],
    },
    {
      n: 979,
      subject: 'Client portal error',
      firm: 0,
      category: 'technical',
      priority: 'high',
      source: 'PORTAL',
      assignee: 'priya',
      created: 45 * 24,
      body: 'Clients see a blank page after signing in.',
      thread: [['SUPPORT', 45 * 24 - 1, 'A fix is live; please ask clients to reload.']],
      steps: [
        ['RESOLVED', 44 * 24],
        ['CLOSED', 42 * 24],
      ],
    },
    {
      n: 978,
      subject: 'Filing deadline alert',
      firm: 8,
      category: 'compliance',
      priority: 'medium',
      source: 'EMAIL',
      assignee: 'daniel',
      created: 50 * 24,
      body: 'We did not get the reminder for the extension deadline.',
      thread: [
        ['SUPPORT', 50 * 24 - 3, 'Reminders were paused on your account; they are back on.'],
      ],
      steps: [
        ['RESOLVED', 49 * 24],
        ['CLOSED', 47 * 24],
      ],
    },
    {
      n: 977,
      subject: 'Invoice PDF blank',
      firm: 9,
      category: 'billing',
      priority: 'low',
      source: 'PORTAL',
      assignee: 'jordan',
      created: 55 * 24,
      body: 'Downloaded invoices open as a blank PDF.',
      thread: [['SUPPORT', 55 * 24 - 4, 'Fixed in the latest release.']],
      steps: [
        ['RESOLVED', 53 * 24],
        ['CLOSED', 50 * 24],
      ],
    },
    {
      n: 976,
      subject: 'Sync question',
      firm: 7,
      category: 'general',
      priority: 'low',
      source: 'INTERNAL',
      assignee: 'sophia',
      created: 58 * 24,
      body: 'Follow-up from the onboarding call about calendar sync.',
      thread: [['SUPPORT', 58 * 24 - 1, 'Calendar sync steps shared with the firm.']],
      steps: [
        ['RESOLVED', 57 * 24],
        ['CLOSED', 56 * 24],
      ],
    },
  ];
}

function seed(): Store {
  const empty = mockedEmpty(MODULE);
  const now = Date.now();
  const ago = (hours: number) => iso(now - hours * HOUR);

  const agentList: [AgentKey | 'me', string, string, AgentRole, boolean, boolean][] = [
    ['marcus', 'Marcus Lee', 'marcus.lee', 'LEAD', true, true],
    ['priya', 'Priya Shah', 'priya.shah', 'AGENT', true, true],
    ['daniel', 'Daniel Park', 'daniel.park', 'AGENT', true, true],
    ['sophia', 'Sophia Martinez', 'sophia.martinez', 'AGENT', true, false],
    ['jordan', 'Jordan Former', 'jordan.former', 'AGENT', false, false],
    ['me', 'Morgan Admin', 'morgan.admin', 'OWNER', true, true],
  ];
  const agentIds = new Map<string, string>();
  const agents: SupportAgent[] = agentList.map(([key, name, mail, role, active, available], i) => {
    const id = key === 'me' ? ME_ID : uuid('02', i + 1);
    agentIds.set(key, id);
    return {
      id,
      name,
      email: key === 'me' ? 'morgan.admin@example.test' : `${mail}@firmivra.example.test`,
      role,
      active,
      available,
    };
  });

  let contactNo = 0;
  const firms: SupportFirm[] = FIRMS.map(([name, domain, contacts], i) => ({
    id: uuid('03', i + 1),
    name,
    contacts: contacts.map(([person, mail], c) => {
      contactNo += 1;
      return {
        id: uuid('04', contactNo),
        name: person,
        email: `${mail}@${domain}.example.test`,
        phone: `(404) 555-01${String(contactNo).padStart(2, '0')}`,
        primary: c === 0,
      };
    }),
  }));

  const categoryList: [CategoryKey, string, string, boolean][] = [
    ['access', 'Account Access', 'Login, password, 2FA, account lockout, etc.', true],
    ['billing', 'Billing & Payments', 'Invoices, payments, refunds, subscription issues', true],
    ['filing', 'Document Filing', 'Issues with document uploads, processing, or status', true],
    ['compliance', 'Compliance', 'State/federal filing requirements, notices, deadlines', true],
    ['technical', 'Technical Issue', 'System errors, bugs, unexpected behavior', true],
    ['general', 'General Inquiry', 'Other questions or support requests', true],
    ['onboarding', 'Onboarding', 'Setting up a new firm (retired: kept on older tickets)', false],
    ['feature', 'Feature Request', 'Ideas for the product (retired: kept on older tickets)', false],
  ];
  const categoryIds = new Map<CategoryKey, string>();
  const categories: SupportCategory[] = categoryList.map(([key, name, description, active], i) => {
    const id = uuid('09', i + 1);
    categoryIds.set(key, id);
    return { id, name, description, active };
  });

  const priorityList: [PriorityKey, string, string, PriorityColor, ResponseTarget][] = [
    ['critical', 'Critical', 'Urgent issue, system down', 'red', { amount: 1, unit: 'HOURS' }],
    ['high', 'High', 'High impact, needs quick resolution', 'orange', { amount: 4, unit: 'HOURS' }],
    ['medium', 'Medium', 'Standard issue', 'yellow', { amount: 1, unit: 'BUSINESS_DAYS' }],
    [
      'low',
      'Low',
      'Minor issue or general question',
      'green',
      { amount: 2, unit: 'BUSINESS_DAYS' },
    ],
  ];
  const priorityIds = new Map<PriorityKey, string>();
  const priorities: SupportPriority[] = priorityList.map(
    ([key, name, description, color, target], i) => {
      const id = uuid('0a', i + 1);
      priorityIds.set(key, id);
      return { id, name, description, color, target, active: true, rank: i + 1 };
    },
  );
  const year = new Date(now).getFullYear();
  const settings: SupportSettings = {
    categories: empty ? [] : categories,
    priorities: empty ? [] : priorities,
    businessHours: {
      timeZone: 'America/New_York',
      clock: 'BUSINESS',
      days: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        open: day >= 1 && day <= 5,
        start: '08:00',
        end: '18:00',
      })),
      holidays: empty
        ? []
        : [
            { id: uuid('0c', 1), date: `${year}-11-26`, name: 'Thanksgiving Day' },
            { id: uuid('0c', 2), date: `${year}-12-25`, name: 'Christmas Day' },
            { id: uuid('0c', 3), date: `${year + 1}-01-01`, name: "New Year's Day" },
          ],
    },
    assignment: { defaultQueue: true, roundRobin: true, reassign: true, reassignAfterHours: 4 },
    escalation: {
      slaBreach: { enabled: true, notify: 'LEAD' },
      highPriority: {
        enabled: true,
        priorityId: priorityIds.get('high') ?? '',
        target: { amount: 1, unit: 'BUSINESS_DAYS' },
      },
      critical: {
        enabled: true,
        priorityId: priorityIds.get('critical') ?? '',
        channels: ['EMAIL', 'SMS'],
      },
    },
    cannedResponses: empty
      ? []
      : [
          [
            'Password Reset Instructions',
            'access',
            'Hi,\n\nYou can reset your password from the sign-in page with "Forgot password". The link arrives within a few minutes; please check your spam folder too.',
            8 * 24,
          ] as const,
          [
            'Payment Received',
            'billing',
            'Hi,\n\nThank you, we have received your payment. A receipt is on its way to your email.',
            10 * 24,
          ] as const,
          [
            'Document Approved',
            'filing',
            'Hi,\n\nYour document has been reviewed and approved. No further action is needed.',
            13 * 24,
          ] as const,
        ].map(([title, category, body, hours], i) => ({
          id: uuid('0b', i + 1),
          title,
          body,
          categoryId: categoryIds.get(category) ?? null,
          active: true,
          createdBy: 'Marcus Lee',
          updatedAt: ago(hours),
        })),
    notifications: {
      channels: ['IN_APP', 'EMAIL', 'SMS'],
      rules: (Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]).map(
        (event): NotificationRule => ({
          event,
          recipients:
            event === 'NEW_TICKET'
              ? ['ASSIGNEE', 'CLIENT']
              : event === 'ASSIGNED' || event === 'REASSIGNED'
                ? ['ASSIGNEE']
                : event === 'ESCALATED' || event === 'SLA_BREACH'
                  ? ['ASSIGNEE', 'LEAD']
                  : event === 'SLA_WARNING' || event === 'CUSTOMER_RESPONSE'
                    ? ['ASSIGNEE']
                    : ['ASSIGNEE', 'CLIENT'],
        }),
      ),
    },
    permissions: {
      OWNER: Object.keys(SUPPORT_PERMISSIONS) as SupportPermission[],
      LEAD: [
        'VIEW_ALL',
        'VIEW_OWN',
        'ASSIGN',
        'ESCALATE',
        'RESOLVE',
        'CLOSE',
        'MERGE',
        'VIEW_INTERNAL_NOTES',
        'MANAGE_CANNED',
      ],
      AGENT: ['VIEW_OWN', 'ESCALATE', 'RESOLVE', 'VIEW_INTERNAL_NOTES'],
    },
  };

  let counter = 0;
  const id = (kind: string) => {
    counter += 1;
    return uuid(kind, counter);
  };
  const tickets: TicketRecord[] = empty
    ? []
    : seedTickets().map((t): TicketRecord => {
        const firm = firms[t.firm];
        const contact = firm?.contacts[t.contact ?? 0];
        const assigneeId = t.assignee ? (agentIds.get(t.assignee) ?? null) : null;
        const assignee = agents.find((a) => a.id === assigneeId);
        const support = assignee?.name ?? 'Marcus Lee';
        const clientName = contact?.name ?? 'Client';
        const activity: TicketActivity[] = [];
        const add = (
          type: ActivityType,
          hours: number,
          actor: string,
          details: Partial<Pick<TicketActivity, 'from' | 'to' | 'note'>> = {},
        ) =>
          activity.push({
            id: id('08'),
            type,
            at: ago(hours),
            actor,
            from: details.from ?? null,
            to: details.to ?? null,
            note: details.note ?? null,
          });
        add('CREATED', t.created, clientName, {
          note: `Created from ${TICKET_SOURCES[t.source]}`,
        });
        if (assignee)
          add('ASSIGNED', t.created - 0.05, 'System', { to: assignee.name, note: 'Round robin' });
        const files: StoredAttachment[] = (t.files ?? []).map(([name, type, size, who, hours]) => ({
          id: id('07'),
          name,
          type,
          size,
          uploadedBy: who === 'CLIENT' ? clientName : support,
          at: ago(hours),
          mergedFrom: null,
        }));
        const fileFor = (hours: number) =>
          files.filter((f) => f.at === ago(hours)).map((f) => ({ id: f.id, name: f.name }));
        const messages: StoredMessage[] = [
          {
            id: id('05'),
            author: { name: clientName, role: 'CLIENT' },
            body: t.body,
            at: ago(t.created),
            attachments: fileFor(t.created),
            sentToClient: true,
            mergedFrom: null,
          },
          ...(t.thread ?? []).map(([who, hours, body]) => ({
            id: id('05'),
            author:
              who === 'CLIENT'
                ? { name: clientName, role: 'CLIENT' as const }
                : { name: support, role: 'SUPPORT' as const },
            body,
            at: ago(hours),
            attachments: fileFor(hours),
            sentToClient: true,
            mergedFrom: null,
          })),
        ];
        for (const message of messages.slice(1)) {
          const hours = (now - Date.parse(message.at)) / HOUR;
          add(
            message.author.role === 'CLIENT' ? 'CLIENT_REPLY' : 'MESSAGE',
            hours,
            message.author.name,
            {
              note:
                message.author.role === 'CLIENT'
                  ? 'Replied by email'
                  : 'Sent to the client by email and portal',
            },
          );
        }
        for (const file of files) {
          add('ATTACHMENT', (now - Date.parse(file.at)) / HOUR, file.uploadedBy, { to: file.name });
        }
        const notes: TicketNote[] = (t.notes ?? []).map(([who, hours, body]) => {
          add('NOTE', hours, agents.find((a) => a.id === agentIds.get(who))?.name ?? support);
          return {
            id: id('06'),
            author: agents.find((a) => a.id === agentIds.get(who))?.name ?? support,
            body,
            at: ago(hours),
            mergedFrom: null,
          };
        });
        const statusLog: { at: string; status: TicketStatus }[] = [
          { at: ago(t.created), status: 'OPEN' },
        ];
        let status: TicketStatus = 'OPEN';
        let resolvedAt: string | null = null;
        let closedAt: string | null = null;
        for (const [next, hours] of t.steps ?? []) {
          add('STATUS_CHANGED', hours, support, {
            from: TICKET_STATUSES[status],
            to: TICKET_STATUSES[next],
          });
          if (next === 'RESOLVED') {
            resolvedAt = ago(hours);
            add('RESOLVED', hours, support);
          }
          if (next === 'CLOSED') {
            closedAt = ago(hours);
            add('CLOSED', hours, support);
          }
          status = next;
          statusLog.push({ at: ago(hours), status: next });
        }
        if (t.breached !== undefined) {
          add('SLA_BREACHED', t.breached, 'System', { note: 'Response time exceeded the target' });
        }
        let escalation: TicketRecord['escalation'] = null;
        if (t.escalated) {
          const [hours, reason, by] = t.escalated;
          const actor =
            by === 'SYSTEM'
              ? 'System'
              : (agents.find((a) => a.id === agentIds.get(by))?.name ?? 'System');
          escalation = { reason, at: ago(hours), by: actor };
          add('ESCALATED', hours, actor, { note: reason });
          add('STATUS_CHANGED', hours, actor, { from: TICKET_STATUSES[status], to: 'Escalated' });
          status = 'ESCALATED';
          statusLog.push({ at: ago(hours), status });
        }
        const support1 = messages.find((m) => m.author.role === 'SUPPORT');
        const last = messages[messages.length - 1];
        const pending =
          isActive(status) && status !== 'WAITING_ON_CUSTOMER' && last?.author.role === 'CLIENT';
        const lastActivity = Math.max(...activity.map((a) => Date.parse(a.at)));
        return {
          id: id('01'),
          number: t.n,
          subject: t.subject,
          description: t.body,
          status,
          source: t.source,
          priorityId: priorityIds.get(t.priority) ?? '',
          categoryId: categoryIds.get(t.category) ?? '',
          firmId: firm?.id ?? '',
          contactId: contact?.id ?? '',
          assigneeId,
          assignedAt: assignee ? ago(t.created) : null,
          acceptedAt:
            assignee && (support1 || notes.length || t.steps?.length) ? ago(t.created) : null,
          createdBy: { name: clientName, role: 'CLIENT' },
          createdAt: ago(t.created),
          updatedAt: iso(lastActivity),
          firstResponseAt: support1?.at ?? null,
          resolvedAt,
          closedAt,
          slaStartAt: pending ? (last?.at ?? null) : null,
          warnedAt: null,
          breachedAt: t.breached === undefined ? null : ago(t.breached),
          priorityEscalationChecked: true,
          escalation,
          mergedInto: null,
          deleted: false,
          version: 1,
          requestId: null,
          statusLog,
          messages,
          notes,
          attachments: files,
          activity,
        };
      });

  return { firms, agents, settings, tickets, nextId: 1000, roundRobin: 0 };
}
