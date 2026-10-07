'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Button, Card, Input } from '@firmivra/ui';
import { useMe } from '../../../../../components/signed-in';
import {
  listApplications,
  revision,
  subscribe,
  type Application,
  type Status,
} from './application-data';
import { dateParts, MetricCards, StatusPill } from './application-ui';

type Tab = 'all' | 'pending' | 'approved' | 'declined';
const tabs: Tab[] = ['all', 'pending', 'approved', 'declined'];
const labels: Record<Tab, string> = {
  all: 'All Applications',
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
};
const statuses: (Status | 'all')[] = [
  'all',
  'Pending Review',
  'Information Requested',
  'Approved',
  'Declined',
];
const matchesTab = (a: Application, tab: Tab) =>
  tab === 'all' ||
  (tab === 'pending'
    ? a.status === 'Pending Review' || a.status === 'Information Requested'
    : a.status.toLowerCase() === tab);
const matches = (a: Application, q: string, status: string, date: string) => {
  const found = [a.name, a.owner, a.email].some((s) =>
    s.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const time = new Date(a.submittedAt),
    now = new Date();
  const inDateRange =
    date === 'all' ||
    (date === 'month'
      ? time.getMonth() === now.getMonth() && time.getFullYear() === now.getFullYear()
      : time >= new Date(now.getTime() - Number(date) * 86400000));
  return found && (status === 'all' || a.status === status) && inDateRange;
};

export function ApplicationList() {
  const { me } = useMe();
  useSyncExternalStore(subscribe, revision, revision);
  const apps = listApplications();
  const [tab, setTab] = useState<Tab>('all'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all'),
    [date, setDate] = useState('all'),
    [page, setPage] = useState(1);
  const filtered = apps.filter((a) => matchesTab(a, tab) && matches(a, query, status, date));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 5)),
    current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * 5, current * 5);
  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setPage(1);
  };
  if (!me.platformAdmin)
    return <p role="alert">You do not have permission to review firm applications.</p>;
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 data-testid="page-title" className="text-3xl font-semibold tracking-tight text-text">
          Firm Applications
        </h1>
        <p className="mt-2 text-muted">
          Review and manage new firm applications. Approve firms to activate their accounts.
        </p>
      </header>
      <MetricCards apps={apps} />
      <Card className="!p-0" aria-label="Applications">
        <div
          role="tablist"
          aria-label="Application status"
          className="flex gap-5 overflow-x-auto border-b border-border px-5"
        >
          {tabs.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={id === tab}
              onClick={() => {
                setTab(id);
                setPage(1);
              }}
              className={`shrink-0 border-b-2 px-1 py-4 text-sm ${id === tab ? 'border-brand-700 font-semibold text-brand-700' : 'border-transparent text-muted'}`}
            >
              {labels[id]} ({apps.filter((a) => matchesTab(a, id)).length})
            </button>
          ))}
        </div>
        <div className="grid gap-4 border-b border-border p-5 md:grid-cols-3">
          <Input
            label="Search applications"
            type="search"
            value={query}
            onChange={(e) => setFilter(setQuery, e.target.value)}
            placeholder="Business name, owner, or email"
          />
          <label className="flex flex-col gap-1 text-sm font-medium text-text">
            Status
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(e) => setFilter(setStatus, e.target.value)}
              className="h-10 rounded-control border border-border bg-surface px-3 text-base font-normal"
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s === 'all' ? 'All statuses' : s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-text">
            Date range
            <select
              aria-label="Filter by date range"
              value={date}
              onChange={(e) => setFilter(setDate, e.target.value)}
              className="h-10 rounded-control border border-border bg-surface px-3 text-base font-normal"
            >
              {[
                ['all', 'All time'],
                ['7', 'Last 7 days'],
                ['30', 'Last 30 days'],
                ['month', 'This month'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max table-fixed text-left text-xs">
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
                ].map((n) => (
                  <th key={n} className="whitespace-nowrap px-2 py-4 font-medium">
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => {
                const [day, time] = dateParts(a.submittedAt);
                return (
                  <tr key={a.id} className="align-top hover:bg-canvas/70">
                    <th
                      scope="row"
                      className="min-w-32 break-words px-2 py-4 text-left font-semibold"
                    >
                      {a.name}
                    </th>
                    <td className="px-2 py-4">
                      {a.sections['Business Information']?.['Business type']}
                    </td>
                    <td className="min-w-32 break-words px-2 py-4">
                      {a.owner}
                      <span className="block text-muted">{a.phone}</span>
                    </td>
                    <td className="px-2 py-4">{a.email}</td>
                    <td className="min-w-40 break-words px-2 py-4">{a.services.join(', ')}</td>
                    <td className="px-2 py-4">
                      {a.sections['Account Details']?.['Requested plan']}
                    </td>
                    <td className="whitespace-nowrap px-2 py-4 text-muted">
                      {day}
                      <span className="block">{time}</span>
                    </td>
                    <td className="px-2 py-4">
                      <StatusPill status={a.status} />
                    </td>
                    <td className="px-2 py-4">
                      <Link
                        aria-label={`Open application for ${a.name}`}
                        className="inline-flex whitespace-nowrap rounded-control bg-brand-700 px-3 py-2 font-medium text-white"
                        href={`/applications/${a.id}`}
                      >
                        Open application
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <p role="status" className="p-8 text-center text-sm text-muted">
            No applications match these filters.
          </p>
        )}
        <footer className="flex flex-col gap-3 border-t border-border p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Showing {filtered.length ? (current - 1) * 5 + 1 : 0}–
            {Math.min(current * 5, filtered.length)} of {filtered.length} applications
          </p>
          <nav aria-label="Application pages" className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </Button>
            <span aria-current="page">
              {current} / {pageCount}
            </span>
            <Button
              variant="secondary"
              disabled={current === pageCount}
              onClick={() => setPage(current + 1)}
            >
              Next
            </Button>
          </nav>
        </footer>
      </Card>
    </div>
  );
}
