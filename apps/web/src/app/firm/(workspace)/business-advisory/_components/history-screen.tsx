'use client';

import {
  ADVISORY_HISTORY_AREA_LABELS,
  type AdvisoryHistoryArea,
  type AdvisoryHistoryEntry,
} from '@firmivra/types';
import { type Column, Table } from '@firmivra/ui';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { FilterSelect, serverPaging } from './ba-list-kit';
import { BaShell } from './ba-shell';
import { BA_KEY, BASE, card, DateTimeCell, SectionHead } from './ba-shared';

const SIZE = 25;

/** The periods offered, in days back from the start of today (local time). */
const PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
];

/** The start of the first day of the last `days` days, as an instant. */
const periodStart = (days: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString();
};

/**
 * Where a history entry opens: its plan; else its client's tab for its area; nothing for a
 * firm-wide change.
 */
export function historyHref(e: AdvisoryHistoryEntry): string | null {
  if (e.area === 'PLAN' && e.planId) return `${BASE}/plans/${e.planId}/edit`;
  const c = e.advisoryClient?.id;
  if (!c) return null;
  const tab: Partial<Record<AdvisoryHistoryArea, string>> = {
    PLAN: 'plan',
    GOAL: 'goals',
    FINANCIAL: 'financials',
    RECOMMENDATION: 'recommendations',
    ACTION: 'tasks',
    RESOURCE: 'portal',
  };
  const t = e.area ? tab[e.area] : undefined;
  return `${BASE}/clients/${c}${t ? `/${t}` : ''}`;
}

/**
 * /business-advisory/history (A-NEW2, Business Advisory Review Two): the module's View History.
 * Every advisory change across the clients the signed-in person reaches, newest first, by
 * client, area and period; each entry opens its record. What happened, by whom and when: never a
 * figure or a note (the client's own Activity Log is the same history for one client).
 */
export function AdvisoryHistory() {
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const [clientId, setClientId] = useState('');
  const [area, setArea] = useState('');
  const [period, setPeriod] = useState('');
  const [page, setPage] = useState(1);
  const from = period ? periodStart(Number(period)) : '';
  const q = useApiQuery([...BA_KEY, 'history', clientId, area, from, page], () =>
    api.advisory.history({
      ...(clientId ? { advisoryClientId: clientId } : {}),
      ...(area ? { area: area as AdvisoryHistoryArea } : {}),
      ...(from ? { from } : {}),
      page,
      pageSize: SIZE,
    }),
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };

  const cols: Column<AdvisoryHistoryEntry>[] = [
    {
      id: 'at',
      label: 'When',
      className: 'whitespace-nowrap',
      cell: (r) => <DateTimeCell iso={r.at} />,
    },
    {
      id: 'activity',
      label: 'Activity',
      cell: (r) => {
        const href = historyHref(r);
        return href ? (
          <Link
            href={href}
            className="font-semibold text-link hover:underline"
            data-testid="history-link"
          >
            {r.message}
          </Link>
        ) : (
          <span className="font-semibold text-heading">{r.message}</span>
        );
      },
    },
    {
      id: 'client',
      label: 'Client',
      cell: (r) =>
        r.advisoryClient ? (
          <Link href={`${BASE}/clients/${r.advisoryClient.id}`} className="hover:underline">
            {r.advisoryClient.name}
          </Link>
        ) : (
          'Firm-wide'
        ),
    },
    {
      id: 'area',
      label: 'Area',
      className: 'whitespace-nowrap',
      cell: (r) => (r.area ? ADVISORY_HISTORY_AREA_LABELS[r.area] : '—'),
    },
    { id: 'by', label: 'By', cell: (r) => r.actor?.name ?? 'System' },
  ];

  return (
    <BaShell>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="View history"
        data-testid="ba-history"
      >
        <SectionHead
          icon={ClockCounterClockwise}
          title="View History"
          subtitle="Every change in Business Advisory, by whom and when. Open an entry to see its record. Figures and notes are never shown here."
        />
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label="Client"
            all="All Clients"
            value={clientId}
            onChange={filter(setClientId)}
            options={(clients.data?.items ?? []).map((c) => ({
              value: c.id,
              label: c.client.name,
            }))}
          />
          <FilterSelect
            label="Area"
            all="All Areas"
            value={area}
            onChange={filter(setArea)}
            options={Object.entries(ADVISORY_HISTORY_AREA_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <FilterSelect
            label="Period"
            all="Any Time"
            value={period}
            onChange={filter(setPeriod)}
            options={PERIODS}
          />
        </div>
        <Table
          rows={q.data?.items ?? []}
          columns={cols}
          rowKey={(r) => r.id}
          caption="Business advisory history"
          dense
          noun="entries"
          pageSize={SIZE}
          loading={q.isPending}
          emptyTitle={q.isError ? 'History is not available' : 'No history'}
          emptyText={
            q.isError
              ? 'We could not load it. Try again in a moment.'
              : clientId || area || period
                ? 'Try another filter.'
                : 'Changes to advisory clients, plans, goals and the rest show here.'
          }
          server={serverPaging(q.data, SIZE, page, setPage)}
        />
      </section>
    </BaShell>
  );
}
