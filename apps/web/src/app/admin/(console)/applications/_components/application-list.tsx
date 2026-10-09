'use client';

import { type FirmApplicationReviewStatus, type ListFirmApplicationsQuery } from '@firmivra/types';
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
    <div className="flex w-full flex-col gap-5">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1
            data-testid="page-title"
            className="font-display text-4xl font-bold tracking-tight text-heading md:text-5xl"
          >
            Firm Applications
          </h1>
          <p className="mt-1 text-lg text-muted">
            Review and manage new firm applications. Approve firms to activate their accounts.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row xl:mt-2">
          <SearchBox
            label="Search applications"
            className="sm:w-80"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search applications by business name, owner, or email..."
          />
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as StatusFilter);
              setTab('all');
              setPage(1);
            }}
            className={selectClass}
          >
            {statuses.map(({ value, label }) => (
              <option key={value || 'all'} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by date range"
            value={dateRange}
            onChange={(event) => {
              const value = event.target.value as DateRange;
              setDateRange(value);
              setDates(rangeBounds(value));
              setPage(1);
            }}
            className={`${selectClass} sm:w-36`}
          >
            <option value="all">All Time</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="month">This month</option>
          </select>
        </div>
      </header>

      <ApplicationPageState query={counts}>
        {(data) => (
          <section
            aria-label="Application totals"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          >
            <StatCard
              label="Pending Review"
              value={data.pendingReview}
              icon={FileText}
              tone="info"
            />
            <StatCard label="Approved" value={data.approved} icon={CircleCheck} tone="success" />
            <StatCard label="Declined" value={data.declined} icon={X} tone="danger" />
            <StatCard label="Total Applications" value={data.all} icon={UsersRound} tone="purple" />
          </section>
        )}
      </ApplicationPageState>

      <div
        role="tablist"
        aria-label="Application status"
        className="flex gap-6 overflow-x-auto border-b border-border"
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

      <ApplicationPageState
        query={applications}
        empty="No applications match these filters."
        isEmpty={(data) => data.total === 0}
      >
        {(data) => (
          <>
            <Card className="overflow-hidden !p-0" aria-label="Applications">
              <ListTable
                head={[
                  '#',
                  'Business Name',
                  'Owner / Contact',
                  'Email',
                  'Phone',
                  'Submitted',
                  'Status',
                  'Actions',
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
                        className={`${cellClass} min-w-40 break-words font-semibold text-heading`}
                      >
                        {application.legalName}
                      </th>
                      <td className={`${cellClass} break-words`}>{application.contactName}</td>
                      <td className={`${cellClass} whitespace-nowrap`}>
                        {application.contactEmail}
                      </td>
                      <td className={`${cellClass} whitespace-nowrap`}>
                        {formatPhone(application.contactPhone)}
                      </td>
                      <td className={`${cellClass} whitespace-nowrap`}>
                        {day}
                        <span className="block">{time}</span>
                      </td>
                      <td className={cellClass}>
                        <StatusPill status={application.status} />
                      </td>
                      <td className={`${cellClass} text-center`}>
                        <Link
                          aria-label={`Open application for ${application.legalName}`}
                          className="inline-flex whitespace-nowrap rounded-control bg-platform-navy px-5 py-3 font-semibold text-white hover:bg-platform-navy-raised"
                          href={`/applications/${application.id}`}
                        >
                          Open Application
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </ListTable>
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
