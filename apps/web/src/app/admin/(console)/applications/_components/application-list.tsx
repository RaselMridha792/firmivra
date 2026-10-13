'use client';

import {
  ENTITY_TYPES,
  FIRM_SERVICES,
  FIRM_PLANS,
  type FirmApplicationReviewStatus,
  type ListFirmApplicationsQuery,
} from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { CircleCheck, FileText, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { applicationCountsKey, applicationListKey } from './application-data';
import {
  cellClass,
  EmailText,
  firstCellClass,
  formatPhone,
  ListPager,
  ListTable,
  SearchBox,
  selectClass,
  StatCard,
} from '../../_components/list-parts';
import {
  ApplicationPageState,
  dateParts,
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
  // The API refuses control characters and more than 100 characters (SearchText).
  const searchText = search.replace(/[\p{Cc}\p{Cs}]/gu, ' ').trim();
  const query: ListFirmApplicationsQuery = {
    page,
    pageSize,
    order: 'newest',
    ...(searchText ? { search: searchText } : {}),
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
    <div className="flex w-full min-w-0 flex-col gap-0 [&>footer]:rounded-b-card [&>footer]:border-x [&>footer]:border-b [&>footer]:border-border [&>footer]:bg-surface [&>footer]:p-4">
      <header className="mb-5 flex flex-col gap-4">
        <div>
          <h1
            data-testid="page-title"
            className="font-display text-3xl font-bold tracking-tight text-heading md:text-5xl"
          >
            Firm Applications
          </h1>
          <p className="mt-2 text-base text-muted md:text-lg">
            Review and manage new firm applications. Approve firms to activate their accounts.
          </p>
        </div>
      </header>

      <ApplicationPageState query={counts}>
        {(data) => (
          <section
            aria-label="Application totals"
            className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>div]:shadow-none [&_.size-13]:size-16 [&_svg]:size-8"
          >
            <StatCard
              label="Pending Review"
              value={data.pendingReview}
              icon={FileText}
              tone="info"
            />
            <StatCard
              label="Approved This Month"
              value={data.approvedThisMonth}
              icon={CircleCheck}
              tone="success"
            />
            <StatCard
              label="Declined This Month"
              value={data.declinedThisMonth}
              icon={X}
              tone="danger"
            />
            <StatCard label="Total Applications" value={data.all} icon={UsersRound} tone="purple" />
          </section>
        )}
      </ApplicationPageState>

      <div
        role="tablist"
        aria-label="Application status"
        className="flex flex-wrap gap-x-4 gap-y-0 rounded-t-card border border-border bg-surface px-4 pt-3"
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
              className={`-mb-px shrink-0 border-b-2 px-1 py-3 text-sm ${id === tab ? 'border-action font-semibold text-action' : 'border-transparent text-muted hover:text-heading'}`}
            >
              {label} ({value ?? '…'})
            </button>
          );
        })}
      </div>

      <div
        className="grid min-w-0 grid-cols-1 items-end gap-4 border-x border-border bg-surface p-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="application-filters"
      >
        <SearchBox
          label="Search applications"
          className="min-w-0 w-full sm:col-span-2 xl:col-span-1"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Search by business, owner, or email..."
        />
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          Status
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setTab('all');
              setPage(1);
            }}
            className={`${selectClass} min-w-0 w-full max-w-full`}
          >
            {statuses.map(({ value, label }) => (
              <option key={value || 'all'} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-muted">
          Date Range
          <select
            aria-label="Filter by date range"
            value={dateRange}
            onChange={(event) => {
              const value = event.target.value as DateRange;
              setDateRange(value);
              setDates(rangeBounds(value));
              setPage(1);
            }}
            className={`${selectClass} min-w-0 w-full max-w-full`}
          >
            <option value="all">All Time</option>
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
            <Card
              variant="elevated"
              className="overflow-hidden !rounded-none !p-0"
              aria-label="Applications"
            >
              <ul className="divide-y divide-border xl:hidden">
                {data.items.map((application) => {
                  const [day, time] = dateParts(application.submittedAt);
                  return (
                    <li key={application.id} className="space-y-3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-semibold text-heading">
                          {application.legalName}
                        </p>
                        <StatusPill status={application.status} />
                      </div>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-sm">
                        <div className="col-span-2">
                          <dt className="text-xs text-muted">Owner / Contact</dt>
                          <dd className="mt-1 break-words font-medium text-text">
                            {application.contactName}
                            <span className="block font-normal text-muted wrap-anywhere">
                              <EmailText value={application.contactEmail} />
                            </span>
                            {application.contactPhone ? (
                              <span className="block font-normal text-muted">
                                {formatPhone(application.contactPhone)}
                              </span>
                            ) : null}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Business Type</dt>
                          <dd className="mt-1 wrap-anywhere">
                            {application.entityType
                              ? ENTITY_TYPES[application.entityType]
                              : '\u2014'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted">Requested Plan</dt>
                          <dd className="mt-1 wrap-anywhere">
                            {application.requestedPlan
                              ? FIRM_PLANS[application.requestedPlan]
                              : '\u2014'}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-xs text-muted">Services</dt>
                          <dd className="mt-1 wrap-anywhere">
                            {application.services.length
                              ? application.services
                                  .map((service) => FIRM_SERVICES[service])
                                  .join(', ')
                              : '\u2014'}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-xs text-muted">Submitted</dt>
                          <dd className="mt-1 text-text">
                            {day}, {time}
                          </dd>
                        </div>
                      </dl>
                      <Link
                        aria-label={`Open application for ${application.legalName}`}
                        className="flex justify-center rounded-control bg-action px-4 py-2.5 text-sm font-semibold text-on-action hover:bg-action-hover"
                        href={`/applications/${application.id}`}
                      >
                        Open Application
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="hidden min-w-0 xl:block [&_table]:table-fixed [&_table]:text-xs 2xl:[&_table]:text-sm [&_table]:min-w-0 [&_td]:border-l-0 [&_td]:px-1 [&_th]:px-1 [&_thead_th]:whitespace-nowrap [&_th]:min-w-0 [&_th:first-child]:w-8 [&_[data-testid=application-status]]:px-2 [&_[data-testid=application-status]]:text-xs 2xl:[&_[data-testid=application-status]]:text-sm">
                <ListTable
                  head={[
                    { label: '#', center: true },
                    { label: 'Business Name' },
                    { label: 'Business Type' },
                    { label: 'Owner / Contact' },
                    { label: 'Email', className: 'w-36 2xl:w-56' },
                    { label: 'Services' },
                    { label: 'Requested Plan' },
                    { label: 'Submitted' },
                    { label: 'Status', className: 'w-28 2xl:w-36' },
                    { label: 'Action', center: true, className: 'w-28 2xl:w-36' },
                  ]}
                >
                  {data.items.map((application, index) => {
                    const [day, time] = dateParts(application.submittedAt);
                    return (
                      <tr
                        key={application.id}
                        data-testid="application-row"
                        className="hover:bg-subtle"
                      >
                        <td className={firstCellClass}>{first + index}</td>
                        <th
                          scope="row"
                          className={`${cellClass} break-words font-semibold text-heading`}
                        >
                          {application.legalName}
                        </th>
                        <td className={`${cellClass} break-words`}>
                          {application.entityType ? ENTITY_TYPES[application.entityType] : '\u2014'}
                        </td>
                        <td className={`${cellClass} break-words`}>
                          {application.contactName}
                          {application.contactPhone ? (
                            <span className="block text-muted">
                              {formatPhone(application.contactPhone)}
                            </span>
                          ) : null}
                        </td>
                        <td className={`${cellClass} break-words`}>
                          <span className="block truncate" title={application.contactEmail}>
                            {application.contactEmail}
                          </span>
                        </td>
                        <td className={`${cellClass} break-words`}>
                          {application.services.length
                            ? application.services
                                .map((service) => FIRM_SERVICES[service])
                                .join(', ')
                            : '\u2014'}
                        </td>
                        <td className={`${cellClass} break-words`}>
                          {application.requestedPlan
                            ? FIRM_PLANS[application.requestedPlan]
                            : '\u2014'}
                        </td>
                        <td className={`${cellClass} break-words`}>
                          {day}
                          <span className="block">{time}</span>
                        </td>
                        <td className={cellClass}>
                          <StatusPill status={application.status} />
                        </td>
                        <td className={`${cellClass} text-center`}>
                          <Link
                            aria-label={`Open application for ${application.legalName}`}
                            className="inline-flex justify-center whitespace-nowrap rounded-control bg-action px-1 py-2.5 font-semibold text-on-action hover:bg-action-hover"
                            href={`/applications/${application.id}`}
                          >
                            Open Application
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </ListTable>
              </div>
            </Card>
            <ListPager
              noun="applications"
              first={first}
              last={last}
              total={data.total}
              page={currentPage}
              pageCount={pageCount}
              onPage={setPage}
            />
          </>
        )}
      </ApplicationPageState>
    </div>
  );
}
