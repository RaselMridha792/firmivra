'use client';

import type { ComplianceLog } from '@firmivra/types';
import { Badge, type Column, Input, Table } from '@firmivra/ui';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { OriginLink } from '../../../../../components/origin-link';
import { RequireRole } from '../../../../../components/require-role';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { useMembers } from './compliance-data';
import { COMPLIANCE_KEY, Selectbox, dayText, shortName, stamp } from './compliance-shared';

const KINDS = ['IMPORT', 'VERIFY', 'PUBLISH', 'ROLLBACK', 'GENERATE', 'OVERRIDE', 'ERROR'] as const;
const OUTCOME = { SUCCESS: 'success', FAILED: 'danger', SKIPPED: 'neutral' } as const;
const cap = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();
const dayOf = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
/** The global Audit Log, filtered to Compliance (CD-F15). */
export const AUDIT_COMPLIANCE = '/audit-log?action=compliance.';
const COUNTS: [string, string][] = [
  ['suggested', 'suggested'],
  ['needsReview', 'need review'],
  ['applied', 'added'],
  ['alreadyDecided', 'already decided'],
];

/** What a log row adds to its message: dates before and after, the rule and its version, counts. */
function extraOf(l: ComplianceLog): string[] {
  const d = l.details;
  const out: string[] = [];
  if (typeof d['from'] === 'string' && typeof d['to'] === 'string') {
    out.push(`Due date ${dayText(d['from'])} → ${dayText(d['to'])}`);
  }
  if (l.rule)
    out.push(`Rule “${l.rule.name}”${l.rule.version ? ` (version ${l.rule.version})` : ''}`);
  const counts = COUNTS.filter(([k]) => typeof d[k] === 'number' && (d[k] as number) > 0).map(
    ([k, word]) => `${d[k] as number} ${word}`,
  );
  if (counts.length) out.push(counts.join(', '));
  return out;
}

/** The record a row is about, as a link where the viewer may open it. */
function RecordCell({ record }: { record: ComplianceLog['record'] }) {
  if (!record) return <>—</>;
  if (record.name === null) {
    return <span className="text-muted">A {record.kind.toLowerCase()} you cannot open</span>;
  }
  const href =
    record.kind === 'DEADLINE'
      ? `/compliance/${record.id}`
      : record.kind === 'RECURRENCE'
        ? `/compliance/recurring/new?edit=${record.id}`
        : null;
  return href ? (
    <OriginLink href={href} className="text-link underline" data-testid="log-record">
      {record.name}
    </OriginLink>
  ) : (
    <span>{record.name}</span>
  );
}

/**
 * The "Logs" tab: imports, verifications, publishing, generation, overrides and errors.
 * CD-F16 (Octavia, Oct 28): search by record name or ID, the person and the dates as well, all in
 * the address so Back returns to the same filtered log; each row names its record, the dates
 * before and after, and the rule with its version. CD-F15: Owners and Admins open the Audit Log.
 */
export function LogsTab() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { members } = useMembers();
  const search = params.get('logq') ?? '';
  const kind = KINDS.find((k) => k === params.get('event')) ?? '';
  const outcome = (['SUCCESS', 'FAILED', 'SKIPPED'] as const).find(
    (o) => o === params.get('result'),
  );
  const by = params.get('by') ?? '';
  const start = dayOf(params.get('start'));
  const end = dayOf(params.get('end'));
  const badDates = !!start && !!end && start > end;
  const page = Math.max(1, Number(params.get('logpage')) || 1);
  const [term, setTerm] = useState(search);
  /** One change to the address; page 1 unless set. Built from the address as it is now. */
  const go = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('logpage' in over)) next.delete('logpage');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const list = useApiQuery(
    [...COMPLIANCE_KEY, 'logs', kind, outcome, search, by, start, end, page],
    () =>
      api.compliance.logs({
        ...(kind ? { kind } : {}),
        ...(outcome ? { outcome } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(by ? { actorUserId: by } : {}),
        ...(start ? { from: start } : {}),
        ...(end && !badDates ? { to: end } : {}),
        page,
        pageSize: 10,
      }),
  );
  const columns: Column<ComplianceLog>[] = [
    {
      id: 'when',
      label: 'When',
      cell: (l) => <span className="whitespace-nowrap">{stamp(l.createdAt)}</span>,
    },
    { id: 'kind', label: 'Event', cell: (l) => cap(l.kind) },
    {
      id: 'outcome',
      label: 'Result',
      cell: (l) => <Badge tone={OUTCOME[l.outcome]}>{cap(l.outcome)}</Badge>,
    },
    { id: 'record', label: 'Record', cell: (l) => <RecordCell record={l.record} /> },
    {
      id: 'message',
      label: 'Details',
      cell: (l) => (
        <span className="flex flex-col gap-0.5">
          <span>{l.message ?? '—'}</span>
          {extraOf(l).map((x) => (
            <span key={x} className="text-sm text-muted">
              {x}
            </span>
          ))}
        </span>
      ),
    },
    { id: 'actor', label: 'By', cell: (l) => (l.actor ? shortName(l.actor.name) : 'System') },
  ];
  const filtered = !!(search || kind || outcome || by || start || end);
  return (
    <section
      className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
      aria-label="Logs"
      data-testid="logs-tab"
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <Input
            label="Search"
            hideLabel
            type="search"
            maxLength={100}
            placeholder="Search record name or ID, or text"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              go({ logq: e.target.value.trim() || null });
            }}
          />
        </div>
        <div className="w-40">
          <Selectbox
            label="Event"
            value={kind}
            onChange={(v) => go({ event: v })}
            options={[
              { value: '', label: 'All Events' },
              ...KINDS.map((k) => ({ value: k, label: cap(k) })),
            ]}
          />
        </div>
        <div className="w-36">
          <Selectbox
            label="Result"
            value={outcome ?? ''}
            onChange={(v) => go({ result: v })}
            options={[
              { value: '', label: 'All Results' },
              { value: 'SUCCESS', label: 'Success' },
              { value: 'FAILED', label: 'Failed' },
              { value: 'SKIPPED', label: 'Skipped' },
            ]}
          />
        </div>
        <div className="w-48">
          <Selectbox
            label="By"
            value={by}
            onChange={(v) => go({ by: v })}
            options={[
              { value: '', label: 'Anyone' },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
        </div>
        <div className="w-40">
          <Input
            label="From"
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => go({ start: e.target.value })}
          />
        </div>
        <div className="w-40">
          <Input
            label="To"
            type="date"
            value={end}
            min={start || undefined}
            error={badDates ? 'The end date is before the start date' : undefined}
            onChange={(e) => go({ end: e.target.value })}
          />
        </div>
        {filtered ? (
          <button
            type="button"
            className="min-h-10 text-sm font-medium text-link"
            onClick={() => {
              setTerm('');
              go({ logq: null, event: null, result: null, by: null, start: null, end: null });
            }}
          >
            Clear
          </button>
        ) : null}
        <RequireRole roles={['OWNER', 'ADMIN']}>
          <Link
            href={AUDIT_COMPLIANCE}
            className="ml-auto min-h-10 content-center text-sm font-medium text-link underline"
            data-testid="logs-audit-link"
          >
            Open the Audit Log for Compliance
          </Link>
        </RequireRole>
      </div>
      <p className="mb-2 text-sm text-muted">
        These are the module&apos;s own events. Every change to a deadline, its tasks and its
        reminders is also in the firm&apos;s Audit Log.
      </p>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(l) => l.id}
          caption="Compliance logs"
          dense
          noun="log entries"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Logs are not available' : 'No log entries'}
          emptyText={
            list.isError
              ? 'We could not load the logs. Try again in a moment.'
              : filtered
                ? 'Nothing matches these filters.'
                : 'Imports, publishing and overrides will be listed here.'
          }
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => go({ logpage: String(page + 1) }),
            onPrevious: () => go({ logpage: page > 2 ? String(page - 1) : null }),
            onPage: (next: number) => go({ logpage: next > 1 ? String(next) : null }),
            onSort: () => undefined,
          }}
        />
      </div>
    </section>
  );
}
