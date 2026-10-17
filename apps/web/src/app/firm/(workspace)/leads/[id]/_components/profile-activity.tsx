'use client';

import type { LeadActivityKind } from '@firmivra/types';
import { Button, Select, Textarea, Timeline, type TimelineItem } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from '../../_components/lead-shared';
import { useProfile } from './profile-frame';
import { kindOf, shortName, stamp, wsKey } from './profile-shared';

type LoggableKind = 'CALL' | 'EMAIL_SENT' | 'SMS_SENT' | 'MEETING' | 'FOLLOW_UP';
const LOGGABLE: { value: LoggableKind; label: string }[] = [
  { value: 'CALL', label: 'Call' },
  { value: 'EMAIL_SENT', label: 'Email sent' },
  { value: 'SMS_SENT', label: 'SMS sent' },
  { value: 'MEETING', label: 'Meeting' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
];

/** Log Activity: a manual call, meeting or follow-up, attached to the lead's history. */
export function LogActivityForm({
  initial = 'CALL',
  onDone,
}: {
  initial?: LoggableKind;
  onDone?: () => void;
}) {
  const { id } = useProfile();
  const [kind, setKind] = useState<LoggableKind>(initial);
  const [summary, setSummary] = useState('');
  const log = useApiMutation(
    () => api.leadPipeline.logActivity(id, { kind, summary: summary.trim() }),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  return (
    <form
      className="mb-4 flex flex-col gap-3 rounded-lg bg-canvas p-4"
      aria-label="Log activity"
      onSubmit={(event) => {
        event.preventDefault();
        log.mutate(undefined, {
          onSuccess: () => {
            setSummary('');
            onDone?.();
          },
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Select
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value as LoggableKind)}
          options={LOGGABLE}
        />
        <Textarea
          label="What happened"
          rows={2}
          maxLength={1000}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!summary.trim() || log.isPending}>
          Log activity
        </Button>
        {log.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(log.error)}
          </p>
        ) : log.isSuccess ? (
          <p role="status" className="text-sm text-success">
            Logged.
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The lead's history as the Recent Activity rail: icon tile, what happened, when, and who (System
 * for what the platform did). `communications` keeps calls, emails and SMS only.
 */
export function ActivityTimeline({
  kind,
  filter,
  limit,
  emptyText,
  label,
}: {
  kind: 'all' | 'communications';
  /** Keep only these kinds (the Communications tab's chips). */
  filter?: LeadActivityKind[] | undefined;
  limit?: number;
  emptyText: string;
  label: string;
}) {
  const { id } = useProfile();
  const query = useApiQuery(wsKey(id, 'activity', kind), () =>
    api.leadPipeline.activity(id, { kind, limit: 100 }),
  );
  const rows = (query.data?.items ?? [])
    .filter((a) => !filter || filter.includes(a.kind))
    .slice(0, limit ?? 100);
  const items: TimelineItem[] = rows.map((a) => {
    const meta = kindOf(a.kind);
    return {
      id: a.id,
      icon: meta.icon,
      tone: meta.tone,
      title: a.label,
      time: stamp(a.at),
      dateTime: a.at,
      actor: a.by ? shortName(a.by.name) : 'System',
    };
  });
  const text = query.isPending
    ? 'Loading…'
    : query.isError
      ? 'The history is not available right now.'
      : emptyText;
  return (
    <div data-testid="activity-list">
      <Timeline items={items} variant="rail" label={label} emptyText={text} />
      {query.data?.nextCursor ? (
        <p className="mt-2 text-xs text-muted">Showing the latest {rows.length} entries.</p>
      ) : null}
    </div>
  );
}
