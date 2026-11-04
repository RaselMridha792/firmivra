'use client';

import type { RecentReportRow, ReportScheduleRow, SavedReportRow } from '@firmivra/types';
import { ActionMenu, Checkbox, Select, Table, Toast, type Column } from '@firmivra/ui';
import { DotsThreeVertical, MagnifyingGlass, Star } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { withOrigin } from '../../../../../lib/origin';
import { useApiQuery } from '../../../../../lib/query';
import { ScheduleReportDialog } from './report-dialogs';
import {
  CATEGORY_META,
  CategoryTile,
  EXPORT_ERRORS,
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

// RP-F12 (Octavia, Oct 28): each tab's sort, as the API takes it ("field:direction").
const SORTS: Record<TabId, { value: string; label: string }[]> = {
  recent: [
    { value: 'at:desc', label: 'Newest First' },
    { value: 'at:asc', label: 'Oldest First' },
    { value: 'name:asc', label: 'Name A–Z' },
    { value: 'name:desc', label: 'Name Z–A' },
    { value: 'category:asc', label: 'Category' },
  ],
  saved: [
    { value: 'updatedAt:desc', label: 'Recently Changed' },
    { value: 'updatedAt:asc', label: 'Least Recently Changed' },
    { value: 'name:asc', label: 'Name A–Z' },
    { value: 'name:desc', label: 'Name Z–A' },
  ],
  scheduled: [],
};
const PAGE = 10;

/**
 * /reports/library: every recent, saved and scheduled report, with their actions. Its tab, page,
 * search, filters and sort live in the address (RP-F03, F12), so a report opened from here comes
 * back to the same place, by the page's Back and by the browser's.
 */
export function ReportsLibrary() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'recent') as TabId;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const search = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort =
    SORTS[tab].find((s) => s.value === params.get('sort'))?.value ?? SORTS[tab][0]?.value;
  const show = params.get('show') ?? '';
  const archived = params.get('archived') === '1';
  const [term, setTerm] = useState(search);
  const query = useDeferredValue(search);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [schedule, setSchedule] = useState<SavedReportRow>();
  const here = `${pathname}?${params.toString()}`;
  /** Changes the address in place; any change but the page goes back to page 1. */
  const set = (over: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(over)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in over)) next.delete('page');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      await qc.invalidateQueries({ queryKey: [...RP_KEY] });
      setMessage({ text: done, tone: 'success' });
    } catch (e) {
      setMessage({ text: errorMessage(e, RP_ERRORS), tone: 'error' });
    }
  };
  const [sortField, direction] = (sort ?? '').split(':') as [string, 'asc' | 'desc'];
  const recent = useApiQuery([...RP_KEY, 'lib-recent', page, query, category, sort, show], () =>
    api.reports.recent({
      page,
      pageSize: PAGE,
      ...(query ? { search: query } : {}),
      ...(category ? { category: category as never } : {}),
      ...(show ? { kind: show as never } : {}),
      sort: sortField as never,
      direction,
    }),
  );
  const saved = useApiQuery(
    [...RP_KEY, 'lib-saved', page, query, category, sort, show, archived],
    () =>
      api.reports.saved({
        page,
        pageSize: PAGE,
        ...(query ? { search: query } : {}),
        ...(category ? { category: category as never } : {}),
        tab: (show || 'all') as never,
        includeArchived: archived,
        sort: sortField as never,
        direction,
      }),
  );
  const scheduled = useApiQuery([...RP_KEY, 'lib-scheduled', page, query, show], () =>
    api.reports.schedules({
      page,
      pageSize: PAGE,
      ...(query ? { search: query } : {}),
      status: (show || 'all') as never,
    }),
  );
  const cur = tab === 'recent' ? recent : tab === 'saved' ? saved : scheduled;
  const open = (href: string) => withOrigin(href, here);
  const nameCell = (name: string, category: string, href?: string) => (
    <span className="flex items-center gap-2">
      <CategoryTile category={category} size="sm" />
      {href ? (
        <Link
          href={open(href)}
          data-testid="lib-link"
          className="font-medium text-link hover:underline"
        >
          {name}
        </Link>
      ) : (
        <span className="font-medium text-heading">{name}</span>
      )}
    </span>
  );
  const cat = (c: string) => CATEGORY_META[c]?.label ?? c;
  const recentHref = (r: RecentReportRow) =>
    r.savedReportId
      ? `/reports/${r.savedReportId}`
      : r.systemKey
        ? `/reports/${r.systemKey}`
        : undefined;
  const recentCols: Column<RecentReportRow>[] = [
    { id: 'name', label: 'Report', cell: (r) => nameCell(r.name, r.category, recentHref(r)) },
    { id: 'cat', label: 'Category', cell: (r) => cat(r.category) },
    { id: 'owner', label: 'Owner', cell: (r) => r.owner?.name ?? 'Built-in' },
    { id: 'status', label: 'Status', cell: (r) => (r.saved ? 'Saved' : 'Not saved') },
    { id: 'kind', label: 'Opened as', cell: (r) => r.kind.toLowerCase() },
    { id: 'at', label: 'When', cell: (r) => dateTimeText(r.at) },
  ];
  const savedCols: Column<SavedReportRow>[] = [
    { id: 'name', label: 'Report', cell: (r) => nameCell(r.name, r.category, `/reports/${r.id}`) },
    { id: 'cat', label: 'Category', cell: (r) => cat(r.category) },
    { id: 'owner', label: 'Owner', cell: (r) => r.owner.name },
    {
      id: 'vis',
      label: 'Shared',
      cell: (r) =>
        ({ PRIVATE: 'Only me', SELECTED: 'Selected people', COMPANY: 'Everyone' })[r.visibility],
    },
    { id: 'status', label: 'Status', cell: (r) => (r.archived ? 'Archived' : 'Active') },
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
  /** Export a saved report as CSV from its row, as its page does. */
  const exportCsv = async (r: SavedReportRow) => {
    try {
      let v = await api.reports.exportReport({
        run: { target: { kind: 'SAVED', id: r.id } },
        format: 'CSV',
      });
      for (let i = 0; !v.ready && v.status !== 'FAILED' && i < 10; i += 1) {
        await new Promise((done) => setTimeout(done, 1000));
        v = await api.reports.runStatus(v.runId);
      }
      if (!v.ready) {
        setMessage({ text: 'The export could not be made. Try again in a moment.', tone: 'error' });
        return;
      }
      const link = await api.reports.download(v.runId);
      setMessage({ text: `Export ready: ${v.fileName ?? 'report'}.`, tone: 'success' });
      const save = document.createElement('a');
      save.href = link.url;
      save.download = v.fileName ?? '';
      save.rel = 'noopener';
      save.click();
    } catch (e) {
      setMessage({ text: errorMessage(e, { ...RP_ERRORS, ...EXPORT_ERRORS }), tone: 'error' });
    }
  };
  const total = cur.data?.total ?? 0;
  const server = {
    page: cur.data?.page ?? 1,
    total,
    hasNext: (cur.data?.page ?? 1) * PAGE < total,
    hasPrevious: (cur.data?.page ?? 1) > 1,
    onNext: () => set({ page: String(page + 1) }),
    onPrevious: () => set({ page: String(Math.max(1, page - 1)) }),
    onPage: (n: number) => set({ page: String(n) }),
    onSort: () => undefined,
  };
  const filtered = !!(query || category || show || archived);
  const empty = filtered
    ? 'No reports match these filters'
    : {
        recent: 'No reports opened yet',
        saved: 'No saved reports yet',
        scheduled: 'No scheduled reports',
      }[tab];
  const showOptions = {
    recent: [
      { value: '', label: 'All Kinds' },
      { value: 'VIEW', label: 'Viewed' },
      { value: 'EXPORT', label: 'Exported' },
      { value: 'SCHEDULED', label: 'Scheduled' },
    ],
    saved: [
      { value: '', label: 'All Reports' },
      { value: 'mine', label: 'Mine' },
      { value: 'shared', label: 'Shared With Me' },
      { value: 'favorites', label: 'Favorites' },
    ],
    scheduled: [
      { value: '', label: 'All Schedules' },
      { value: 'active', label: 'Active' },
      { value: 'paused', label: 'Paused' },
    ],
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
                setTerm('');
                set({ tab: t.id, q: null, category: null, sort: null, show: null, archived: null });
              }}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div
          className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
          data-testid="library-filters"
        >
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-heading">
            Search
            <span className="flex h-10 items-center gap-2 rounded-control border border-border bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
              <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
              <input
                type="search"
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  set({ q: e.target.value.trim() || null });
                }}
                placeholder="Search by name..."
                className="w-full bg-transparent text-sm font-normal text-text outline-none placeholder:text-muted"
              />
            </span>
          </label>
          {tab === 'scheduled' ? null : (
            <Select
              label="Category"
              value={category}
              onChange={(e) => set({ category: e.target.value })}
              options={[
                { value: '', label: 'All Categories' },
                ...Object.entries(CATEGORY_META).map(([value, m]) => ({ value, label: m.label })),
              ]}
            />
          )}
          <Select
            label={tab === 'recent' ? 'Opened As' : tab === 'saved' ? 'Show' : 'Status'}
            value={show}
            onChange={(e) => set({ show: e.target.value })}
            options={showOptions}
          />
          {SORTS[tab].length ? (
            <Select
              label="Sort By"
              value={sort ?? ''}
              onChange={(e) => set({ sort: e.target.value })}
              options={SORTS[tab]}
            />
          ) : null}
        </div>
        {tab === 'saved' ? (
          <Checkbox
            label="Show archived reports"
            checked={archived}
            onChange={(e) => set({ archived: e.target.checked ? '1' : null })}
          />
        ) : null}
        <div className="relative">
          {tab === 'recent' ? (
            <Table
              rows={recent.data?.items ?? []}
              columns={recentCols}
              rowKey={(r) => r.runId}
              caption="Recent reports"
              dense
              noun="reports"
              pageSize={PAGE}
              loading={recent.isPending}
              emptyTitle={recent.isError ? 'Reports are not available' : empty}
              emptyText={
                filtered ? 'Change the search or filters.' : 'Reports you open appear here.'
              }
              rowActions={(r) =>
                recentHref(r) ? (
                  <ActionMenu
                    label={`Actions for ${r.name}`}
                    trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
                    align="right"
                    sections={[
                      {
                        items: [
                          { label: 'View', onSelect: () => router.push(open(recentHref(r)!)) },
                        ],
                      },
                    ]}
                  />
                ) : null
              }
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
              pageSize={PAGE}
              loading={saved.isPending}
              emptyTitle={saved.isError ? 'Reports are not available' : empty}
              emptyText={
                filtered
                  ? 'Change the search or filters.'
                  : 'Save a report from its page to find it here.'
              }
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
                        // RP-F12: only what the caller may do on this report.
                        items: [
                          { label: 'View', onSelect: () => router.push(open(`/reports/${r.id}`)) },
                          {
                            label: 'Duplicate',
                            onSelect: () =>
                              void act(() => api.reports.duplicateSaved(r.id), 'Duplicated.'),
                          },
                          ...(r.archived
                            ? []
                            : [
                                { label: 'Schedule', onSelect: () => setSchedule(r) },
                                { label: 'Export CSV', onSelect: () => void exportCsv(r) },
                              ]),
                          ...(!r.canEdit
                            ? []
                            : r.archived
                              ? [
                                  {
                                    label: 'Restore',
                                    onSelect: () =>
                                      void act(() => api.reports.restoreSaved(r.id), 'Restored.'),
                                  },
                                ]
                              : [
                                  {
                                    label: 'Archive',
                                    danger: true,
                                    onSelect: () =>
                                      void act(() => api.reports.archiveSaved(r.id), 'Archived.'),
                                  },
                                ]),
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
              pageSize={PAGE}
              loading={scheduled.isPending}
              emptyTitle={scheduled.isError ? 'Schedules are not available' : empty}
              emptyText={
                filtered
                  ? 'Change the search or filters.'
                  : 'Schedule a report from its page to send it automatically.'
              }
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
      {schedule ? (
        <ScheduleReportDialog
          target={{ kind: 'SAVED', id: schedule.id }}
          defaultName={`${schedule.name} schedule`}
          onClose={() => setSchedule(undefined)}
          onNotice={(text, tone) => setMessage({ text, tone })}
        />
      ) : null}
    </div>
  );
}
