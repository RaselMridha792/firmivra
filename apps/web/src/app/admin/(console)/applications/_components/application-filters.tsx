import { Input } from '@firmivra/ui';
import type { ApplicationStatus, FirmApplication } from './application-data';

export type StatusFilter = 'all' | ApplicationStatus;
export type DateFilter = 'all' | '7days' | '30days' | 'month';

export function matchesFilters(
  application: FirmApplication,
  search: string,
  status: StatusFilter,
  date: DateFilter,
) {
  const query = search.trim().toLowerCase();
  const matchesQuery =
    !query ||
    [application.businessName, application.ownerName, application.email].some((value) =>
      value.toLowerCase().includes(query),
    );
  const matchesStatus = status === 'all' || application.status === status;
  const submitted = new Date(application.submittedAt);
  const now = new Date();
  const days = date === '7days' ? 7 : date === '30days' ? 30 : undefined;
  const matchesDate =
    date === 'all' ||
    (date === 'month' &&
      submitted.getMonth() === now.getMonth() &&
      submitted.getFullYear() === now.getFullYear()) ||
    (days !== undefined && submitted >= new Date(now.getTime() - days * 86400000));
  return matchesQuery && matchesStatus && matchesDate;
}

export function ApplicationFilters({
  search,
  status,
  date,
  onSearch,
  onStatus,
  onDate,
}: {
  search: string;
  status: StatusFilter;
  date: DateFilter;
  onSearch: (value: string) => void;
  onStatus: (value: StatusFilter) => void;
  onDate: (value: DateFilter) => void;
}) {
  return (
    <div className="grid gap-4 border-b border-border p-5 md:grid-cols-[minmax(14rem,1.4fr)_minmax(10rem,1fr)_minmax(10rem,1fr)]">
      <Input
        label="Search applications"
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Business name, owner, or email"
      />
      <label className="flex flex-col gap-1 text-sm font-medium text-text">
        Status
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => onStatus(event.target.value as StatusFilter)}
          className="h-10 rounded-control border border-border bg-surface px-3 text-base font-normal focus:outline-2 focus:outline-accent-500"
        >
          <option value="all">All statuses</option>
          <option value="Pending Review">Pending review</option>
          <option value="Information Requested">Information requested</option>
          <option value="Approved">Approved</option>
          <option value="Declined">Declined</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-text">
        Date range
        <select
          aria-label="Filter by date range"
          value={date}
          onChange={(event) => onDate(event.target.value as DateFilter)}
          className="h-10 rounded-control border border-border bg-surface px-3 text-base font-normal focus:outline-2 focus:outline-accent-500"
        >
          <option value="all">All time</option>
          <option value="7days">Last 7 days</option>
          <option value="30days">Last 30 days</option>
          <option value="month">This month</option>
        </select>
      </label>
    </div>
  );
}
