'use client';

import type { ComplianceDeadline, DeadlineSource, DeadlineType } from '@firmivra/types';
import { COMPLIANCE_STATES } from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Radio, Textarea, Toast, Toggle } from '@firmivra/ui';
import { ArrowLeft, Bank, CalendarPlus, CloudArrowUp, Plus, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useClients, useMembers, useSettings } from './compliance-data';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  Label,
  PRIORITY_LABEL,
  STATUS_LABEL,
  SOURCE_LABEL,
  Section,
  Selectbox,
  TYPE_LABEL,
  TYPE_OPTIONS,
  dayText,
  quiet,
  subtle,
  timeText,
} from './compliance-shared';
import {
  type ReminderDraft,
  RemindersEditor,
  draftsToReminders,
  remindersToDrafts,
} from './deadline-dialogs';

const ENTITY_TYPES = [
  'Sole Proprietor',
  'Single-Member LLC',
  'LLC (Multi-Member)',
  'S Corporation',
  'C Corporation',
  'Partnership',
  'Nonprofit',
];
const PERIODS = [
  'Annual',
  'Q1 (Jan – Mar)',
  'Q2 (Apr – Jun)',
  'Q3 (Jul – Sep)',
  'Q4 (Oct – Dec)',
  'Monthly',
];
const JURISDICTIONS = [
  { value: '', label: 'Select jurisdiction' },
  { value: 'FEDERAL', label: 'Federal' },
  { value: 'STATE', label: 'State' },
  { value: 'LOCAL', label: 'Local' },
  { value: 'INTERNAL', label: 'Internal' },
];
const STATUSES = ['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT'] as const;

interface Pick {
  id: string;
  label: string;
}
interface Form {
  name: string;
  type: DeadlineType;
  source: DeadlineSource;
  description: string;
  clientId: string;
  entityType: string;
  taxYear: string;
  filingPeriod: string;
  engagementId: string;
  relatedForm: string;
  agency: string;
  jurisdiction: string;
  state: string;
  dueOn: string;
  dueTime: string;
  statutoryDueOn: string;
  overrideReason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  status: (typeof STATUSES)[number];
  remindersOn: boolean;
  reminders: ReminderDraft[];
  createTask: boolean;
  taskTemplateId: string;
  assignOn: boolean;
  assignedUserId: string;
  recurring: boolean;
  clientVisible: boolean;
  internalNotes: string;
  clientNotes: string;
  tasks: Pick[];
  documents: Pick[];
  links: Pick[];
}

const blank = (): Form => ({
  name: '',
  type: 'TAX_FILING',
  source: 'FIRM',
  description: '',
  clientId: '',
  entityType: '',
  taxYear: String(new Date().getFullYear()),
  filingPeriod: '',
  engagementId: '',
  relatedForm: '',
  agency: '',
  jurisdiction: '',
  state: '',
  dueOn: '',
  dueTime: '',
  statutoryDueOn: '',
  overrideReason: '',
  priority: 'MEDIUM',
  status: 'UPCOMING',
  remindersOn: true,
  reminders: [],
  createTask: false,
  taskTemplateId: '',
  assignOn: false,
  assignedUserId: '',
  recurring: false,
  clientVisible: false,
  internalNotes: '',
  clientNotes: '',
  tasks: [],
  documents: [],
  links: [],
});

const fromDeadline = (d: ComplianceDeadline): Form => ({
  name: d.name,
  type: d.type,
  source: d.source,
  description: d.description ?? '',
  clientId: d.client.id,
  entityType: d.entityType ?? '',
  taxYear: d.taxYear ? String(d.taxYear) : '',
  filingPeriod: d.filingPeriod ?? '',
  engagementId: d.engagementId ?? '',
  relatedForm: d.relatedForm ?? '',
  agency: d.agency ?? '',
  jurisdiction: d.jurisdiction ?? '',
  state: d.state ?? '',
  dueOn: d.dueOn,
  dueTime: d.dueTime ?? '',
  statutoryDueOn: d.statutoryDueOn ?? '',
  overrideReason: d.dueOverrideReason ?? '',
  priority: d.priority,
  status: (STATUSES as readonly string[]).includes(d.status)
    ? (d.status as Form['status'])
    : 'UPCOMING',
  remindersOn: d.reminders.length > 0,
  reminders: remindersToDrafts(d.reminders),
  createTask: d.createTask,
  taskTemplateId: d.taskTemplateId ?? '',
  assignOn: d.assignedTo !== null,
  assignedUserId: d.assignedTo?.userId ?? '',
  recurring: false,
  clientVisible: d.clientVisible,
  internalNotes: d.internalNotes ?? '',
  clientNotes: d.clientNotes ?? '',
  tasks: d.tasks.map((t) => ({ id: t.id, label: t.title })),
  documents: d.documents.map((x) => ({ id: x.documentId, label: x.fileName })),
  links: d.relatedDeadlines.map((r) => ({ id: r.id, label: r.name })),
});

/** /compliance/new and /compliance/[id]/edit. */
export function DeadlineFormScreen({ id }: { id?: string }) {
  const deadline = useApiQuery([...COMPLIANCE_KEY, 'deadline', id ?? 'new'], async () =>
    id ? api.compliance.getDeadline(id) : undefined,
  );
  if (id && !deadline.data) {
    return (
      <div className="flex min-w-0 flex-col gap-4" data-testid="deadline-form-loading">
        <Link
          href="/compliance"
          className="flex w-fit items-center gap-2 text-sm font-medium text-link"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Compliance &amp;
          Deadlines
        </Link>
        <p className={quiet}>
          {deadline.isError ? 'This deadline is not available right now.' : 'Loading…'}
        </p>
      </div>
    );
  }
  return <DeadlineForm key={id ?? 'new'} id={id} initial={deadline.data} />;
}

function Related({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-heading">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function Chips({
  items,
  onRemove,
  empty,
}: {
  items: Pick[];
  onRemove: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((x) => (
        <li
          key={x.id}
          className="flex max-w-full items-center gap-2 rounded-lg border border-divider bg-canvas px-3 py-1.5 text-sm text-heading"
        >
          <span className="truncate">{x.label}</span>
          <button
            type="button"
            aria-label={`Remove ${x.label}`}
            onClick={() => onRemove(x.id)}
            className="text-muted hover:text-danger"
          >
            <X aria-hidden weight="bold" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A small "+ Link Task" row: pick from the list, then add. */
function Adder({
  label,
  options,
  disabled,
  onAdd,
}: {
  label: string;
  options: Pick[];
  disabled?: boolean;
  onAdd: (item: Pick) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-sm font-medium text-link disabled:text-muted"
      >
        <Plus aria-hidden weight="bold" className="size-4" /> {label}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Selectbox
        label={label}
        value={value}
        onChange={(v) => {
          setValue('');
          const item = options.find((o) => o.id === v);
          if (item) onAdd(item);
          setOpen(false);
        }}
        options={[
          { value: '', label: options.length ? 'Choose…' : 'Nothing to add' },
          ...options.map((o) => ({ value: o.id, label: o.label })),
        ]}
      />
    </div>
  );
}

function DeadlineForm({
  id,
  initial,
}: {
  id: string | undefined;
  initial: ComplianceDeadline | undefined;
}) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => (initial ? fromDeadline(initial) : blank()));
  const [saved] = useState<Form | undefined>(() => (initial ? fromDeadline(initial) : undefined));
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [asTemplate, setAsTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [round, setRound] = useState(0);
  const { clients } = useClients();
  const { members } = useMembers();
  const settings = useSettings();
  const templates = useApiQuery([...COMPLIANCE_KEY, 'task-templates'], () =>
    api.taskWork.templates({ status: 'active' }),
  );
  const engagements = useApiQuery([...COMPLIANCE_KEY, 'engagements', f.clientId], async () =>
    f.clientId ? api.engagements.listForClient(f.clientId) : [],
  );
  const clientTasks = useApiQuery([...COMPLIANCE_KEY, 'client-tasks', f.clientId], async () =>
    f.clientId
      ? api.taskWork.overview({ view: 'all', status: 'OPEN', clientId: f.clientId, pageSize: 50 })
      : { items: [] },
  );
  const clientDocs = useApiQuery([...COMPLIANCE_KEY, 'client-docs', f.clientId], async () =>
    f.clientId ? api.documents.list(f.clientId) : { items: [] },
  );
  const clientDeadlines = useApiQuery(
    [...COMPLIANCE_KEY, 'client-deadlines', f.clientId],
    async () =>
      f.clientId
        ? api.compliance.deadlines({ clientId: f.clientId, pageSize: 100 })
        : { items: [] },
  );
  const set = (change: Partial<Form>) => setF((cur) => ({ ...cur, ...change }));

  const taken = (list: Pick[]) => new Set(list.map((x) => x.id));
  const taskChoices = (clientTasks.data?.items ?? [])
    .filter((t) => !taken(f.tasks).has(t.id))
    .map((t) => ({ id: t.id, label: t.title }));
  const docChoices = (clientDocs.data?.items ?? [])
    .filter((d) => !taken(f.documents).has(d.id))
    .map((d) => ({ id: d.id, label: d.fileName }));
  const linkChoices = (clientDeadlines.data?.items ?? [])
    .filter((d) => d.id !== id && !taken(f.links).has(d.id))
    .map((d) => ({ id: d.id, label: `${d.name} · ${dayText(d.dueOn)}` }));

  const options = { invalidate: [...COMPLIANCE_KEY] };
  const save = useApiMutation(async () => {
    const reminders = f.remindersOn ? draftsToReminders(f.reminders) : [];
    const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());
    let d: ComplianceDeadline;
    if (id) {
      d = await api.compliance.updateDeadline(id, {
        name: f.name.trim(),
        type: f.type,
        source: f.source,
        description: blankToNull(f.description),
        internalNotes: blankToNull(f.internalNotes),
        clientNotes: blankToNull(f.clientNotes),
        entityType: blankToNull(f.entityType),
        taxYear: f.taxYear ? Number(f.taxYear) : null,
        filingPeriod: blankToNull(f.filingPeriod),
        relatedForm: blankToNull(f.relatedForm),
        agency: blankToNull(f.agency),
        jurisdiction: (f.jurisdiction || null) as ComplianceDeadline['jurisdiction'],
        state: f.state || null,
        dueOn: f.dueOn,
        dueTime: f.dueTime || null,
        dueOverrideReason: blankToNull(f.overrideReason),
        priority: f.priority,
        status: f.status,
        assignedUserId: f.assignOn && f.assignedUserId ? f.assignedUserId : null,
        clientVisible: f.clientVisible,
        engagementId: f.engagementId || null,
      });
      await api.compliance.saveReminders(id, { reminders });
    } else {
      d = await api.compliance.createDeadline({
        clientId: f.clientId,
        name: f.name.trim(),
        type: f.type,
        source: f.source,
        ...(f.description.trim() ? { description: f.description.trim() } : {}),
        ...(f.internalNotes.trim() ? { internalNotes: f.internalNotes.trim() } : {}),
        ...(f.clientNotes.trim() ? { clientNotes: f.clientNotes.trim() } : {}),
        ...(f.entityType ? { entityType: f.entityType } : {}),
        ...(f.taxYear ? { taxYear: Number(f.taxYear) } : {}),
        ...(f.filingPeriod ? { filingPeriod: f.filingPeriod } : {}),
        ...(f.relatedForm.trim() ? { relatedForm: f.relatedForm.trim() } : {}),
        ...(f.agency.trim() ? { agency: f.agency.trim() } : {}),
        ...(f.jurisdiction
          ? { jurisdiction: f.jurisdiction as ComplianceDeadline['jurisdiction'] }
          : {}),
        ...(f.state ? { state: f.state } : {}),
        ...(f.statutoryDueOn ? { statutoryDueOn: f.statutoryDueOn } : {}),
        dueOn: f.dueOn,
        ...(f.dueTime ? { dueTime: f.dueTime } : {}),
        ...(f.overrideReason.trim() ? { dueOverrideReason: f.overrideReason.trim() } : {}),
        priority: f.priority,
        status: f.status,
        ...(f.assignOn && f.assignedUserId ? { assignedUserId: f.assignedUserId } : {}),
        clientVisible: f.clientVisible,
        ...(f.engagementId ? { engagementId: f.engagementId } : {}),
        reminders,
        createTask: f.createTask,
        ...(f.createTask && f.taskTemplateId ? { taskTemplateId: f.taskTemplateId } : {}),
      });
    }
    // Related items: only what changed since the deadline was opened.
    const before = saved ?? blank();
    const diff = (now: Pick[], was: Pick[]) => ({
      add: now.filter((x) => !was.some((w) => w.id === x.id)),
      drop: was.filter((w) => !now.some((x) => x.id === w.id)),
    });
    const t = diff(f.tasks, before.tasks);
    const docs = diff(f.documents, before.documents);
    const l = diff(f.links, before.links);
    for (const x of t.add) d = await api.compliance.linkTask(d.id, { taskId: x.id });
    for (const x of t.drop) d = await api.compliance.removeTask(d.id, x.id);
    for (const x of docs.add) d = await api.compliance.addDocument(d.id, { documentId: x.id });
    for (const x of docs.drop) d = await api.compliance.removeDocument(d.id, x.id);
    for (const x of l.add) d = await api.compliance.addLink(d.id, { relatedDeadlineId: x.id });
    for (const x of l.drop) d = await api.compliance.removeLink(d.id, x.id);
    return d;
  }, options);
  const template = useApiMutation(
    (v: { id: string; name: string }) => api.compliance.saveAsTemplate(v.id, { name: v.name }),
    options,
  );

  const check = (): boolean => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!f.name.trim()) e.name = 'Enter the deadline name';
    if (!f.clientId) e.clientId = 'Choose a client';
    if (!f.dueOn) e.dueOn = 'Choose the due date';
    if (f.statutoryDueOn && f.dueOn && f.statutoryDueOn !== f.dueOn && !f.overrideReason.trim()) {
      e.overrideReason = 'Give a reason for changing the statutory date';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' });
  const run = (after: 'open' | 'again' | 'recurring') => {
    if (!check()) return;
    save.mutate(undefined, {
      onSuccess: (d) => {
        if (after === 'again') {
          setF(blank());
          setErrors({});
          setRound(round + 1);
          setMessage({ text: `${d.name} saved. Add the next one.`, tone: 'success' });
        } else if (after === 'recurring') {
          router.push(`/compliance/recurring/new?from=${d.id}`);
        } else {
          router.push(`/compliance/${d.id}`);
        }
      },
      onError: fail,
    });
  };
  const saveTemplate = () => {
    if (!check()) return;
    save.mutate(undefined, {
      onSuccess: (d) =>
        template.mutate(
          { id: d.id, name: templateName.trim() || `${d.name} template` },
          { onSuccess: () => router.push(`/compliance/${d.id}`), onError: fail },
        ),
      onError: fail,
    });
    setAsTemplate(false);
  };

  const clientName =
    clients.find((c) => c.id === f.clientId)?.displayName ?? initial?.client.displayName;
  const summary: [string, string][] = [
    ['Name', f.name || '—'],
    ['Client', clientName ?? '—'],
    ['Type', TYPE_LABEL[f.type]],
    ['Form', f.relatedForm || '—'],
    ['Agency', f.agency || '—'],
    [
      'Due Date',
      f.dueOn ? `${dayText(f.dueOn)}${f.dueTime ? ` at ${timeText(f.dueTime)}` : ''}` : '—',
    ],
    ['Priority', PRIORITY_LABEL[f.priority]],
    ['Status', STATUS_LABEL[f.status]],
    ['Recurring', f.recurring ? 'Yes' : initial?.recurring ? 'Yes' : 'No'],
    ['Client Visible', f.clientVisible ? 'Yes' : 'No'],
  ];
  const overrideNeeded = f.statutoryDueOn !== '' && f.dueOn !== '' && f.statutoryDueOn !== f.dueOn;
  const defaults = settings.data?.defaultReminders ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="deadline-form" key={round}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/compliance" aria-label="Back to Compliance & Deadlines" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/compliance" className="text-link">
          Compliance &amp; Deadlines
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">
          {id ? 'Edit Deadline' : 'Add New Deadline'}
        </span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <CalendarPlus aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">
              {id ? 'Edit Deadline' : 'Add Deadline'}
            </h1>
            <p className="text-base text-muted">
              Create a new deadline for a client or edit an existing one.
            </p>
          </div>
        </div>
        <Link
          href="/compliance/recurring/new?tab=library"
          className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
        >
          <Bank aria-hidden weight="fill" className="size-4" /> View Government Calendars
        </Link>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            step={1}
            title="Deadline Information"
            subtitle="Enter the main details for this deadline."
            testId="sec-info"
          >
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Input
                label="Deadline Name *"
                value={f.name}
                maxLength={200}
                onChange={(e) => set({ name: e.target.value })}
                {...(errors.name ? { error: errors.name } : {})}
              />
              <Label text="Deadline Type" required htmlFor="df-type">
                <Selectbox
                  id="df-type"
                  label="Deadline Type"
                  value={f.type}
                  onChange={(v) => set({ type: v as DeadlineType })}
                  options={TYPE_OPTIONS}
                />
              </Label>
              <fieldset className="min-w-0">
                <legend className="text-sm font-medium text-text">
                  Source <span className="text-danger">*</span>
                </legend>
                {(Object.keys(SOURCE_LABEL) as DeadlineSource[]).map((s) => (
                  <Radio
                    key={s}
                    name="source"
                    label={SOURCE_LABEL[s]}
                    checked={f.source === s}
                    onChange={() => set({ source: s })}
                    className="min-h-8"
                  />
                ))}
              </fieldset>
            </div>
            <div className="mt-3">
              <Textarea
                label="Description"
                value={f.description}
                maxLength={2000}
                rows={4}
                onChange={(e) => set({ description: e.target.value })}
              />
              <p className="mt-1 text-right text-xs text-muted">
                Characters: {f.description.length}/2000
              </p>
            </div>
          </Section>

          <Section
            step={2}
            title="Client & Filing Details"
            subtitle="Link this deadline to a client and filing requirements."
            testId="sec-client"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Label text="Client" required htmlFor="df-client" error={errors.clientId}>
                <Selectbox
                  id="df-client"
                  label="Client"
                  value={f.clientId}
                  disabled={Boolean(id)}
                  onChange={(v) =>
                    set({ clientId: v, engagementId: '', tasks: [], documents: [], links: [] })
                  }
                  options={[
                    { value: '', label: 'Select client' },
                    ...(initial && !clients.some((c) => c.id === initial.client.id)
                      ? [{ value: initial.client.id, label: initial.client.displayName }]
                      : []),
                    ...clients.map((c) => ({ value: c.id, label: c.displayName })),
                  ]}
                />
              </Label>
              <Label text="Entity Type" htmlFor="df-entity">
                <Selectbox
                  id="df-entity"
                  label="Entity Type"
                  value={f.entityType}
                  onChange={(v) => set({ entityType: v })}
                  options={[
                    { value: '', label: 'Select entity type' },
                    ...ENTITY_TYPES.map((x) => ({ value: x, label: x })),
                  ]}
                />
              </Label>
              <Label text="Tax Year" htmlFor="df-year">
                <Selectbox
                  id="df-year"
                  label="Tax Year"
                  value={f.taxYear}
                  onChange={(v) => set({ taxYear: v })}
                  options={[
                    { value: '', label: 'Select year' },
                    ...[0, 1, 2, 3]
                      .map((n) => String(new Date().getFullYear() + 1 - n))
                      .map((x) => ({ value: x, label: x })),
                  ]}
                />
              </Label>
              <Label text="Filing Period" htmlFor="df-period">
                <Selectbox
                  id="df-period"
                  label="Filing Period"
                  value={f.filingPeriod}
                  onChange={(v) => set({ filingPeriod: v })}
                  options={[
                    { value: '', label: 'Select period' },
                    ...PERIODS.map((x) => ({ value: x, label: x })),
                  ]}
                />
              </Label>
              <Label text="Related To" htmlFor="df-related">
                <Selectbox
                  id="df-related"
                  label="Related To"
                  value={f.engagementId}
                  onChange={(v) => set({ engagementId: v })}
                  options={[
                    { value: '', label: f.clientId ? 'None' : 'Choose a client first' },
                    ...(engagements.data ?? []).map((x) => ({ value: x.id, label: x.title })),
                  ]}
                />
              </Label>
              <Input
                label="Related Form (if applicable)"
                value={f.relatedForm}
                maxLength={60}
                onChange={(e) => set({ relatedForm: e.target.value })}
              />
              <Input
                label="Agency"
                value={f.agency}
                maxLength={120}
                onChange={(e) => set({ agency: e.target.value })}
              />
              <Label text="Jurisdiction" htmlFor="df-juris">
                <Selectbox
                  id="df-juris"
                  label="Jurisdiction"
                  value={f.jurisdiction}
                  onChange={(v) => set({ jurisdiction: v })}
                  options={JURISDICTIONS}
                />
              </Label>
              <Label text="State (if applicable)" htmlFor="df-state">
                <Selectbox
                  id="df-state"
                  label="State"
                  value={f.state}
                  onChange={(v) => set({ state: v })}
                  options={[
                    { value: '', label: 'Select State' },
                    ...COMPLIANCE_STATES.map((x) => ({ value: x, label: x })),
                  ]}
                />
              </Label>
            </div>
          </Section>

          <Section
            step={3}
            title="Dates & Reminders"
            subtitle="Set the due date and reminder preferences."
            testId="sec-dates"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Input
                label="Due Date *"
                id="df-due"
                type="date"
                value={f.dueOn}
                onChange={(e) => set({ dueOn: e.target.value })}
                {...(errors.dueOn ? { error: errors.dueOn } : {})}
              />
              <Input
                label="Due Time"
                type="time"
                value={f.dueTime}
                onChange={(e) => set({ dueTime: e.target.value })}
              />
              <Label text="Priority" htmlFor="df-priority">
                <Selectbox
                  id="df-priority"
                  label="Priority"
                  value={f.priority}
                  onChange={(v) => set({ priority: v as Form['priority'] })}
                  options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Label>
              <Label text="Status" htmlFor="df-status">
                <Selectbox
                  id="df-status"
                  label="Status"
                  value={f.status}
                  onChange={(v) => set({ status: v as Form['status'] })}
                  options={STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }))}
                />
              </Label>
            </div>
            {f.source === 'GOVERNMENT' || f.statutoryDueOn ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  label="Statutory due date"
                  type="date"
                  value={f.statutoryDueOn}
                  onChange={(e) => set({ statutoryDueOn: e.target.value })}
                />
                {overrideNeeded ? (
                  <Textarea
                    label="Reason for changing the statutory date *"
                    value={f.overrideReason}
                    rows={2}
                    maxLength={500}
                    onChange={(e) => set({ overrideReason: e.target.value })}
                    {...(errors.overrideReason ? { error: errors.overrideReason } : {})}
                  />
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 flex items-center gap-3">
              <Toggle
                label="Enable Reminders"
                checked={f.remindersOn}
                onChange={(on) =>
                  set({
                    remindersOn: on,
                    reminders:
                      on && f.reminders.length === 0 ? remindersToDrafts(defaults) : f.reminders,
                  })
                }
              />
              <span className="text-sm text-text">Enable Reminders</span>
            </div>
            {f.remindersOn ? (
              <div className="mt-3">
                <RemindersEditor value={f.reminders} onChange={(reminders) => set({ reminders })} />
              </div>
            ) : null}
          </Section>

          <Section
            step={4}
            title="Automation & Tasks"
            subtitle="Automate next steps to keep work on track."
            testId="sec-automation"
          >
            <div className="flex flex-col gap-3">
              <div className="grid items-center gap-3 md:grid-cols-2">
                <Checkbox
                  label="Automatically create a task for this deadline"
                  checked={f.createTask}
                  disabled={Boolean(id)}
                  onChange={(e) => set({ createTask: e.target.checked })}
                />
                {f.createTask && !id ? (
                  <Selectbox
                    label="Task template"
                    value={f.taskTemplateId}
                    onChange={(v) => set({ taskTemplateId: v })}
                    options={[
                      { value: '', label: 'No template' },
                      ...(templates.data ?? []).map((t) => ({
                        value: t.id,
                        label: `Use template: ${t.name}`,
                      })),
                    ]}
                  />
                ) : null}
              </div>
              <div className="grid items-center gap-3 md:grid-cols-2">
                <Checkbox
                  label="Assign task to"
                  checked={f.assignOn}
                  onChange={(e) => set({ assignOn: e.target.checked })}
                />
                {f.assignOn ? (
                  <Selectbox
                    label="Assigned to"
                    value={f.assignedUserId}
                    onChange={(v) => set({ assignedUserId: v })}
                    options={[
                      { value: '', label: 'Choose a team member' },
                      ...(initial?.assignedTo &&
                      !members.some((m) => m.userId === initial.assignedTo?.userId)
                        ? [{ value: initial.assignedTo.userId, label: initial.assignedTo.name }]
                        : []),
                      ...members.map((m) => ({ value: m.userId, label: m.name })),
                    ]}
                  />
                ) : null}
              </div>
              <Checkbox
                label="Create recurring deadline (set recurrence)"
                checked={f.recurring}
                onChange={(e) => set({ recurring: e.target.checked })}
              />
              <Checkbox
                label="Add to client portal (visible to client)"
                checked={f.clientVisible}
                onChange={(e) => set({ clientVisible: e.target.checked })}
              />
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section
            step={5}
            title="Additional Information"
            subtitle="Add notes, documents, and internal details."
            testId="sec-notes"
          >
            <div className="flex flex-col gap-3">
              <Textarea
                label="Internal Notes (not visible to client)"
                value={f.internalNotes}
                rows={3}
                maxLength={5000}
                onChange={(e) => set({ internalNotes: e.target.value })}
              />
              <div>
                <Textarea
                  label="Client-Facing Notes (optional)"
                  value={f.clientNotes}
                  rows={3}
                  maxLength={2000}
                  onChange={(e) => set({ clientNotes: e.target.value })}
                />
                <p className="mt-1 text-xs text-muted">
                  This deadline will be visible to the client if added to the portal.
                </p>
              </div>
            </div>
          </Section>

          <Section step={3} title="Attachments (Optional)" testId="sec-attachments">
            <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-canvas p-5 text-center text-sm text-muted">
              <CloudArrowUp aria-hidden weight="regular" className="size-8 text-action" />
              <p>Uploading files here is not connected yet.</p>
              <p>Add a document the client already has under Related Items.</p>
            </div>
          </Section>

          <Section
            step={6}
            title="Related Items"
            subtitle="Link to other records."
            testId="sec-related"
          >
            <div className="flex flex-col gap-4">
              <Related
                title="Related Tasks"
                action={
                  <Adder
                    label="Link Task"
                    options={taskChoices}
                    disabled={!f.clientId}
                    onAdd={(x) => set({ tasks: [...f.tasks, x] })}
                  />
                }
              >
                <Chips
                  items={f.tasks}
                  empty={f.clientId ? 'No tasks linked.' : 'Choose a client to link tasks.'}
                  onRemove={(rid) => set({ tasks: f.tasks.filter((x) => x.id !== rid) })}
                />
              </Related>
              <Related
                title="Related Documents"
                action={
                  <Adder
                    label="Add Document"
                    options={docChoices}
                    disabled={!f.clientId}
                    onAdd={(x) => set({ documents: [...f.documents, x] })}
                  />
                }
              >
                <Chips
                  items={f.documents}
                  empty={f.clientId ? 'No documents added.' : 'Choose a client to add documents.'}
                  onRemove={(rid) => set({ documents: f.documents.filter((x) => x.id !== rid) })}
                />
              </Related>
              <Related title="Related Deadlines (Optional)">
                <Selectbox
                  label="Related deadline"
                  value=""
                  disabled={!f.clientId}
                  onChange={(v) => {
                    const item = linkChoices.find((x) => x.id === v);
                    if (item) set({ links: [...f.links, item] });
                  }}
                  options={[
                    { value: '', label: 'Select related deadline' },
                    ...linkChoices.map((o) => ({ value: o.id, label: o.label })),
                  ]}
                />
                <Chips
                  items={f.links}
                  empty=""
                  onRemove={(rid) => set({ links: f.links.filter((x) => x.id !== rid) })}
                />
              </Related>
            </div>
          </Section>

          <section
            className="min-w-0 rounded-xl bg-success-soft p-4"
            data-testid="deadline-summary"
            aria-label="Deadline Summary"
          >
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
              <CalendarPlus aria-hidden weight="fill" className="size-5 text-success" /> Deadline
              Summary
            </h2>
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-sm">
              {summary.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text">{k}:</dt>
                  <dd className="font-medium break-words text-heading">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Link href={id ? `/compliance/${id}` : '/compliance'} className={subtle}>
          Cancel
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          {!id ? (
            <button
              type="button"
              className={subtle}
              disabled={save.isPending}
              onClick={() => run('again')}
            >
              Save &amp; Create Another
            </button>
          ) : null}
          <button
            type="button"
            className={subtle}
            disabled={save.isPending}
            onClick={() => {
              setTemplateName(f.name.trim() ? `${f.name.trim()} template` : '');
              setAsTemplate(true);
            }}
          >
            Save as Template
          </button>
          <Button
            data-testid="deadline-save"
            disabled={save.isPending}
            onClick={() => run(f.recurring ? 'recurring' : 'open')}
          >
            Save Deadline
          </Button>
        </div>
      </footer>
      {asTemplate ? (
        <Modal
          open
          title="Save as Template"
          subtitle="A template keeps the type, agency, form, reminders and task settings, not the client."
          onClose={() => setAsTemplate(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsTemplate(false)}>
                Cancel
              </Button>
              <Button disabled={!templateName.trim() || save.isPending} onClick={saveTemplate}>
                Save Template
              </Button>
            </>
          }
        >
          <Input
            label="Template name"
            value={templateName}
            maxLength={200}
            onChange={(e) => setTemplateName(e.target.value)}
          />
        </Modal>
      ) : null}
    </div>
  );
}
