'use client';

import type { BookkeepingReportRow } from '@firmivra/types';
import { Select, Table, Toast } from '@firmivra/ui';
import { MagnifyingGlass } from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import type { Notice } from './bookkeeping-actions';
import { BK_KEY, REPORT_LABEL, card } from './bookkeeping-shared';
import { ReportMenu } from './report-actions';
import { reportColumns } from './workspace-tabs';

const TABS = [
  { id: 'all', label: 'All Reports' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** /bookkeeping/reports: every bookkeeping report of the firm, with its review state. */
export function ReportsScreen() {
  const [tab, setTab] = useState<TabId>('all');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const term = useDeferredValue(search.trim());
  const list = useApiQuery([...BK_KEY, 'reports', tab, status, term, page], () =>
    api.bookkeeping.reports({
      ...(tab === 'upcoming' ? { upcoming: 'true' as const } : {}),
      ...(tab === 'overdue' ? { overdue: 'true' as const } : {}),
      ...(status ? { status: status as BookkeepingReportRow['status'] } : {}),
      ...(term ? { search: term } : {}),
      page,
      pageSize: 10,
    }),
  );
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="bk-reports-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-link">
        <Link href="/bookkeeping">Bookkeeping</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Reports</span>
      </nav>
      <h1 className="font-display text-3xl font-bold text-heading">Bookkeeping Reports</h1>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section className={`${card} flex flex-col gap-3`} aria-label="Reports">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Report views"
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
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus sm:w-56 sm:flex-none">
              <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
              <span className="sr-only">Search reports</span>
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search reports..."
                className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
              />
            </label>
            <div className="w-40">
              <Select
                label="Status"
                hideLabel
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All Statuses' },
                  ...Object.entries(REPORT_LABEL).map(([value, label]) => ({ value, label })),
                ]}
              />
            </div>
          </div>
        </div>
        <div className="relative">
          <Table
            rows={list.data?.items ?? []}
            columns={reportColumns(true)}
            rowKey={(r) => r.id}
            caption="Bookkeeping reports"
            dense
            noun="reports"
            pageSize={10}
            loading={list.isPending}
            emptyTitle={list.isError ? 'Reports are not available' : 'No reports match'}
            emptyText={
              list.isError
                ? 'We could not load the reports. Try again in a moment.'
                : 'Reports appear here as periods are worked.'
            }
            rowActions={(r) => <ReportMenu row={r} engagementId={null} onNotice={notice} />}
            server={{
              page: list.data?.page ?? 1,
              total: list.data?.total ?? 0,
              hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
              hasPrevious: (list.data?.page ?? 1) > 1,
              onNext: () => setPage(page + 1),
              onPrevious: () => setPage(Math.max(1, page - 1)),
              onPage: (n: number) => setPage(n),
              onSort: () => undefined,
            }}
          />
        </div>
      </section>
    </div>
  );
}
