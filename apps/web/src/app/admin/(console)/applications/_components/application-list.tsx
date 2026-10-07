'use client';

import { useState } from 'react';
import { listApplications } from './application-data';
import { ApplicationTabs, matchesTab, type ApplicationTab } from './application-tabs';
import { MetricCards } from './application-ui';

export function ApplicationList() {
  const [applications] = useState(listApplications);
  const [tab, setTab] = useState<ApplicationTab>('all');
  const visible = applications.filter((application) => matchesTab(application, tab));

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
        <p className="p-6 text-sm text-muted">
          Showing {visible.length} applications in this view.
        </p>
      </section>
    </div>
  );
}
