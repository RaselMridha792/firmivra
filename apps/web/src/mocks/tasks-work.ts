import {
  type AddTaskAttachmentRequest,
  ApiRequestError,
  BulkTaskRequest,
  ConvertToRecurringRequest,
  CreateTaskDetailRequest,
  CreateTaskSeriesRequest,
  CreateTaskTemplateRequest,
  type MemberRef,
  parseInput,
  PublishTaskDraftRequest,
  reminderMinutes,
  type ReminderRule,
  type ReminderRuleOut,
  ReorderChecklistRequest,
  SaveTaskDraftRequest,
  SaveTaskAsTemplateRequest,
  SaveTaskTypeRequest,
  SeriesPreviewRequest,
  SetTaskProgressRequest,
  SkipFutureRequest,
  SkipOccurrenceRequest,
  type TaskAttachment,
  TaskCalendarQuery,
  type TaskDetail,
  type TaskDraft,
  TaskDraftQuery,
  type TaskDraftRow,
  type TaskOccurrence,
  TaskOccurrencesQuery,
  TaskOverviewQuery,
  TaskSeriesQuery,
  type TaskSeriesDetail,
  type TaskTemplate,
  TaskTemplatesQuery,
  type TaskType,
  type TaskWorkClient,
  UpdateTaskAttachmentRequest,
  UpdateTaskDetailRequest,
  UpdateTaskDraftRequest,
  UpdateTaskSeriesRequest,
  UpdateTaskTemplateRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { mockStaff } from './clients';

/**
 * Mock data for `api.taskWork` (R55 contract, the Tasks module). Synthetic people and tasks only,
 * dated around today so Overdue, Upcoming and the calendar are always full. It checks input with
 * the contract's schemas and answers its codes: DUPLICATE_NAME, REQUIRED_ITEMS_OPEN,
 * DEPENDENCY_OPEN, TASK_CLOSED, OCCURRENCE_CLOSED, SERIES_NOT_ACTIVE, INVALID_RECURRENCE.
 * `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=taskWork) starts with no tasks, templates, series or
 * task types, as a firm that never set any up.
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
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = () => iso(Date.now());
const plus = (date: string, days: number) => iso(Date.parse(`${date}T12:00:00Z`) + days * DAY);
const nowIso = () => new Date().toISOString();

const CLIENTS = [
  { id: '0199b6a1-0000-7000-8000-000000000001', displayName: 'Jamie Sample' },
  { id: '0199b6a1-0000-7000-8000-000000000003', displayName: 'Riley Example' },
  { id: uuid('1c00', 3), displayName: 'Taylor Construction LLC' },
  { id: uuid('1c00', 4), displayName: 'Green Leaf Events' },
  { id: uuid('1c00', 5), displayName: 'Nova Creations' },
];
const KEVIN: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000001', name: 'Kevin Martin' };
const ALICIA: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000002', name: 'Alicia Park' };

/** One day before the due date, at the firm's default time (a days rule, as read back). */
const DAY_BEFORE: ReminderRuleOut = {
  id: null,
  daysBefore: 1,
  timeOfDay: null,
  amount: null,
  unit: null,
  inApp: true,
  channels: [],
};

/**
 * A reminder as the API reads it back: a days rule as sent, or Custom (minutes, hours or days
 * before the due time) with its amount and unit, its whole days and no time.
 */
const reminderOut = (r: ReminderRule): ReminderRuleOut => {
  const minutes = reminderMinutes(r);
  const sent = { id: null, inApp: r.inApp ?? true, channels: r.channels ?? [] };
  return minutes === null
    ? {
        ...sent,
        daysBefore: r.daysBefore ?? 0,
        timeOfDay: r.timeOfDay ?? null,
        amount: null,
        unit: null,
      }
    : {
        ...sent,
        daysBefore: Math.floor(minutes / 1_440),
        timeOfDay: null,
        amount: r.amount ?? null,
        unit: r.unit ?? null,
      };
};

/** As the API: a Custom reminder counts back from a due time (a draft keeps it until publishing). */
const refuseCustomWithoutTime = (t: TaskDetail) => {
  const timed = t.dueOn !== null && t.dueTime !== null && !t.allDay;
  if (!timed && t.reminders.some((r) => r.unit !== null))
    throw fail(400, 'INVALID_REMINDER', 'A reminder in minutes or hours needs a due time');
};

/** A draft is kept as the task it will become, with its client apart (a draft may have none). */
interface StoredDraft {
  t: TaskDetail;
  client: TaskDraft['client'];
}

interface Store {
  tasks: TaskDetail[];
  drafts: StoredDraft[];
  types: TaskType[];
  templates: TaskTemplate[];
  series: { detail: TaskSeriesDetail; occurrences: TaskOccurrence[] }[];
  next: number;
}

const rowFields = (t: Partial<TaskDetail> & { id: string; title: string }): TaskDetail => {
  const at = nowIso();
  return {
    kind: 'GENERAL',
    client: CLIENTS[0]!,
    type: null,
    engagement: null,
    service: null,
    deadline: null,
    priority: 'MEDIUM',
    status: 'OPEN',
    progress: 'NOT_STARTED',
    dueOn: null,
    dueTime: null,
    allDay: true,
    overdue: false,
    assignedTo: mockMe,
    additionalAssigneeCount: 0,
    checklist: { done: 0, total: 0 },
    blocked: false,
    recurring: false,
    clientVisible: false,
    archivedAt: null,
    updatedAt: at,
    details: null,
    engagementId: null,
    startOn: null,
    assignedUserId: mockMe.userId,
    additionalAssignees: [],
    checklistItems: [],
    reminders: [],
    attachments: [],
    dependsOn: null,
    blockedReason: null,
    internalNotes: null,
    templateId: null,
    series: null,
    completedAt: null,
    completedBy: null,
    createdBy: mockMe,
    createdAt: at,
    version: 'v1',
    ...t,
  } as TaskDetail;
};

function seed(empty: boolean): Store {
  const types: TaskType[] = [
    'Business Advisory',
    'Bookkeeping',
    'Tax Preparation',
    'Compliance',
    'Onboarding',
  ].map((name, i) => ({ id: uuid('0e10', i + 1), name, sortOrder: i, archivedAt: null }));
  if (empty) return { tasks: [], drafts: [], types: [], templates: [], series: [], next: 100 };
  const d = today();
  const ty = (i: number) => ({ id: types[i]!.id, name: types[i]!.name });
  const items: [
    string,
    number,
    number,
    'LOW' | 'MEDIUM' | 'HIGH',
    TaskDetail['progress'],
    number,
    string,
  ][] = [
    ['Prepare business plan draft', 2, 0, 'HIGH', 'IN_PROGRESS', 2, 'Business Plan'],
    ['Collect 2025 financial statements', 3, 1, 'HIGH', 'PENDING', 3, 'Financial Analysis'],
    ['Schedule advisory meeting', 0, 0, 'MEDIUM', 'PENDING', 3, 'Advisory Meeting'],
    ['Follow up on EIN application', 3, 3, 'HIGH', 'PENDING', 5, 'Business Formation'],
    ['Review funding options', 4, 0, 'MEDIUM', 'IN_PROGRESS', 6, 'Funding'],
    ['Create website proposal', 3, 0, 'MEDIUM', 'NOT_STARTED', 8, 'Website Development'],
    ['Send bank account checklist', 4, 4, 'LOW', 'PENDING', 10, 'Business Banking'],
    ['Finalize logo concepts', 4, 0, 'MEDIUM', 'IN_PROGRESS', 11, 'Branding/Design'],
    ['Prepare Q3 advisory report', 2, 0, 'HIGH', 'NOT_STARTED', 12, 'Reporting'],
    ['Client onboarding checklist', 1, 4, 'MEDIUM', 'PENDING', 13, 'Onboarding'],
    ['Reconcile September statements', 0, 1, 'HIGH', 'IN_PROGRESS', -3, 'Bookkeeping'],
    ['Ask for the missing payroll report', 1, 1, 'MEDIUM', 'WAITING', -1, 'Payroll'],
  ];
  const tasks = items.map(([title, c, t, priority, progress, offset, project], i) => {
    const staff = i % 3 === 1 ? mockStaff : mockMe;
    const checklistItems =
      i % 2 === 0
        ? [
            'Research industry and market trends',
            'Prepare financial projections',
            'Write executive summary',
          ].map((label, k) => ({
            id: uuid('0d10', i * 10 + k),
            label,
            position: k,
            required: k === 2,
            completedAt: k === 0 && i === 0 ? nowIso() : null,
            completedBy: k === 0 && i === 0 ? mockMe : null,
            assignedTo: null,
          }))
        : [];
    return rowFields({
      id: uuid('0a10', i + 1),
      title,
      client: CLIENTS[c]!,
      type: ty(t),
      engagement: { id: uuid('0f10', i + 1), title: project },
      engagementId: uuid('0f10', i + 1),
      priority,
      progress,
      dueOn: plus(d, offset),
      overdue: offset < 0,
      assignedTo: staff,
      assignedUserId: staff.userId,
      additionalAssigneeCount: i === 0 ? 1 : 0,
      additionalAssignees: i === 0 ? [KEVIN] : [],
      checklistItems,
      checklist: {
        done: checklistItems.filter((x) => x.completedAt).length,
        total: checklistItems.length,
      },
      details:
        i === 0
          ? 'Prepare initial business plan draft including market analysis, financial projections, and growth strategy.'
          : null,
      reminders: i === 0 ? [{ ...DAY_BEFORE }] : [],
      updatedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    });
  });
  const done = [0, 1, 2].map((k) =>
    rowFields({
      id: uuid('0a10', 50 + k),
      title: ['Send the engagement letter', 'File the extension', 'Upload prior-year return'][k]!,
      client: CLIENTS[k]!,
      type: ty(2),
      status: 'DONE',
      progress: 'NOT_STARTED',
      dueOn: plus(d, -5 - k),
      completedAt: nowIso(),
      completedBy: mockMe,
    }),
  );
  const templates: TaskTemplate[] = [
    ['New Client Onboarding', 4],
    ['Business Plan Development', 0],
    ['EIN Application Assistance', 3],
    ['Bank Account Setup', 1],
    ['Website Development', 0],
  ].map(([name, t], i) => ({
    id: uuid('0c10', i + 1),
    name: String(name),
    description: null,
    type: ty(Number(t)),
    service: null,
    priority: 'MEDIUM',
    assignmentRule: 'UNASSIGNED',
    assignedTo: null,
    dueOffsetDays: 7,
    clientVisibleDefault: false,
    checklist: [
      { label: 'Gather the documents', required: true },
      { label: 'Confirm with the client', required: false },
    ],
    reminders: [],
    recurrence: null,
    archivedAt: null,
    createdBy: mockMe,
    updatedAt: nowIso(),
    version: 'v1',
  }));
  const drafts: StoredDraft[] = [
    {
      client: CLIENTS[0]!,
      t: rowFields({
        id: uuid('0a30', 1),
        title: 'Collect 2025 1099 forms',
        client: CLIENTS[0]!,
        type: ty(2),
        priority: 'HIGH',
        dueOn: plus(d, 12),
      }),
    },
    {
      client: null,
      t: rowFields({ id: uuid('0a30', 2), title: 'Plan the Q1 onboarding call' }),
    },
    {
      client: CLIENTS[1]!,
      t: rowFields({
        id: uuid('0a30', 3),
        title: 'Follow up on missing receipts',
        client: CLIENTS[1]!,
        type: ty(1),
        assignedTo: mockStaff,
        assignedUserId: mockStaff.userId,
        createdBy: mockStaff,
      }),
    },
  ];
  const store: Store = {
    tasks: [...tasks, ...done],
    drafts,
    types,
    templates,
    series: [],
    next: 100,
  };
  store.series.push(makeSeries(store, 1, 'Quarterly Bookkeeping Review', CLIENTS[2]!, 3, 'MONTH'));
  store.series.push(makeSeries(store, 2, 'Weekly Payroll Check', CLIENTS[3]!, 1, 'WEEK'));
  return store;
}

/** Due dates of a recurrence from its start: every `interval` units, ended by count or date. */
export function occurrenceDates(
  r: {
    interval: number;
    unit: string;
    startOn: string;
    endMode: string;
    endAfterCount: number | null;
    endOn: string | null;
    holidayRule: string;
  },
  count: number,
): { scheduledOn: string; dueOn: string }[] {
  const out: { scheduledOn: string; dueOn: string }[] = [];
  const start = new Date(`${r.startOn}T12:00:00Z`);
  const limit = r.endMode === 'AFTER_COUNT' ? Math.min(count, r.endAfterCount ?? count) : count;
  for (let i = 0; out.length < limit && i < 500; i++) {
    const d = new Date(start);
    if (r.unit === 'DAY') d.setUTCDate(d.getUTCDate() + i * r.interval);
    else if (r.unit === 'WEEK') d.setUTCDate(d.getUTCDate() + i * r.interval * 7);
    else {
      const months =
        r.unit === 'MONTH' ? r.interval : r.unit === 'QUARTER' ? r.interval * 3 : r.interval * 12;
      const day = start.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(start.getUTCMonth() + i * months);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
    }
    const scheduledOn = d.toISOString().slice(0, 10);
    if (r.endMode === 'ON_DATE' && r.endOn && scheduledOn > r.endOn) break;
    const weekday = d.getUTCDay();
    let dueOn = scheduledOn;
    if (r.holidayRule === 'NEXT_BUSINESS_DAY' && (weekday === 0 || weekday === 6))
      dueOn = plus(scheduledOn, weekday === 6 ? 2 : 1);
    if (r.holidayRule === 'PREVIOUS_BUSINESS_DAY' && (weekday === 0 || weekday === 6))
      dueOn = plus(scheduledOn, weekday === 6 ? -1 : -2);
    out.push({ scheduledOn, dueOn });
  }
  return out;
}

const summaryOf = (unit: string, interval: number) =>
  interval === 1 ? `Every ${unit.toLowerCase()}` : `Every ${interval} ${unit.toLowerCase()}s`;

function makeSeries(
  store: Store,
  n: number,
  title: string,
  client: { id: string; displayName: string },
  interval: number,
  unit: 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR',
) {
  const startOn = plus(today(), 5 + n);
  const recurrence = {
    interval,
    unit,
    pattern: {},
    startOn,
    endMode: 'NEVER' as const,
    endAfterCount: null,
    endOn: null,
    holidayRule: 'NEXT_BUSINESS_DAY' as const,
  };
  const dates = occurrenceDates(recurrence, 6);
  const detail: TaskSeriesDetail = {
    id: uuid('0b10', n),
    title,
    client,
    type: { id: store.types[1]!.id, name: store.types[1]!.name },
    priority: 'MEDIUM',
    assignedTo: mockMe,
    summary: summaryOf(unit, interval),
    status: 'ACTIVE',
    nextDueOn: dates[0]?.dueOn ?? null,
    generatedCount: 0,
    updatedAt: nowIso(),
    details: 'Review the client financials, reconcile accounts and send the summary report.',
    engagementId: null,
    service: null,
    assignmentRule: 'SPECIFIC_USER',
    extraAssignees: [KEVIN],
    recurrence,
    createAtPeriodStart: false,
    leadDays: 7,
    linkTaxCalendar: false,
    dueTime: null,
    clientVisible: false,
    notifyClient: false,
    checklist: [
      { label: 'Reconcile bank and credit card accounts', required: true },
      { label: 'Review income and expenses', required: false },
    ],
    reminders: [{ ...DAY_BEFORE }],
    upcoming: dates,
    pausedAt: null,
    endedAt: null,
    createdBy: mockMe,
    createdAt: nowIso(),
    version: 'v1',
  };
  const occurrences: TaskOccurrence[] = dates.map((x, i) => ({
    id: uuid('0b20', n * 10 + i),
    scheduledOn: x.scheduledOn,
    dueOn: x.dueOn,
    state: 'SCHEDULED',
    taskId: null,
    skipReason: null,
    generatedAt: null,
  }));
  return { detail, occurrences };
}

let stores: Map<string, Store> | undefined;

/** `api.taskWork` in mock mode. */
export function createTaskWorkMock(options: Options = {}): TaskWorkClient {
  const role = options.role ?? 'OWNER';
  stores ??= new Map();
  const key = options.empty ? 'empty' : 'full';
  let store = stores.get(key);
  if (!store) {
    store = seed(options.empty ?? false);
    stores.set(key, store);
  }
  const s = store;
  const me: MemberRef = role === 'STAFF' ? mockStaff : mockMe;
  const members: MemberRef[] = [mockMe, mockStaff, KEVIN, ALICIA];
  const memberOf = (id: string | null | undefined) =>
    id ? (members.find((m) => m.userId === id) ?? { userId: id, name: 'Team member' }) : null;
  const sees = (t: TaskDetail) => role !== 'STAFF' || t.assignedTo?.userId === mockStaff.userId;
  const find = (id: string) => {
    const t = s.tasks.find((x) => x.id === id);
    if (!t || !sees(t)) throw fail(404, 'NOT_FOUND', 'Not found');
    return t;
  };
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const touch = (t: TaskDetail) => {
    t.updatedAt = nowIso();
    t.version = `v${Number(t.version.slice(1)) + 1}`;
    t.overdue = t.status === 'OPEN' && t.dueOn !== null && t.dueOn < today();
    t.checklist = {
      done: t.checklistItems.filter((i) => i.completedAt).length,
      total: t.checklistItems.length,
    };
    t.additionalAssigneeCount = t.additionalAssignees.length;
    const dep = t.dependsOn ? s.tasks.find((x) => x.id === t.dependsOn?.id) : undefined;
    if (t.dependsOn && dep) t.dependsOn = { id: dep.id, title: dep.title, status: dep.status };
    t.blocked = !!dep && dep.status !== 'DONE';
    return t;
  };
  const type = (id: string | null | undefined) => {
    if (!id) return null;
    const x = s.types.find((y) => y.id === id);
    if (!x) throw fail(404, 'NOT_FOUND', 'Task type not found');
    if (x.archivedAt) throw fail(409, 'TYPE_ARCHIVED', 'This task type is archived');
    return { id: x.id, name: x.name };
  };
  const visible = () => s.tasks.filter(sees);
  const applyFields = (t: TaskDetail, b: Record<string, unknown>) => {
    const has = (k: string) => b[k] !== undefined;
    if (has('title')) t.title = b['title'] as string;
    if (has('details')) t.details = (b['details'] as string | null) ?? null;
    if (has('dueOn')) t.dueOn = (b['dueOn'] as string | null) ?? null;
    if (has('assignedUserId')) {
      t.assignedUserId = (b['assignedUserId'] as string | null) ?? null;
      t.assignedTo = memberOf(t.assignedUserId);
    }
    if (has('typeId')) t.type = type(b['typeId'] as string | null);
    if (has('priority')) t.priority = b['priority'] as TaskDetail['priority'];
    if (has('progress')) t.progress = b['progress'] as TaskDetail['progress'];
    if (has('startOn')) t.startOn = (b['startOn'] as string | null) ?? null;
    if (has('dueTime')) {
      t.dueTime = (b['dueTime'] as string | null) ?? null;
      // As the API: without "all day" sent, a time turns it off and no time turns it on.
      if (!has('allDay')) t.allDay = t.dueTime === null;
    }
    if (has('allDay')) t.allDay = b['allDay'] as boolean;
    // As the API: no due date, no time.
    if (has('dueOn') && t.dueOn === null) {
      t.dueTime = null;
      t.allDay = true;
    }
    if (has('clientVisible')) t.clientVisible = b['clientVisible'] as boolean;
    if (has('internalNotes')) t.internalNotes = (b['internalNotes'] as string | null) ?? null;
    if (has('blockedReason')) t.blockedReason = (b['blockedReason'] as string | null) ?? null;
    if (has('additionalAssigneeIds'))
      t.additionalAssignees = (b['additionalAssigneeIds'] as string[]).map(
        (id) => memberOf(id) as MemberRef,
      );
    if (has('dependsOnTaskId')) {
      const id = b['dependsOnTaskId'] as string | null;
      if (id === t.id) throw fail(400, 'DEPENDENCY_CYCLE', 'A task cannot depend on itself');
      const dep = id ? s.tasks.find((x) => x.id === id) : undefined;
      if (id && !dep) throw fail(404, 'NOT_FOUND', 'Prerequisite not found');
      if (dep?.dependsOn?.id === t.id)
        throw fail(400, 'DEPENDENCY_CYCLE', 'That would make a loop');
      t.dependsOn = dep ? { id: dep.id, title: dep.title, status: dep.status } : null;
    }
    if (has('reminders')) {
      const list = b['reminders'] as ReminderRule[];
      if (list.length && !t.dueOn)
        throw fail(400, 'INVALID_REMINDER', 'A reminder needs a due date');
      t.reminders = list.map(reminderOut);
    }
    if (has('checklist')) {
      const list = b['checklist'] as {
        id?: string;
        label: string;
        required?: boolean;
        assignedUserId?: string | null;
      }[];
      t.checklistItems = list.map((c, i) => {
        const old = c.id ? t.checklistItems.find((x) => x.id === c.id) : undefined;
        return {
          id: old?.id ?? uuid('0d10', s.next++),
          label: c.label,
          position: i,
          required: c.required ?? false,
          completedAt: old?.completedAt ?? null,
          completedBy: old?.completedBy ?? null,
          assignedTo: memberOf(c.assignedUserId),
        };
      });
    }
  };
  const attach = (t: TaskDetail, a: AddTaskAttachmentRequest): TaskAttachment => {
    const n = s.next++;
    const row: TaskAttachment = {
      id: uuid('0d20', n),
      documentId: a.documentId,
      fileName: `Document-${n}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 120_000,
      clientVisible: a.clientVisible ?? false,
      addedBy: me,
      addedAt: nowIso(),
    };
    t.attachments.push(row);
    return row;
  };
  // ----- Drafts -----
  const draftOf = ({ t, client }: StoredDraft): TaskDraft => ({
    id: t.id,
    title: t.title,
    client,
    type: t.type,
    service: t.service,
    priority: t.priority,
    dueOn: t.dueOn,
    assignedTo: t.assignedTo,
    createdBy: t.createdBy,
    missing: client ? [] : ['clientId'],
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    status: 'DRAFT',
    details: t.details,
    engagement: t.engagement,
    progress: t.progress,
    startOn: t.startOn,
    dueTime: t.dueTime,
    allDay: t.allDay,
    clientVisible: t.clientVisible,
    internalNotes: t.internalNotes,
    blockedReason: t.blockedReason,
    assignedUserId: t.assignedUserId,
    additionalAssignees: t.additionalAssignees,
    checklistItems: t.checklistItems,
    reminders: t.reminders,
    attachments: t.attachments,
    dependsOn: t.dependsOn,
    templateId: t.templateId,
    version: t.version,
  });
  const draftRow = (x: TaskDraft): TaskDraftRow => ({
    id: x.id,
    title: x.title,
    client: x.client,
    type: x.type,
    service: x.service,
    priority: x.priority,
    dueOn: x.dueOn,
    assignedTo: x.assignedTo,
    createdBy: x.createdBy,
    missing: x.missing,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
  });
  /** Without a client, its creator's alone; with one, by the tasks' reach, whoever made it. */
  const seesDraft = (x: StoredDraft) =>
    x.client === null ? x.t.createdBy?.userId === me.userId : sees(x.t);
  const findDraft = (id: string) => {
    const x = s.drafts.find((y) => y.t.id === id);
    if (!x || !seesDraft(x)) throw fail(404, 'NOT_FOUND', 'Not found');
    return x;
  };
  const clientRef = (id: string) =>
    CLIENTS.find((c) => c.id === id) ?? { id, displayName: 'Selected client' };
  /** A draft's fields as sent: nothing that publishing checks is checked here. */
  const applyDraft = (x: StoredDraft, b: Record<string, unknown>) => {
    const has = (k: string) => b[k] !== undefined;
    if (has('clientId')) {
      const next = b['clientId'] === null ? null : clientRef(b['clientId'] as string);
      if (next?.id !== x.client?.id) {
        x.client = next;
        if (!has('engagementId')) {
          x.t.engagementId = null;
          x.t.engagement = null;
        }
        if (!has('attachments')) x.t.attachments = [];
      }
      if (next) x.t.client = next;
    }
    if (has('engagementId')) {
      const id = b['engagementId'] as string | null;
      if (id && !x.client) throw fail(400, 'VALIDATION_FAILED', 'Choose the client first');
      x.t.engagementId = id;
      x.t.engagement = id ? { id, title: 'Project' } : null;
    }
    const { typeId, reminders, attachments, ...rest } = b;
    applyFields(x.t, rest);
    if (typeId !== undefined) {
      const found = typeId ? s.types.find((y) => y.id === typeId) : undefined;
      if (typeId && !found) throw fail(404, 'NOT_FOUND', 'Task type not found');
      x.t.type = found ? { id: found.id, name: found.name } : null;
    }
    if (reminders !== undefined) {
      const due = x.t.dueOn;
      x.t.dueOn = due ?? today();
      applyFields(x.t, { reminders });
      x.t.dueOn = due;
    }
    if (attachments !== undefined) {
      if ((attachments as unknown[]).length && !x.client)
        throw fail(400, 'VALIDATION_FAILED', 'Choose the client first');
      x.t.attachments = [];
      for (const a of attachments as AddTaskAttachmentRequest[]) attach(x.t, a);
    }
  };
  const series = (id: string) => {
    const x = s.series.find((y) => y.detail.id === id);
    if (!x) throw fail(404, 'NOT_FOUND', 'Not found');
    return x;
  };
  // The mock has no catalog: a template's service keeps its id under a neutral name.
  const templateService = (id: string | null | undefined) =>
    id ? { id, name: 'Selected service' } : null;
  // Each rule as sent, Custom ones too (a template has no due time).
  const templateReminders = (list: ReminderRule[] | undefined) => (list ?? []).map(reminderOut);
  const template = (id: string) => {
    const x = s.templates.find((y) => y.id === id);
    if (!x) throw fail(404, 'NOT_FOUND', 'Not found');
    return x;
  };
  const dupName = (name: string, list: { name: string; id: string }[], self?: string) => {
    if (list.some((x) => x.id !== self && x.name.toLowerCase() === name.toLowerCase()))
      throw fail(409, 'DUPLICATE_NAME', 'This name is already used');
  };
  const reseries = (x: { detail: TaskSeriesDetail; occurrences: TaskOccurrence[] }) => {
    const d = x.detail;
    const made = x.occurrences.filter((o) => o.state !== 'SCHEDULED');
    const dates = occurrenceDates(d.recurrence, made.length + 6);
    const fresh = dates.slice(made.length).map((o, i) => ({
      id: uuid('0b20', s.next++ + i),
      scheduledOn: o.scheduledOn,
      dueOn: o.dueOn,
      state: 'SCHEDULED' as const,
      taskId: null,
      skipReason: null,
      generatedAt: null,
    }));
    x.occurrences = [...made, ...fresh];
    d.upcoming = fresh.slice(0, 6).map((o) => ({ scheduledOn: o.scheduledOn, dueOn: o.dueOn }));
    d.nextDueOn = fresh[0]?.dueOn ?? null;
    d.summary = summaryOf(d.recurrence.unit, d.recurrence.interval);
    d.updatedAt = nowIso();
    d.version = `v${Number(d.version.slice(1)) + 1}`;
  };

  return {
    summary: async () => {
      await mockDelay();
      const list = visible().filter((t) => t.archivedAt === null && t.status !== 'CANCELLED');
      const open = list.filter((t) => t.status === 'OPEN');
      const month = today().slice(0, 7);
      return {
        total: list.length,
        pending: open.filter((t) => t.progress === 'PENDING' || t.progress === 'NOT_STARTED')
          .length,
        inProgress: open.filter((t) => t.progress === 'IN_PROGRESS').length,
        overdue: open.filter((t) => t.dueOn !== null && t.dueOn < today()).length,
        completedThisMonth: list.filter(
          (t) => t.status === 'DONE' && (t.completedAt ?? '').startsWith(month),
        ).length,
        mine: open.filter((t) => t.assignedTo?.userId === me.userId).length,
      };
    },
    overview: async (query = {}) => {
      await mockDelay();
      const q = parseInput(TaskOverviewQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      let rows = visible().filter((t) => {
        if (q.view === 'archived') return t.archivedAt !== null;
        if (t.archivedAt !== null || t.status === 'CANCELLED') return false;
        if (q.view === 'completed') return t.status === 'DONE';
        if (q.view === 'mine')
          return (
            t.assignedTo?.userId === me.userId ||
            t.additionalAssignees.some((a) => a.userId === me.userId)
          );
        return true;
      });
      rows = rows
        .filter((t) => !q.status || t.status === q.status)
        .filter((t) => !q.progress || t.progress === q.progress)
        .filter((t) => !q.priority || t.priority === q.priority)
        .filter((t) => !q.typeId || t.type?.id === q.typeId)
        .filter((t) => !q.clientId || t.client.id === q.clientId)
        .filter((t) => !q.engagementId || t.engagementId === q.engagementId)
        .filter((t) => !q.assignedUserId || t.assignedTo?.userId === q.assignedUserId)
        .filter(
          (t) =>
            q.overdue !== true || (t.status === 'OPEN' && t.dueOn !== null && t.dueOn < today()),
        )
        .filter((t) => !q.dueFrom || (t.dueOn !== null && t.dueOn >= q.dueFrom))
        .filter((t) => !q.dueTo || (t.dueOn !== null && t.dueOn <= q.dueTo))
        .filter(
          (t) =>
            !search ||
            [t.title, t.client.displayName, t.type?.name ?? '', t.service?.name ?? ''].some((x) =>
              x.toLowerCase().includes(search),
            ),
        );
      const dir = q.direction === 'desc' ? -1 : 1;
      const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
      rows.sort((a, b) => {
        switch (q.sort) {
          case 'priority':
            return dir * (rank[a.priority] - rank[b.priority]);
          case 'status':
            return dir * a.progress.localeCompare(b.progress);
          case 'client':
            return dir * a.client.displayName.localeCompare(b.client.displayName);
          case 'title':
            return dir * a.title.localeCompare(b.title);
          case 'updated':
            return dir * a.updatedAt.localeCompare(b.updatedAt);
          default:
            return dir * (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999');
        }
      });
      const start = (q.page - 1) * q.pageSize;
      return {
        items: copy(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    calendar: async (query) => {
      await mockDelay();
      const q = parseInput(TaskCalendarQuery, query);
      return {
        items: visible()
          .filter(
            (t) =>
              t.dueOn !== null && t.dueOn >= q.from && t.dueOn <= q.to && t.archivedAt === null,
          )
          .filter((t) => q.mine !== true || t.assignedTo?.userId === me.userId)
          .map((t) => ({
            id: t.id,
            title: t.title,
            dueOn: t.dueOn as string,
            dueTime: t.dueTime,
            allDay: t.allDay,
            priority: t.priority,
            status: t.status,
            progress: t.progress,
            overdue: t.overdue,
            clientName: t.client.displayName,
          })),
      };
    },
    task: async (id) => {
      await mockDelay();
      return copy(touchless(find(id)));
    },
    create: async (body) => {
      await mockDelay();
      const b = parseInput(CreateTaskDetailRequest, body);
      const client = CLIENTS.find((c) => c.id === b.clientId) ?? {
        id: b.clientId,
        displayName: 'Selected client',
      };
      const tpl = b.templateId ? template(b.templateId) : undefined;
      const t = rowFields({
        id: uuid('0a10', s.next++),
        title: b.title,
        client,
        engagementId: b.engagementId ?? null,
        engagement: b.engagementId ? { id: b.engagementId, title: 'Project' } : null,
        assignedTo: me,
        assignedUserId: me.userId,
        templateId: b.templateId ?? null,
        priority: tpl?.priority ?? 'MEDIUM',
      });
      applyFields(t, {
        ...b,
        typeId: b.typeId ?? tpl?.type?.id ?? null,
        checklist:
          b.checklist ?? tpl?.checklist.map((c) => ({ label: c.label, required: c.required })),
      });
      refuseCustomWithoutTime(t);
      for (const a of b.attachments ?? []) attach(t, a);
      s.tasks.unshift(t);
      return copy(touch(t));
    },
    update: async (id, body) => {
      await mockDelay();
      const b = parseInput(UpdateTaskDetailRequest, body);
      const t = find(id);
      if (b.version && b.version !== t.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this task after you opened it');
      if (
        t.status !== 'OPEN' &&
        b.status === undefined &&
        Object.keys(b).some((k) => k !== 'version')
      )
        throw fail(409, 'TASK_CLOSED', 'Reopen the task before changing it');
      // Checked on a copy, so a refused change leaves the task as it was. The reminders kept count:
      // going all-day with a Custom reminder is refused unless the request replaces them.
      const next = copy(t);
      applyFields(next, b);
      refuseCustomWithoutTime(next);
      Object.assign(t, next);
      if (b.status) t.status = b.status;
      return copy(touch(t));
    },
    drafts: async (query = {}) => {
      await mockDelay();
      const q = parseInput(TaskDraftQuery, query);
      const needle = q.search?.toLowerCase();
      const list = s.drafts
        .filter(seesDraft)
        .filter(
          (x) =>
            (!q.clientId || x.client?.id === q.clientId) &&
            (!q.typeId || x.t.type?.id === q.typeId) &&
            (!q.priority || x.t.priority === q.priority) &&
            (!q.assignedUserId || x.t.assignedUserId === q.assignedUserId) &&
            (!q.mine || x.t.createdBy?.userId === me.userId) &&
            (!needle ||
              [x.t.title, x.client?.displayName, x.t.type?.name, x.t.service?.name].some((v) =>
                v?.toLowerCase().includes(needle),
              )),
        )
        .map(draftOf);
      const rank: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };
      const key = (x: TaskDraft): string | number =>
        q.sort === 'title'
          ? x.title.toLowerCase()
          : q.sort === 'due'
            ? (x.dueOn ?? '9999-12-31')
            : q.sort === 'priority'
              ? (rank[x.priority] ?? 0)
              : q.sort === 'client'
                ? (x.client?.displayName.toLowerCase() ?? '')
                : x.updatedAt;
      list.sort((a, b) => {
        const [ka, kb] = [key(a), key(b)];
        const cmp = ka < kb ? -1 : ka > kb ? 1 : 0;
        return q.direction === 'asc' ? cmp : -cmp;
      });
      const from = (q.page - 1) * q.pageSize;
      return {
        items: list.slice(from, from + q.pageSize).map(draftRow),
        total: list.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    draft: async (id) => {
      await mockDelay();
      return copy(draftOf(findDraft(id)));
    },
    saveDraft: async (body) => {
      await mockDelay();
      const b = parseInput(SaveTaskDraftRequest, body);
      const tpl = b.templateId ? template(b.templateId) : undefined;
      const x: StoredDraft = {
        client: null,
        t: rowFields({
          id: uuid('0a30', s.next++),
          title: b.title,
          assignedTo: me,
          assignedUserId: me.userId,
          createdBy: me,
          templateId: b.templateId ?? null,
          priority: tpl?.priority ?? 'MEDIUM',
        }),
      };
      applyDraft(x, {
        ...b,
        typeId: b.typeId ?? tpl?.type?.id ?? null,
        checklist:
          b.checklist ?? tpl?.checklist.map((c) => ({ label: c.label, required: c.required })),
      });
      s.drafts.unshift(x);
      return copy(draftOf(x));
    },
    updateDraft: async (id, body) => {
      await mockDelay();
      const b = parseInput(UpdateTaskDraftRequest, body);
      const x = findDraft(id);
      if (b.version && b.version !== x.t.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this draft after you opened it');
      applyDraft(x, b);
      touch(x.t);
      return copy(draftOf(x));
    },
    publishDraft: async (id, body = {}) => {
      await mockDelay();
      const b = parseInput(PublishTaskDraftRequest, body);
      const x = findDraft(id);
      if (b.version && b.version !== x.t.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this draft after you opened it');
      applyDraft(x, b);
      if (!x.client)
        throw new ApiRequestError(
          400,
          'VALIDATION_FAILED',
          'The request is not valid',
          undefined,
          undefined,
          [{ path: 'clientId', message: 'Choose a client' }],
        );
      type(x.t.type?.id);
      if (x.t.reminders.length && !x.t.dueOn)
        throw fail(400, 'INVALID_REMINDER', 'A reminder needs a due date');
      refuseCustomWithoutTime(x.t);
      s.drafts = s.drafts.filter((y) => y !== x);
      x.t.client = x.client;
      x.t.status = 'OPEN';
      s.tasks.unshift(x.t);
      return copy(touch(x.t));
    },
    discardDraft: async (id) => {
      const x = findDraft(id);
      await mockDelay();
      s.drafts = s.drafts.filter((y) => y !== x);
      return { ok: true };
    },
    complete: async (id) => {
      await mockDelay();
      const t = find(id);
      if (t.checklistItems.some((i) => i.required && !i.completedAt))
        throw fail(409, 'REQUIRED_ITEMS_OPEN', 'Finish the required checklist items first');
      if (t.dependsOn && t.dependsOn.status !== 'DONE')
        throw fail(409, 'DEPENDENCY_OPEN', 'Finish the prerequisite task first');
      t.status = 'DONE';
      t.completedAt = nowIso();
      t.completedBy = me;
      return copy(touch(t));
    },
    reopen: async (id) => {
      await mockDelay();
      const t = find(id);
      t.status = 'OPEN';
      t.completedAt = null;
      t.completedBy = null;
      return copy(touch(t));
    },
    cancel: async (id) => {
      await mockDelay();
      const t = find(id);
      t.status = 'CANCELLED';
      return copy(touch(t));
    },
    setProgress: async (id, body) => {
      await mockDelay();
      const { progress } = parseInput(SetTaskProgressRequest, body);
      const t = find(id);
      if (t.status !== 'OPEN') throw fail(409, 'TASK_CLOSED', 'Reopen the task first');
      t.progress = progress;
      return copy(touch(t));
    },
    duplicate: async (id) => {
      await mockDelay();
      const src = find(id);
      const t = copy(src);
      t.id = uuid('0a10', s.next++);
      t.title = `${src.title} (Copy)`;
      t.status = 'OPEN';
      t.progress = 'NOT_STARTED';
      t.completedAt = null;
      t.completedBy = null;
      t.attachments = [];
      t.checklistItems = src.checklistItems.map((c, i) => ({
        ...c,
        id: uuid('0d10', s.next++ + i),
        completedAt: null,
        completedBy: null,
      }));
      s.tasks.unshift(t);
      return copy(touch(t));
    },
    archive: async (id) => {
      await mockDelay();
      manage();
      const t = find(id);
      t.archivedAt = nowIso();
      return copy(touch(t));
    },
    restore: async (id) => {
      await mockDelay();
      const t = find(id);
      t.archivedAt = null;
      return copy(touch(t));
    },
    bulk: async (body) => {
      await mockDelay();
      const b = parseInput(BulkTaskRequest, body);
      const skipped: { id: string; reason: string }[] = [];
      let updated = 0;
      for (const id of b.ids) {
        const t = s.tasks.find((x) => x.id === id);
        if (!t || !sees(t)) {
          skipped.push({ id, reason: 'NOT_FOUND' });
          continue;
        }
        if (b.action === 'REASSIGN') {
          t.assignedUserId = b.assignedUserId;
          t.assignedTo = memberOf(b.assignedUserId);
        } else if (b.action === 'SET_PROGRESS') t.progress = b.progress;
        else if (b.action === 'SET_PRIORITY') t.priority = b.priority;
        else if (b.action === 'SET_DUE_DATE')
          t.dueOn = b.dueOn ?? (t.dueOn ? plus(t.dueOn, b.shiftDays ?? 0) : null);
        else if (b.action === 'COMPLETE') {
          if (t.checklistItems.some((i) => i.required && !i.completedAt)) {
            skipped.push({ id, reason: 'REQUIRED_ITEMS_OPEN' });
            continue;
          }
          t.status = 'DONE';
          t.completedAt = nowIso();
          t.completedBy = me;
        } else if (b.action === 'CANCEL') t.status = 'CANCELLED';
        else if (b.action === 'ARCHIVE') t.archivedAt = nowIso();
        touch(t);
        updated++;
      }
      if (updated === 0 && skipped.length === b.ids.length)
        throw fail(404, 'NOT_FOUND', 'Not found');
      return { updated, skipped };
    },
    completeItem: async (id, itemId) => {
      await mockDelay();
      const t = find(id);
      const item = t.checklistItems.find((i) => i.id === itemId);
      if (!item) throw fail(404, 'NOT_FOUND', 'Not found');
      item.completedAt = nowIso();
      item.completedBy = me;
      return copy(touch(t));
    },
    reopenItem: async (id, itemId) => {
      await mockDelay();
      const t = find(id);
      const item = t.checklistItems.find((i) => i.id === itemId);
      if (!item) throw fail(404, 'NOT_FOUND', 'Not found');
      item.completedAt = null;
      item.completedBy = null;
      return copy(touch(t));
    },
    reorderChecklist: async (id, body) => {
      await mockDelay();
      const { ids } = parseInput(ReorderChecklistRequest, body);
      const t = find(id);
      t.checklistItems = ids
        .map((i) => t.checklistItems.find((c) => c.id === i))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c, i) => ({ ...c, position: i }));
      return copy(touch(t));
    },
    addAttachment: async (id, body) => {
      await mockDelay();
      // As the API: attaching changes the task's version.
      const t = find(id);
      const row = attach(t, body);
      touch(t);
      return copy(row);
    },
    updateAttachment: async (id, attachmentId, body) => {
      await mockDelay();
      const { clientVisible } = parseInput(UpdateTaskAttachmentRequest, body);
      const a = find(id).attachments.find((x) => x.id === attachmentId);
      if (!a) throw fail(404, 'NOT_FOUND', 'Not found');
      a.clientVisible = clientVisible;
      return copy(a);
    },
    removeAttachment: async (id, attachmentId) => {
      await mockDelay();
      const t = find(id);
      t.attachments = t.attachments.filter((x) => x.id !== attachmentId);
      return { ok: true };
    },
    types: async () => {
      await mockDelay();
      return copy(s.types);
    },
    createType: async (body) => {
      await mockDelay();
      manage();
      const { name } = parseInput(SaveTaskTypeRequest, body);
      dupName(name, s.types);
      const t: TaskType = {
        id: uuid('0e10', s.next++),
        name,
        sortOrder: s.types.length,
        archivedAt: null,
      };
      s.types.push(t);
      return copy(t);
    },
    updateType: async (id, body) => {
      await mockDelay();
      manage();
      const { name } = parseInput(SaveTaskTypeRequest, body);
      const t = s.types.find((x) => x.id === id);
      if (!t) throw fail(404, 'NOT_FOUND', 'Not found');
      dupName(name, s.types, id);
      t.name = name;
      return copy(t);
    },
    archiveType: async (id) => {
      await mockDelay();
      manage();
      const t = s.types.find((x) => x.id === id);
      if (!t) throw fail(404, 'NOT_FOUND', 'Not found');
      t.archivedAt = nowIso();
      return copy(t);
    },
    restoreType: async (id) => {
      await mockDelay();
      manage();
      const t = s.types.find((x) => x.id === id);
      if (!t) throw fail(404, 'NOT_FOUND', 'Not found');
      t.archivedAt = null;
      return copy(t);
    },
    templates: async (query = {}) => {
      await mockDelay();
      const q = parseInput(TaskTemplatesQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      return copy(
        s.templates
          .filter(
            (t) => q.status === 'all' || (q.status === 'archived') === (t.archivedAt !== null),
          )
          .filter((t) => !search || t.name.toLowerCase().includes(search)),
      );
    },
    getTemplate: async (id) => {
      await mockDelay();
      return copy(template(id));
    },
    createTemplate: async (body) => {
      await mockDelay();
      manage();
      const b = parseInput(CreateTaskTemplateRequest, body);
      dupName(b.name, s.templates);
      const t: TaskTemplate = {
        id: uuid('0c10', s.next++),
        name: b.name,
        description: b.description ?? null,
        type: b.typeId ? type(b.typeId) : null,
        service: templateService(b.serviceId),
        priority: b.priority ?? 'MEDIUM',
        assignmentRule: b.assignmentRule ?? 'UNASSIGNED',
        assignedTo: memberOf(b.assignedUserId),
        dueOffsetDays: b.dueOffsetDays ?? null,
        clientVisibleDefault: b.clientVisibleDefault ?? false,
        checklist: (b.checklist ?? []).map((c) => ({
          label: c.label,
          required: c.required ?? false,
        })),
        reminders: templateReminders(b.reminders),
        recurrence: null,
        archivedAt: null,
        createdBy: me,
        updatedAt: nowIso(),
        version: 'v1',
      };
      s.templates.unshift(t);
      return copy(t);
    },
    updateTemplate: async (id, body) => {
      await mockDelay();
      manage();
      const b = parseInput(UpdateTaskTemplateRequest, body);
      const t = template(id);
      if (b.version !== t.version) throw fail(409, 'SAVE_CONFLICT', 'Someone saved this first');
      if (b.name) {
        dupName(b.name, s.templates, id);
        t.name = b.name;
      }
      if (b.description !== undefined) t.description = b.description ?? null;
      if (b.priority) t.priority = b.priority;
      if (b.typeId !== undefined && b.typeId !== t.type?.id) t.type = type(b.typeId);
      if (b.serviceId !== undefined) t.service = templateService(b.serviceId);
      if (b.assignmentRule) t.assignmentRule = b.assignmentRule;
      t.assignedTo =
        t.assignmentRule === 'SPECIFIC_USER'
          ? memberOf(b.assignedUserId ?? t.assignedTo?.userId)
          : null;
      if (b.dueOffsetDays !== undefined) t.dueOffsetDays = b.dueOffsetDays;
      if (b.clientVisibleDefault !== undefined) t.clientVisibleDefault = b.clientVisibleDefault;
      if (b.checklist)
        t.checklist = b.checklist.map((c) => ({ label: c.label, required: c.required ?? false }));
      if (b.reminders) t.reminders = templateReminders(b.reminders);
      t.updatedAt = nowIso();
      t.version = `v${Number(t.version.slice(1)) + 1}`;
      return copy(t);
    },
    duplicateTemplate: async (id) => {
      await mockDelay();
      const src = template(id);
      const t = {
        ...copy(src),
        id: uuid('0c10', s.next++),
        name: `${src.name} (Copy)`,
        version: 'v1',
      };
      s.templates.unshift(t);
      return copy(t);
    },
    archiveTemplate: async (id) => {
      await mockDelay();
      const t = template(id);
      t.archivedAt = nowIso();
      return copy(t);
    },
    restoreTemplate: async (id) => {
      await mockDelay();
      const t = template(id);
      t.archivedAt = null;
      return copy(t);
    },
    saveAsTemplate: async (id, body) => {
      await mockDelay();
      const { name } = parseInput(SaveTaskAsTemplateRequest, body);
      const src = find(id);
      dupName(name, s.templates);
      const t: TaskTemplate = {
        id: uuid('0c10', s.next++),
        name,
        description: src.details,
        type: src.type,
        service: src.service,
        priority: src.priority,
        assignmentRule: 'UNASSIGNED',
        assignedTo: null,
        dueOffsetDays: null,
        clientVisibleDefault: src.clientVisible,
        checklist: src.checklistItems.map((c) => ({ label: c.label, required: c.required })),
        reminders: copy(src.reminders),
        recurrence: null,
        archivedAt: null,
        createdBy: me,
        updatedAt: nowIso(),
        version: 'v1',
      };
      s.templates.unshift(t);
      return copy(t);
    },
    seriesList: async (query = {}) => {
      await mockDelay();
      const q = parseInput(TaskSeriesQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      const rows = s.series
        .map((x) => x.detail)
        .filter((d) => !q.status || d.status === q.status)
        .filter((d) => !q.clientId || d.client.id === q.clientId)
        .filter((d) => !search || d.title.toLowerCase().includes(search));
      const start = (q.page - 1) * q.pageSize;
      return {
        items: copy(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    series: async (id) => {
      await mockDelay();
      return copy(series(id).detail);
    },
    previewSeries: async (body) => {
      await mockDelay();
      const b = parseInput(SeriesPreviewRequest, body);
      const dates = occurrenceDates(b.recurrence, b.count);
      return {
        dates,
        endsAfter: b.recurrence.endMode !== 'NEVER' && dates.length < b.count ? dates.length : null,
      };
    },
    createSeries: async (body) => {
      await mockDelay();
      const b = parseInput(CreateTaskSeriesRequest, body);
      const client = CLIENTS.find((c) => c.id === b.clientId) ?? {
        id: b.clientId,
        displayName: 'Selected client',
      };
      const n = s.next++;
      const made = makeSeries(s, n, b.title, client, b.recurrence.interval, b.recurrence.unit);
      made.detail.recurrence = {
        ...b.recurrence,
        pattern: b.recurrence.pattern as Record<string, unknown>,
      };
      made.detail.details = b.details ?? null;
      made.detail.priority = b.priority ?? 'MEDIUM';
      made.detail.type = type(b.typeId);
      made.detail.checklist = (b.checklist ?? []).map((c) => ({
        label: c.label,
        required: c.required ?? false,
      }));
      made.detail.clientVisible = b.clientVisible ?? false;
      made.detail.notifyClient = b.notifyClient ?? false;
      made.detail.createAtPeriodStart = b.createAtPeriodStart ?? false;
      made.detail.linkTaxCalendar = b.linkTaxCalendar ?? false;
      made.detail.assignedTo = memberOf(b.assignedUserId) ?? made.detail.assignedTo;
      made.detail.extraAssignees = (b.extraAssigneeIds ?? []).map((i) => memberOf(i) as MemberRef);
      made.occurrences = [];
      reseries(made);
      s.series.unshift(made);
      return copy(made.detail);
    },
    updateSeries: async (id, body) => {
      await mockDelay();
      const b = parseInput(UpdateTaskSeriesRequest, body);
      const x = series(id);
      if (b.version !== x.detail.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this first');
      if (b.title) x.detail.title = b.title;
      if (b.details !== undefined) x.detail.details = b.details ?? null;
      if (b.priority) x.detail.priority = b.priority;
      if (b.clientVisible !== undefined) x.detail.clientVisible = b.clientVisible;
      if (b.recurrence)
        x.detail.recurrence = {
          ...x.detail.recurrence,
          ...b.recurrence,
        } as TaskSeriesDetail['recurrence'];
      reseries(x);
      return copy(x.detail);
    },
    pauseSeries: async (id) => {
      await mockDelay();
      const d = series(id).detail;
      d.status = 'PAUSED';
      d.pausedAt = nowIso();
      return copy(d);
    },
    resumeSeries: async (id) => {
      await mockDelay();
      const d = series(id).detail;
      d.status = 'ACTIVE';
      d.pausedAt = null;
      return copy(d);
    },
    stopSeries: async (id) => {
      await mockDelay();
      const d = series(id).detail;
      d.status = 'ENDED';
      d.endedAt = nowIso();
      d.nextDueOn = null;
      return copy(d);
    },
    occurrences: async (id, query = {}) => {
      await mockDelay();
      const q = parseInput(TaskOccurrencesQuery, query);
      const rows = series(id).occurrences.filter((o) => !q.state || o.state === q.state);
      const start = (q.page - 1) * q.pageSize;
      return {
        items: copy(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    skipOccurrence: async (id, occurrenceId, body = {}) => {
      await mockDelay();
      const { reason } = parseInput(SkipOccurrenceRequest, body);
      const o = series(id).occurrences.find((x) => x.id === occurrenceId);
      if (!o) throw fail(404, 'NOT_FOUND', 'Not found');
      if (o.state !== 'SCHEDULED')
        throw fail(409, 'OCCURRENCE_CLOSED', 'This occurrence is already closed');
      o.state = 'SKIPPED';
      o.skipReason = reason ?? null;
      return copy(o);
    },
    skipFuture: async (id, body) => {
      await mockDelay();
      parseInput(SkipFutureRequest, body);
      const x = series(id);
      for (const o of x.occurrences) if (o.state === 'SCHEDULED') o.state = 'SKIPPED';
      x.detail.nextDueOn = null;
      return copy(x.detail);
    },
    convertToRecurring: async (id, body) => {
      await mockDelay();
      const b = parseInput(ConvertToRecurringRequest, body);
      const t = find(id);
      const made = makeSeries(
        s,
        s.next++,
        t.title,
        t.client,
        b.recurrence.interval,
        b.recurrence.unit,
      );
      t.recurring = true;
      t.series = { id: made.detail.id, title: made.detail.title };
      touch(t);
      s.series.unshift(made);
      return copy(made.detail);
    },
  };
}

/** A read does not change the task (its version stays), only refreshes derived fields. */
function touchless(t: TaskDetail): TaskDetail {
  t.overdue = t.status === 'OPEN' && t.dueOn !== null && t.dueOn < today();
  return t;
}
