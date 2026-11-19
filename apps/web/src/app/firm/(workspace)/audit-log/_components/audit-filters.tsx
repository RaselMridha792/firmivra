'use client';

import { AuditLogQuery } from '@firmivra/types';
import { Button, Input, Select } from '@firmivra/ui';
import { useState, type FormEvent } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { TEAM } from '../../../setup/_components/shared';
import { dayBounds } from './audit-time';

/** The filters a page of the log is asked with; paging adds the cursor. */
export type AuditFilters = Omit<AuditLogQuery, 'cursor' | 'limit'>;

/**
 * The record filters a link brings in its address (CD-F15: Compliance opens
 * `?action=compliance.` and `?entityType=compliance_deadline&entityId=<id>`), checked with the
 * contract's own schema; anything it refuses is left out.
 */
export function addressFilters(params: { get: (key: string) => string | null }): AuditFilters {
  const out: AuditFilters = {};
  for (const key of ['action', 'entityType', 'entityId'] as const) {
    const value = params.get(key)?.trim();
    if (value && AuditLogQuery.safeParse({ [key]: value }).success) out[key] = value;
  }
  return out;
}

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

/**
 * Checks the filters with the contract's own schema before any request, so a range over 366 days
 * or a single end shows its message here. Returns the query, or the messages by field. The days
 * are the firm's (R01b), from the first moment of From to the last of To.
 */
function toQuery(
  draft: Draft,
  timeZone: string | undefined,
): { query: AuditFilters } | { errors: Partial<Draft> } {
  const errors: Partial<Draft> = {};
  for (const end of ['from', 'to'] as const) {
    if (draft[end] && !WHOLE_DATE.test(draft[end])) errors[end] = 'Enter a whole date';
  }
  if (errors.from || errors.to) return { errors };
  if ((draft.from || draft.to) && !timeZone) {
    return { errors: { from: "The firm's time zone is still loading. Try again in a moment." } };
  }
  const zone = timeZone ?? 'UTC';
  const query: AuditFilters = {
    ...(draft.from ? { from: dayBounds(draft.from, zone).from } : {}),
    ...(draft.to ? { to: dayBounds(draft.to, zone).to } : {}),
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

export function AuditLogFilters({
  initial = {},
  timeZone,
  onApply,
}: {
  /** The filters the page opened with (from its address). */
  initial?: AuditFilters;
  /** The firm's time zone, which the dates are in; undefined while it loads. */
  timeZone: string | undefined;
  onApply: (filters: AuditFilters) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    ...EMPTY,
    action: initial.action ?? '',
    entityType: initial.entityType ?? '',
    entityId: initial.entityId ?? '',
  }));
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
    const result = toQuery(draft, timeZone);
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
        Without dates, the log shows the last 30 days. Dates and times are in the firm&apos;s time
        zone{timeZone ? ` (${timeZone})` : ''}. An action that ends with a dot matches every action
        that starts with it.
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
