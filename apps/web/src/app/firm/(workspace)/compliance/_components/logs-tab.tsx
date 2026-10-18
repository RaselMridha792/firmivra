'use client';

import type { ComplianceLog } from '@firmivra/types';
import { Badge, type Column, Table } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { COMPLIANCE_KEY, Selectbox, shortName, stamp } from './compliance-shared';

const KINDS = ['IMPORT', 'VERIFY', 'PUBLISH', 'ROLLBACK', 'GENERATE', 'OVERRIDE', 'ERROR'] as const;
const OUTCOME = { SUCCESS: 'success', FAILED: 'danger', SKIPPED: 'neutral' } as const;
const cap = (v: string) => v.charAt(0) + v.slice(1).toLowerCase();

/** The "Logs" tab: imports, verifications, publishing, generation, overrides and errors. */
export function LogsTab() {
  const [kind, setKind] = useState('');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(1);
  const list = useApiQuery([...COMPLIANCE_KEY, 'logs', kind, outcome, page], () =>
    api.compliance.logs({
      ...(kind ? { kind: kind as ComplianceLog['kind'] } : {}),
      ...(outcome ? { outcome: outcome as ComplianceLog['outcome'] } : {}),
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
    { id: 'message', label: 'Details', cell: (l) => l.message ?? '—' },
    { id: 'actor', label: 'By', cell: (l) => (l.actor ? shortName(l.actor.name) : 'System') },
  ];
  return (
    <section
      className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
      aria-label="Logs"
      data-testid="logs-tab"
    >
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Selectbox
            label="Event"
            value={kind}
            onChange={(v) => {
              setKind(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All Events' },
              ...KINDS.map((k) => ({ value: k, label: cap(k) })),
            ]}
          />
        </div>
        <div className="w-44">
          <Selectbox
            label="Result"
            value={outcome}
            onChange={(v) => {
              setOutcome(v);
              setPage(1);
            }}
            options={[
              { value: '', label: 'All Results' },
              { value: 'SUCCESS', label: 'Success' },
              { value: 'FAILED', label: 'Failed' },
              { value: 'SKIPPED', label: 'Skipped' },
            ]}
          />
        </div>
      </div>
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
              : 'Imports, publishing and overrides will be listed here.'
          }
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (next: number) => setPage(next),
            onSort: () => undefined,
          }}
        />
      </div>
    </section>
  );
}
