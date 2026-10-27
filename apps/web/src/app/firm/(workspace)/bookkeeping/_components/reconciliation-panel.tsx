'use client';

import type { BookkeepingClientWorkspace, BookkeepingReconciliation } from '@firmivra/types';
import { Select, Table, type Column } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BK_KEY, ReconPill, card, dayText, linkBtn, money } from './bookkeeping-shared';
import { ReconDialog } from './recon-parts';

type Row =
  | { kind: 'recon'; id: string; r: BookkeepingReconciliation }
  | { kind: 'todo'; id: string; name: string };

/**
 * The Reconciliation tab's first panel (BK-R01): each account's reconciliation for the chosen
 * period, opened on its own page, and Start for an account not reconciled yet.
 */
export function ReconciliationPanel({ w }: { w: BookkeepingClientWorkspace }) {
  const periods = useApiQuery([...BK_KEY, 'periods', w.id, 'all'], () =>
    api.bookkeeping.periods(w.id, { pageSize: 24 }),
  );
  const [chosen, setChosen] = useState<string>();
  const periodId = chosen ?? w.currentPeriod?.id ?? periods.data?.items[0]?.id;
  const pq = useApiQuery([...BK_KEY, 'period', periodId ?? 'none'], () =>
    periodId ? api.bookkeeping.getPeriod(periodId) : Promise.resolve(null),
  );
  const p = pq.data;
  const [starting, setStarting] = useState<string>();
  const closed = p?.status === 'CLOSED';
  const rows: Row[] = p
    ? [
        ...p.reconciliations.map((r) => ({ kind: 'recon' as const, id: r.id, r })),
        ...p.accountsWithoutReconciliation.map((a) => ({
          kind: 'todo' as const,
          id: a.id,
          name: a.name,
        })),
      ]
    : [];
  // On a phone the statement figures step aside; the difference, status and action stay.
  const columns: Column<Row>[] = [
    {
      id: 'account',
      label: 'Account',
      cell: (row) =>
        row.kind === 'recon' ? (
          <Link
            href={`/bookkeeping/reconciliations/${row.r.id}`}
            className="font-semibold text-link hover:underline"
          >
            {row.r.account.name}
            {row.r.account.mask ? ` ••${row.r.account.mask}` : ''}
          </Link>
        ) : (
          <span className="font-medium text-heading">{row.name}</span>
        ),
    },
    {
      id: 'statement',
      label: 'Statement',
      className: 'hidden md:table-cell',
      cell: (row) =>
        row.kind === 'recon'
          ? `${dayText(row.r.statementStart)} – ${dayText(row.r.statementEnd)}`
          : '—',
    },
    {
      id: 'ending',
      label: 'Ending',
      className: 'hidden md:table-cell',
      cell: (row) => (row.kind === 'recon' ? money(row.r.endingBalanceCents) : '—'),
    },
    {
      id: 'cleared',
      label: 'Cleared',
      className: 'hidden md:table-cell',
      cell: (row) => (row.kind === 'recon' ? money(row.r.clearedBalanceCents) : '—'),
    },
    {
      id: 'difference',
      label: 'Difference',
      cell: (row) =>
        row.kind === 'recon' ? (
          <span
            className={row.r.differenceCents === 0 ? 'text-success' : 'font-medium text-danger'}
          >
            {money(row.r.differenceCents)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      label: 'Status',
      cell: (row) =>
        row.kind === 'recon' ? (
          <ReconPill status={row.r.status} />
        ) : (
          <span className="text-sm text-muted">Not started</span>
        ),
    },
    {
      id: 'action',
      label: 'Action',
      cell: (row) =>
        row.kind === 'recon' ? (
          <Link href={`/bookkeeping/reconciliations/${row.r.id}`} className={linkBtn}>
            Open
          </Link>
        ) : closed ? (
          '—'
        ) : (
          <button
            type="button"
            className={linkBtn}
            aria-label={`Start reconciling ${row.name}`}
            onClick={() => setStarting(row.id)}
          >
            Start
          </button>
        ),
    },
  ];
  const options = periods.data?.items ?? [];
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label="Account reconciliations"
      data-testid="reconciliation-panel"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-heading">Reconciliation</h2>
          <p className="text-xs text-muted">
            Each account is reconciled to its statement; the difference must be zero to approve.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {options.length ? (
            <Select
              label="Period"
              value={periodId ?? ''}
              onChange={(e) => setChosen(e.target.value)}
              options={options.map((o) => ({ value: o.id, label: o.label }))}
            />
          ) : null}
          {p ? (
            <Link href={`/bookkeeping/periods/${p.id}`} className={linkBtn}>
              Close Checklist
            </Link>
          ) : null}
        </div>
      </div>
      {closed ? <p className="text-sm text-muted">This period is closed and locked.</p> : null}
      <Table
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        caption="Account reconciliations"
        dense
        noun="accounts"
        pageSize={12}
        loading={periods.isPending || (!!periodId && pq.isPending)}
        keepHeaderWhenEmpty
        emptyTitle={
          periods.isError || pq.isError
            ? 'Reconciliations are not available'
            : !periodId
              ? 'No period yet'
              : 'No accounts to reconcile'
        }
        emptyText={
          periods.isError || pq.isError
            ? 'We could not load the reconciliations. Try again in a moment.'
            : !periodId
              ? 'Add a period below to start reconciling.'
              : 'Connect accounting software or add an account in Settings.'
        }
      />
      {starting && p ? (
        <ReconDialog p={p} accountId={starting} onClose={() => setStarting(undefined)} />
      ) : null}
    </section>
  );
}
