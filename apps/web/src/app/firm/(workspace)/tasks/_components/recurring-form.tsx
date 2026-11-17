'use client';

import {
  type CreateTaskSeriesRequest,
  RecurrencePattern,
  type TaskPriority,
  type TaskSeriesDetail,
  type UpdateTaskSeriesRequest,
} from '@firmivra/types';
import { Button, Checkbox, Modal, Textarea, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  CheckCircle,
  CloudArrowUp,
  FloppyDisk,
  Plus,
  Repeat,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ORIGIN_PARAM, safeOrigin } from '../../../../../lib/origin';
import { useClients, useMembers } from './task-data';
import { ChecklistItems, type Item, takeRecurringHandoff } from './task-form-parts';
import { TaskTypeSelect, useTypeChoice } from './task-type-field';
import { UnsavedDialog, useUnsavedGuard } from './unsaved-guard';
import { PRIORITY_LABEL, TASKS_KEY, TASK_ERRORS, dayText } from './task-shared';

const field =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NTH = ['1st', '2nd', '3rd', '4th', 'Last'];

function Section({
  step,
  title,
  subtitle,
  aside,
  children,
  testId,
}: {
  step?: number;
  title: string;
  subtitle?: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {step ? (
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
            >
              {step}
            </span>
          ) : null}
          <div>
            <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
            {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
const Lbl = ({
  text,
  required,
  htmlFor,
  children,
}: {
  text: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={htmlFor} className="text-sm font-medium text-text">
      {text}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
    {children}
  </div>
);

type Unit = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

/**
 * /tasks/recurring/new: Set Up Recurring Task. Save & Create Another (Octavia's A5) saves the
 * series once and starts a fresh form (a new key), saying what was saved.
 */
/** Where the form starts: a client and engagement from Create Task's Recurring switch (Review 2). */
type Prefill = { clientId?: string | undefined; engagementId?: string | undefined };

export function RecurringFormScreen({ prefill = {} }: { prefill?: Prefill }) {
  const [round, setRound] = useState(0);
  // T-C11: what Create Task's Recurring switch handed over, for the first form only.
  const [handoff] = useState(() => (typeof window === 'undefined' ? null : takeRecurringHandoff()));
  const [saved, setSaved] = useState<string>();
  return (
    <RecurringForm
      key={round}
      // Save & Create Another starts empty; the first form keeps what it was opened with.
      prefill={round === 0 ? prefill : {}}
      handoff={round === 0 ? handoff : null}
      saved={saved}
      onAnother={(title) => {
        setSaved(title);
        setRound(round + 1);
      }}
    />
  );
}

/**
 * Tasks Review Two T-D16: /tasks/recurring/[id]/edit, Edit Series: the same form, filled from the
 * series, saved for this and future occurrences (scope FUTURE). Tasks already made keep theirs;
 * one occurrence is changed by editing its task. Owner and Admin (the API refuses others).
 */
export function EditSeriesScreen({ id }: { id: string }) {
  const series = useApiQuery([...TASKS_KEY, 'series', id], () => api.taskWork.series(id));
  if (!series.data)
    return (
      <p role="status" className="rounded-xl bg-surface p-6 text-sm text-muted shadow-md">
        {series.isError ? errorMessage(series.error, TASK_ERRORS) : 'Loading…'}
      </p>
    );
  return (
    <RecurringForm
      // The series' id, never its version: a save refetches it and must not remount the form
      // before the save's own success moves to the series page.
      key={series.data.id}
      prefill={{}}
      handoff={null}
      saved={undefined}
      onAnother={() => undefined}
      editing={series.data}
    />
  );
}

function RecurringForm({
  prefill,
  handoff,
  saved,
  onAnother,
  editing,
}: {
  prefill: Prefill;
  handoff: { title: string; items: Item[] } | null;
  /** T-D16: the series being edited; its values fill the form. */
  editing?: TaskSeriesDetail;
  saved: string | undefined;
  onAnother: (title: string) => void;
}) {
  const router = useRouter();
  const { members } = useMembers();
  const { clients } = useClients();
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  // A5 (#1084): one key per form, reused only to retry its save, so a retried Save never makes a
  // second series; Save & Create Another starts a fresh form with a new key.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // T-D16: the series' repeat pattern, as the form's choices.
  const editPattern: RecurrencePattern =
    (editing ? RecurrencePattern.safeParse(editing.recurrence.pattern).data : undefined) ?? {};
  const [title, setTitle] = useState(editing?.title ?? handoff?.title ?? '');
  const [typeId, setTypeId] = useState(editing?.type?.id ?? '');
  const typeChoice = useTypeChoice(typeId);
  const [details, setDetails] = useState(editing?.details ?? '');
  // Review 2 (Bookkeeping N05): switching to recurrence keeps the client and engagement, and the
  // engagement's service is the service until another is chosen.
  const [clientId, setClientId] = useState(editing?.client.id ?? prefill.clientId ?? '');
  const [engagementId, setEngagementId] = useState(
    prefill.clientId ? (prefill.engagementId ?? '') : '',
  );
  const [serviceChoice, setServiceChoice] = useState<string | null>(
    editing ? (editing.service?.id ?? '') : null,
  );
  const [assignee, setAssignee] = useState(editing?.assignedTo?.userId ?? '');
  const [extra, setExtra] = useState<string[]>(editing?.extraAssignees.map((a) => a.userId) ?? []);
  const [interval, setInterval] = useState(String(editing?.recurrence.interval ?? 1));
  const [unit, setUnit] = useState<Unit>(editing?.recurrence.unit ?? 'MONTH');
  const [startOn, setStartOn] = useState(editing?.recurrence.startOn ?? today);
  const [endMode, setEndMode] = useState<'NEVER' | 'AFTER_COUNT' | 'ON_DATE'>(
    editing?.recurrence.endMode ?? 'NEVER',
  );
  const [endAfter, setEndAfter] = useState(String(editing?.recurrence.endAfterCount ?? 8));
  const [endOn, setEndOn] = useState(editing?.recurrence.endOn ?? '');
  const [repeatOn, setRepeatOn] = useState<'DAY_OF_MONTH' | 'NTH_WEEKDAY'>(
    editPattern.monthly ?? 'DAY_OF_MONTH',
  );
  const [nth, setNth] = useState(editPattern.nth ?? 3);
  const [weekday, setWeekday] = useState(editPattern.weekday ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(editPattern.weekdays ?? [1]);
  const [holidays, setHolidays] = useState(
    editing ? editing.recurrence.holidayRule !== 'NONE' : true,
  );
  const [atStart, setAtStart] = useState(editing?.createAtPeriodStart ?? false);
  const [byTeam, setByTeam] = useState(editing?.assignmentRule === 'CLIENT_TEAM');
  const [taxCalendar, setTaxCalendar] = useState(editing?.linkTaxCalendar ?? false);
  const [setPriority, setSetPriority] = useState(true);
  const [priority, setPriorityValue] = useState<TaskPriority>(editing?.priority ?? 'MEDIUM');
  const [remind, setRemind] = useState(editing ? editing.reminders.length > 0 : true);
  // T-D16: a series' days reminders; its Custom ones stay as they are unless these change.
  const startReminders = editing
    ? editing.reminders.filter((r) => !r.unit).map((r) => r.daysBefore)
    : [1];
  const [reminders, setReminders] = useState(startReminders);
  const [notifyClient, setNotifyClient] = useState(editing?.notifyClient ?? false);
  const [items, setItems] = useState<Item[]>(
    editing
      ? editing.checklist.map((c, n) => ({
          key: `e${n}`,
          label: c.label,
          required: c.required,
          done: false,
        }))
      : (handoff?.items ?? []),
  );
  // Octavia's C8: each task the series makes starts with its own copy of this checklist (the API
  // snapshots it), so ticking a step on one occurrence never ticks it on another.
  const [applyChecklist, setApplyChecklist] = useState(true);
  const [nextKey, setNextKey] = useState(0);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | undefined>(
    saved ? { text: `${saved} saved. Set up the next one.`, tone: 'success' } : undefined,
  );
  // One save at a time: a second click before the first answers does nothing.
  const sendingRef = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [tpl, setTpl] = useState(false);
  const [tplName, setTplName] = useState('');

  const engagements = useApiQuery([...TASKS_KEY, 'engagements', clientId], async () =>
    clientId ? api.engagements.listForClient(clientId) : [],
  );
  const services = useApiQuery([...TASKS_KEY, 'services'], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100 }),
  );
  const engagementService = engagements.data?.find((x) => x.id === engagementId)?.service.id;
  const serviceId =
    serviceChoice ??
    (engagementService && services.data?.items.some((x) => x.id === engagementService)
      ? engagementService
      : '');
  const templates = useApiQuery([...TASKS_KEY, 'templates', 'active'], () =>
    api.taskWork.templates({ status: 'active' }),
  );

  const pattern =
    unit === 'WEEK'
      ? { weekdays }
      : unit === 'MONTH'
        ? repeatOn === 'NTH_WEEKDAY'
          ? { monthly: 'NTH_WEEKDAY' as const, nth, weekday }
          : { monthly: 'DAY_OF_MONTH' as const }
        : {};
  const recurrence = {
    interval: Math.max(1, Number(interval) || 1),
    unit,
    pattern,
    startOn,
    endMode,
    endAfterCount: endMode === 'AFTER_COUNT' ? Math.max(1, Number(endAfter) || 1) : null,
    endOn: endMode === 'ON_DATE' && endOn ? endOn : null,
    holidayRule: holidays ? ('NEXT_BUSINESS_DAY' as const) : ('NONE' as const),
  };
  const preview = useApiQuery(
    [...TASKS_KEY, 'series-preview', JSON.stringify(recurrence)],
    async () => (startOn ? api.taskWork.previewSeries({ recurrence, count: 5 }) : null),
  );

  const checklist = items
    .filter((i) => i.label.trim())
    .map((i) => ({ label: i.label.trim(), required: i.required }));
  const options = { invalidate: [...TASKS_KEY] };
  const guard = useUnsavedGuard({
    title,
    typeId,
    details,
    clientId,
    engagementId,
    serviceChoice,
    assignee,
    extra,
    interval,
    unit,
    startOn,
    endMode,
    endAfter,
    endOn,
    repeatOn,
    nth,
    weekday,
    weekdays,
    holidays,
    atStart,
    byTeam,
    taxCalendar,
    setPriority,
    priority,
    remind,
    reminders,
    notifyClient,
    applyChecklist,
    items: items.map((i) => [i.label, i.required]),
  });
  const save = useApiMutation(() => {
    if (editing) {
      // T-D16: this and future occurrences; tasks already made are never rewritten.
      const remindersChanged =
        remind !== editing.reminders.length > 0 ||
        JSON.stringify(reminders) !== JSON.stringify(startReminders);
      const update: UpdateTaskSeriesRequest = {
        scope: 'FUTURE',
        version: editing.version,
        title: title.trim(),
        details,
        serviceId: serviceId || null,
        typeId: typeChoice.value || null,
        priority,
        assignmentRule: byTeam ? 'CLIENT_TEAM' : 'SPECIFIC_USER',
        assignedUserId: byTeam ? null : assignee,
        extraAssigneeIds: extra,
        createAtPeriodStart: atStart,
        linkTaxCalendar: taxCalendar,
        checklist: applyChecklist ? checklist : [],
        ...(remindersChanged
          ? { reminders: remind ? reminders.map((d) => ({ daysBefore: d })) : [] }
          : {}),
        notifyClient: notifyClient && editing.clientVisible,
        recurrence: {
          interval: recurrence.interval,
          unit: recurrence.unit,
          pattern: recurrence.pattern,
          endMode: recurrence.endMode,
          endAfterCount: recurrence.endAfterCount,
          endOn: recurrence.endOn,
          holidayRule: recurrence.holidayRule,
        },
      };
      return api.taskWork.updateSeries(editing.id, update);
    }
    const body: CreateTaskSeriesRequest = {
      clientId,
      title: title.trim(),
      details,
      ...(engagementId ? { engagementId } : {}),
      serviceId: serviceId || null,
      typeId: typeChoice.value || null,
      ...(setPriority ? { priority } : {}),
      assignmentRule: byTeam ? 'CLIENT_TEAM' : 'SPECIFIC_USER',
      ...(byTeam ? {} : { assignedUserId: assignee }),
      extraAssigneeIds: extra,
      createAtPeriodStart: atStart,
      linkTaxCalendar: taxCalendar,
      checklist: applyChecklist ? checklist : [],
      reminders: remind ? reminders.map((d) => ({ daysBefore: d })) : [],
      ...(notifyClient ? { clientVisible: true, notifyClient: true } : {}),
      recurrence,
      idempotencyKey,
    };
    return api.taskWork.createSeries(body);
  }, options);
  const saveTemplate = useApiMutation(
    () =>
      api.taskWork.createTemplate({
        name: tplName.trim(),
        description: details,
        typeId: typeChoice.value || null,
        priority,
        checklist,
        recurrence,
      }),
    options,
  );
  function submit(another = false) {
    if (sendingRef.current) return;
    const e: Record<string, string> = {};
    if (!title.trim()) e['title'] = 'Enter the task name';
    if (typeChoice.problem) e['type'] = typeChoice.problem;
    if (!clientId) e['client'] = 'Choose a client';
    if (!byTeam && !assignee) e['assignee'] = 'Choose who it is assigned to';
    if (!startOn) e['start'] = 'Choose the start date';
    if (endMode === 'ON_DATE' && !endOn) e['end'] = 'Choose the end date';
    setErrors(e);
    if (Object.keys(e).length) {
      setMessage({ text: 'Fix the highlighted fields to continue.', tone: 'error' });
      return;
    }
    sendingRef.current = true;
    save.mutate(undefined, {
      onSuccess: (s) => {
        if (another) return onAnother(s.title);
        guard.allow();
        router.push(`/tasks/recurring/${s.id}`);
      },
      onError: (er) => setMessage({ text: errorMessage(er, TASK_ERRORS), tone: 'error' }),
      onSettled: () => {
        sendingRef.current = false;
      },
    });
  }
  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-danger">
        {errors[k]}
      </p>
    ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="recurring-create">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/tasks" className="flex items-center gap-1 text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Tasks
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">
          {editing ? 'Edit Recurring Task' : 'Set Up Recurring Task'}
        </span>
      </nav>
      <header className="flex items-center gap-4">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
          <Repeat aria-hidden weight="bold" className="size-8" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold text-heading">
            {editing ? 'Edit Recurring Task' : 'Set Up Recurring Task'}
          </h1>
          <p className="text-base text-muted">
            {editing ? (
              <span data-testid="edit-series-scope">
                Changes apply to this and future occurrences: tasks already made keep theirs. To
                change one occurrence, edit its task.{' '}
              </span>
            ) : null}
            Automate repeat tasks and keep your team on track. Perfect for ongoing client work,
            deadlines, and seasonal tasks.
          </p>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <UnsavedDialog guard={guard} onSave={() => submit(false)} saving={save.isPending} />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            step={1}
            title="Task Information"
            subtitle="Enter the basic details for this recurring task."
            testId="rec-info"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Lbl text="Task Name" required htmlFor="rf-title">
                <input
                  id="rf-title"
                  className={field}
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                />
                {err('title')}
              </Lbl>
              <Lbl text="Task Type" required={typeChoice.required} htmlFor="rf-type">
                <TaskTypeSelect
                  id="rf-type"
                  className={field}
                  choice={typeChoice}
                  onChange={setTypeId}
                  onAdded={(_, text) => {
                    setErrors((e) => {
                      const next = { ...e };
                      delete next['type'];
                      return next;
                    });
                    setMessage({ text, tone: 'success' });
                  }}
                  error={err('type')}
                />
              </Lbl>
              <div className="md:col-span-2">
                <Textarea
                  label="Description"
                  rows={3}
                  maxLength={2000}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                />
                <p className="text-right text-xs text-muted">Characters: {details.length}/2000</p>
              </div>
            </div>
          </Section>
          <Section
            step={2}
            title="Client & Related Information"
            subtitle="Link this task to a client, project, or service."
            testId="rec-client"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Lbl text="Client" required htmlFor="rf-client">
                <select
                  id="rf-client"
                  className={field}
                  disabled={!!editing}
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value);
                    setEngagementId('');
                  }}
                >
                  <option value="">Select client</option>
                  {/* T-D16: the series' own client, even when the list does not reach it. */}
                  {editing && !clients.some((c) => c.id === editing.client.id) ? (
                    <option value={editing.client.id}>{editing.client.displayName}</option>
                  ) : null}
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
                {err('client')}
              </Lbl>
              <Lbl text="Related To" htmlFor="rf-related">
                <select
                  id="rf-related"
                  className={field}
                  disabled={!clientId}
                  value={engagementId}
                  onChange={(e) => setEngagementId(e.target.value)}
                >
                  <option value="">{clientId ? 'No project' : 'Choose a client first'}</option>
                  {(engagements.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
                </select>
              </Lbl>
              <Lbl text="Service (if applicable)" htmlFor="rf-service">
                <select
                  id="rf-service"
                  className={field}
                  value={serviceId}
                  onChange={(e) => setServiceChoice(e.target.value)}
                >
                  <option value="">
                    {services.isError ? 'Services are not available' : 'No service'}
                  </option>
                  {(services.data?.items ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Lbl>
              <Lbl text="Assign To" required htmlFor="rf-assignee">
                <select
                  id="rf-assignee"
                  className={field}
                  disabled={byTeam}
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                >
                  <option value="">{byTeam ? "The client's team" : 'Select team member'}</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {err('assignee')}
              </Lbl>
              <fieldset className="flex min-w-0 flex-col gap-1 md:col-span-2">
                <legend className="text-sm font-medium text-text">Additional Assignees</legend>
                <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-control border border-border bg-surface px-2 py-1">
                  {extra.map((uid) => (
                    <span
                      key={uid}
                      className="inline-flex items-center gap-1 rounded-pill bg-canvas py-0.5 pr-1 pl-2 text-sm text-heading"
                    >
                      {members.find((m) => m.userId === uid)?.name ?? 'Team member'}
                      <button
                        type="button"
                        aria-label="Remove assignee"
                        onClick={() => setExtra(extra.filter((x) => x !== uid))}
                        className="text-muted hover:text-danger"
                      >
                        <X aria-hidden weight="bold" className="size-3" />
                      </button>
                    </span>
                  ))}
                  <select
                    aria-label="Add an assignee"
                    value=""
                    onChange={(e) => e.target.value && setExtra([...extra, e.target.value])}
                    className="min-h-8 min-w-20 flex-1 bg-transparent text-sm text-muted outline-none"
                  >
                    <option value="">Add…</option>
                    {members
                      .filter((m) => m.userId !== assignee && !extra.includes(m.userId))
                      .map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name}
                        </option>
                      ))}
                  </select>
                </div>
              </fieldset>
            </div>
          </Section>
          <Section
            step={3}
            title="Recurrence Settings"
            subtitle="Define how often this task should be created."
            testId="rec-settings"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Lbl text="Repeat Every" htmlFor="rf-interval">
                <div className="flex gap-2">
                  <input
                    id="rf-interval"
                    type="number"
                    min={1}
                    max={365}
                    className={`${field} w-20!`}
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                  />
                  <select
                    aria-label="Unit"
                    className={field}
                    value={unit}
                    onChange={(e) => setUnit(e.target.value as Unit)}
                  >
                    <option value="DAY">Day(s)</option>
                    <option value="WEEK">Week(s)</option>
                    <option value="MONTH">Month(s)</option>
                    <option value="QUARTER">Quarter(s)</option>
                    <option value="YEAR">Year(s)</option>
                  </select>
                </div>
              </Lbl>
              <Lbl text="Start Date" required htmlFor="rf-start">
                <input
                  id="rf-start"
                  type="date"
                  className={field}
                  disabled={!!editing}
                  value={startOn}
                  onChange={(e) => setStartOn(e.target.value)}
                />
                {err('start')}
              </Lbl>
              <Lbl text="End Date" htmlFor="rf-end-date">
                <input
                  id="rf-end-date"
                  type="date"
                  className={field}
                  value={endOn}
                  onChange={(e) => {
                    setEndOn(e.target.value);
                    if (e.target.value) setEndMode('ON_DATE');
                  }}
                />
                {err('end')}
              </Lbl>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-text">Repeat On</legend>
                {unit === 'WEEK' ? (
                  <div className="flex flex-wrap gap-x-3">
                    {WEEKDAYS.map((d, i) => (
                      <Checkbox
                        key={d}
                        label={d.slice(0, 3)}
                        checked={weekdays.includes(i)}
                        onChange={(e) =>
                          setWeekdays(
                            e.target.checked
                              ? [...weekdays, i]
                              : weekdays.filter((x) => x !== i).length
                                ? weekdays.filter((x) => x !== i)
                                : weekdays,
                          )
                        }
                      />
                    ))}
                  </div>
                ) : unit === 'MONTH' ? (
                  <div className="flex flex-col gap-2 text-sm text-heading">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="rf-on"
                        checked={repeatOn === 'DAY_OF_MONTH'}
                        onChange={() => setRepeatOn('DAY_OF_MONTH')}
                      />{' '}
                      Same day of the month (e.g., 15th)
                    </label>
                    <label className="flex flex-wrap items-center gap-2">
                      <input
                        type="radio"
                        name="rf-on"
                        checked={repeatOn === 'NTH_WEEKDAY'}
                        onChange={() => setRepeatOn('NTH_WEEKDAY')}
                      />{' '}
                      Specific day of week
                      <select
                        aria-label="Which week"
                        className={`${field} w-24!`}
                        disabled={repeatOn !== 'NTH_WEEKDAY'}
                        value={nth}
                        onChange={(e) => setNth(Number(e.target.value))}
                      >
                        {NTH.map((n, i) => (
                          <option key={n} value={i + 1}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Which weekday"
                        className={`${field} w-32!`}
                        disabled={repeatOn !== 'NTH_WEEKDAY'}
                        value={weekday}
                        onChange={(e) => setWeekday(Number(e.target.value))}
                      >
                        {WEEKDAYS.map((d, i) => (
                          <option key={d} value={i}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Repeats on the start date's day.</p>
                )}
              </fieldset>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-text">End Recurrence</legend>
                <div className="flex flex-col gap-2 text-sm text-heading">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="rf-end"
                      checked={endMode === 'NEVER'}
                      onChange={() => setEndMode('NEVER')}
                    />{' '}
                    No end date
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="rf-end"
                      checked={endMode === 'AFTER_COUNT'}
                      onChange={() => setEndMode('AFTER_COUNT')}
                    />{' '}
                    End after
                    <input
                      aria-label="Occurrences"
                      type="number"
                      min={1}
                      max={1000}
                      className={`${field} w-20!`}
                      disabled={endMode !== 'AFTER_COUNT'}
                      value={endAfter}
                      onChange={(e) => setEndAfter(e.target.value)}
                    />{' '}
                    occurrences
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="rf-end"
                      checked={endMode === 'ON_DATE'}
                      onChange={() => setEndMode('ON_DATE')}
                    />{' '}
                    End on the end date
                  </label>
                </div>
              </fieldset>
            </div>
          </Section>
          <Section
            step={4}
            title="Checklist / Subtasks"
            subtitle="Add steps that will be included with each recurring task."
            testId="rec-checklist"
            aside={
              <div className="flex flex-wrap items-center gap-3 text-sm font-medium text-link">
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => {
                    setNextKey(nextKey + 1);
                    setItems([
                      ...items,
                      { key: `n${nextKey}`, label: '', required: false, done: false },
                    ]);
                  }}
                >
                  <Plus aria-hidden weight="bold" className="size-4" /> Add Item
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1"
                  onClick={() => setPicking(true)}
                >
                  Use Checklist Template
                </button>
              </div>
            }
          >
            <ChecklistItems items={items} onChange={setItems} showDone={false} />
            {/* Tasks Review Two T-C11: the choice sits with the checklist it applies. */}
            <div className="mt-3" data-testid="rec-apply-checklist">
              <Checkbox
                label="Apply the same checklist to all occurrences"
                checked={applyChecklist && checklist.length > 0}
                disabled={checklist.length === 0}
                onChange={(e) => setApplyChecklist(e.target.checked)}
              />
              <p className="ml-8 text-xs text-muted" data-testid="rec-checklist-note">
                {checklist.length === 0
                  ? 'Add a checklist item to apply it to every occurrence.'
                  : applyChecklist
                    ? 'Each occurrence gets its own copy: ticking a step on one task does not tick it on the others.'
                    : 'Occurrences start without a checklist.'}
              </p>
            </div>
          </Section>
          <Section
            title="Attachments (Optional)"
            subtitle="Add resources or templates for this task."
            testId="rec-attachments"
          >
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-control-border bg-canvas p-6 text-center">
              <CloudArrowUp aria-hidden weight="fill" className="size-10 text-action" />
              <p className="text-sm text-heading">Drag and drop files here or click to upload</p>
              <p className="text-xs text-muted">
                Supported files: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG (Max 10MB each)
              </p>
              <span
                className="rounded-control border border-border bg-surface px-4 py-2 text-sm text-muted"
                title="Documents are attached to each task after it is made."
              >
                Browse Files
              </span>
            </div>
          </Section>
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Preview and options">
          <Section
            title="Automation Preview"
            subtitle="Task will be automatically created based on your recurrence settings."
            testId="rec-preview"
          >
            <h3 className="mb-2 text-sm font-bold text-heading">Next 5 Occurrences</h3>
            {(preview.data?.dates ?? []).length === 0 ? (
              <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
                {preview.isPending
                  ? 'Loading…'
                  : preview.isError
                    ? errorMessage(preview.error, TASK_ERRORS)
                    : 'Choose a start date to see the dates.'}
              </p>
            ) : (
              <ol className="flex flex-col gap-2" data-testid="rec-dates">
                {preview.data?.dates.map((d, i) => (
                  <li key={d.scheduledOn} className="flex items-center gap-3 text-sm text-heading">
                    <span
                      aria-hidden
                      className="flex size-6 items-center justify-center rounded-full border border-action text-xs font-semibold text-action"
                    >
                      {i + 1}
                    </span>
                    {dayText(d.dueOn)}
                  </li>
                ))}
              </ol>
            )}
            {preview.data?.endsAfter != null ? (
              <p className="mt-2 text-xs text-muted">
                The series ends after {preview.data.endsAfter}.
              </p>
            ) : null}
          </Section>
          <Section title="Additional Options" testId="rec-options">
            <div className="flex flex-col">
              <Checkbox
                label="Adjust for holidays (move to next business day)"
                checked={holidays}
                onChange={(e) => setHolidays(e.target.checked)}
              />
              <Checkbox
                label="Create task at the start of the period"
                checked={atStart}
                onChange={(e) => setAtStart(e.target.checked)}
              />
              <Checkbox
                label="Auto-assign based on client's team"
                checked={byTeam}
                onChange={(e) => setByTeam(e.target.checked)}
              />
              <Checkbox
                label="Link to tax season calendar (if applicable)"
                checked={taxCalendar}
                onChange={(e) => setTaxCalendar(e.target.checked)}
              />
              <Checkbox
                label="Set priority for all occurrences"
                checked={setPriority}
                onChange={(e) => setSetPriority(e.target.checked)}
              />
              {setPriority ? (
                <select
                  aria-label="Priority for all occurrences"
                  className={`${field} ml-8 w-40!`}
                  value={priority}
                  onChange={(e) => setPriorityValue(e.target.value as TaskPriority)}
                >
                  {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </Section>
          <Section title="Notifications & Reminders" testId="rec-reminders">
            <Checkbox
              label="Enable reminders"
              checked={remind}
              onChange={(e) => setRemind(e.target.checked)}
            />
            {remind ? (
              <ul className="mt-2 flex flex-col gap-2">
                {reminders.map((d, i) => (
                  <li key={`${d}-${i}`} className="flex items-center gap-2">
                    <select
                      aria-label={`Reminder ${i + 1}`}
                      className={field}
                      value={d}
                      onChange={(e) =>
                        setReminders(
                          reminders.map((x, j) => (j === i ? Number(e.target.value) : x)),
                        )
                      }
                    >
                      {[0, 1, 2, 3, 7, 14, 30].map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? 'Same day' : `${n} day${n === 1 ? '' : 's'} before`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove reminder ${i + 1}`}
                      onClick={() => setReminders(reminders.filter((_, j) => j !== i))}
                      className="text-muted hover:text-danger"
                    >
                      <X aria-hidden weight="bold" className="size-4" />
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm font-medium text-link"
                    onClick={() => setReminders([...reminders, 1])}
                  >
                    <Plus aria-hidden weight="bold" className="size-4" /> Add Reminder
                  </button>
                </li>
              </ul>
            ) : null}
            <Checkbox
              label="Notify client (if visible)"
              checked={notifyClient}
              onChange={(e) => setNotifyClient(e.target.checked)}
            />
          </Section>
          <Section title="What Happens Next?" testId="rec-next">
            <ul className="flex flex-col gap-2 text-sm text-heading">
              {[
                'A new task will be automatically created based on your settings.',
                'Each task will include the checklist, assignee(s), and reminders.',
                'You can edit, skip, or stop the series at any time.',
                'All tasks will appear in your main Tasks list and calendar.',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <CheckCircle
                    aria-hidden
                    weight="fill"
                    className="mt-0.5 size-5 shrink-0 text-success"
                  />{' '}
                  {t}
                </li>
              ))}
            </ul>
          </Section>
        </aside>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() =>
            guard.leave(
              safeOrigin(new URLSearchParams(window.location.search).get(ORIGIN_PARAM)) ?? '/tasks',
            )
          }
        >
          Cancel
        </Button>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setTplName(title);
              setTpl(true);
            }}
          >
            <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save as Template
          </Button>
          <Button disabled={save.isPending} onClick={() => submit(false)} data-testid="series-save">
            {editing ? 'Save Changes' : 'Save Recurring Task'}
          </Button>
          {editing ? null : (
            <Button
              variant="outline"
              disabled={save.isPending}
              onClick={() => submit(true)}
              data-testid="series-save-another"
            >
              Save &amp; Create Another
            </Button>
          )}
        </div>
      </div>
      {picking ? (
        <Modal
          open
          title="Use Checklist Template"
          subtitle="Add the checklist of a template."
          onClose={() => setPicking(false)}
        >
          {(templates.data ?? []).length === 0 ? (
            <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
              {templates.isPending ? 'Loading…' : 'No templates yet.'}
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {(templates.data ?? []).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col py-2 text-left hover:bg-canvas"
                    onClick={() => {
                      setItems([
                        ...items,
                        ...t.checklist.map((c, i) => ({
                          key: `${t.id}-${i}-${items.length}`,
                          label: c.label,
                          required: c.required,
                          done: false,
                        })),
                      ]);
                      setPicking(false);
                    }}
                  >
                    <span className="text-sm font-semibold text-heading">{t.name}</span>
                    <span className="text-xs text-muted">{t.checklist.length} items</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}
      {tpl ? (
        <Modal
          open
          title="Save as Template"
          onClose={() => setTpl(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setTpl(false)}>
                Cancel
              </Button>
              <Button
                disabled={!tplName.trim() || saveTemplate.isPending}
                onClick={() =>
                  saveTemplate.mutate(undefined, {
                    onSuccess: () => {
                      setTpl(false);
                      setMessage({ text: 'Template saved.', tone: 'success' });
                    },
                  })
                }
              >
                Save Template
              </Button>
            </>
          }
        >
          <Lbl text="Template name" htmlFor="rf-tpl">
            <input
              id="rf-tpl"
              className={field}
              value={tplName}
              maxLength={120}
              onChange={(e) => setTplName(e.target.value)}
            />
          </Lbl>
          {saveTemplate.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(saveTemplate.error, TASK_ERRORS)}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
