'use client';

import type { ClientsSummary } from '@firmivra/types';
import { KpiCard, type KpiTone } from '@firmivra/ui';
import {
  Archive,
  CheckCircle,
  CurrencyDollar,
  FileText,
  type Icon,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { monthTrend } from './list-parts';

/**
 * The kit card made as compact as clients.jpg draws it at 1440 px: a 48 px tile and the label on
 * one line in 12 px, so six cards fit beside each other. Top-aligned, so a card without a trend
 * keeps its number on the same line as its neighbours'.
 */
const fit =
  'grid [&>div]:h-full [&>div]:!items-start [&>div]:!gap-3 [&>div]:!p-3 [&>div>span]:!size-12 [&>div>span>svg]:!size-7 [&>div>div>span:nth-child(2)]:!text-xs [&>div>div>span:nth-child(2)]:whitespace-nowrap';

const CARDS: {
  key: keyof ClientsSummary['kpis'];
  label: string;
  icon: Icon;
  tone: KpiTone;
  /** The tab the card opens; the API has no filter for documents owed or balances. */
  tab?: string;
}[] = [
  { key: 'totalClients', label: 'Total Clients', icon: UsersThree, tone: 'blue', tab: 'all' },
  { key: 'newClients', label: 'New Clients', icon: UserPlus, tone: 'purple', tab: 'new' },
  {
    key: 'activeClients',
    label: 'Active Clients',
    icon: CheckCircle,
    tone: 'green',
    tab: 'active',
  },
  { key: 'pendingDocuments', label: 'Pending Documents', icon: FileText, tone: 'amber' },
  { key: 'balancesDue', label: 'Balances Due', icon: CurrencyDollar, tone: 'red' },
  {
    key: 'inactiveClients',
    label: 'Inactive Clients',
    icon: Archive,
    tone: 'grey',
    tab: 'inactive',
  },
];

/**
 * The six cards of clients.jpg from GET /business/clients/summary. Without data (loading, or the
 * API unreachable) each card keeps its frame with "—"; the trend shows only where the API gives
 * last month's number.
 */
export function ClientsKpis({
  summary,
  onTab,
}: {
  summary: UseQueryResult<ClientsSummary>;
  onTab: (tab: string) => void;
}) {
  return (
    <section
      aria-label="Client summary"
      data-testid="client-kpis"
      className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      {CARDS.map(({ key, label, icon, tone, tab }) => {
        const kpi = summary.data?.kpis[key];
        const trend = kpi ? monthTrend(kpi) : undefined;
        const card = (
          <KpiCard
            icon={icon}
            tone={tone}
            label={label}
            loading={summary.isPending}
            value={kpi ? kpi.value.toLocaleString('en-US') : '—'}
            trend={trend}
            note={trend ? 'vs last month' : undefined}
          />
        );
        return tab ? (
          <button
            key={key}
            type="button"
            data-testid="kpi-card"
            onClick={() => onTab(tab)}
            className={`${fit} rounded-xl text-left hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus`}
          >
            {card}
          </button>
        ) : (
          <div key={key} data-testid="kpi-card" className={fit}>
            {card}
          </div>
        );
      })}
    </section>
  );
}
