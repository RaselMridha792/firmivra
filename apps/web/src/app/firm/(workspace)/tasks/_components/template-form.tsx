'use client';

import type {
  CreateTaskTemplateRequest,
  TaskAssignmentRule,
  TaskPriority,
  TaskTemplate,
} from '@firmivra/types';
import { Button, Checkbox, Textarea, Toast } from '@firmivra/ui';
import { ArrowLeft, FileText, Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
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
import { PRIORITY_LABEL, TASKS_KEY, TASK_ERRORS } from './task-shared';
import { TaskTypeSelect, useTypeChoice } from './task-type-field';

const RULES: Record<TaskAssignmentRule, string> = {
  UNASSIGNED: 'Chosen on each task',
  SPECIFIC_USER: 'A specific team member',
  CLIENT_TEAM: "The client's team",
};

const TEMPLATE_ERRORS: Record<string, string> = {
  ...TASK_ERRORS,
  DUPLICATE_NAME: 'Another template already has this name. Choose another.',
  SAVE_CONFLICT: 'Someone saved this template after you opened it. Reload and try again.',
  FORBIDDEN: 'Only an Owner or an Admin can create or edit task templates.',
};

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** Where the library is: the Tasks page's Task Templates view (`saved` names the template). */
const library = (saved?: string) => `/tasks?view=templates${saved ? `&saved=${saved}` : ''}`;

/**
 * /tasks/templates/new and /tasks/templates/[id]/edit: Create Task Template and Edit Task
 * Template (Octavia's review C3; no design, so it follows Create Task). The source template, not a
 * task: Use (/tasks/new?template=) starts a task from it as a snapshot, so a change here applies
 * to new tasks only. Owner and Admin, as the API (`FIRM_MANAGERS`).
 */
export function TemplateFormScreen({ id }: { id?: string }) {
  const { role } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const template = useApiQuery([...TASKS_KEY, 'template', id ?? 'new'], async () =>
    id ? api.taskWork.getTemplate(id) : null,
  );
  const note = !manages
    ? 'Only an Owner or an Admin can create or edit task templates.'
    : id && template.isPending
      ? 'Loading…'
      : id && template.isError
        ? errorMessage(template.error, TEMPLATE_ERRORS)
        : undefined;
  if (note)
    return (
      <div className="flex min-w-0 flex-col gap-5" data-testid="template-form">
        <BackLink />
        <p role="status" className="rounded-xl bg-surface p-6 text-sm text-muted shadow-md">
          {note}
        </p>
      </div>
    );
  return <TemplateForm key={template.data?.id ?? 'new'} template={template.data ?? undefined} />;
}

function BackLink() {
  return (
    <Link href={library()} className="flex w-fit items-center gap-2 text-sm font-medium text-link">
      <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Task Templates
    </Link>
  );
}

function TemplateForm({ template }: { template: TaskTemplate | undefined }) {
  const router = useRouter();
  const editing = !!template;
  const { members } = useMembers();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [typeId, setTypeId] = useState(template?.type?.id ?? '');
  const [serviceId, setServiceId] = useState(template?.service?.id ?? '');
  const [priority, setPriority] = useState<TaskPriority>(template?.priority ?? 'MEDIUM');
  const [rule, setRule] = useState<TaskAssignmentRule>(template?.assignmentRule ?? 'UNASSIGNED');
  const [assignee, setAssignee] = useState(template?.assignedTo?.userId ?? '');
  const [dueDays, setDueDays] = useState(
    template?.dueOffsetDays == null ? '' : String(template.dueOffsetDays),
  );
  const [visible, setVisible] = useState(template?.clientVisibleDefault ?? false);
  const [items, setItems] = useState<Item[]>(
    (template?.checklist ?? []).map((c, i) => ({
      key: `t${i}`,
      label: c.label,
      required: c.required,
      done: false,
    })),
  );
  const [nextKey, setNextKey] = useState(0);
  const [remind, setRemind] = useState((template?.reminders.length ?? 0) > 0);
  const [reminders, setReminders] = useState<Reminder[]>(
    (template?.reminders ?? []).map((r, i) => ({ key: `r${i}`, daysBefore: r.daysBefore })),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();

  // A template's type is never required; an archived one stays shown as "(archived)".
  const typeChoice = useTypeChoice(typeId, template?.type);
  const services = useApiQuery([...TASKS_KEY, 'services'], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100 }),
  );
  const serviceOptions = [
    ...(template?.service && !services.data?.items.some((x) => x.id === template.service?.id)
      ? [{ value: template.service.id, label: template.service.name }]
      : []),
    ...(services.data?.items ?? []).map((x) => ({ value: x.id, label: x.name })),
  ];
  const memberOptions = [
    ...(template?.assignedTo && !members.some((m) => m.userId === template.assignedTo?.userId)
      ? [{ value: template.assignedTo.userId, label: template.assignedTo.name }]
      : []),
    ...members.map((m) => ({ value: m.userId, label: m.name })),
  ];

  const body = (): CreateTaskTemplateRequest => ({
    name: name.trim(),
    description,
    typeId: typeChoice.value || null,
    serviceId: serviceId || null,
    priority,
    assignmentRule: rule,
    ...(rule === 'SPECIFIC_USER' ? { assignedUserId: assignee } : {}),
    dueOffsetDays: dueDays === '' ? null : Number(dueDays),
    clientVisibleDefault: visible,
    checklist: items
      .filter((i) => i.label.trim())
      .map((i) => ({ label: i.label.trim(), required: i.required })),
    reminders: remind ? reminders.map((r) => ({ daysBefore: r.daysBefore })) : [],
  });
  const save = useApiMutation(
    () =>
      template
        ? api.taskWork.updateTemplate(template.id, { version: template.version, ...body() })
        : api.taskWork.createTemplate(body()),
    { invalidate: [...TASKS_KEY] },
  );

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e['name'] = 'Enter the template name';
    if (rule === 'SPECIFIC_USER' && !assignee) e['assignee'] = 'Choose the team member';
    const days = Number(dueDays);
    if (dueDays !== '' && (!Number.isInteger(days) || days < 0 || days > 730))
      e['due'] = 'Enter 0 to 730 days, or leave it empty for no due date';
    if (remind && reminders.length > 0) {
      if (dueDays === '') e['reminders'] = 'Reminders need a due date. Set the due date first.';
      else if (new Set(reminders.map((r) => r.daysBefore)).size < reminders.length)
        e['reminders'] = 'Two reminders are the same. Remove one.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }
  function submit() {
    setMessage(undefined);
    if (!validate()) {
      setMessage({ text: 'Fix the highlighted fields to continue.', tone: 'error' });
      return;
    }
    save.mutate(undefined, {
      onSuccess: (saved) => router.push(library(saved.id)),
      onError: (e) => {
        if (errorCode(e) === 'DUPLICATE_NAME')
          setErrors({ ...errors, name: TEMPLATE_ERRORS['DUPLICATE_NAME'] as string });
        setMessage({ text: errorMessage(e, TEMPLATE_ERRORS), tone: 'error' });
      },
    });
  }
  const err = (k: string) =>
    errors[k] ? (
      <p role="alert" className="text-xs text-danger">
        {errors[k]}
      </p>
    ) : null;

  const assigned =
    rule === 'SPECIFIC_USER'
      ? (memberOptions.find((m) => m.value === assignee)?.label ?? '—')
      : RULES[rule];
  const summary: [string, string][] = [
    ['Type', typeChoice.options.find((o) => o.value === typeChoice.value)?.label ?? '—'],
    ['Service', serviceOptions.find((o) => o.value === serviceId)?.label ?? '—'],
    ['Priority', PRIORITY_LABEL[priority]],
    ['Assigned To', assigned],
    [
      'Due Date',
      dueDays === ''
        ? 'None'
        : `${dueDays} day${dueDays === '1' ? '' : 's'} after the task is made`,
    ],
    ['Checklist', count(items.filter((i) => i.label.trim()).length, 'item')],
    ['Reminders', remind && reminders.length ? count(reminders.length, 'reminder') : 'None'],
    ['Client Visible', visible ? 'Yes' : 'No'],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="template-form">
      <BackLink />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <FileText aria-hidden weight="fill" className="size-8" />
          </span>
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">
              {editing ? 'Edit Task Template' : 'Create Task Template'}
            </h1>
            <p className="text-base text-muted">
              Set what every task started from this template begins with.
            </p>
          </div>
        </div>
        {template && template.archivedAt === null ? (
          <Link
            href={`/tasks/new?template=${template.id}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
          >
            Use Template
          </Link>
        ) : null}
      </header>
      {template?.archivedAt ? (
        <p role="status" className="rounded-xl bg-surface px-4 py-3 text-sm text-muted shadow-md">
          This template is archived. Restore it in Task Templates to start tasks from it.
        </p>
      ) : null}
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            step={1}
            title="Template Details"
            subtitle="Name the template and describe the work."
            testId="template-basic"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Label text="Template Name" required htmlFor="tt-name">
                <input
                  id="tt-name"
                  className={field}
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={errors['name'] ? true : undefined}
                />
                {err('name')}
              </Label>
              <Label text="Task Type" htmlFor="tt-type">
                <TaskTypeSelect
                  id="tt-type"
                  className={field}
                  choice={typeChoice}
                  onChange={setTypeId}
                  onAdded={(_, text) => setMessage({ text, tone: 'success' })}
                />
              </Label>
              <div className="md:col-span-2">
                <Textarea
                  label="Description"
                  rows={4}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <p className="text-right text-xs text-muted">
                  Characters: {description.length}/2000
                </p>
              </div>
            </div>
          </Section>

          <Section
            step={2}
            title="Defaults for New Tasks"
            subtitle="A task started from the template begins with these. They can be changed on the task."
            testId="template-defaults"
          >
            <div className="grid gap-4 md:grid-cols-3">
              <Label text="Service (if applicable)" htmlFor="tt-service">
                <Selectbox
                  id="tt-service"
                  label="Service"
                  value={serviceId}
                  onChange={setServiceId}
                  options={[
                    {
                      value: '',
                      label: services.isError ? 'Services are not available' : 'No service',
                    },
                    ...serviceOptions,
                  ]}
                />
              </Label>
              <Label text="Priority" htmlFor="tt-priority">
                <Selectbox
                  id="tt-priority"
                  label="Priority"
                  value={priority}
                  onChange={(v) => setPriority(v as TaskPriority)}
                  options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Label>
              <Label text="Due Date (days after the task is made)" htmlFor="tt-due">
                <input
                  id="tt-due"
                  type="number"
                  min={0}
                  max={730}
                  inputMode="numeric"
                  className={field}
                  placeholder="No due date"
                  value={dueDays}
                  onChange={(e) => setDueDays(e.target.value)}
                  aria-invalid={errors['due'] ? true : undefined}
                />
                {err('due')}
              </Label>
              <Label text="Assign To" htmlFor="tt-rule">
                <Selectbox
                  id="tt-rule"
                  label="Assign to"
                  value={rule}
                  onChange={(v) => setRule(v as TaskAssignmentRule)}
                  options={Object.entries(RULES).map(([value, label]) => ({ value, label }))}
                />
              </Label>
              {rule === 'SPECIFIC_USER' ? (
                <Label text="Team Member" required htmlFor="tt-assignee">
                  <Selectbox
                    id="tt-assignee"
                    label="Team member"
                    value={assignee}
                    onChange={setAssignee}
                    options={[{ value: '', label: 'Select team member' }, ...memberOptions]}
                  />
                  {err('assignee')}
                </Label>
              ) : null}
            </div>
          </Section>

          <Section
            step={3}
            title="Checklist / Subtasks"
            subtitle="Steps every task from this template starts with (optional)."
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
            <ChecklistItems items={items} onChange={setItems} showDone={false} />
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Template settings">
          <Section title="Visibility" testId="template-visibility">
            <Checkbox
              label="Visible to client by default"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />
            <p className="text-xs text-muted">
              Tasks from this template start visible to clients with portal access.
            </p>
          </Section>
          <Section title="Notifications & Reminders" testId="template-reminders">
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
            {err('reminders')}
          </Section>
          <Section title="Template Summary" testId="template-summary">
            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
              {summary.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text">{k}:</dt>
                  <dd className="text-heading">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted">
              Tasks already started from this template keep what they began with; a change here
              applies to new tasks.
            </p>
          </Section>
        </aside>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => router.push(library())}>
          Cancel
        </Button>
        <Button disabled={save.isPending} onClick={submit} data-testid="template-save">
          {editing ? 'Save Changes' : 'Save Template'}
        </Button>
      </div>
    </div>
  );
}
