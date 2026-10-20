'use client';

import type { RecentReportRow, ReportScheduleRow, SavedReportRow } from '@firmivra/types';
import { ActionMenu, Table, Toast, type Column } from '@firmivra/ui';
import { DotsThreeVertical, Star } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  CATEGORY_META,
  CategoryTile,
  RP_ERRORS,
  RP_KEY,
  card,
  dateTimeText,
} from './reports-shared';

const TABS = [
  { id: 'recent', label: 'Recent Reports' },
  { id: 'saved', label: 'Saved Reports' },
  { id: 'scheduled', label: 'Scheduled Reports' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** /reports/library: every recent, saved and scheduled report, with their actions. */
export function ReportsLibrary() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabId>(
    (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'recent') as TabId,
  );
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      await qc.invalidateQueries({ queryKey: [...RP_KEY] });
      setMessage({ text: done, tone: 'success' });
    } catch (e) {
      setMessage({ text: errorMessage(e, RP_ERRORS), tone: 'error' });
    }
  };
  const recent = useApiQuery([...RP_KEY, 'lib-recent', page], () =>
    api.reports.recent({ page, pageSize: 10 }),
  );
  const saved = useApiQuery([...RP_KEY, 'lib-saved', page], () =>
    api.reports.saved({ page, pageSize: 10 }),
  );
  const scheduled = useApiQuery([...RP_KEY, 'lib-scheduled', page], () =>
    api.reports.schedules({ page, pageSize: 10 }),
  );
  const cur = tab === 'recent' ? recent : tab === 'saved' ? saved : scheduled;
  const nameCell = (name: string, category: string, href?: string) => (
    <span className="flex items-center gap-2">
      <CategoryTile category={category} size="sm" />
      {href ? (
        <Link href={href} data-testid="lib-link" className="font-medium text-link hover:underline">
          {name}
        </Link>
      ) : (
        <span className="font-medium text-heading">{name}</span>
      )}
    </span>
  );
  const cat = (c: string) => CATEGORY_META[c]?.label ?? c;
  const recentCols: Column<RecentReportRow>[] = [
    {
      id: 'name',
      label: 'Report',
      cell: (r) =>
        nameCell(
          r.name,
          r.category,
          r.savedReportId ? `/reports/${r.savedReportId}` : `/reports/${r.systemKey ?? ''}`,
        ),
    },
    { id: 'cat', label: 'Category', cell: (r) => cat(r.category) },
    { id: 'kind', label: 'Opened as', cell: (r) => r.kind.toLowerCase() },
    { id: 'at', label: 'When', cell: (r) => dateTimeText(r.at) },
  ];
  const savedCols: Column<SavedReportRow>[] = [
    { id: 'name', label: 'Report', cell: (r) => nameCell(r.name, r.category, `/reports/${r.id}`) },
    { id: 'cat', label: 'Category', cell: (r) => cat(r.category) },
    {
      id: 'vis',
      label: 'Shared',
      cell: (r) =>
        ({ PRIVATE: 'Only me', SELECTED: 'Selected people', COMPANY: 'Everyone' })[r.visibility],
    },
    { id: 'sched', label: 'Schedules', cell: (r) => r.scheduleCount },
    { id: 'upd', label: 'Updated', cell: (r) => dateTimeText(r.updatedAt) },
  ];
  const schedCols: Column<ReportScheduleRow>[] = [
    { id: 'name', label: 'Schedule', cell: (r) => nameCell(r.name, r.category) },
    { id: 'rep', label: 'Report', cell: (r) => r.reportName },
    { id: 'when', label: 'When', cell: (r) => r.description },
    {
      id: 'next',
      label: 'Next run',
      cell: (r) => (r.nextRunAt && r.active ? dateTimeText(r.nextRunAt) : 'Paused'),
    },
    { id: 'rec', label: 'Recipients', cell: (r) => r.recipientCount },
  ];
  const total = cur.data?.total ?? 0;
  const server = {
    page: cur.data?.page ?? 1,
    total,
    hasNext: (cur.data?.page ?? 1) * 10 < total,
    hasPrevious: (cur.data?.page ?? 1) > 1,
    onNext: () => setPage(page + 1),
    onPrevious: () => setPage(Math.max(1, page - 1)),
    onPage: (n: number) => setPage(n),
    onSort: () => undefined,
  };
  const empty = {
    recent: 'No reports opened yet',
    saved: 'No saved reports yet',
    scheduled: 'No scheduled reports',
  }[tab];
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="reports-library">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-link">
        <Link href="/reports">Reports</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Library</span>
      </nav>
      <h1 className="font-display text-3xl font-bold text-heading">Report Library</h1>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section className={`${card} flex flex-col gap-3`} aria-label="Reports">
        <div
          role="tablist"
          aria-label="Report library"
          className="relative flex overflow-x-auto border-b border-divider"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setPage(1);
              }}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative">
          {tab === 'recent' ? (
            <Table
              rows={recent.data?.items ?? []}
              columns={recentCols}
              rowKey={(r) => r.runId}
              caption="Recent reports"
              dense
              noun="reports"
              pageSize={10}
              loading={recent.isPending}
              emptyTitle={recent.isError ? 'Reports are not available' : empty}
              emptyText="Reports you open appear here."
              server={server}
            />
          ) : tab === 'saved' ? (
            <Table
              rows={saved.data?.items ?? []}
              columns={savedCols}
              rowKey={(r) => r.id}
              caption="Saved reports"
              dense
              noun="reports"
              pageSize={10}
              loading={saved.isPending}
              emptyTitle={saved.isError ? 'Reports are not available' : empty}
              emptyText="Save a report from its page to find it here."
              rowActions={(r) => (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={
                      r.favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`
                    }
                    onClick={() =>
                      void act(
                        () =>
                          r.favorite ? api.reports.unfavorite(r.id) : api.reports.favorite(r.id),
                        r.favorite ? 'Removed from favorites.' : 'Added to favorites.',
                      )
                    }
                    className="flex size-8 items-center justify-center rounded-control hover:bg-canvas"
                  >
                    <Star
                      aria-hidden
                      weight={r.favorite ? 'fill' : 'regular'}
                      className={`size-4 ${r.favorite ? 'text-gold' : 'text-muted'}`}
                    />
                  </button>
                  <ActionMenu
                    label={`Actions for ${r.name}`}
                    trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                    align="right"
                    sections={[
                      {
                        items: [
                          {
                            label: 'Open',
                            onSelect: () => router.push(`/reports/${r.id}`),
                          },
                          {
                            label: 'Duplicate',
                            onSelect: () =>
                              void act(() => api.reports.duplicateSaved(r.id), 'Duplicated.'),
                          },
                          {
                            label: 'Archive',
                            danger: true,
                            onSelect: () =>
                              void act(() => api.reports.archiveSaved(r.id), 'Archived.'),
                          },
                        ],
                      },
                    ]}
                  />
                </span>
              )}
              server={server}
            />
          ) : (
            <Table
              rows={scheduled.data?.items ?? []}
              columns={schedCols}
              rowKey={(r) => r.id}
              caption="Scheduled reports"
              dense
              noun="schedules"
              pageSize={10}
              loading={scheduled.isPending}
              emptyTitle={scheduled.isError ? 'Schedules are not available' : empty}
              emptyText="Schedule a report from its page to send it automatically."
              rowActions={(r) => (
                <ActionMenu
                  label={`Actions for ${r.name}`}
                  trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                  align="right"
                  sections={[
                    {
                      items: [
                        {
                          label: 'Run Now',
                          onSelect: () =>
                            void act(() => api.reports.runScheduleNow(r.id), 'Report run.'),
                        },
                        r.active
                          ? {
                              label: 'Pause',
                              onSelect: () =>
                                void act(() => api.reports.pauseSchedule(r.id), 'Paused.'),
                            }
                          : {
                              label: 'Resume',
                              onSelect: () =>
                                void act(() => api.reports.resumeSchedule(r.id), 'Resumed.'),
                            },
                        {
                          label: 'Duplicate',
                          onSelect: () =>
                            void act(() => api.reports.duplicateSchedule(r.id), 'Duplicated.'),
                        },
                        {
                          label: 'Delete',
                          danger: true,
                          onSelect: () =>
                            void act(() => api.reports.deleteSchedule(r.id), 'Deleted.'),
                        },
                      ],
                    },
                  ]}
                />
              )}
              server={server}
            />
          )}
        </div>
      </section>
    </div>
  );
}
