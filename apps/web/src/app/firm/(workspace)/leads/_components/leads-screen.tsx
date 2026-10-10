'use client';

import { ReviewedLeadStatus, type LeadListItem } from '@firmivra/types';
import { Badge, Button, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

const STATUS = {
  SUBMITTED: { label: 'New', tone: 'info' },
  IN_REVIEW: { label: 'Reviewed', tone: 'warning' },
  CONVERTED: { label: 'Converted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'danger' },
} as const;

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  ...Object.entries(STATUS).map(([value, { label }]) => ({ value, label })),
];

/** The API returns submitted leads newest first, with a cursor for the next page. */
export function LeadsScreen() {
  const [status, setStatus] = useState<ReviewedLeadStatus | ''>('');
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const leads = useApiQuery(['leads', 'list', status, cursor ?? ''], () =>
    api.leads.list({
      ...(status ? { status } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 25,
    }),
  );
  const nextCursor = leads.data?.nextCursor;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Leads
        </h1>
        <p className="text-sm text-muted">Begin Online submissions, newest first.</p>
      </div>
      <div className="w-full sm:max-w-xs">
        <Select
          label="Filter by status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(event) => {
            const parsed = ReviewedLeadStatus.safeParse(event.target.value);
            setStatus(parsed.success ? parsed.data : '');
            setCursors([]);
          }}
        />
      </div>
      <PageState
        query={leads}
        isEmpty={(data) => data.items.length === 0}
        empty={
          status
            ? `No ${STATUS[status].label.toLowerCase()} leads.`
            : 'No Begin Online submissions yet.'
        }
      >
        {(data) => (
          <ul
            aria-label="Begin Online submissions"
            className="divide-y divide-border rounded-card border border-border bg-surface"
          >
            {data.items.map((lead) => (
              <LeadRow key={lead.id} lead={lead} />
            ))}
          </ul>
        )}
      </PageState>
      <nav
        aria-label="Leads pages"
        className="flex flex-wrap items-center gap-3 text-sm text-muted"
      >
        <p aria-live="polite">Page {cursors.length + 1}</p>
        <Button
          variant="secondary"
          disabled={cursors.length === 0 || leads.isFetching}
          onClick={() => setCursors((previous) => previous.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={!nextCursor || leads.isFetching || leads.isError}
          onClick={() => {
            if (nextCursor) setCursors((previous) => [...previous, nextCursor]);
          }}
        >
          Next
        </Button>
      </nav>
    </div>
  );
}

function LeadRow({ lead }: { lead: LeadListItem }) {
  const name = `${lead.firstName} ${lead.lastName}`.trim() || lead.email;
  const { label, tone } = STATUS[lead.status];
  return (
    <li data-testid="lead-row" data-status={lead.status}>
      <Link
        href={`/leads/${lead.id}`}
        aria-label={`Open lead for ${name}`}
        className="grid min-w-0 gap-3 rounded-card p-3 hover:bg-folder-surface focus-visible:outline-2 focus-visible:outline-action md:grid-cols-5 md:items-center"
      >
        <div className="min-w-0 md:col-span-2">
          <p data-testid="lead-name" className="font-medium text-text">
            {name}
          </p>
          <p className="break-all text-sm text-muted">{lead.email}</p>
          {lead.phone && <p className="text-sm text-muted">{lead.phone}</p>}
        </div>
        <div className="min-w-0 text-sm text-text">
          <p>{lead.service.name}</p>
          {lead.taxYear !== null && <p className="text-muted">Tax year {lead.taxYear}</p>}
        </div>
        <div className="text-sm text-muted">
          <span className="sr-only">Submitted </span>
          <time dateTime={lead.submittedAt}>
            {new Date(lead.submittedAt).toLocaleDateString('en-US', {
              dateStyle: 'medium',
              timeZone: 'UTC',
            })}
          </time>
        </div>
        <div>
          <Badge tone={tone}>{label}</Badge>
        </div>
      </Link>
    </li>
  );
}
