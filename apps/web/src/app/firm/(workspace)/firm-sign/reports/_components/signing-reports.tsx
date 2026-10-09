'use client';

import {
  ESIGN_STATUS_LABELS,
  type EsignReport,
  EsignReportQuery,
  EsignRequestStatus,
  type EsignReportTotals,
} from '@firmivra/types';
import { Card, Input, Select, Table, type Column } from '@firmivra/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { EsignGate } from '../../../../../../components/esign/esign-gate';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { shouldRetry } from '../../../../../../lib/query';

/** A calendar date `days` before today on this device, as the report's `from` and `to` take it. */
function daysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** The report counts sent requests, so a draft or one waiting for approval is never in it. */
const STATUSES = EsignRequestStatus.options
  .filter((s) => s !== 'DRAFT' && s !== 'NEEDS_APPROVAL')
  .map((s) => ({
    value: s,
    // Elsewhere Delivered reads Sent; here they are separate filters (the report matches exactly).
    label: s === 'DELIVERED' ? 'Delivered, not opened' : ESIGN_STATUS_LABELS[s],
  }));

const percent = (rate: number | null) => (rate === null ? '–' : `${Math.round(rate * 100)}%`);
/** Hours under two days; days above. */
function duration(hours: number | null) {
  if (hours === null) return '–';
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

type Row = EsignReport['bySender'][number];
const COLUMNS: Column<Row>[] = [
  { id: 'sender', label: 'Sent by', cell: (r) => r.sender.name, sortValue: (r) => r.sender.name },
  { id: 'sent', label: 'Sent', cell: (r) => r.sent, sortValue: (r) => r.sent },
  { id: 'completed', label: 'Completed', cell: (r) => r.completed, sortValue: (r) => r.completed },
  {
    id: 'rate',
    label: 'Completion rate',
    cell: (r) => percent(r.completionRate),
    sortValue: (r) => r.completionRate ?? -1,
  },
  {
    id: 'time',
    label: 'Average time to complete',
    cell: (r) => duration(r.averageCompletionHours),
    sortValue: (r) => r.averageCompletionHours ?? -1,
  },
  { id: 'open', label: 'Outstanding', cell: (r) => r.outstanding, sortValue: (r) => r.outstanding },
  { id: 'expired', label: 'Expired', cell: (r) => r.expired, sortValue: (r) => r.expired },
];

/** /firm-sign/reports: totals and activity by sender for a date range. */
export function SigningReports() {
  return <EsignGate>{() => <Reports />}</EsignGate>;
}

function Reports() {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => daysAgo(0));
  const [status, setStatus] = useState('');
  // Kept with its name, so a sender who sent nothing in new dates stays chosen and shown.
  const [sender, setSender] = useState<{ userId: string; name: string } | null>(null);
  const senderId = sender?.userId ?? '';
  const parsed = EsignReportQuery.safeParse({
    from,
    to,
    ...(status && { status }),
    ...(senderId && { senderId }),
  });
  const query = parsed.success ? parsed.data : null;
  const report = useQuery<EsignReport, Error>({
    queryKey: ['esign', 'report', query],
    queryFn: () => api.esign.report(query!),
    enabled: !!query,
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
  // The sender choices: everyone who sent in the range, whichever sender is picked.
  const everyone = useQuery({
    queryKey: ['esign', 'report', { from, to }],
    queryFn: () => api.esign.report({ from, to }),
    enabled: !!query,
    retry: shouldRetry,
  });
  const issue = (field: 'from' | 'to') =>
    parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === field);
  const fromError = issue('from') && 'Choose a start date';
  const toError = issue('to') && (to ? issue('to')?.message : 'Choose an end date');
  const senders = new Map((everyone.data?.bySender ?? []).map((r) => [r.sender.userId, r.sender]));
  if (sender) senders.set(sender.userId, sender);

  return (
    <div className="flex flex-col gap-6">
      <h1 data-testid="page-title" className="font-display text-3xl text-heading">
        Signing reports
      </h1>
      <Card>
        <div className="grid gap-3 md:grid-cols-4">
          <Input
            label="From"
            type="date"
            value={from}
            max={to}
            error={fromError}
            onChange={(e) => setFrom(e.target.value)}
          />
          <Input
            label="To"
            type="date"
            value={to}
            min={from}
            error={toError}
            onChange={(e) => setTo(e.target.value)}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[{ value: '', label: 'Every status' }, ...STATUSES]}
          />
          <Select
            label="Sent by"
            value={senderId}
            onChange={(e) => setSender(senders.get(e.target.value) ?? null)}
            options={[
              { value: '', label: 'Everyone' },
              ...[...senders.values()].map((s) => ({ value: s.userId, label: s.name })),
            ]}
          />
        </div>
        <p className="mt-3 text-sm text-muted">
          Counts the requests sent in these dates. You see only requests you may open.
        </p>
      </Card>
      {query && (
        <PageState query={report}>
          {(data) => (
            <div
              className="flex flex-col gap-6"
              aria-busy={report.isPlaceholderData}
              data-testid="report"
            >
              {report.isPlaceholderData && (
                <p role="status" className="text-sm text-muted">
                  Updating…
                </p>
              )}
              <Totals t={data.totals} />
              <Table
                caption="Activity by sender"
                rows={data.bySender}
                columns={COLUMNS}
                rowKey={(r) => r.sender.userId}
                pageSize={25}
                emptyTitle="Nothing sent"
                emptyText="No requests were sent in these dates."
              />
            </div>
          )}
        </PageState>
      )}
    </div>
  );
}

function Totals({ t }: { t: EsignReportTotals }) {
  const items: [string, string | number][] = [
    ['Sent', t.sent],
    ['Completion rate', percent(t.completionRate)],
    ['Average time to complete', duration(t.averageCompletionHours)],
    ['Outstanding', t.outstanding],
    ['Completed', t.completed],
    ['Declined', t.declined],
    ['Expired', t.expired],
    ['Voided', t.voided],
  ];
  return (
    <div data-testid="report-totals" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <Card key={label}>
          <dl className="flex flex-col gap-1">
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-2xl font-semibold text-heading">{value}</dd>
          </dl>
        </Card>
      ))}
    </div>
  );
}
