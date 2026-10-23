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
import { ArrowLeft, FloppyDisk, Plus, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  AttachmentDrop,
  FilesNotUploaded,
  type QueuedFile,
  useTaskFiles,
} from './task-attachments';
import { useMembers } from './task-data';
import {
  ChecklistItems,
  type Item,
  Label,
  type Reminder,
  ReminderList,
  Section,
  Selectbox,
  field,
} from './task-form-parts';
import { TaskTypeSelect, useTypeChoice } from './task-type-field';
import { UnsavedDialog, useUnsavedGuard } from './unsaved-guard';
import {
  PRIORITY_LABEL,
  PROGRESS_LABEL,
  TASKS_KEY,
  TASK_ERRORS,
  dayText,
  timeText,
} from './task-shared';

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
  const [title, setTitle] = useState(task?.title ?? '');
  const [typeId, setTypeId] = useState(task?.type?.id ?? template?.type?.id ?? '');
  const [details, setDetails] = useState(task?.details ?? template?.description ?? '');
  const [clientId, setClientId] = useState(task?.client.id ?? '');
  // Octavia's C4: clients are found by name on the server: the firm's own, and for Staff only
  // their assigned ones, so a restricted client is never listed or counted.
  const [clientSearch, setClientSearch] = useState('');
  const [clientTerm, setClientTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setClientTerm(clientSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [clientSearch]);
  const clientList = useApiQuery([...TASKS_KEY, 'clients', clientTerm], () =>
    api.clients.list({ limit: 25, ...(clientTerm ? { search: clientTerm } : {}) }),
  );
  const listed = (clientList.data?.items ?? []).map((c) => ({
    id: c.id,
    displayName: c.displayName,
  }));
  // The names of clients chosen from earlier searches, so the choice keeps its label.
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [engagementId, setEngagementId] = useState(task?.engagementId ?? '');
  const [serviceId, setServiceId] = useState(task?.service?.id ?? template?.service?.id ?? '');
  const [assignee, setAssignee] = useState(
    task?.assignedUserId ??
      (template?.assignmentRule === 'SPECIFIC_USER' ? (template.assignedTo?.userId ?? '') : ''),
  );
  // A template that assigns the client's team leaves the person to the API when none is chosen.
  const byTeam = !task && template?.assignmentRule === 'CLIENT_TEAM';
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
  const startReminders = task?.reminders ?? template?.reminders ?? [];
  const [remind, setRemind] = useState(startReminders.length > 0);
  const [reminders, setReminders] = useState<Reminder[]>(
    startReminders.map((r, i) => ({ key: `r${i}`, daysBefore: r.daysBefore })),
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

  const typeChoice = useTypeChoice(typeId, task?.type);

  // Octavia's C5: Related To is one of the chosen client's engagements (open or not started), not
  // a second Service list; a task keeps the one it has. Other record types need a contract.
  const relatedOptions = [
    ...(editing && task?.engagement
      ? [{ value: task.engagement.id, label: task.engagement.title }]
      : []),
    ...(engagements.data ?? [])
      .filter(
        (x) => x.id !== task?.engagement?.id && (x.status === 'ACTIVE' || x.status === 'PENDING'),
      )
      .map((x) => ({
        value: x.id,
        label: `${x.title} (${x.status === 'ACTIVE' ? 'open' : 'not started'})`,
      })),
  ];

  // Attachments (C6): files go to the client's documents under one of the client's open
  // services: the Related To project when it is open, else the first open one.
  const files = useTaskFiles();
  const [version, setVersion] = useState(task?.version ?? '');
  const [attached, setAttached] = useState(task?.attachments ?? []);
  const openServices = (engagements.data ?? []).filter((x) => x.status === 'ACTIVE');
  const fileService = openServices.find((x) => x.id === engagementId) ?? openServices[0];
  const clientName =
    listed.find((c) => c.id === clientId)?.displayName ??
    clientNames[clientId] ??
    task?.client.displayName ??
    '';
  const filesBlocked = !clientId
    ? "Choose the client first: files are saved to the client's documents."
    : engagements.isPending
      ? "Loading the client's services…"
      : engagements.isError
        ? "The client's services could not be loaded, so files cannot be added right now."
        : !fileService
          ? `${clientName || 'This client'} has no open service, so files cannot be saved to their documents yet.`
          : undefined;
  const filesNote = fileService
    ? `Saved privately to ${clientName}'s documents under ${fileService.title}, staff only.`
    : undefined;
  // Edit Task attaches each file as soon as it is up, then reads the task's new version, so
  // Save Changes does not meet its own attachment as a conflict.
  const attachNow = useApiMutation(
    async (picked: QueuedFile[]) => {
      if (!task || !fileService) return 0;
      let count = 0;
      for (const item of picked) {
        try {
          const [documentId] = await files.upload([item], task.client.id, fileService.id);
          if (!documentId) continue;
          await api.taskWork.addAttachment(task.id, { documentId });
          files.remove(item.key);
          count++;
        } catch (e) {
          if (!(e instanceof FilesNotUploaded))
            files.patch(item.key, { state: 'error', error: errorMessage(e, TASK_ERRORS) });
        }
      }
      if (count) {
        const fresh = await api.taskWork.task(task.id);
        setVersion(fresh.version);
        setAttached(fresh.attachments);
      }
      return count;
    },
    { invalidate: [...TASKS_KEY] },
  );
  function addFiles(list: File[]) {
    if (filesBlocked) return;
    const ready = files.add(list);
    if (task && ready.length)
      attachNow.mutate(ready, {
        onSuccess: (count) =>
          count &&
          setMessage({
            text: count === 1 ? 'File attached.' : `${count} files attached.`,
            tone: 'success',
          }),
      });
  }

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
    typeId: typeChoice.value || null,
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

  const guard = useUnsavedGuard({
    title,
    typeId,
    details,
    clientId,
    engagementId,
    serviceId,
    assignee,
    extra,
    priority,
    startOn,
    dueOn,
    dueTime,
    allDay,
    progress,
    blockedReason,
    visible,
    remind,
    reminders: reminders.map((r) => r.daysBefore),
    depends,
    dependsOn,
    notes,
    items: items.map((i) => [i.label, i.required]),
    files: files.queue.map((f) => f.key),
  });

  const options = { invalidate: [...TASKS_KEY] };
  const save = useApiMutation(async (another: boolean) => {
    if (task) {
      const body: UpdateTaskDetailRequest = {
        version,
        title: title.trim(),
        details,
        dueOn: dueOn || null,
        assignedUserId: assignee || null,
        ...common(),
        checklist: checklistBody,
      };
      return { saved: await api.taskWork.update(task.id, body), another };
    }
    const documentIds =
      files.sendable.length && fileService
        ? await files.upload(files.sendable, clientId, fileService.id)
        : [];
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
      ...(documentIds.length
        ? { attachments: documentIds.map((documentId) => ({ documentId })) }
        : {}),
    };
    return { saved: await api.taskWork.create(body), another };
  }, options);
  const saveTemplate = useApiMutation(
    () =>
      api.taskWork.createTemplate({
        name: tplName.trim(),
        description: details,
        typeId: typeChoice.value || null,
        priority,
        checklist: checklistBody.map((c) => ({ label: c.label, required: c.required })),
        clientVisibleDefault: visible,
      }),
    options,
  );

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e['title'] = 'Enter the task name';
    if (typeChoice.problem) e['type'] = typeChoice.problem;
    if (!clientId) e['client'] = 'Choose a client';
    if (!assignee && !byTeam) e['assignee'] = 'Choose who it is assigned to';
    if (!dueOn) e['due'] = 'Choose a due date';
    if (startOn && dueOn && startOn > dueOn) e['due'] = 'The due date is before the start';
    if (files.queue.some((f) => f.state === 'uploading'))
      e['files'] = 'Wait for the files to finish uploading.';
    else if (files.queue.some((f) => f.blocking) || (task && files.queue.length > 0))
      e['files'] = 'Remove the files marked in red, or choose others.';
    else if (!task && files.sendable.length && filesBlocked) e['files'] = filesBlocked;
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
          files.setQueue([]);
          guard.rebase();
        } else {
          guard.allow();
          router.push(`/tasks/${saved.id}`);
        }
      },
      onError: (e) =>
        setMessage({
          text:
            e instanceof FilesNotUploaded
              ? 'A file was not uploaded, so the task was not saved. See Attachments, then save again.'
              : errorMessage(e, TASK_ERRORS),
          tone: 'error',
        }),
    });
  }

  const summary: [string, string][] = [
    ['Client', clientName || '—'],
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
      members.find((m) => m.userId === assignee)?.name ??
        task?.assignedTo?.name ??
        (byTeam ? "The client's team" : '—'),
    ],
    ['Due Date', dueOn ? `${dayText(dueOn)}${allDay ? '' : ` at ${timeText(dueTime)}`}` : '—'],
    ['Priority', PRIORITY_LABEL[priority]],
    ['Status', PROGRESS_LABEL[progress]],
    ['Client Visible', visible ? 'Yes' : 'No'],
  ];
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
              <Label text="Task Type" required={typeChoice.required} htmlFor="tf-type">
                <TaskTypeSelect
                  id="tf-type"
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
                {editing ? null : (
                  <input
                    type="search"
                    aria-label="Search clients by name"
                    placeholder="Search clients by name…"
                    className={field}
                    maxLength={100}
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    data-testid="client-search"
                  />
                )}
                <Selectbox
                  id="tf-client"
                  label="Client"
                  value={clientId}
                  disabled={editing}
                  onChange={(v) => {
                    const c = listed.find((x) => x.id === v);
                    if (c) setClientNames((n) => ({ ...n, [c.id]: c.displayName }));
                    setClientId(v);
                    setEngagementId('');
                  }}
                  options={[
                    {
                      value: '',
                      label: clientList.isError
                        ? 'Clients are not available'
                        : clientTerm && listed.length === 0
                          ? 'No clients match'
                          : 'Select client',
                    },
                    ...(clientId && !listed.some((c) => c.id === clientId) && clientName
                      ? [{ value: clientId, label: clientName }]
                      : []),
                    ...(editing ? [] : listed).map((c) => ({ value: c.id, label: c.displayName })),
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
                    {
                      value: '',
                      label: !clientId
                        ? 'Choose a client first'
                        : relatedOptions.length
                          ? 'No engagement'
                          : 'No open engagement for this client',
                    },
                    ...relatedOptions,
                  ]}
                />
                <p className="text-xs text-muted">
                  The client&apos;s engagement this work belongs to. The service is chosen
                  separately.
                </p>
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
              <Label text="Assigned To" required={!byTeam} htmlFor="tf-assignee">
                <Selectbox
                  id="tf-assignee"
                  label="Assigned to"
                  value={assignee}
                  onChange={setAssignee}
                  options={[
                    { value: '', label: byTeam ? "The client's team" : 'Select team member' },
                    ...(task?.assignedTo &&
                    !members.some((m) => m.userId === task.assignedTo?.userId)
                      ? [{ value: task.assignedTo.userId, label: task.assignedTo.name }]
                      : []),
                    ...members.map((m) => ({ value: m.userId, label: m.name })),
                  ]}
                />
                {err('assignee')}
                {byTeam && !assignee ? (
                  <p className="text-xs text-muted">
                    The template gives it to the client&apos;s team. Choose a person to override.
                  </p>
                ) : null}
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
              {/* Octavia's C7: All Day sits with the due time it replaces. */}
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="tf-time" className="text-sm font-medium text-text">
                    Due Time
                  </label>
                  <Checkbox
                    label="All Day"
                    checked={allDay}
                    onChange={(e) => setAllDay(e.target.checked)}
                  />
                </div>
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
              </div>
            </div>
            <p className="mt-2 text-xs text-muted" data-testid="due-rule">
              {allDay
                ? 'All day: due by the end of the due date.'
                : 'Due at that time on the due date.'}{' '}
              Dates and times are in your firm&apos;s time zone; an open task is overdue after that.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-6">
              <div className="flex items-center gap-3 text-sm text-heading">
                <div className="flex items-center gap-3">
                  <Toggle
                    label="Recurring Task"
                    checked={false}
                    onChange={() => guard.leave('/tasks/recurring/new')}
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
            <ChecklistItems items={items} onChange={setItems} showDone />
          </Section>

          <Section
            step={6}
            title="Attachments"
            subtitle="Upload relevant documents (optional)."
            testId="form-attachments"
          >
            <AttachmentDrop
              attached={attached}
              queue={files.queue}
              onFiles={addFiles}
              onRemove={files.remove}
              blocked={filesBlocked}
              note={filesNote}
            />
            {err('files')}
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
            {remind ? <ReminderList reminders={reminders} onChange={setReminders} /> : null}
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
            onClick={() => guard.leave(task ? `/tasks/${task.id}` : '/tasks')}
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
                    onClick={() => {
                      setPicking(false);
                      guard.leave(`/tasks/new?template=${t.id}`);
                    }}
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
      <UnsavedDialog guard={guard} onSave={() => submit(false)} saving={save.isPending} />
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
