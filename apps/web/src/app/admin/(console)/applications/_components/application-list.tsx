'use client';

import {
  ENTITY_TYPES,
  FIRM_PLANS,
  FIRM_SERVICES,
  PRACTICE_TYPES,
  type FirmApplicationReviewStatus,
  type ListFirmApplicationsQuery,
} from '@firmivra/types';
import { Button, Card, Input } from '@firmivra/ui';
import { useState } from 'react';
import Link from 'next/link';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { applicationCountsKey, applicationListKey } from './application-data';
import {
  ApplicationPageState,
  dateParts,
  MetricCards,
  NoApplicationPermission,
  StatusPill,
} from './application-ui';

type Tab = 'all' | FirmApplicationReviewStatus;
type DateRange = 'all' | '7' | '30' | 'month';
type StatusFilter = '' | FirmApplicationReviewStatus;
const tabs: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All Applications' },
  { id: 'PENDING_REVIEW', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'DECLINED', label: 'Declined' },
];
const statuses: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING_REVIEW', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DECLINED', label: 'Declined' },
];
const pageSize = 5;

function rangeBounds(value: DateRange): Pick<ListFirmApplicationsQuery, 'from' | 'to'> {
  if (value === 'all') return {};
  const today = new Date();
  const start =
    value === 'month'
      ? new Date(today.getFullYear(), today.getMonth(), 1)
      : new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(value) + 1);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export function ApplicationList() {
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [dates, setDates] = useState<Pick<ListFirmApplicationsQuery, 'from' | 'to'>>({});
  const [page, setPage] = useState(1);
  const counts = useApiQuery(applicationCountsKey, () => api.firmApplications.counts());
  const query: ListFirmApplicationsQuery = {
    page,
    pageSize,
    order: 'newest',
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(statusFilter || (tab === 'all' ? undefined : tab)
      ? { status: statusFilter || (tab === 'all' ? undefined : tab) }
      : {}),
    ...dates,
  };
  const applications = useApiQuery(applicationListKey(query), () =>
    api.firmApplications.list(query),
  );
  const count = counts.data;
  const pageCount = Math.max(1, Math.ceil((applications.data?.total ?? 0) / pageSize));
  const currentPage = Math.min(page, pageCount);
  const first = applications.data?.total ? (currentPage - 1) * pageSize + 1 : 0;
  const last = Math.min(currentPage * pageSize, applications.data?.total ?? 0);

  if (!me.platformAdmin) return <NoApplicationPermission />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <header>
        <h1
          data-testid="page-title"
          className="font-serif text-4xl font-semibold tracking-tight text-text"
        >
          Firm Applications
        </h1>
        <p className="mt-2 text-muted">
          Review and manage new firm applications. Approve firms to activate their accounts.
        </p>
      </header>

      <ApplicationPageState query={counts}>
        {(data) => <MetricCards counts={data} />}
      </ApplicationPageState>

      <Card className="!p-0" aria-label="Applications">
        <div
          role="tablist"
          aria-label="Application status"
          className="flex gap-5 overflow-x-auto border-b border-border px-5"
        >
          {tabs.map(({ id, label }) => {
            const value =
              id === 'all'
                ? count?.all
                : id === 'PENDING_REVIEW'
                  ? count?.pendingReview
                  : id === 'APPROVED'
                    ? count?.approved
                    : count?.declined;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === tab}
                onClick={() => {
                  setTab(id);
                  setStatusFilter('');
                  setPage(1);
                }}
                className={`shrink-0 border-b-2 px-1 py-4 text-sm ${id === tab ? 'border-brand-700 font-semibold text-brand-700' : 'border-transparent text-muted'}`}
              >
                {label} ({value ?? '…'})
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 border-b border-border p-5 md:grid-cols-3">
          <Input
            label="Search applications"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Business name, owner, or email"
          />
          <label className="flex flex-col gap-1 text-sm font-medium text-text">
            Status
            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter);
                setTab('all');
                setPage(1);
              }}
              className="h-10 rounded-control border border-border bg-surface px-3 text-base font-normal"
            >
              {statuses.map(({ value, label }) => (
                <option key={value || 'all'} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-text">
            Date range
            <select
              aria-label="Filter by date range"
              value={dateRange}
              onChange={(event) => {
                const value = event.target.value as DateRange;
                setDateRange(value);
                setDates(rangeBounds(value));
                setPage(1);
              }}
              className="h-10 rounded-control border border-border bg-surface px-3 text-base font-normal"
            >
              <option value="all">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="month">This month</option>
            </select>
          </label>
        </div>

        <ApplicationPageState
          query={applications}
          empty="No applications match these filters."
          isEmpty={(data) => data.total === 0}
        >
          {(data) => (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-5xl table-fixed text-left text-xs">
                  <thead className="bg-canvas">
                    <tr>
                      {[
                        'Business name',
                        'Business type',
                        'Owner / contact',
                        'Email',
                        'Services',
                        'Requested plan',
                        'Submitted',
                        'Status',
                        'Action',
                      ].map((label) => (
                        <th key={label} className="whitespace-nowrap px-2 py-4 font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.items.map((application) => {
                      const [day, time] = dateParts(application.submittedAt);
                      return (
                        <tr
                          key={application.id}
                          data-testid="application-row"
                          className="align-top hover:bg-canvas/70"
                        >
                          <th
                            scope="row"
                            className="min-w-32 break-words px-2 py-4 text-left font-semibold"
                          >
                            {application.legalName}
                          </th>
                          <td className="px-2 py-4">
                            {application.practiceType && application.entityType
                              ? `${PRACTICE_TYPES[application.practiceType]} · ${ENTITY_TYPES[application.entityType]}`
                              : '—'}
                          </td>
                          <td className="min-w-32 break-words px-2 py-4">
                            {application.contactName}
                            <span className="block text-muted">{application.contactPhone}</span>
                          </td>
                          <td className="break-all px-2 py-4">{application.contactEmail}</td>
                          <td className="break-words px-2 py-4">
                            {application.services
                              .map((service) => FIRM_SERVICES[service])
                              .join(', ') || '—'}
                          </td>
                          <td className="px-2 py-4">
                            {application.requestedPlan
                              ? FIRM_PLANS[application.requestedPlan]
                              : '—'}
                          </td>
                          <td className="whitespace-nowrap px-2 py-4 text-muted">
                            {day}
                            <span className="block">{time}</span>
                          </td>
                          <td className="px-2 py-4">
                            <StatusPill status={application.status} />
                          </td>
                          <td className="px-2 py-4">
                            <Link
                              aria-label={`Open application for ${application.legalName}`}
                              className="inline-flex rounded-control bg-brand-700 px-3 py-2 font-medium text-white"
                              href={`/applications/${application.id}`}
                            >
                              Open Application
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <footer className="flex flex-col gap-3 border-t border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted">
                  Showing {first}–{last} of {data.total} applications
                </p>
                <nav aria-label="Application pages" className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    aria-label="Previous applications page"
                    disabled={currentPage === 1}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <span aria-current="page">
                    {currentPage} / {pageCount}
                  </span>
                  <Button
                    variant="secondary"
                    aria-label="Next applications page"
                    disabled={currentPage === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </nav>
              </footer>
            </>
          )}
        </ApplicationPageState>
      </Card>
    </div>
  );
}
