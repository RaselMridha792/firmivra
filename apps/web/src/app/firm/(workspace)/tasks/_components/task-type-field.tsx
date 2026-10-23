'use client';

import type { TaskType } from '@firmivra/types';
import { Plus } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { useTypes } from './task-data';
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
 * The Task Type select, its error, and the line under it: what an empty or unreadable list
 * means, and for Owner and Admin Add Task Type without leaving the form (the full list is Manage
 * Task Types, /tasks/types). A type added here is selected.
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
  const { state, manages } = choice;
  const add = manages ? (
    <button
      type="button"
      onClick={() => setAdding(true)}
      className="inline-flex items-center gap-1 font-medium text-link hover:underline"
      data-testid="add-type-inline"
    >
      <Plus aria-hidden weight="bold" className="size-3" /> Add Task Type
    </button>
  ) : null;
  return (
    <>
      <select
        id={id}
        className={className}
        value={choice.value}
        disabled={state === 'loading' || state === 'none'}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">
          {state === 'loading'
            ? 'Loading task types…'
            : state === 'none'
              ? 'No task types set up'
              : 'Select task type'}
        </option>
        {choice.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
    </>
  );
}
