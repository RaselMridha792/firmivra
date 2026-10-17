'use client';

import type {
  CreateTaskDetailRequest,
  TaskDetail,
  TaskPriority,
  TaskProgress,
  TaskTemplate,
  UpdateTaskDetailRequest,
} from '@firmivra/types';
import { Button, Checkbox, Modal, Textarea, Toast, Toggle } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CloudArrowUp,
  FloppyDisk,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useClients, useMembers, useTypes } from './task-data';
import {
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  TASKS_KEY,
  TASK_ERRORS,
  dayText,
  timeText,
} from './task-shared';

const field =
  'min-h-10 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500 disabled:bg-canvas disabled:text-muted';

function Selectbox({
  value,
  onChange,
  options,
  id,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={field}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

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

const Label = ({
  text,
  required,
  children,
  htmlFor,
}: {
  text: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) => (
  <div className="flex min-w-0 flex-col gap-1">
    <label htmlFor={htmlFor} className="text-sm font-medium text-text">
      {text}
      {required ? <span className="text-danger"> *</span> : null}
    </label>
    {children}
  </div>
);

interface Item {
  key: string;
  id?: string;
  label: string;
  required: boolean;
  done: boolean;
}
interface Reminder {
  key: string;
  daysBefore: number;
}
const DAYS = [0, 1, 2, 3, 7, 14, 30];

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const m = i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

/** /tasks/new and /tasks/[id]/edit: Create Task and Edit Task, one form. */
export function TaskFormScreen({ id, templateId }: { id?: string; templateId?: string }) {
  const task = useApiQuery([...TASKS_KEY, 'task', id ?? 'new'], async () =>
    id ? api.taskWork.task(id) : null,
  );
  const template = useApiQuery([...TASKS_KEY, 'template', templateId ?? 'none'], async () =>
    templateId ? api.taskWork.getTemplate(templateId) : null,
  );
  const waiting = (id !== undefined && task.isPending) || (!!templateId && template.isPending);
  if (waiting)
    return (
      <p role="status" className="rounded-xl bg-surface p-6 text-sm text-muted shadow-md">
        Loading…
      </p>
    );
  return (
    <Form
      key={task.data?.id ?? template.data?.id ?? 'blank'}
      task={task.data ?? undefined}
      template={template.data ?? undefined}
      loadNote={
        id !== undefined && task.isError ? errorMessage(task.error, TASK_ERRORS) : undefined
      }
    />
  );
}

function Form({
  task,
  template,
  loadNote,
}: {
  task: TaskDetail | undefined;
  template: TaskTemplate | undefined;
  loadNote: string | undefined;
}) {
  const router = useRouter();
  const editing = !!task;
  const { members } = useMembers();
  const { types } = useTypes();
  const { clients } = useClients();
  const [title, setTitle] = useState(task?.title ?? '');
  const [typeId, setTypeId] = useState(task?.type?.id ?? template?.type?.id ?? '');
  const [details, setDetails] = useState(task?.details ?? template?.description ?? '');
  const [clientId, setClientId] = useState(task?.client.id ?? '');
  const [engagementId, setEngagementId] = useState(task?.engagementId ?? '');
  const [serviceId, setServiceId] = useState(task?.service?.id ?? '');
  const [assignee, setAssignee] = useState(task?.assignedUserId ?? '');
  const [extra, setExtra] = useState<string[]>(
    task?.additionalAssignees.map((a) => a.userId) ?? [],
  );
  const [priority, setPriority] = useState<TaskPriority>(
    task?.priority ?? template?.priority ?? 'MEDIUM',
  );
  const [startOn, setStartOn] = useState(task?.startOn ?? '');
  const [dueOn, setDueOn] = useState(() =>
    task
      ? (task.dueOn ?? '')
      : template?.dueOffsetDays != null
        ? new Date(Date.now() + template.dueOffsetDays * 86_400_000).toISOString().slice(0, 10)
        : '',
  );
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '17:00');
  const [allDay, setAllDay] = useState(task?.allDay ?? true);
  const [progress, setProgress] = useState<TaskProgress>(task?.progress ?? 'NOT_STARTED');
  const [blockedReason, setBlockedReason] = useState(task?.blockedReason ?? '');
  const [visible, setVisible] = useState(
    task?.clientVisible ?? template?.clientVisibleDefault ?? false,
  );
  const [remind, setRemind] = useState((task?.reminders.length ?? 0) > 0);
  const [reminders, setReminders] = useState<Reminder[]>(
    (task?.reminders ?? []).map((r, i) => ({ key: `r${i}`, daysBefore: r.daysBefore })),
  );
  const [depends, setDepends] = useState(!!task?.dependsOn);
  const [dependsOn, setDependsOn] = useState(task?.dependsOn?.id ?? '');
  const [notes, setNotes] = useState(task?.internalNotes ?? '');
  const [items, setItems] = useState<Item[]>(
    task
      ? task.checklistItems.map((c) => ({
          key: c.id,
          id: c.id,
          label: c.label,
          required: c.required,
          done: !!c.completedAt,
        }))
      : (template?.checklist ?? []).map((c, i) => ({
          key: `t${i}`,
          label: c.label,
          required: c.required,
          done: false,
        })),
  );
  const [nextKey, setNextKey] = useState(0);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tpl, setTpl] = useState(false);
  const [picking, setPicking] = useState(false);
  const templates = useApiQuery([...TASKS_KEY, 'templates', 'active'], () =>
    api.taskWork.templates({ status: 'active' }),
  );
  const [tplName, setTplName] = useState(task?.title ?? '');

  const engagements = useApiQuery([...TASKS_KEY, 'engagements', clientId], async () =>
    clientId ? api.engagements.listForClient(clientId) : [],
  );
  const services = useApiQuery([...TASKS_KEY, 'services'], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100 }),
  );
  const candidates = useApiQuery([...TASKS_KEY, 'candidates'], () =>
    api.taskWork.overview({ view: 'all', pageSize: 100 }),
  );

  const checklistBody = items
    .filter((i) => i.label.trim())
    .map((i) => ({ ...(i.id ? { id: i.id } : {}), label: i.label.trim(), required: i.required }));
  const remindersBody = remind
    ? reminders.map((r) => ({
        daysBefore: r.daysBefore,
        timeOfDay: null,
        inApp: true,
        channels: [] as ('EMAIL' | 'SMS')[],
      }))
    : [];
  const common = () => ({
    typeId: typeId || null,
    priority,
    progress,
    serviceId: serviceId || null,
    startOn: startOn || null,
    allDay,
    dueTime: dueOn && !allDay ? dueTime : null,
    clientVisible: visible,
    internalNotes: notes,
    blockedReason: progress === 'BLOCKED' ? blockedReason : '',
    additionalAssigneeIds: extra,
    dependsOnTaskId: depends && dependsOn ? dependsOn : null,
    reminders: remindersBody,
  });

  const options = { invalidate: [...TASKS_KEY] };
  const save = useApiMutation(async (another: boolean) => {
    if (task) {
      const body: UpdateTaskDetailRequest = {
        version: task.version,
        title: title.trim(),
        details,
        dueOn: dueOn || null,
        assignedUserId: assignee || null,
        ...common(),
        checklist: checklistBody,
      };
      return { saved: await api.taskWork.update(task.id, body), another };
    }
    const body: CreateTaskDetailRequest = {
      clientId,
      title: title.trim(),
      details,
      ...(engagementId ? { engagementId } : {}),
      ...(dueOn ? { dueOn } : {}),
      ...(assignee ? { assignedUserId: assignee } : {}),
      ...common(),
      checklist: checklistBody,
      ...(template ? { templateId: template.id } : {}),
    };
    return { saved: await api.taskWork.create(body), another };
  }, options);
  const saveTemplate = useApiMutation(
    () =>
      api.taskWork.createTemplate({
        name: tplName.trim(),
        description: details,
        typeId: typeId || null,
        priority,
        checklist: checklistBody.map((c) => ({ label: c.label, required: c.required })),
        clientVisibleDefault: visible,
      }),
    options,
  );

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e['title'] = 'Enter the task name';
    if (!typeId) e['type'] = 'Choose a task type';
    if (!clientId) e['client'] = 'Choose a client';
    if (!assignee) e['assignee'] = 'Choose who it is assigned to';
    if (!dueOn) e['due'] = 'Choose a due date';
    if (startOn && dueOn && startOn > dueOn) e['due'] = 'The due date is before the start';
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  function submit(another: boolean) {
    setMessage(undefined);
    if (!validate()) {
      setMessage({ text: 'Fix the highlighted fields to continue.', tone: 'error' });
      return;
    }
    save.mutate(another, {
      onSuccess: ({ saved, another: again }) => {
        if (again) {
          setMessage({ text: 'Task saved. Add another.', tone: 'success' });
          router.replace('/tasks/new');
          setTitle('');
        } else router.push(`/tasks/${saved.id}`);
      },
      onError: (e) => setMessage({ text: errorMessage(e, TASK_ERRORS), tone: 'error' }),
    });
  }

  const summary: [string, string][] = [
    [
      'Client',
      clients.find((c) => c.id === clientId)?.displayName ?? task?.client.displayName ?? '—',
    ],
    [
      'Related To',
      engagements.data?.find((x) => x.id === engagementId)?.title ?? task?.engagement?.title ?? '—',
    ],
    [
      'Service',
      services.data?.items.find((s) => s.id === serviceId)?.name ?? task?.service?.name ?? '—',
    ],
    [
      'Assigned To',
      members.find((m) => m.userId === assignee)?.name ?? task?.assignedTo?.name ?? '—',
    ],
    ['Due Date', dueOn ? `${dayText(dueOn)}${allDay ? '' : ` at ${timeText(dueTime)}`}` : '—'],
    ['Priority', PRIORITY_LABEL[priority]],
    ['Status', PROGRESS_LABEL[progress]],
    ['Client Visible', visible ? 'Yes' : 'No'],
  ];
  const move = (i: number, step: -1 | 1) => {
    const j = i + step;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j] as Item, next[i] as Item];
    setItems(next);
  };
  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-danger">
        {errors[k]}
      </p>
    ) : null;

  return (
    <div
      className="flex min-w-0 flex-col gap-5"
      data-testid={editing ? 'task-edit' : 'task-create'}
    >
      <Link href="/tasks" className="flex w-fit items-center gap-2 text-sm font-medium text-link">
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Tasks
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <Plus aria-hidden weight="bold" className="size-8" />
          </span>
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">
              {editing ? 'Edit Task' : 'Create Task'}
            </h1>
            <p className="text-base text-muted">
              Add a new task, set the details, and keep your team (and clients) on track.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
        >
          Use Template
        </button>
      </header>
      {loadNote ? (
        <p role="status" className="rounded-xl bg-surface px-4 py-3 text-sm text-muted shadow-md">
          {loadNote}
        </p>
      ) : null}
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            step={1}
            title="Basic Information"
            subtitle="Enter the main details for this task."
            testId="form-basic"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Label text="Task Name" required htmlFor="tf-title">
                <input
                  id="tf-title"
                  className={field}
                  value={title}
                  maxLength={200}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-invalid={errors['title'] ? true : undefined}
                />
                {err('title')}
              </Label>
              <Label text="Task Type" required htmlFor="tf-type">
                <Selectbox
                  id="tf-type"
                  label="Task type"
                  value={typeId}
                  onChange={setTypeId}
                  options={[
                    { value: '', label: 'Select task type' },
                    ...types.map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
                {err('type')}
              </Label>
              <div className="md:col-span-2">
                <Textarea
                  label="Description"
                  rows={4}
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
            testId="form-client"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Label text="Client" required htmlFor="tf-client">
                <Selectbox
                  id="tf-client"
                  label="Client"
                  value={clientId}
                  disabled={editing}
                  onChange={(v) => {
                    setClientId(v);
                    setEngagementId('');
                  }}
                  options={[
                    { value: '', label: 'Select client' },
                    ...(editing && task
                      ? [{ value: task.client.id, label: task.client.displayName }]
                      : []),
                    ...clients
                      .filter((c) => c.id !== task?.client.id)
                      .map((c) => ({ value: c.id, label: c.displayName })),
                  ]}
                />
                {err('client')}
              </Label>
              <Label text="Related To" htmlFor="tf-related">
                <Selectbox
                  id="tf-related"
                  label="Related to"
                  value={engagementId}
                  disabled={!clientId || editing}
                  onChange={setEngagementId}
                  options={[
                    { value: '', label: clientId ? 'No project' : 'Choose a client first' },
                    ...(editing && task?.engagement
                      ? [{ value: task.engagement.id, label: task.engagement.title }]
                      : []),
                    ...(engagements.data ?? []).map((x) => ({ value: x.id, label: x.title })),
                  ]}
                />
              </Label>
              <Label text="Service (if applicable)" htmlFor="tf-service">
                <Selectbox
                  id="tf-service"
                  label="Service"
                  value={serviceId}
                  onChange={setServiceId}
                  options={[
                    {
                      value: '',
                      label: services.isError ? 'Services are not available' : 'No service',
                    },
                    ...(services.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </Label>
            </div>
          </Section>

          <Section
            step={3}
            title="Assignment & Priority"
            subtitle="Assign to a team member or team."
            testId="form-assign"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Label text="Assigned To" required htmlFor="tf-assignee">
                <Selectbox
                  id="tf-assignee"
                  label="Assigned to"
                  value={assignee}
                  onChange={setAssignee}
                  options={[
                    { value: '', label: 'Select team member' },
                    ...(task?.assignedTo &&
                    !members.some((m) => m.userId === task.assignedTo?.userId)
                      ? [{ value: task.assignedTo.userId, label: task.assignedTo.name }]
                      : []),
                    ...members.map((m) => ({ value: m.userId, label: m.name })),
                  ]}
                />
                {err('assignee')}
              </Label>
              <fieldset className="flex min-w-0 flex-col gap-1">
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
                        aria-label={`Remove ${members.find((m) => m.userId === uid)?.name ?? 'assignee'}`}
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
              <Label text="Priority" required htmlFor="tf-priority">
                <Selectbox
                  id="tf-priority"
                  label="Priority"
                  value={priority}
                  onChange={(v) => setPriority(v as TaskPriority)}
                  options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Label>
            </div>
          </Section>

          <Section
            step={4}
            title="Dates & Schedule"
            subtitle="Set the timeline and recurrence options."
            testId="form-dates"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Label text="Start Date" htmlFor="tf-start">
                <input
                  id="tf-start"
                  type="date"
                  className={field}
                  value={startOn}
                  onChange={(e) => setStartOn(e.target.value)}
                />
              </Label>
              <Label text="Due Date" required htmlFor="tf-due">
                <input
                  id="tf-due"
                  type="date"
                  className={field}
                  min={startOn || undefined}
                  value={dueOn}
                  onChange={(e) => setDueOn(e.target.value)}
                />
                {err('due')}
              </Label>
              <Label text="Due Time" htmlFor="tf-time">
                <select
                  id="tf-time"
                  className={field}
                  disabled={allDay || !dueOn}
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                >
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {timeText(t)}
                    </option>
                  ))}
                </select>
              </Label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-6">
              <Checkbox
                label="All Day"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              <div className="flex items-center gap-3 text-sm text-heading">
                <div className="flex items-center gap-3">
                  <Toggle
                    label="Recurring Task"
                    checked={false}
                    onChange={() => router.push('/tasks/recurring/new')}
                  />
                  <span>
                    <span className="block font-medium">Recurring Task</span>
                    <span className="block text-xs text-muted">
                      Set up recurrence options (monthly, quarterly, etc.).
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </Section>

          <Section
            step={5}
            title="Checklist / Subtasks"
            subtitle="Break the task into smaller steps (optional)."
            testId="form-checklist"
            aside={
              <button
                type="button"
                onClick={() => {
                  setNextKey(nextKey + 1);
                  setItems([
                    ...items,
                    { key: `n${nextKey}`, label: '', required: false, done: false },
                  ]);
                }}
                className="inline-flex items-center gap-1 text-sm font-medium text-link"
              >
                <Plus aria-hidden weight="bold" className="size-4" /> Add Checklist Item
              </button>
            }
          >
            {items.length === 0 ? (
              <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
                No checklist items yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="form-checklist-items">
                {items.map((it, i) => (
                  <li key={it.key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Item ${i + 1} done`}
                      checked={it.done}
                      disabled
                      className="size-5 shrink-0"
                    />
                    <input
                      aria-label={`Checklist item ${i + 1}`}
                      className={field}
                      value={it.label}
                      maxLength={300}
                      onChange={(e) =>
                        setItems(
                          items.map((x) =>
                            x.key === it.key ? { ...x, label: e.target.value } : x,
                          ),
                        )
                      }
                    />
                    <label className="flex shrink-0 items-center gap-1 text-xs text-text">
                      <input
                        type="checkbox"
                        checked={it.required}
                        onChange={(e) =>
                          setItems(
                            items.map((x) =>
                              x.key === it.key ? { ...x, required: e.target.checked } : x,
                            ),
                          )
                        }
                        className="size-4"
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      aria-label={`Move item ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider disabled:opacity-40"
                    >
                      <ArrowUp aria-hidden weight="bold" className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move item ${i + 1} down`}
                      disabled={i === items.length - 1}
                      onClick={() => move(i, 1)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider disabled:opacity-40"
                    >
                      <ArrowDown aria-hidden weight="bold" className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete item ${i + 1}`}
                      onClick={() => setItems(items.filter((x) => x.key !== it.key))}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-divider text-danger"
                    >
                      <Trash aria-hidden weight="fill" className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            step={6}
            title="Attachments"
            subtitle="Upload relevant documents (optional)."
            testId="form-attachments"
          >
            {task && task.attachments.length > 0 ? (
              <ul className="mb-3 divide-y divide-divider rounded-lg border border-divider">
                {task.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                    <span className="truncate text-heading">{a.fileName}</span>
                    <span className="text-xs text-muted">
                      {a.clientVisible ? 'Visible to client' : 'Staff only'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-control-border bg-canvas p-6 text-center">
              <CloudArrowUp aria-hidden weight="fill" className="size-10 text-action" />
              <p className="text-sm text-heading">Drag and drop files here or click to upload</p>
              <p className="text-xs text-muted">
                Supported files: PDF, DOC, DOCX, XLS, XLSX, PNG, JPG (Max 10MB each)
              </p>
              <span
                className="rounded-control border border-border bg-surface px-4 py-2 text-sm text-muted"
                title="Documents are attached from the client's own documents once the task is saved."
              >
                Browse Files
              </span>
            </div>
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Status and settings">
          <Section title="Task Status" testId="form-status">
            <Selectbox
              label="Task status"
              value={progress}
              onChange={(v) => setProgress(v as TaskProgress)}
              options={Object.entries(PROGRESS_LABEL).map(([value, label]) => ({ value, label }))}
            />
            {progress === 'BLOCKED' ? (
              <input
                aria-label="Why it is blocked"
                className={`${field} mt-2`}
                placeholder="Why is it blocked?"
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
              />
            ) : null}
          </Section>
          <Section title="Visibility" testId="form-visibility">
            <Checkbox
              label="Visible to client (optional)"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />
            <p className="text-xs text-muted">Clients with portal access can view this task.</p>
          </Section>
          <Section title="Notifications & Reminders" testId="form-reminders">
            <Checkbox
              label="Enable reminders"
              checked={remind}
              onChange={(e) => {
                setRemind(e.target.checked);
                if (e.target.checked && reminders.length === 0)
                  setReminders([{ key: 'r0', daysBefore: 1 }]);
              }}
            />
            {remind ? (
              <ul className="mt-2 flex flex-col gap-2">
                {reminders.map((r, i) => (
                  <li key={r.key} className="flex items-center gap-2">
                    <select
                      aria-label={`Reminder ${i + 1}`}
                      className={field}
                      value={r.daysBefore}
                      onChange={(e) =>
                        setReminders(
                          reminders.map((x) =>
                            x.key === r.key ? { ...x, daysBefore: Number(e.target.value) } : x,
                          ),
                        )
                      }
                    >
                      {DAYS.map((d) => (
                        <option key={d} value={d}>
                          {d === 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'} before`}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove reminder ${i + 1}`}
                      onClick={() => setReminders(reminders.filter((x) => x.key !== r.key))}
                      className="text-muted hover:text-danger"
                    >
                      <X aria-hidden weight="bold" className="size-4" />
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() =>
                      setReminders([
                        ...reminders,
                        { key: `r${reminders.length}-${Date.now()}`, daysBefore: 1 },
                      ])
                    }
                    className="inline-flex items-center gap-1 text-sm font-medium text-link"
                  >
                    <Plus aria-hidden weight="bold" className="size-4" /> Add Reminder
                  </button>
                </li>
              </ul>
            ) : null}
          </Section>
          <Section title="Dependencies" testId="form-depends">
            <Checkbox
              label="This task depends on another task"
              checked={depends}
              onChange={(e) => setDepends(e.target.checked)}
            />
            <div className="mt-2">
              <Selectbox
                label="Dependent task"
                value={dependsOn}
                disabled={!depends}
                onChange={setDependsOn}
                options={[
                  { value: '', label: 'Select a dependent task' },
                  ...(candidates.data?.items ?? [])
                    .filter((c) => c.id !== task?.id)
                    .map((c) => ({ value: c.id, label: c.title })),
                ]}
              />
            </div>
            <p className="mt-1 text-xs text-muted">
              This task will not start until the selected task is completed.
            </p>
          </Section>
          <Section title="Internal Notes" testId="form-notes">
            <Textarea
              label="Internal notes"
              rows={3}
              maxLength={5000}
              placeholder="Add internal notes (not visible to client)…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Section>
          <Section title="Task Summary" testId="form-summary">
            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
              {summary.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text">{k}:</dt>
                  <dd className="text-heading">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </aside>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => router.push(task ? `/tasks/${task.id}` : '/tasks')}
          >
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => setTpl(true)}>
            <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save as Template
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={save.isPending || !!loadNote}
            onClick={() => submit(false)}
            data-testid="task-save"
          >
            {editing ? 'Save Changes' : 'Save Task'}
          </Button>
          {editing ? null : (
            <Button
              disabled={save.isPending}
              onClick={() => submit(true)}
              data-testid="task-save-another"
            >
              Save &amp; Create Another
            </Button>
          )}
        </div>
      </div>
      {picking ? (
        <Modal
          open
          title="Use Template"
          subtitle="Start a new task from a template."
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
                    onClick={() => router.push(`/tasks/new?template=${t.id}`)}
                    className="flex w-full flex-col py-2 text-left hover:bg-canvas"
                  >
                    <span className="text-sm font-semibold text-heading">{t.name}</span>
                    <span className="text-xs text-muted">{t.checklist.length} checklist items</span>
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
          subtitle="A template keeps the type, priority, checklist and visibility, not the client."
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
          <Label text="Template name" htmlFor="tf-tpl">
            <input
              id="tf-tpl"
              className={field}
              value={tplName}
              maxLength={120}
              onChange={(e) => setTplName(e.target.value)}
            />
          </Label>
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
