'use client';

import type { LeadDetail } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { LeadFile } from './lead-file';
import { leadKey, STATUS } from './lead-shared';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words text-text">{children}</dd>
    </div>
  );
}

/** Who sent the request, for which service, and what the firm did with it. */
function LeadSummary({ lead }: { lead: LeadDetail }) {
  return (
    <Card title="Request">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Service">
          {lead.service.name}
          {lead.taxYear ? ` · ${lead.taxYear}` : ''}
        </Fact>
        <Fact label="Sent">{when(lead.submittedAt)}</Fact>
        <Fact label="Email">{lead.email}</Fact>
        <Fact label="Phone">{lead.phone ?? '—'}</Fact>
        {lead.reviewedBy && lead.reviewedAt ? (
          <Fact label="Handled by">
            {lead.reviewedBy.name} · {when(lead.reviewedAt)}
          </Fact>
        ) : null}
        {lead.client ? (
          <Fact label="Client">
            <Link href={`/clients/${lead.client.id}`} className="text-link">
              {lead.client.displayName}
            </Link>
          </Fact>
        ) : null}
        {lead.declineReason ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <Fact label="Reason for declining (never sent to the visitor)">
              {lead.declineReason}
            </Fact>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}

/**
 * One Begin Online lead: who sent it and the uploaded files. Every member of the firm reads
 * leads; another firm's is 404.
 */
export function LeadScreen() {
  const { id } = useParams<{ id: string }>();
  const lead = useApiQuery(leadKey(id), () => api.leads.get(id));
  return (
    <div className="flex flex-col gap-4">
      <Link href="/leads" className="w-fit text-sm text-link">
        ← All leads
      </Link>
      <PageState query={lead}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
                {data.firstName} {data.lastName}
              </h1>
              <Badge tone={STATUS[data.status].tone}>{STATUS[data.status].label}</Badge>
            </div>
            <LeadSummary lead={data} />
            {data.intake?.uploads.length ? (
              <Card title="Files">
                <ul className="flex flex-col gap-2">
                  {data.intake.uploads.map((file) => (
                    <LeadFile key={file.id} leadId={data.id} file={file} />
                  ))}
                </ul>
              </Card>
            ) : null}
          </>
        )}
      </PageState>
    </div>
  );
}
