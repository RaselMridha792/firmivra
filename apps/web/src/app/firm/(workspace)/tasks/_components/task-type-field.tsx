'use client';

import type { TaskType } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { CaretDown, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { useTypes } from './task-data';
import { TASK_ERRORS, TASKS_KEY } from './task-shared';
import { TypeModal } from './task-types-screen';

export interface TypeChoice {
  options: { value: string; label: string }[];
  /** What the form sends and shows: `typeId` when it is one of the options, else "". */
  value: string;
  /** Required while the firm has a type to choose; with none, the task saves without one. */
  required: boolean;
  state: 'loading' | 'error' | 'none' | 'some';
  manages: boolean;
  /** Why a save waits: the types are still loading, or one is required and none is chosen. */
  problem: string | undefined;
}

/**
 * The Task Type field's rules (Octavia's C1), for Create / Edit Task and Set Up Recurring Task:
 * the firm's active types are offered; a task keeps its own type after it is archived; a
 * template's archived type is not offered (the API would refuse it). With no active type the
 * field says so and the task saves without one; with types it is required.
 */
export function useTypeChoice(
  typeId: string,
  own?: { id: string; name: string } | null,
): TypeChoice {
  const { role } = useFirm();
  const { types, query } = useTypes();
  const keepOwn = own && !types.some((t) => t.id === own.id);
  const options = [
    ...(keepOwn
      ? [{ value: own.id, label: query.isSuccess ? `${own.name} (archived)` : own.name }]
      : []),
    ...types.map((t) => ({ value: t.id, label: t.name })),
  ];
  const value = !query.isSuccess || options.some((o) => o.value === typeId) ? typeId : '';
  const required = options.length > 0;
  // A list that failed once counts as failed while it is retried: it never holds up a save.
  const failed = query.isError || (query.isPending && query.failureCount > 0);
  const loading = query.isPending && !failed;
  return {
    options,
    value,
    required,
    state: loading ? 'loading' : failed ? 'error' : required ? 'some' : 'none',
    manages: role === 'OWNER' || role === 'ADMIN',
    problem: loading
      ? 'Task types are still loading. Try again in a moment.'
      : required && !value
        ? 'Choose a task type'
        : undefined,
  };
}

/**
 * The Task Type field, its error, and the line under it: what an empty or unreadable list means,
 * and for Owner and Admin Add Task Type without leaving the form (the full list is Manage Task
 * Types, /tasks/types). A type added here is selected. Tasks Review Two T-C04: a dropdown whose
 * rows carry Edit and Delete for Owner and Admin; Delete archives the type after a confirmation,
 * and tasks that have it keep it. `onAdded` reports each change made here with its words.
 */
export function TaskTypeSelect({
  id,
  className,
  choice,
  onChange,
  onAdded,
  error,
}: {
  id: string;
  className: string;
  choice: TypeChoice;
  onChange: (typeId: string) => void;
  onAdded: (type: TaskType, text: string) => void;
  error?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TaskType>();
  const [deleting, setDeleting] = useState<TaskType>();
  const [open, setOpen] = useState(false);
  const { types } = useTypes();
  const { state, manages } = choice;
  const archive = useApiMutation((t: TaskType) => api.taskWork.archiveType(t.id), {
    invalidate: [...TASKS_KEY],
  });
  const chosen = choice.options.find((o) => o.value === choice.value);
  const placeholder =
    state === 'loading'
      ? 'Loading task types…'
      : state === 'none'
        ? 'No task types set up'
        : 'Select task type';
  const pick = (value: string) => {
    onChange(value);
    setOpen(false);
  };
  const add = manages ? (
    <button
      type="button"
      onClick={() => {
        setOpen(false);
        setAdding(true);
      }}
      className="inline-flex items-center gap-1 font-medium text-link hover:underline"
      data-testid="add-type-inline"
    >
      <Plus aria-hidden weight="bold" className="size-3" /> Add Task Type
    </button>
  ) : null;
  const listId = `${id}-list`;
  return (
    <>
      <div
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          className={`${className} flex items-center justify-between gap-2 text-left`}
          disabled={state === 'loading' || state === 'none'}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        >
          <span className={chosen ? 'truncate' : 'truncate text-muted'}>
            {chosen?.label ?? placeholder}
          </span>
          <CaretDown aria-hidden weight="bold" className="size-3.5 shrink-0 text-muted" />
        </button>
        {open ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Task types"
            className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-control border border-border bg-surface py-1 shadow-md"
          >
            <li role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={!choice.value}
                className="w-full px-3 py-2 text-left text-sm text-muted hover:bg-canvas"
                onClick={() => pick('')}
              >
                Select task type
              </button>
            </li>
            {choice.options.map((o) => {
              const type = types.find((t) => t.id === o.value);
              return (
                <li role="presentation" key={o.value} className="flex items-center hover:bg-canvas">
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === choice.value}
                    className={`min-w-0 flex-1 truncate px-3 py-2 text-left text-sm ${o.value === choice.value ? 'font-semibold text-heading' : 'text-text'}`}
                    onClick={() => pick(o.value)}
                  >
                    {o.label}
                  </button>
                  {manages && type ? (
                    <span className="flex shrink-0 items-center gap-1 pr-2">
                      <button
                        type="button"
                        aria-label={`Edit ${o.label}`}
                        className="rounded-control p-1.5 text-muted hover:text-link"
                        onClick={() => {
                          setOpen(false);
                          setEditing(type);
                        }}
                      >
                        <PencilSimple aria-hidden weight="fill" className="size-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${o.label}`}
                        className="rounded-control p-1.5 text-muted hover:text-danger"
                        onClick={() => {
                          setOpen(false);
                          setDeleting(type);
                        }}
                      >
                        <Trash aria-hidden weight="fill" className="size-4" />
                      </button>
                    </span>
                  ) : null}
                </li>
              );
            })}
            {add ? (
              <li role="presentation" className="border-t border-divider px-3 py-2 text-xs">
                {add}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      {error}
      {state === 'some' && add ? <p className="flex justify-end text-xs">{add}</p> : null}
      {state === 'none' || state === 'error' ? (
        <p
          className="flex flex-wrap items-center gap-x-2 text-xs text-muted"
          data-testid="type-note"
        >
          <span>
            {state === 'error'
              ? 'Task types could not be loaded. The task saves without a type.'
              : `No task types are set up yet, so the task saves without one.${manages ? '' : ' An Owner or an Admin can add them.'}`}
          </span>
          {state === 'none' ? add : null}
        </p>
      ) : null}
      {adding ? (
        <TypeModal
          type={null}
          onClose={() => setAdding(false)}
          onDone={(saved, text) => {
            setAdding(false);
            onChange(saved.id);
            onAdded(saved, `${text} It is selected for this task.`);
          }}
        />
      ) : null}
      {editing ? (
        <TypeModal
          type={editing}
          onClose={() => setEditing(undefined)}
          onDone={(saved, text) => {
            setEditing(undefined);
            onAdded(saved, text);
          }}
        />
      ) : null}
      {deleting ? (
        <Modal
          open
          title={`Delete ${deleting.name}?`}
          onClose={() => setDeleting(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(undefined)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={archive.isPending}
                onClick={() =>
                  archive.mutate(deleting, {
                    onSuccess: (gone) => {
                      setDeleting(undefined);
                      if (choice.value === gone.id) onChange('');
                      onAdded(gone, `${gone.name} is deleted; tasks that have it keep it.`);
                    },
                  })
                }
              >
                Delete Task Type
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            {deleting.name} leaves the list of task types. Tasks that already have it keep it.
          </p>
          {archive.isError ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errorMessage(archive.error, TASK_ERRORS)}
            </p>
          ) : null}
        </Modal>
      ) : null}
    </>
  );
}
