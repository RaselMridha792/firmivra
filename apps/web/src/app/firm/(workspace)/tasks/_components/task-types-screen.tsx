'use client';

import { SaveTaskTypeRequest, type TaskType } from '@firmivra/types';
import { Badge, Button, Input, Modal, Table, Toast } from '@firmivra/ui';
import { ArrowLeft, Plus, Tag } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { BackToWorkflow } from '../../settings/workflow/_components/back-to-workflow';
import { RowMenu } from '../../team/_components/row-menu';
import { TASKS_KEY, TASK_ERRORS } from './task-shared';

const TYPE_ERRORS: Record<string, string> = {
  ...TASK_ERRORS,
  DUPLICATE_NAME: 'Another task type already has this name.',
  FORBIDDEN: 'Only an Owner or an Admin can change task types.',
};

/**
 * /tasks/types: Manage Task Types (Octavia's review C1; no design, so it follows Manage
 * Appointment Types). The firm's task categories with Add, Rename, Archive and Restore. Owner and
 * Admin change them, as the API does; everyone else reads. An archived type stays on the tasks
 * that have it and leaves the Task Type picker. Opened from Settings > Workflow & Automations
 * (`fromWorkflow`), Back to Workflow & Automations sits beside Back to Tasks.
 */
export function TaskTypesScreen({ fromWorkflow = false }: { fromWorkflow?: boolean }) {
  const { role } = useFirm();
  const manages = role === 'OWNER' || role === 'ADMIN';
  const types = useApiQuery([...TASKS_KEY, 'types'], () => api.taskWork.types());
  const [editing, setEditing] = useState<TaskType | 'new' | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const toggle = useApiMutation(
    (t: TaskType) =>
      t.archivedAt ? api.taskWork.restoreType(t.id) : api.taskWork.archiveType(t.id),
    { invalidate: [...TASKS_KEY] },
  );
  const list = types.data ?? [];
  const add = (testId: string) => (
    <Button onClick={() => setEditing('new')} data-testid={testId}>
      <Plus aria-hidden weight="bold" className="size-4" />
      Add Task Type
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="task-types-page">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Link href="/tasks" className="flex w-fit items-center gap-2 text-sm font-medium text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Tasks
        </Link>
        {fromWorkflow ? <BackToWorkflow /> : null}
      </div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <Tag aria-hidden weight="fill" className="size-8" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading">Task Types</h1>
            <p className="text-base text-muted">
              The categories your firm sorts tasks by, such as Bookkeeping or Tax Prep.
            </p>
          </div>
        </div>
        {manages ? add('add-task-type') : null}
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {manages ? null : (
        <p
          role="status"
          className="rounded-xl bg-surface px-4 py-3 text-sm text-muted shadow-md"
          data-testid="types-read-only"
        >
          Only an Owner or an Admin can add or change task types.
        </p>
      )}

      <section
        aria-label="Task types"
        className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
        data-testid="task-types-list"
      >
        <Table
          rows={list}
          loading={types.isPending}
          rowKey={(t) => t.id}
          caption="Task types"
          noun="types"
          dense
          showPagination={false}
          columns={[
            {
              id: 'name',
              label: 'Name',
              cell: (t) => (
                <span className="font-semibold text-heading" data-testid="task-type-name">
                  {t.name}
                </span>
              ),
            },
            {
              id: 'status',
              label: 'Status',
              cell: (t) =>
                t.archivedAt ? (
                  <Badge tone="neutral">Archived</Badge>
                ) : (
                  <Badge tone="success">Active</Badge>
                ),
            },
            {
              id: 'use',
              label: 'On New Tasks',
              cell: (t) =>
                t.archivedAt ? 'Not offered; kept on the tasks that have it' : 'Offered',
            },
          ]}
          rowActions={(t) =>
            manages ? (
              <RowMenu
                label={`Actions for ${t.name}`}
                items={[
                  { label: 'Rename', onSelect: () => setEditing(t) },
                  {
                    label: t.archivedAt ? 'Restore' : 'Archive',
                    danger: !t.archivedAt,
                    onSelect: () =>
                      toggle.mutate(t, {
                        onSuccess: () =>
                          setMessage({
                            text: t.archivedAt
                              ? `${t.name} is offered on new tasks again.`
                              : `${t.name} is archived; tasks that have it keep it.`,
                            tone: 'success',
                          }),
                        onError: (e) =>
                          setMessage({ text: errorMessage(e, TYPE_ERRORS), tone: 'error' }),
                      }),
                  },
                ]}
              />
            ) : null
          }
          emptyTitle={types.isError ? 'Task types are not available' : 'No task types yet'}
          emptyText={
            types.isError
              ? 'We could not load the task types. Try again in a moment.'
              : manages
                ? 'Add the first type. Until then, tasks save without one.'
                : 'An Owner or an Admin adds them. Until then, tasks save without one.'
          }
          emptyAction={manages && !types.isError ? add('add-task-type-empty') : undefined}
        />
      </section>

      {editing ? (
        <TypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={(_, text) => {
            setEditing(null);
            setMessage({ text, tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Add a type, or rename one; Create and Edit Task add one from the Task Type field with it. Names
 * are unique ignoring case (the API answers DUPLICATE_NAME).
 */
export function TypeModal({
  type,
  onClose,
  onDone,
}: {
  type: TaskType | null;
  onClose: () => void;
  onDone: (saved: TaskType, text: string) => void;
}) {
  const [name, setName] = useState(type?.name ?? '');
  const [error, setError] = useState('');
  const save = useApiMutation(
    () => {
      const body = { name: name.trim() };
      return type ? api.taskWork.updateType(type.id, body) : api.taskWork.createType(body);
    },
    { invalidate: [...TASKS_KEY] },
  );
  return (
    <Modal open title={type ? `Rename ${type.name}` : 'Add Task Type'} onClose={onClose}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!SaveTaskTypeRequest.safeParse({ name: name.trim() }).success) {
            setError('Enter a name.');
            return;
          }
          setError('');
          save.mutate(undefined, {
            onSuccess: (t) => onDone(t, type ? `${t.name} saved.` : `${t.name} added.`),
          });
        }}
      >
        <Input
          label="Name *"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={error || save.error ? true : undefined}
        />
        {error || save.error ? (
          <p role="alert" className="text-sm text-danger">
            {error || errorMessage(save.error, TYPE_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending} data-testid="save-task-type">
            {type ? 'Save Changes' : 'Add Type'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
