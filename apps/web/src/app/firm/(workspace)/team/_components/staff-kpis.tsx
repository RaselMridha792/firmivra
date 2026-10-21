'use client';

import { IconTile, type KpiTone, Skeleton } from '@firmivra/ui';
import { ArrowUp, BuildingOffice, type Icon, User, Users } from '@phosphor-icons/react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { NOT_LOADED } from './quiet-card';

interface Kpi {
  id: string;
  label: string;
  icon: Icon;
  tone: KpiTone;
  value: number | undefined;
  /** "↑ 2" beside the number: added this month. */
  rise?: number;
  note: string;
  noteTone: string;
}

const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/**
 * The four summary cards (`api.staff.summary`): Total Staff with this month's additions, Active
 * Staff and Inactive Staff with their share, and Departments. The design sets the label above the
 * number (KpiCard sets it below), so the cards are drawn here with the kit's IconTile. A failed
 * call keeps every frame with a dash, and one quiet line under them offers Try again.
 */
export function StaffKpis() {
  const summary = useApiQuery(['staff', 'summary'], () => api.staff.summary());
  const s = summary.data;
  const failed = summary.isError && !s;
  const added = s?.addedThisMonth ?? 0;
  const cards: Kpi[] = [
    {
      id: 'total',
      label: 'Total Staff',
      icon: Users,
      tone: 'blue',
      value: s?.total,
      ...(added > 0 ? { rise: added } : {}),
      note: added > 0 ? `+${added} this month` : 'None added this month',
      noteTone: added > 0 ? 'text-success' : 'text-muted',
    },
    {
      id: 'active',
      label: 'Active Staff',
      icon: User,
      tone: 'green',
      value: s?.active,
      note: s ? `${share(s.active, s.total)}% active` : '',
      noteTone: 'text-success',
    },
    {
      id: 'inactive',
      label: 'Inactive Staff',
      icon: User,
      tone: 'grey',
      value: s?.inactive,
      note: s ? `${share(s.inactive, s.total)}% inactive` : '',
      noteTone: 'text-muted',
    },
    {
      id: 'departments',
      label: 'Departments',
      icon: BuildingOffice,
      tone: 'blue',
      value: s?.departments,
      note: 'Across your organization',
      noteTone: 'text-link',
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="staff-kpis">
        {cards.map((card) => (
          <section
            key={card.id}
            aria-label={card.label}
            data-testid={`kpi-${card.id}`}
            className="flex min-w-0 items-center gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
          >
            <IconTile icon={card.icon} tone={card.tone} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-sm font-semibold text-heading">{card.label}</h2>
              {summary.isPending ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="flex items-baseline gap-4">
                  {/* No number without data: a quiet dash, never an invented count. */}
                  <span data-testid="kpi-value" className="text-3xl font-bold text-heading">
                    {card.value ?? '—'}
                  </span>
                  {card.rise ? (
                    <span className="inline-flex items-center gap-1 text-xl font-semibold text-success">
                      <ArrowUp aria-hidden weight="bold" className="size-5" />
                      <span className="sr-only">up</span>
                      {card.rise}
                    </span>
                  ) : null}
                </p>
              )}
              {failed ? (
                <p className="text-sm text-muted">Not loaded</p>
              ) : s ? (
                <p className={`text-sm ${card.noteTone}`}>{card.note}</p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {NOT_LOADED}
          <button
            type="button"
            onClick={() => void summary.refetch()}
            className="min-h-9 font-semibold text-link hover:underline"
          >
            Try again
          </button>
        </p>
      ) : null}
    </div>
  );
}
