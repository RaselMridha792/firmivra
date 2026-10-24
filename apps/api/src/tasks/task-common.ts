import { BadRequestException } from '@nestjs/common';
import type { Database, Prisma, TaskStatus as StoredTaskStatus, TxClient } from '@firmivra/db';
import {
  reminderMinutes,
  TASK_REMINDER_MAX_MINUTES,
  TASK_REMINDER_UNIT_MINUTES,
} from '@firmivra/types';
import type {
  ChecklistItem,
  DeliveryChannel,
  MemberRef,
  ReminderRule,
  ReminderRuleOut,
  TaskAttachment,
  TaskDetail,
  TaskDraft,
  TaskDraftRow,
  TaskReminderUnit,
  TaskRow,
  TaskStatus,
  TaskWorkErrorCode,
} from '@firmivra/types';
import type { z } from 'zod';
import type { ClientsActor } from '../clients/clients.service.js';
import {
  assignee,
  conflict,
  day,
  isUniqueViolation,
  memberRef,
  notFound,
  violatedIndex,
} from '../workspaces/common.js';
import { minutesOf, timeOfDayFromDb, timeOfDayToDb } from '../appointments/calendar.js';

// ---------- Live tasks and drafts ----------

/**
 * Every task but a draft (Save as Draft, R1 Oct 24). A draft is not live yet: only the Drafts
 * routes (task-drafts.service.ts) read it, so every other read of tasks merges this in, unless
 * its filter already pins a status that is not DRAFT.
 */
export const LIVE_TASK: Prisma.TaskWhereInput = { status: { not: 'DRAFT' } };

/** A live task's status as the contract has it: never DRAFT (see LIVE_TASK). */
export function liveStatus(status: StoredTaskStatus): TaskStatus {
  if (status === 'DRAFT') throw new Error('A draft is not a live task');
  return status;
}

/**
 * A live task's client, or its id: only a draft may have none (tasks_client_unless_draft), and
 * every read but the Drafts routes' leaves drafts out (LIVE_TASK).
 */
export function liveClient<T>(client: T | null): T {
  if (client === null) throw new Error('A live task has a client');
  return client;
}

/** The errors of the Tasks module beyond TaskErrorCode (codes in packages/types/src/tasks). */
const code = (c: TaskWorkErrorCode, message: string) => conflict(c, message);

export const taskErrors = {
  duplicateName: (what: string) =>
    code('DUPLICATE_NAME', `A ${what} with this name already exists`),
  saveConflict: () =>
    code('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  requiredItemsOpen: () =>
    code('REQUIRED_ITEMS_OPEN', 'Complete the required checklist items first'),
  dependencyOpen: () => code('DEPENDENCY_OPEN', 'Complete the task this one depends on first'),
  typeArchived: () => code('TYPE_ARCHIVED', 'This task type is archived. Choose another.'),
  attachmentNotAllowed: () =>
    code(
      'ATTACHMENT_NOT_ALLOWED',
      "Attach one of this client's documents; an internal document cannot be shown to the client",
    ),
  seriesNotActive: () => code('SERIES_NOT_ACTIVE', 'This recurring task is not active'),
  occurrenceClosed: () => code('OCCURRENCE_CLOSED', 'This occurrence is already made or skipped'),
  keyReused: () =>
    code(
      'IDEMPOTENCY_KEY_REUSED',
      'This request key was already used for another save. Try again.',
    ),
  /** 400 with one of TaskWorkErrorCode's codes (the request is well formed but cannot be kept). */
  bad: (c: 'DEPENDENCY_CYCLE' | 'INVALID_REMINDER' | 'INVALID_RECURRENCE', message: string) =>
    new BadRequestException({ code: c, message }),
  /** A request that passed the contract but names something that is not the firm's, or too long. */
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

// ---------- Reminder rules ----------

const DAY_MINUTES = 1_440;
const UNITS = Object.keys(TASK_REMINDER_UNIT_MINUTES) as TaskReminderUnit[];

/**
 * A reminder rule as the Tasks module keeps it (a task_reminders row, or an item of a template's
 * or a series' JSON). A days rule (`unit` null): `daysBefore` the due date at `timeOfDay` ("HH:MM";
 * null: the firm's default time). Custom (Octavia's Tasks review A3, Oct 24): `minutesBefore` the
 * due date and time, typed in `unit`, with no time and its whole days in `daysBefore`, so whatever
 * reads only days still sees a valid rule.
 */
export interface Reminder {
  daysBefore: number;
  timeOfDay: string | null;
  minutesBefore: number | null;
  unit: TaskReminderUnit | null;
  inApp: boolean;
  channels: DeliveryChannel[];
}

/** A rule as a request sends it (the contract's ReminderRule, parsed). */
export type ReminderInput = z.output<typeof ReminderRule>;

/** A rule from a request. */
export function reminderFrom(input: ReminderInput): Reminder {
  const minutes = reminderMinutes(input);
  const where = { inApp: input.inApp, channels: input.channels };
  if (minutes === null || input.unit == null) {
    const days = { daysBefore: input.daysBefore ?? 0, timeOfDay: input.timeOfDay };
    return { ...days, minutesBefore: null, unit: null, ...where };
  }
  const daysBefore = Math.floor(minutes / DAY_MINUTES);
  return { daysBefore, timeOfDay: null, minutesBefore: minutes, unit: input.unit, ...where };
}

/** A stored task_reminders row as a rule. */
export function reminderFromRow(row: {
  daysBefore: number;
  timeOfDay: Date | null;
  minutesBefore: number | null;
  unit: TaskReminderUnit | null;
  inApp: boolean;
  channels: DeliveryChannel[];
}): Reminder {
  const where = { inApp: row.inApp, channels: row.channels };
  if (row.unit === null || row.minutesBefore === null) {
    const timeOfDay = row.timeOfDay ? timeOfDayFromDb(row.timeOfDay) : null;
    return { daysBefore: row.daysBefore, timeOfDay, minutesBefore: null, unit: null, ...where };
  }
  const custom = { minutesBefore: row.minutesBefore, unit: row.unit };
  return { daysBefore: row.daysBefore, timeOfDay: null, ...custom, ...where };
}

/** The task_reminders columns of a rule (the caller adds the firm and the task). */
export function reminderRow(r: Reminder) {
  return {
    daysBefore: r.daysBefore,
    timeOfDay: r.timeOfDay ? timeOfDayToDb(r.timeOfDay) : null,
    minutesBefore: r.minutesBefore,
    unit: r.unit,
    inApp: r.inApp,
    channels: r.channels,
  };
}

/** A whole Custom length of `unit` that the database would keep, or null. */
function wholeMinutes(unit: TaskReminderUnit | null, minutes: unknown): number | null {
  if (unit === null || typeof minutes !== 'number' || !Number.isInteger(minutes)) return null;
  const fits =
    minutes >= 1 &&
    minutes <= TASK_REMINDER_MAX_MINUTES &&
    minutes % TASK_REMINDER_UNIT_MINUTES[unit] === 0;
  return fits ? minutes : null;
}

/**
 * A template's or a series' JSON as rules. One saved before Custom rules (Oct 24), or not whole,
 * reads as the days rule it was.
 */
export function remindersFromJson(json: unknown): Reminder[] {
  if (!Array.isArray(json)) return [];
  return json.map((item: unknown) => {
    const r = (item ?? {}) as Partial<Record<keyof Reminder, unknown>>;
    const where = {
      inApp: typeof r.inApp === 'boolean' ? r.inApp : true,
      channels: Array.isArray(r.channels) ? (r.channels as DeliveryChannel[]) : [],
    };
    const unit = UNITS.find((u) => u === r.unit) ?? null;
    const minutes = wholeMinutes(unit, r.minutesBefore);
    if (unit !== null && minutes !== null) {
      const daysBefore = Math.floor(minutes / DAY_MINUTES);
      return { daysBefore, timeOfDay: null, minutesBefore: minutes, unit, ...where };
    }
    return {
      daysBefore: typeof r.daysBefore === 'number' ? r.daysBefore : 0,
      timeOfDay: typeof r.timeOfDay === 'string' ? r.timeOfDay : null,
      minutesBefore: null,
      unit: null,
      ...where,
    };
  });
}

/**
 * Rules as the JSON a template or a series keeps: a days rule with the keys it always had, a
 * Custom rule with `minutesBefore` and `unit` too (and its whole days, for older readers).
 */
export function remindersJson(rules: Reminder[]) {
  return rules.map((r) => ({
    daysBefore: r.daysBefore,
    timeOfDay: r.timeOfDay,
    ...(r.unit === null ? {} : { minutesBefore: r.minutesBefore, unit: r.unit }),
    inApp: r.inApp,
    channels: r.channels,
  }));
}

/** A rule as the contract shows it: Custom with its amount in the unit it was typed in. */
export function reminderOut(r: Reminder, id: string | null): ReminderRuleOut {
  const amount =
    r.unit === null || r.minutesBefore === null
      ? null
      : r.minutesBefore / TASK_REMINDER_UNIT_MINUTES[r.unit];
  const custom = { amount, unit: amount === null ? null : r.unit };
  return {
    id,
    daysBefore: r.daysBefore,
    timeOfDay: r.timeOfDay,
    ...custom,
    inApp: r.inApp,
    channels: r.channels,
  };
}

/**
 * Minutes from a rule's reminder to the due moment, when they can be told: always for Custom (it
 * needs a due time); for a days rule with a time on a task with a due time, the same clock time
 * that many days earlier. Null otherwise (a days rule with the firm's default time, or no due time).
 * Plain clock minutes, as the contract's ReminderRule says: an hour is 60, a day 1,440, daylight
 * saving ignored. The delivery job works out the exact instant.
 */
function minutesToDue(r: Reminder, dueTime: string | null): number | null {
  if (r.minutesBefore !== null) return r.minutesBefore;
  if (r.timeOfDay === null || dueTime === null) return null;
  return r.daysBefore * DAY_MINUTES + minutesOf(dueTime) - minutesOf(r.timeOfDay);
}

/** The same rule twice: a days rule's days and time, a Custom rule's length and unit. */
const sameRule = (r: Reminder) =>
  r.unit === null ? `d${r.daysBefore}@${r.timeOfDay ?? ''}` : `c${r.minutesBefore}${r.unit}`;
/** What the database keeps once: a days rule's days and time, a Custom rule's length. */
const keptOnce = (r: Reminder) =>
  r.unit === null ? `d${r.daysBefore}@${r.timeOfDay ?? ''}` : `m${r.minutesBefore}`;
/** When it fires: its minutes to the due moment when they can be told, else as kept. */
const firesAt = (r: Reminder, dueTime: string | null) => {
  const minutes = minutesToDue(r, dueTime);
  return minutes === null ? keptOnce(r) : `m${minutes}`;
};

const invalidReminder = (message: string) => taskErrors.bad('INVALID_REMINDER', message);
export const reminderErrors = {
  needsDueDate: () => invalidReminder('Set a due date before adding reminders'),
  needsDueTime: () => invalidReminder('A reminder in minutes or hours needs a due time'),
  once: () => invalidReminder('Each reminder can be added once'),
  sameMoment: () => invalidReminder('Two reminders fire at the same time'),
  afterDue: () => invalidReminder('A reminder cannot be after the due time'),
};

/**
 * The reminder rules of a task or a series checked against its due time (`dueTime`: "HH:MM" when
 * it has one and is not all-day, else null), 400 INVALID_REMINDER. `strict` (a live task, a
 * publish, a series): a Custom rule needs a due time, two rules never fire at the same moment, and
 * none after the due time. Otherwise (a draft, a template, kept as sent): only what is kept once,
 * the same rule twice or two Custom rules of one length. Moments and lengths are plain clock
 * minutes (see minutesToDue).
 */
export function checkReminders(rules: Reminder[], dueTime: string | null, strict: boolean): void {
  const same = new Set<string>();
  const moments = new Set<string>();
  for (const r of rules) {
    if (strict && r.unit !== null && dueTime === null) throw reminderErrors.needsDueTime();
    const rule = sameRule(r);
    if (same.has(rule)) throw reminderErrors.once();
    same.add(rule);
    const moment = strict ? firesAt(r, dueTime) : keptOnce(r);
    if (moments.has(moment)) throw reminderErrors.sameMoment();
    moments.add(moment);
    // On the due day itself, a reminder after the due time is too late.
    if (strict && (minutesToDue(r, dueTime) ?? 0) < 0) throw reminderErrors.afterDue();
  }
}

/**
 * The rules of a template or a series that fit a task or series with this due time (`dueTime` as
 * in checkReminders), never refused: a Custom rule without a due time, a rule after the due time
 * and the later of two that fire at the same moment are left out.
 */
export function fitReminders(rules: Reminder[], dueTime: string | null): Reminder[] {
  const same = new Set<string>();
  const moments = new Set<string>();
  return rules.filter((r) => {
    if (r.unit !== null && dueTime === null) return false;
    if ((minutesToDue(r, dueTime) ?? 0) < 0) return false;
    const rule = sameRule(r);
    const moment = firesAt(r, dueTime);
    if (same.has(rule) || moments.has(moment)) return false;
    same.add(rule);
    moments.add(moment);
    return true;
  });
}

/**
 * A task's rules in the order they fire, the earliest first: by minutes to the due moment (plain
 * clock minutes, as minutesToDue), a days rule with no time placed as if at the due time, and an
 * all-day task due at the end of its day; then by days, a days rule before a Custom one, and time.
 * Ties keep their order.
 */
export function inFiringOrder<T extends { rule: Reminder }>(
  list: T[],
  dueTime: string | null,
): T[] {
  const due = dueTime === null ? DAY_MINUTES : minutesOf(dueTime);
  const before = (r: Reminder) =>
    r.minutesBefore ??
    r.daysBefore * DAY_MINUTES + due - (r.timeOfDay === null ? due : minutesOf(r.timeOfDay));
  return [...list].sort(
    (a, b) =>
      before(b.rule) - before(a.rule) ||
      b.rule.daysBefore - a.rule.daysBefore ||
      Number(a.rule.unit !== null) - Number(b.rule.unit !== null) ||
      (a.rule.timeOfDay ?? '24:00').localeCompare(b.rule.timeOfDay ?? '24:00'),
  );
}

// ---------- Idempotency keys ----------

/** The keys' unique indexes on (business_id, idempotency_key) (migration r1_task_idempotency_keys). */
export const TASK_KEY_INDEX = 'tasks_business_id_idempotency_key_key';
export const SERIES_KEY_INDEX = 'task_series_business_id_idempotency_key_key';

/**
 * Where a key was used, kept beside it: the route, and for Duplicate and Convert the task in the
 * URL, in lower case as ids are stored. Tasks take 'create', 'draft' and 'duplicate:<id>', series
 * 'series' and 'convert:<id>' (the migration's CHECKs).
 */
export const keyScope = {
  create: 'create',
  draft: 'draft',
  duplicate: (sourceId: string) => `duplicate:${sourceId.toLowerCase()}`,
  series: 'series',
  convert: (taskId: string) => `convert:${taskId.toLowerCase()}`,
} as const;

/** The key's columns for a new row: the key with its scope, or neither without a key. */
export function keyColumns(key: string | undefined, scope: string) {
  return key ? { idempotencyKey: key, idempotencyScope: scope } : {};
}

/**
 * The record a key already made in this firm, for a retry of the same save: its id when the same
 * member used the key on the same route for the same task (and, on Save as Draft, while the row
 * is still a draft); null when the key is new. Any other use of the key, on a task or a series,
 * is 409 IDEMPOTENCY_KEY_REUSED, and nothing of the record is shown.
 */
export async function firstByKey(
  tx: TxClient,
  businessId: string,
  actor: ClientsActor,
  key: string,
  scope: string,
): Promise<string | null> {
  const where = { businessId, idempotencyKey: key };
  const keyed = { id: true, createdByUserId: true, idempotencyScope: true } as const;
  const [task, series] = await Promise.all([
    tx.task.findFirst({ where, select: { ...keyed, status: true } }),
    tx.taskSeries.findFirst({ where, select: keyed }),
  ]);
  const found = [...(task ? [task] : []), ...(series ? [{ ...series, status: null }] : [])];
  if (found.length === 0) return null;
  const member = actor.userId.toLowerCase();
  const same = found.find(
    (row) =>
      row.idempotencyScope === scope &&
      row.createdByUserId === member &&
      (scope !== keyScope.draft || row.status === 'DRAFT'),
  );
  if (!same) throw taskErrors.keyReused();
  return same.id;
}

/**
 * A save that makes a task or a series, retry-safe by the request's idempotency key (R1, Oct 24;
 * the contract's IdempotencyKey):
 * - the key is looked up first, before any check that can change between two tries (an archived
 *   type or template, an assignee gone, a task already recurring): the same member's retry on the
 *   same route and task gets `read` of the record the first save made, as it is now and as they
 *   reach it, with nothing written or audited; any other use of the key is 409 (firstByKey);
 * - a new key runs `create`, which stores the key with `scope`;
 * - two requests with one key at once: the second's insert waits on the key's unique `index` and
 *   fails once the first commits. Its transaction is aborted, so it is answered as a retry in a
 *   new one. This is checked before any other error is mapped (`otherwise`).
 * Without a key, only `create`.
 */
export async function keyedSave<T>(
  database: Database,
  businessId: string,
  actor: ClientsActor,
  keyed: { key: string | undefined; scope: string; index: string },
  read: (tx: TxClient, id: string) => Promise<T>,
  create: (tx: TxClient) => Promise<T>,
  otherwise: (error: unknown) => never,
): Promise<T> {
  const { key, scope, index } = keyed;
  const inFirm = <R>(fn: (tx: TxClient) => Promise<R>) =>
    database.withScope({ kind: 'business', businessId }, fn);
  try {
    return await inFirm(async (tx) => {
      const first = key ? await firstByKey(tx, businessId, actor, key, scope) : null;
      return first === null ? create(tx) : read(tx, first);
    });
  } catch (error) {
    if (!key || !isUniqueViolation(error) || violatedIndex(error) !== index) {
      return otherwise(error);
    }
    return inFirm(async (tx) => {
      const first = await firstByKey(tx, businessId, actor, key, scope);
      // Gone already (a draft discarded at once): as for a record the member no longer reaches.
      if (first === null) throw notFound();
      return read(tx, first);
    });
  }
}

// ---------- What a task is read with ----------

const memberSelect = { userId: true, user: { select: { name: true } } } as const;

export const rowInclude = {
  client: { select: { id: true, displayName: true } },
  assignedMember: { select: memberSelect },
  type: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
  engagement: { select: { id: true, title: true } },
  deadline: { select: { id: true, name: true } },
  dependsOn: { select: { id: true, title: true, status: true } },
  taskOccurrence: { select: { seriesId: true } },
  _count: { select: { assignees: true } },
} satisfies Prisma.TaskInclude;

export const detailInclude = {
  ...rowInclude,
  assignees: { select: { member: { select: memberSelect } }, orderBy: { createdAt: 'asc' } },
  taskChecklistItems: {
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: { assignedMember: { select: memberSelect } },
  },
  taskReminders: { orderBy: [{ daysBefore: 'desc' }, { timeOfDay: 'asc' }, { id: 'asc' }] },
  taskAttachments: {
    orderBy: { createdAt: 'asc' },
    include: { document: { select: { fileName: true, contentType: true, sizeBytes: true } } },
  },
  taskOccurrence: {
    select: { seriesId: true, series: { select: { id: true, title: true } } },
  },
} satisfies Prisma.TaskInclude;

export type RowShape = Prisma.TaskGetPayload<{ include: typeof rowInclude }>;
export type DetailShape = Prisma.TaskGetPayload<{ include: typeof detailInclude }>;

/** What a row of the Drafts tab is read with. */
export const draftRowInclude = {
  client: { select: { id: true, displayName: true } },
  assignedMember: { select: memberSelect },
  type: { select: { id: true, name: true } },
  service: { select: { id: true, name: true } },
} satisfies Prisma.TaskInclude;

export type DraftRowShape = Prisma.TaskGetPayload<{ include: typeof draftRowInclude }>;

/** Whether an OPEN task is past due in the firm's time zone (`today` is the firm's date). */
export function isOverdue(
  t: { status: string; dueOn: Date | null; dueTime: Date | null; allDay: boolean },
  today: string,
  nowMinutes: number,
): boolean {
  if (t.status !== 'OPEN' || !t.dueOn) return false;
  const due = day(t.dueOn)!;
  if (due !== today) return due < today;
  if (t.allDay || !t.dueTime) return false;
  const [h, m] = timeOfDayFromDb(t.dueTime).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0) < nowMinutes;
}

export interface RowContext {
  today: string;
  nowMinutes: number;
  /** Checklist steps done, by task id (those with none are missing). */
  done: Map<string, number>;
  /** Checklist steps in all, by task id. */
  total: Map<string, number>;
}

export function toRow(t: RowShape, ctx: RowContext): TaskRow {
  const client = liveClient(t.client);
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    client: { id: client.id, displayName: client.displayName },
    type: t.type ? { id: t.type.id, name: t.type.name } : null,
    engagement: t.engagement ? { id: t.engagement.id, title: t.engagement.title } : null,
    service: t.service ? { id: t.service.id, name: t.service.name } : null,
    deadline: t.deadline ? { id: t.deadline.id, name: t.deadline.name } : null,
    priority: t.priority,
    status: liveStatus(t.status),
    progress: t.progress,
    dueOn: day(t.dueOn),
    dueTime: t.dueTime ? timeOfDayFromDb(t.dueTime) : null,
    allDay: t.allDay,
    overdue: isOverdue(t, ctx.today, ctx.nowMinutes),
    assignedTo: assignee(t.assignedMember),
    additionalAssigneeCount: t._count.assignees,
    checklist: { done: ctx.done.get(t.id) ?? 0, total: ctx.total.get(t.id) ?? 0 },
    blocked: t.dependsOn !== null && t.dependsOn.status !== 'DONE',
    recurring: t.taskOccurrence !== null,
    clientVisible: t.clientVisible,
    archivedAt: t.archivedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** A task's checklist, reminders and attachments, as a TaskDetail or a TaskDraft has them. */
function checklistOut(t: DetailShape, names: Map<string, string>): ChecklistItem[] {
  return t.taskChecklistItems.map((i) => ({
    id: i.id,
    label: i.label,
    position: i.position,
    required: i.required,
    completedAt: i.completedAt?.toISOString() ?? null,
    completedBy: memberRef(names, i.completedByUserId),
    assignedTo: assignee(i.assignedMember),
  }));
}

/** In the order they fire, against the task's due time (none when it is all-day). */
function remindersOut(t: DetailShape): ReminderRuleOut[] {
  const dueTime = t.dueTime && !t.allDay ? timeOfDayFromDb(t.dueTime) : null;
  const rules = t.taskReminders.map((row) => ({ id: row.id, rule: reminderFromRow(row) }));
  return inFiringOrder(rules, dueTime).map(({ id, rule }) => reminderOut(rule, id));
}

function attachmentsOut(t: DetailShape, names: Map<string, string>): TaskAttachment[] {
  return t.taskAttachments.map((a) => ({
    id: a.id,
    documentId: a.documentId,
    fileName: a.document.fileName,
    contentType: a.document.contentType,
    sizeBytes: a.document.sizeBytes,
    clientVisible: a.clientVisible,
    addedBy: memberRef(names, a.addedByUserId),
    addedAt: a.createdAt.toISOString(),
  }));
}

/** The prerequisite: always a live task (a draft is never one). */
const dependsOnOut = (t: DetailShape) =>
  t.dependsOn
    ? { id: t.dependsOn.id, title: t.dependsOn.title, status: liveStatus(t.dependsOn.status) }
    : null;

export function toDetail(t: DetailShape, names: Map<string, string>, ctx: RowContext): TaskDetail {
  const items = checklistOut(t, names);
  const withTotals: RowContext = {
    ...ctx,
    done: new Map([[t.id, items.filter((i) => i.completedAt).length]]),
    total: new Map([[t.id, items.length]]),
  };
  return {
    ...toRow(t, withTotals),
    details: t.details,
    engagementId: t.engagementId,
    startOn: day(t.startOn),
    assignedUserId: t.assignedUserId,
    additionalAssignees: t.assignees.map((a): MemberRef => assignee(a.member)!),
    checklistItems: items,
    reminders: remindersOut(t),
    attachments: attachmentsOut(t, names),
    dependsOn: dependsOnOut(t),
    blockedReason: t.blockedReason,
    internalNotes: t.internalNotes,
    templateId: t.templateId,
    series: t.taskOccurrence?.series
      ? { id: t.taskOccurrence.series.id, title: t.taskOccurrence.series.title }
      : null,
    completedAt: t.completedAt?.toISOString() ?? null,
    completedBy: memberRef(names, t.completedByUserId),
    createdBy: memberRef(names, t.createdByUserId),
    createdAt: t.createdAt.toISOString(),
    version: t.updatedAt.toISOString(),
  };
}

/** One row of the Drafts tab (contract in packages/types/src/tasks/drafts.ts). */
export function toDraftRow(t: DraftRowShape, names: Map<string, string>): TaskDraftRow {
  return {
    id: t.id,
    title: t.title,
    client: t.client ? { id: t.client.id, displayName: t.client.displayName } : null,
    type: t.type ? { id: t.type.id, name: t.type.name } : null,
    service: t.service ? { id: t.service.id, name: t.service.name } : null,
    priority: t.priority,
    dueOn: day(t.dueOn),
    assignedTo: assignee(t.assignedMember),
    createdBy: memberRef(names, t.createdByUserId),
    // Publishing needs a client; everything else a draft holds can be published as it is checked.
    missing: t.clientId ? [] : ['clientId'],
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** A draft with everything the Create Task form shows. */
export function toDraft(t: DetailShape, names: Map<string, string>): TaskDraft {
  return {
    ...toDraftRow(t, names),
    status: 'DRAFT',
    details: t.details,
    engagement: t.engagement ? { id: t.engagement.id, title: t.engagement.title } : null,
    progress: t.progress,
    startOn: day(t.startOn),
    dueTime: t.dueTime ? timeOfDayFromDb(t.dueTime) : null,
    allDay: t.allDay,
    clientVisible: t.clientVisible,
    internalNotes: t.internalNotes,
    blockedReason: t.blockedReason,
    assignedUserId: t.assignedUserId,
    additionalAssignees: t.assignees.map((a): MemberRef => assignee(a.member)!),
    checklistItems: checklistOut(t, names),
    reminders: remindersOut(t),
    attachments: attachmentsOut(t, names),
    dependsOn: dependsOnOut(t),
    templateId: t.templateId,
    version: t.updatedAt.toISOString(),
  };
}
