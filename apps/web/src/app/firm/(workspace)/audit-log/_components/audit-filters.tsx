'use client';

import { AuditLogQuery } from '@firmivra/types';
import { Button, Input, Select } from '@firmivra/ui';
import { useState, type FormEvent } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { TEAM } from '../../../setup/_components/shared';

/** The filters a page of the log is asked with; paging adds the cursor. */
export type AuditFilters = Omit<AuditLogQuery, 'cursor' | 'limit'>;

type Draft = Record<'from' | 'to' | 'action' | 'actorUserId' | 'entityType' | 'entityId', string>;
const EMPTY: Draft = {
  from: '',
  to: '',
  action: '',
  actorUserId: '',
  entityType: '',
  entityId: '',
};

const WHOLE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A day in the viewer's time zone, from its first to its last moment, as the API's instants. */
const dayStart = (day: string) => new Date(`${day}T00:00:00`).toISOString();
const dayEnd = (day: string) => new Date(`${day}T23:59:59.999`).toISOString();

/**
 * Checks the filters with the contract's own schema before any request, so a range over 366 days
 * or a single end shows its message here. Returns the query, or the messages by field.
 */
function toQuery(draft: Draft): { query: AuditFilters } | { errors: Partial<Draft> } {
  const errors: Partial<Draft> = {};
  for (const end of ['from', 'to'] as const) {
    if (draft[end] && !WHOLE_DATE.test(draft[end])) errors[end] = 'Enter a whole date';
  }
  if (errors.from || errors.to) return { errors };
  const query: AuditFilters = {
    ...(draft.from ? { from: dayStart(draft.from) } : {}),
    ...(draft.to ? { to: dayEnd(draft.to) } : {}),
    ...(draft.action.trim() ? { action: draft.action.trim() } : {}),
    ...(draft.actorUserId ? { actorUserId: draft.actorUserId } : {}),
    ...(draft.entityType.trim() ? { entityType: draft.entityType.trim() } : {}),
    ...(draft.entityId.trim() ? { entityId: draft.entityId.trim() } : {}),
  };
  const checked = AuditLogQuery.safeParse(query);
  if (checked.success) return { query };
  for (const issue of checked.error.issues) {
    const field = String(issue.path[0] ?? 'to') as keyof Draft;
    errors[field] ??=
      field === 'entityType' ? 'Use lower-case letters and _, like appointment' : issue.message;
  }
  return { errors };
}

export function AuditLogFilters({ onApply }: { onApply: (filters: AuditFilters) => void }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Partial<Draft>>({});
  const team = useApiQuery(TEAM, () => api.team.list());
  const field = (name: keyof Draft) => ({
    value: draft[name],
    error: errors[name],
    onChange: (event: { target: { value: string } }) =>
      setDraft({ ...draft, [name]: event.target.value }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = toQuery(draft);
    if ('errors' in result) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    onApply(result.query);
  };
  const clear = () => {
    setDraft(EMPTY);
    setErrors({});
    onApply({});
  };

  return (
    <form onSubmit={submit} noValidate aria-label="Filter the log" className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input label="From" type="date" {...field('from')} />
        <Input label="To" type="date" {...field('to')} />
        <Select
          label="Person"
          {...field('actorUserId')}
          options={[
            { value: '', label: 'Anyone' },
            ...(team.data ?? []).map((member) => ({
              value: member.user.id,
              label: member.user.name,
            })),
          ]}
        />
        <Input
          label="Action"
          placeholder="appointment. or client.created"
          maxLength={80}
          {...field('action')}
        />
        <Input
          label="Record type"
          placeholder="appointment"
          maxLength={40}
          {...field('entityType')}
        />
        <Input label="Record id" maxLength={100} {...field('entityId')} />
      </div>
      <p className="text-xs text-muted">
        Without dates, the log shows the last 30 days. Dates are in your time zone. An action that
        ends with a dot matches every action that starts with it.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">Apply filters</Button>
        <Button type="button" variant="secondary" onClick={clear}>
          Clear
        </Button>
      </div>
    </form>
  );
}
