'use client';

import { IconTile, type KpiTone, Skeleton } from '@firmivra/ui';
import { Buildings, type Icon, UserCheck, UsersFour, UsersThree } from '@phosphor-icons/react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { GROUPS } from './groups-shared';

/**
 * The four counts above the tabs: Total Departments, Total Teams, Total Staff, Active Staff with
 * its share. The design sets the label above the number (KpiCard sets it below), so the cards are
 * drawn here with the kit's IconTile.
 */
export function GroupsKpis() {
  const summary = useApiQuery([...GROUPS, 'summary'], () => api.departments.summary());
  const s = summary.data;
  const share = s && s.staff > 0 ? `${Math.round((s.activeStaff / s.staff) * 100)}% active` : '';
  const cards: [string, Icon, KpiTone, number | undefined, string?][] = [
    ['Total Departments', Buildings, 'blue', s?.departments],
    ['Total Teams', UsersFour, 'blue', s?.teams],
    ['Total Staff', UsersThree, 'blue', s?.staff],
    ['Active Staff', UserCheck, 'green', s?.activeStaff, share],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="groups-kpis">
      {cards.map(([label, icon, tone, value, note]) => (
        <div
          key={label}
          className="flex items-center gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <IconTile icon={icon} tone={tone} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-medium text-text">{label}</span>
            {summary.isPending ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <span className="flex items-baseline gap-3">
                {/* No number without data: a quiet dash, never an invented count. */}
                <span className="text-3xl leading-none font-bold text-heading">{value ?? '—'}</span>
                {note ? <span className="text-sm font-semibold text-success">{note}</span> : null}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
