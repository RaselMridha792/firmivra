'use client';

import { useState } from 'react';
import { listApplications } from './application-data';
import {
  ApplicationFilters,
  matchesFilters,
  type DateFilter,
  type StatusFilter,
} from './application-filters';
import { ApplicationTabs, matchesTab, type ApplicationTab } from './application-tabs';
import { MetricCards } from './application-ui';

export function ApplicationList() {
  const [applications] = useState(listApplications);
  const [tab, setTab] = useState<ApplicationTab>('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [date, setDate] = useState<DateFilter>('all');
  const visible = applications.filter(
    (application) =>
      matchesTab(application, tab) && matchesFilters(application, search, status, date),
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-text">Firm Applications</h1>
        <p className="mt-2 max-w-3xl text-muted">
          Review and manage new firm applications. Approve firms to activate their accounts.
        </p>
      </header>
      <MetricCards applications={applications} />
      <section
        aria-label="Applications"
        className="rounded-card border border-border bg-surface shadow-card"
      >
        <ApplicationTabs applications={applications} selected={tab} onSelect={setTab} />
        <ApplicationFilters
          search={search}
          status={status}
          date={date}
          onSearch={setSearch}
          onStatus={setStatus}
          onDate={setDate}
        />
        <p className="p-6 text-sm text-muted">
          Showing {visible.length} applications in this view.
        </p>
      </section>
    </div>
  );
}
