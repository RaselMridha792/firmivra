'use client';

import type {
  CreateTaskDetailRequest,
  TaskDetail,
  TaskDraft,
  TaskPriority,
  TaskProgress,
  TaskTemplate,
  UpdateTaskDetailRequest,
} from '@firmivra/types';
import { Button, Checkbox, Modal, Textarea, Toast, Toggle } from '@firmivra/ui';
import { ArrowLeft, FloppyDisk, Plus, Trash, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  TIMES,
  newReminder,
  reminderBody,
  reminderProblem,
  toReminders,
  ReminderList,
  Section,
  ClientCombobox,
  handOffToRecurring,
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
import { ORIGIN_PARAM, safeOrigin, withOrigin } from '../../../../../lib/origin';
import { recurringHref, relatedChoice, splitRelated } from './new-task-href';

/** The page Create Task was opened from (SH1), if any. */
const openedFrom = () => safeOrigin(new URLSearchParams(window.location.search).get(ORIGIN_PARAM));
/** `href` carrying this page's origin on, so the next page's Cancel and Back still find it. */
const keepOrigin = (href: string) => {
  const from = openedFrom();
  return from ? withOrigin(href, from) : href;
};

/**
 * /tasks/new, /tasks/[id]/edit and /tasks/drafts/[id]: Create Task, Edit Task and a reopened draft
 * (Octavia's A2), one form.
 */
/** What a service workspace's Create Task fills in (SH4); the member can still change it. */
export interface TaskPrefill {
  clientId?: string;
  engagementId?: string;
  /** "October 2026": the details start with it. */
  period?: string;
  /** I-P01: "INV-2026-0106": a task opened from an invoice is named and described by it. */
  invoice?: string;
  /** Tax Returns Review Two F03 (R56): the exact tax return Create Task was opened from. */
  taxReturnId?: string;
}

export function TaskFormScreen({
  id,
  templateId,
  prefill,
  draftId,
}: {
  id?: string;
  templateId?: string;
  prefill?: TaskPrefill;
  /** A2: the draft to reopen; Save Task publishes it, Save as Draft keeps it a draft. */
  draftId?: string;
}) {
  // T-C05: Save & Create Another remounts a clean form (as the recurring form): each round is a
  // new Form with a new idempotency key; the first keeps what the page opened it with.
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState<string>();
  const prefillClient = useApiQuery(
    [...TASKS_KEY, 'prefill-client', prefill?.clientId ?? 'none'],
    async () => (prefill?.clientId ? api.clients.get(prefill.clientId) : null),
  );
  const task = useApiQuery([...TASKS_KEY, 'task', id ?? 'new'], async () =>
    id ? api.taskWork.task(id) : null,
  );
  const template = useApiQuery([...TASKS_KEY, 'template', templateId ?? 'none'], async () =>
    templateId ? api.taskWork.getTemplate(templateId) : null,
  );
  const draft = useApiQuery([...TASKS_KEY, 'draft', draftId ?? 'none'], async () =>
    draftId ? api.taskWork.draft(draftId) : null,
  );
  const waiting =
    (id !== undefined && task.isPending) ||
    (draftId !== undefined && draft.isPending) ||
    (!!templateId && template.isPending) ||
    (!!prefill?.clientId && prefillClient.isPending);
  if (waiting)
    return (
      <p role="status" className="rounded-xl bg-surface p-6 text-sm text-muted shadow-md">
        Loading…
      </p>
    );
  return (
    <Form
      key={`${task.data?.id ?? draft.data?.id ?? template.data?.id ?? 'blank'}-${round}`}
      savedTitle={saved}
      onAnother={(title) => {
        setSaved(title);
        setRound((r) => r + 1);
      }}
      task={task.data ?? undefined}
      draft={draft.data ?? undefined}
      template={template.data ?? undefined}
      prefill={
        id === undefined && round === 0 && prefillClient.data
          ? {
              ...prefill,
              clientId: prefillClient.data.id,
              clientName: prefillClient.data.displayName,
            }
          : undefined
      }
      loadNote={
        id !== undefined && task.isError
          ? errorMessage(task.error, TASK_ERRORS)
          : draftId !== undefined && draft.isError
            ? errorMessage(draft.error, TASK_ERRORS)
            : prefill?.clientId && prefillClient.isError
              ? 'The client could not be loaded. Choose the client below.'
              : undefined
      }
    />
  );
}

/** What the form starts from: a task being edited, or a draft being reopened (A2). */
type Seed = Omit<
  TaskDraft,
  'id' | 'client' | 'status' | 'missing' | 'createdAt' | 'updatedAt' | 'createdBy' | 'templateId'
> & {
  client: { id: string; displayName: string } | null;
  engagementId: string | null;
};

function Form({
  task,
  draft,
  template,
  prefill,
  loadNote,
  savedTitle,
  onAnother,
}: {
  /** The task Save & Create Another just saved: this clean form says so (T-C05). */
  savedTitle?: string | undefined;
  onAnother: (title: string) => void;
  task: TaskDetail | undefined;
  draft?: TaskDraft | undefined;
  template: TaskTemplate | undefined;
  prefill: (TaskPrefill & { clientId: string; clientName: string }) | undefined;
  loadNote: string | undefined;
}) {
  const router = useRouter();
  const editing = !!task;
  const seed: Seed | undefined =
    task ?? (draft ? { ...draft, engagementId: draft.engagement?.id ?? null } : undefined);
  const { members } = useMembers();
  const [title, setTitle] = useState(
    seed?.title ?? (prefill?.invoice && !template ? `Follow up on ${prefill.invoice}` : ''),
  );
  const [typeId, setTypeId] = useState(seed?.type?.id ?? template?.type?.id ?? '');
  const [details, setDetails] = useState(
    seed?.details ??
      template?.description ??
      (prefill?.period
        ? `For ${prefill.period}.`
        : prefill?.invoice
          ? `About invoice ${prefill.invoice}.`
          : ''),
  );
  const [clientId, setClientId] = useState(seed?.client?.id ?? prefill?.clientId ?? '');
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
  const [clientNames, setClientNames] = useState<Record<string, string>>(
    prefill ? { [prefill.clientId]: prefill.clientName } : {},
  );
  // T-C10: Related To is one choice: the client's engagement, tax plan or deadline, or a custom
  // note that is not a record. `saved` is what the task holds, so Edit sends only a change.
  const [saved, setSaved] = useState(() => ({
    choice: seed
      ? relatedChoice(seed)
      : prefill?.engagementId
        ? `engagement:${prefill.engagementId}`
        : '',
    note: seed?.relatedText ?? '',
  }));
  const [related, setRelated] = useState(saved.choice);
  const [note, setNote] = useState(saved.note);
  // F03 (R56): the exact tax return, kept apart from Related To (a return and its service both).
  const [taxReturnId, setTaxReturnId] = useState<string | null>(
    seed?.taxReturn?.id ?? prefill?.taxReturnId ?? null,
  );
  const taxReturnName =
    seed?.taxReturn?.name ?? (prefill?.period ? `Tax return, ${prefill.period}` : 'Tax return');
  /** Edit sends the return only when it changed. */
  const returnChange = () => (taxReturnId !== (seed?.taxReturn?.id ?? null) ? { taxReturnId } : {});
  // The note's box shows until its Save keeps it.
  const [noteOpen, setNoteOpen] = useState(!saved.note);
  const chosen = splitRelated(related);
  const engagementId = chosen.kind === 'engagement' ? chosen.id : '';
  const noteText = chosen.kind === 'custom' ? note.trim() : '';
  // Review 2 (Payroll F04, Bookkeeping N05): null until someone chooses, so a new task opened on
  // a service's engagement takes that service; a task being edited or a draft keeps its own.
  const [serviceChoice, setServiceChoice] = useState<string | null>(
    seed ? (seed.service?.id ?? '') : (template?.service?.id ?? null),
  );
  const [assignee, setAssignee] = useState(
    seed?.assignedUserId ??
      (template?.assignmentRule === 'SPECIFIC_USER' ? (template.assignedTo?.userId ?? '') : ''),
  );
  // A template that assigns the client's team leaves the person to the API when none is chosen.
  const byTeam = !seed && template?.assignmentRule === 'CLIENT_TEAM';
  const [extra, setExtra] = useState<string[]>(
    seed?.additionalAssignees.map((a) => a.userId) ?? [],
  );
  const [priority, setPriority] = useState<TaskPriority>(
    seed?.priority ?? template?.priority ?? 'MEDIUM',
  );
  const [startOn, setStartOn] = useState(seed?.startOn ?? '');
  const [dueOn, setDueOn] = useState(() =>
    seed
      ? (seed.dueOn ?? '')
      : template?.dueOffsetDays != null
        ? new Date(Date.now() + template.dueOffsetDays * 86_400_000).toISOString().slice(0, 10)
        : '',
  );
  const [dueTime, setDueTime] = useState(seed?.dueTime ?? '17:00');
  const [allDay, setAllDay] = useState(seed?.allDay ?? true);
  const [progress, setProgress] = useState<TaskProgress>(seed?.progress ?? 'NOT_STARTED');
  const [blockedReason, setBlockedReason] = useState(seed?.blockedReason ?? '');
  const [visible, setVisible] = useState(
    seed?.clientVisible ?? template?.clientVisibleDefault ?? false,
  );
  const startReminders = seed?.reminders ?? template?.reminders ?? [];
  const [remind, setRemind] = useState(startReminders.length > 0);
  const [reminders, setReminders] = useState<Reminder[]>(() => toReminders(startReminders));
  const [depends, setDepends] = useState(!!seed?.dependsOn);
  const [dependsOn, setDependsOn] = useState(seed?.dependsOn?.id ?? '');
  const [notes, setNotes] = useState(seed?.internalNotes ?? '');
  const [items, setItems] = useState<Item[]>(
    seed
      ? seed.checklistItems.map((c) => ({
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
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' } | undefined>(
    savedTitle ? { text: `Task saved: ${savedTitle}. Add another.`, tone: 'success' } : undefined,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tpl, setTpl] = useState(false);
  const [picking, setPicking] = useState(false);
  const templates = useApiQuery([...TASKS_KEY, 'templates', 'active'], () =>
    api.taskWork.templates({ status: 'active' }),
  );
  const [tplName, setTplName] = useState(seed?.title ?? '');

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
  const candidates = useApiQuery([...TASKS_KEY, 'candidates'], () =>
    api.taskWork.overview({ view: 'all', pageSize: 100 }),
  );

  const typeChoice = useTypeChoice(typeId, seed?.type);

  // Octavia's C5 (T-C10): Related To lists the chosen client's records by type, not a second
  // Service list: open or not started engagements, tax plans that are not closed, and open
  // deadlines; the task (or draft) keeps the ones it has.
  const plans = useApiQuery([...TASKS_KEY, 'related-plans', clientId], async () =>
    clientId ? (await api.taxPlanning.plans({ clientId, pageSize: 100 })).items : [],
  );
  const deadlines = useApiQuery([...TASKS_KEY, 'related-deadlines', clientId], async () =>
    clientId ? (await api.compliance.clientCompliance(clientId)).deadlines : [],
  );
  const kept = seed && seed.client?.id === clientId ? seed : undefined;
  const relatedOptions = [
    ...(kept?.engagement
      ? [
          {
            value: `engagement:${kept.engagement.id}`,
            label: kept.engagement.title,
            group: 'Engagement',
          },
        ]
      : []),
    ...(engagements.data ?? [])
      .filter(
        (x) => x.id !== kept?.engagement?.id && (x.status === 'ACTIVE' || x.status === 'PENDING'),
      )
      .map((x) => ({
        value: `engagement:${x.id}`,
        label: `${x.title} (${x.status === 'ACTIVE' ? 'open' : 'not started'})`,
        group: 'Engagement',
      })),
    ...(kept?.taxPlan
      ? [{ value: `taxPlan:${kept.taxPlan.id}`, label: kept.taxPlan.name, group: 'Tax plan' }]
      : []),
    ...(plans.data ?? [])
      .filter((p) => p.id !== kept?.taxPlan?.id && p.status !== 'CLOSED')
      .map((p) => ({
        value: `taxPlan:${p.id}`,
        label: `${p.name} (${p.planYear})`,
        group: 'Tax plan',
      })),
    ...(kept?.deadline
      ? [{ value: `deadline:${kept.deadline.id}`, label: kept.deadline.name, group: 'Deadline' }]
      : []),
    ...(deadlines.data ?? [])
      .filter((d) => d.id !== kept?.deadline?.id)
      .map((d) => ({
        value: `deadline:${d.id}`,
        label: `${d.name} (due ${dayText(d.dueOn)})`,
        group: 'Deadline',
      })),
  ];
  const relatedSummary =
    chosen.kind === 'custom'
      ? noteText
        ? `Custom: ${noteText}`
        : 'Custom note'
      : (relatedOptions.find((o) => o.value === related)?.label ?? '—');

  // Attachments (C6): files go to the client's documents under one of the client's open
  // services: the Related To project when it is open, else the first open one.
  const files = useTaskFiles();
  const [version, setVersion] = useState(seed?.version ?? '');
  const [attached, setAttached] = useState(seed?.attachments ?? []);
  const openServices = (engagements.data ?? []).filter((x) => x.status === 'ACTIVE');
  const fileService = openServices.find((x) => x.id === engagementId) ?? openServices[0];
  const clientName =
    listed.find((c) => c.id === clientId)?.displayName ??
    clientNames[clientId] ??
    seed?.client?.displayName ??
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
        ...reminderBody(r),
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
    // T-C10: against what the task holds, so a note saved on its own leaves nothing unsaved.
    relatedChanged:
      related !== saved.choice || noteText !== (related === 'custom' ? saved.note : ''),
    serviceChoice,
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
    reminders: reminders.map((r) => [r.daysBefore, r.timeOfDay, r.amount, r.unit]),
    depends,
    dependsOn,
    notes,
    items: items.map((i) => [i.label, i.required]),
    files: files.queue.map((f) => f.key),
  });

  const options = { invalidate: [...TASKS_KEY] };
  // #1084: one key per new task (or draft), reused only to retry it: a retried save returns the
  // first one instead of making a second.
  const [createKey] = useState(() => crypto.randomUUID());
  const [draftKey] = useState(() => crypto.randomUUID());
  const uploadNew = async () =>
    files.sendable.length && fileService && clientId
      ? files.upload(files.sendable, clientId, fileService.id)
      : [];
  /** T-C10: Related To as a draft holds it (`null` clears): one record, or the custom note. */
  const relatedFields = () => ({
    engagementId: chosen.kind === 'engagement' ? chosen.id : null,
    taxPlanId: chosen.kind === 'taxPlan' ? chosen.id : null,
    deadlineId: chosen.kind === 'deadline' ? chosen.id : null,
    taxReturnId,
    relatedText: noteText || null,
  });
  /** Related To of a new task or draft: only what is chosen. */
  const relatedForNew = () => ({
    ...(chosen.kind === 'engagement' ? { engagementId: chosen.id } : {}),
    ...(chosen.kind === 'taxPlan' ? { taxPlanId: chosen.id } : {}),
    ...(chosen.kind === 'deadline' ? { deadlineId: chosen.id } : {}),
    ...(taxReturnId ? { taxReturnId } : {}),
    ...(noteText ? { relatedText: noteText } : {}),
  });
  /**
   * Edit sends Related To only when it changed: the new record or note, and the old choice
   * cleared, so another link the task has (a deadline's task with an engagement) stays.
   */
  const relatedChange = (): Pick<
    UpdateTaskDetailRequest,
    'engagementId' | 'taxPlanId' | 'deadlineId' | 'relatedText'
  > => {
    if (related === saved.choice && noteText === (related === 'custom' ? saved.note : ''))
      return {};
    const field = { engagement: 'engagementId', taxPlan: 'taxPlanId', deadline: 'deadlineId' };
    const out: Record<string, string | null> = {};
    const was = splitRelated(saved.choice).kind;
    if (was === 'custom') out['relatedText'] = null;
    else if (was) out[field[was]] = null;
    if (chosen.kind === 'custom') {
      out['relatedText'] = noteText;
      // A record and a note never together: the engagement goes (the tasks_related_text check).
      if (seed?.engagement) out['engagementId'] = null;
    } else if (chosen.kind) {
      out[field[chosen.kind]] = chosen.id;
      if (chosen.kind === 'engagement' && seed?.relatedText) out['relatedText'] = null;
    }
    return out;
  };
  /** A draft's fields as they stand (A2): `null` clears; new files join the ones it has. */
  const draftFields = (documentIds: string[]) => ({
    title: title.trim(),
    details,
    clientId: clientId || null,
    ...relatedFields(),
    dueOn: dueOn || null,
    assignedUserId: assignee || null,
    ...common(),
    checklist: checklistBody,
    ...(documentIds.length
      ? {
          attachments: [
            ...attached.map((a) => ({ documentId: a.documentId })),
            ...documentIds.map((documentId) => ({ documentId })),
          ],
        }
      : {}),
  });
  const save = useApiMutation(async (another: boolean) => {
    if (draft) {
      // Save Task on a draft publishes it: the same id becomes a live task.
      const body = { ...draftFields(await uploadNew()), version };
      return { saved: await api.taskWork.publishDraft(draft.id, body), another };
    }
    if (task) {
      const body: UpdateTaskDetailRequest = {
        version,
        title: title.trim(),
        details,
        dueOn: dueOn || null,
        assignedUserId: assignee || null,
        ...relatedChange(),
        ...returnChange(),
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
      ...relatedForNew(),
      ...(dueOn ? { dueOn } : {}),
      ...(assignee ? { assignedUserId: assignee } : {}),
      ...common(),
      checklist: checklistBody,
      ...(template ? { templateId: template.id } : {}),
      ...(documentIds.length
        ? { attachments: documentIds.map((documentId) => ({ documentId })) }
        : {}),
      idempotencyKey: createKey,
    };
    return { saved: await api.taskWork.create(body), another };
  }, options);
  // A2: Save as Draft keeps it out of every list, count, calendar and reminder until Save Task.
  const saveDraft = useApiMutation(async () => {
    const documentIds = await uploadNew();
    if (draft) return api.taskWork.updateDraft(draft.id, { ...draftFields(documentIds), version });
    return api.taskWork.saveDraft({
      title: title.trim(),
      details,
      ...(clientId ? { clientId } : {}),
      ...relatedForNew(),
      ...(dueOn ? { dueOn } : {}),
      ...(assignee ? { assignedUserId: assignee } : {}),
      ...common(),
      checklist: checklistBody,
      ...(template ? { templateId: template.id } : {}),
      ...(documentIds.length
        ? { attachments: documentIds.map((documentId) => ({ documentId })) }
        : {}),
      idempotencyKey: draftKey,
    });
  }, options);
  const discard = useApiMutation(
    async () => (draft ? api.taskWork.discardDraft(draft.id) : null),
    options,
  );
  const [discarding, setDiscarding] = useState(false);
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

  /**
   * T-C10: the custom note's own Save. Create Task and a draft keep it in the form (it saves with
   * the task); Edit Task saves it to the task at once and takes the task's new version.
   */
  const saveNoteNow = useApiMutation(
    () => api.taskWork.update(task!.id, { version, ...relatedChange(), ...returnChange() }),
    options,
  );
  function saveNote() {
    if (!noteText) {
      setErrors((e) => ({ ...e, related: 'Type the custom note, or choose a record' }));
      return;
    }
    setErrors(({ related: _gone, ...rest }) => rest);
    if (!task || (saved.choice === 'custom' && saved.note === noteText)) {
      setNoteOpen(false);
      return;
    }
    saveNoteNow.mutate(undefined, {
      onSuccess: (fresh) => {
        setVersion(fresh.version);
        setSaved({ choice: 'custom', note: noteText });
        setNoteOpen(false);
        setMessage({ text: 'Custom note saved.', tone: 'success' });
      },
      onError: (er) => setMessage({ text: errorMessage(er, TASK_ERRORS), tone: 'error' }),
    });
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!title.trim()) e['title'] = 'Enter the task name';
    if (typeChoice.problem) e['type'] = typeChoice.problem;
    if (!clientId) e['client'] = 'Choose a client';
    if (chosen.kind === 'custom' && !noteText)
      e['related'] = 'Type the custom note, or choose a record';
    if (!assignee && !byTeam) e['assignee'] = 'Choose who it is assigned to';
    if (!dueOn) e['due'] = 'Choose a due date';
    if (startOn && dueOn && startOn > dueOn) e['due'] = 'The due date is before the start';
    if (remind && reminders.length > 0) {
      const problem = reminderProblem(reminders, dueOn && !allDay ? dueTime : null);
      if (!dueOn) e['reminders'] = 'Reminders need a due date. Set the due date first.';
      else if (problem) e['reminders'] = problem;
    }
    if (files.queue.some((f) => f.state === 'uploading'))
      e['files'] = 'Wait for the files to finish uploading.';
    else if (files.queue.some((f) => f.blocking) || (task && files.queue.length > 0))
      e['files'] = 'Remove the files marked in red, or choose others.';
    else if (!task && files.sendable.length && filesBlocked) e['files'] = filesBlocked;
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  // One save at a time (T2): a second click before the first answers does nothing.
  const sendingRef = useRef(false);
  function submit(another: boolean) {
    if (sendingRef.current) return;
    setMessage(undefined);
    if (!validate()) {
      setMessage({ text: 'Fix the highlighted fields to continue.', tone: 'error' });
      return;
    }
    sendingRef.current = true;
    save.mutate(another, {
      onSettled: () => {
        sendingRef.current = false;
      },
      onSuccess: ({ saved, another: again }) => {
        if (again) {
          guard.allow();
          router.replace('/tasks/new');
          onAnother(saved.title);
        } else {
          guard.allow();
          // Bookkeeping Review 2 (N05 original): opened from a service workspace (SH1), Save
          // returns there, as Cancel does; otherwise the new task's page opens.
          const from = safeOrigin(new URLSearchParams(window.location.search).get(ORIGIN_PARAM));
          router.push(from ?? `/tasks/${saved.id}`);
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

  /** Save as Draft: only the task name is needed; nothing else is checked until Save Task. */
  function keepDraft() {
    if (sendingRef.current) return;
    setMessage(undefined);
    const e: Record<string, string> = {};
    if (!title.trim()) e['title'] = 'Enter the task name';
    if (files.queue.some((f) => f.state === 'uploading'))
      e['files'] = 'Wait for the files to finish uploading.';
    else if (files.sendable.length && filesBlocked) e['files'] = filesBlocked;
    setErrors(e);
    if (Object.keys(e).length) {
      setMessage({
        text: 'A draft needs the task name. Fix the highlighted fields.',
        tone: 'error',
      });
      return;
    }
    sendingRef.current = true;
    saveDraft.mutate(undefined, {
      onSettled: () => {
        sendingRef.current = false;
      },
      onSuccess: () => {
        guard.allow();
        router.push('/tasks?view=drafts');
      },
      onError: (er) =>
        setMessage({
          text:
            er instanceof FilesNotUploaded
              ? 'A file was not uploaded, so the draft was not saved. See Attachments, then save again.'
              : errorMessage(er, TASK_ERRORS),
          tone: 'error',
        }),
    });
  }

  const summary: [string, string][] = [
    ['Client', clientName || '—'],
    ['Related To', relatedSummary],
    [
      'Service',
      services.data?.items.find((s) => s.id === serviceId)?.name ?? seed?.service?.name ?? '—',
    ],
    [
      'Assigned To',
      members.find((m) => m.userId === assignee)?.name ??
        seed?.assignedTo?.name ??
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
      data-testid={editing ? 'task-edit' : draft ? 'task-draft' : 'task-create'}
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
              {editing ? 'Edit Task' : draft ? 'Edit Draft' : 'Create Task'}
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
                {/* T-C09: one combobox: type, see the matches below, choose. */}
                <ClientCombobox
                  id="tf-client"
                  chosen={clientId ? (clientName ?? '') : ''}
                  text={clientSearch}
                  onText={setClientSearch}
                  results={editing ? [] : listed}
                  loading={clientList.isPending || clientSearch.trim() !== clientTerm}
                  failed={clientList.isError}
                  disabled={editing}
                  onChoose={(c) => {
                    setClientNames((n) => ({ ...n, [c.id]: c.displayName }));
                    setClientId(c.id);
                    setRelated('');
                    // F03: a return is its client's; another client drops it.
                    if (c.id !== clientId) setTaxReturnId(null);
                    setClientSearch('');
                  }}
                  onClear={() => {
                    setClientId('');
                    setRelated('');
                    setTaxReturnId(null);
                    setClientSearch('');
                  }}
                />
                {err('client')}
              </Label>
              <Label text="Related To" htmlFor="tf-related">
                <Selectbox
                  id="tf-related"
                  label="Related to"
                  value={related}
                  disabled={!clientId}
                  onChange={(v) => {
                    setRelated(v);
                    if (v === 'custom' && !noteText) setNoteOpen(true);
                  }}
                  options={[
                    {
                      value: '',
                      label: !clientId ? 'Choose a client first' : 'No related record',
                    },
                    ...relatedOptions,
                    ...(clientId ? [{ value: 'custom', label: 'Custom note (not a record)' }] : []),
                  ]}
                />
                <p className="text-xs text-muted">
                  The client&apos;s engagement, tax plan or deadline this work belongs to, or a
                  custom note. The service is chosen separately.
                </p>
              </Label>
              <Label text="Service (if applicable)" htmlFor="tf-service">
                <Selectbox
                  id="tf-service"
                  label="Service"
                  value={serviceId}
                  onChange={setServiceChoice}
                  options={[
                    {
                      value: '',
                      label: services.isError ? 'Services are not available' : 'No service',
                    },
                    ...(services.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </Label>
              {/* T-C10 (A1): Related To typed when no record fits, with its own Save. */}
              {chosen.kind === 'custom' ? (
                <div className="flex flex-col gap-1 md:col-span-3" data-testid="related-note">
                  <label htmlFor="tf-related-note" className="text-sm font-medium text-heading">
                    Custom note (not a record)
                  </label>
                  {noteOpen ? (
                    <div className="flex gap-2">
                      <input
                        id="tf-related-note"
                        className={field}
                        value={note}
                        maxLength={200}
                        placeholder="What this task relates to"
                        aria-invalid={errors['related'] ? true : undefined}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            saveNote();
                          }
                        }}
                      />
                      <Button
                        variant="outline"
                        disabled={saveNoteNow.isPending}
                        onClick={saveNote}
                        data-testid="related-note-save"
                      >
                        Save
                      </Button>
                    </div>
                  ) : (
                    <p className="flex flex-wrap items-center gap-2 text-sm text-text">
                      <span data-testid="related-note-text">Custom: {noteText}</span>
                      <button
                        type="button"
                        className="font-medium text-link underline"
                        onClick={() => setNoteOpen(true)}
                      >
                        Change
                      </button>
                    </p>
                  )}
                  <p className="text-xs text-muted">
                    {task
                      ? 'Save keeps the note on this task now. It is a note, not a link to a record.'
                      : 'Save keeps the note with this task. It is a note, not a link to a record.'}
                  </p>
                  {err('related')}
                </div>
              ) : null}
              {/* Tax Returns Review Two F03 (R56): the exact return this task is about. */}
              {taxReturnId ? (
                <p
                  className="flex flex-wrap items-center gap-2 text-sm text-text"
                  data-testid="task-tax-return"
                >
                  <span>{taxReturnName}</span>
                  <button
                    type="button"
                    className="font-medium text-link underline"
                    onClick={() => setTaxReturnId(null)}
                  >
                    Remove
                  </button>
                </p>
              ) : null}
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
                    ...(seed?.assignedTo &&
                    !members.some((m) => m.userId === seed.assignedTo?.userId)
                      ? [{ value: seed.assignedTo.userId, label: seed.assignedTo.name }]
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
                    onChange={() => {
                      // T-C11: the title and checklist typed here come along.
                      handOffToRecurring({ title, items });
                      guard.leave(keepOrigin(recurringHref(clientId, engagementId)));
                    }}
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
                if (e.target.checked && reminders.length === 0) setReminders([newReminder('r0')]);
              }}
            />
            {remind ? (
              <ReminderList reminders={reminders} onChange={setReminders} allowBefore />
            ) : null}
            {err('reminders')}
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
            onClick={() =>
              guard.leave(
                task
                  ? `/tasks/${task.id}`
                  : draft
                    ? '/tasks?view=drafts'
                    : (openedFrom() ?? '/tasks'),
              )
            }
          >
            Cancel
          </Button>
          <Button variant="outline" onClick={() => setTpl(true)}>
            <FloppyDisk aria-hidden weight="fill" className="size-4" /> Save as Template
          </Button>
          {editing ? null : (
            <Button
              variant="outline"
              disabled={saveDraft.isPending || save.isPending || !!loadNote}
              onClick={keepDraft}
              data-testid="task-save-draft"
            >
              Save as Draft
            </Button>
          )}
          {draft ? (
            <Button
              variant="danger"
              onClick={() => setDiscarding(true)}
              data-testid="task-discard-draft"
            >
              <Trash aria-hidden weight="fill" className="size-4" /> Discard Draft
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={save.isPending || !!loadNote}
            onClick={() => submit(false)}
            data-testid="task-save"
          >
            {editing ? 'Save Changes' : 'Save Task'}
          </Button>
          {editing || draft ? null : (
            <Button
              variant="outline"
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
      {discarding && draft ? (
        <Modal
          open
          title="Discard Draft"
          subtitle={draft.title}
          onClose={() => setDiscarding(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDiscarding(false)}>
                Keep Draft
              </Button>
              <Button
                disabled={discard.isPending}
                onClick={() =>
                  discard.mutate(undefined, {
                    onSuccess: () => {
                      guard.allow();
                      router.push('/tasks?view=drafts');
                    },
                    onError: (er) => {
                      setDiscarding(false);
                      setMessage({ text: errorMessage(er, TASK_ERRORS), tone: 'error' });
                    },
                  })
                }
              >
                Discard
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            The draft, its checklist and reminders are deleted. It was never a live task, so nothing
            else changes.
          </p>
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
