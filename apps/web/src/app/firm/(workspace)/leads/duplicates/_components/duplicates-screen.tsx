'use client';

import {
  LEAD_STATUS_LABELS,
  type LeadDuplicatePair,
  type LeadDuplicateReason,
  type LeadRow,
} from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { ArrowLeft, CopySimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { useFirm } from '../../../../../../components/firm-context';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { fullName, LEAD_PIPELINE_KEY } from '../../_components/lead-shared';

export const DUPLICATES_KEY = [...LEAD_PIPELINE_KEY, 'duplicates'] as const;

const REASONS: Record<LeadDuplicateReason, string> = {
  EMAIL: 'Same email',
  PHONE: 'Same phone',
  NAME: 'Same name',
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Review Duplicates (Leads R2 15), from the Leads list: leads that may be the same person (the
 * same email or phone, any of theirs, or the same name), newest first. Compare and Merge opens the
 * two side by side; nothing is merged unless an Owner or Admin merges it. "Not a Duplicate" takes
 * the pair off this list. Staff see the pairs of their own leads and can compare them.
 */
export function DuplicatesScreen() {
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const query = useApiQuery(DUPLICATES_KEY, () => api.leadPipeline.duplicates());
  const dismiss = useApiMutation(
    (pair: LeadDuplicatePair) =>
      api.leadPipeline.dismissDuplicate({
        leadId: pair.leads[0].id,
        otherLeadId: pair.leads[1].id,
      }),
    { invalidate: DUPLICATES_KEY },
  );
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="lead-duplicates-review">
      <Link href="/leads" className="flex w-fit items-center gap-2 text-sm font-medium text-link">
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Leads
      </Link>
      <header className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
          <CopySimple aria-hidden weight="fill" className="size-7" />
        </span>
        <div>
          <h1 className="font-display text-3xl font-bold text-heading">Review Duplicates</h1>
          <p className="text-muted">
            Leads that may be the same person. Nothing is merged unless you merge it.
          </p>
        </div>
      </header>
      {manager ? null : (
        <p className="text-sm text-muted" data-testid="duplicates-staff-note">
          Only an Owner or Admin can merge leads or mark them as not duplicates.
        </p>
      )}
      {dismiss.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(dismiss.error)}
        </p>
      ) : null}
      <PageState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty="No possible duplicates right now."
      >
        {(data) => (
          <ul className="flex flex-col gap-3" aria-label="Possible duplicates">
            {data.items.map((pair) => (
              <li key={`${pair.leads[0].id}:${pair.leads[1].id}`}>
                <Card className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {pair.reasons.map((r) => (
                      <Badge key={r} tone="warning">
                        {REASONS[r]}
                      </Badge>
                    ))}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {pair.leads.map((lead) => (
                      <LeadSummary key={lead.id} lead={lead} />
                    ))}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {manager ? (
                      <Button
                        variant="secondary"
                        disabled={dismiss.isPending}
                        onClick={() => dismiss.mutate(pair)}
                      >
                        Not a Duplicate
                      </Button>
                    ) : null}
                    <Link
                      href={`/leads/duplicates/merge?a=${pair.leads[0].id}&b=${pair.leads[1].id}`}
                      className="inline-flex min-h-11 items-center rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover"
                    >
                      {manager ? 'Compare and Merge' : 'Compare'}
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </div>
  );
}

function LeadSummary({ lead }: { lead: LeadRow }) {
  const name = fullName(lead.firstName, lead.lastName, lead.email);
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-control bg-canvas p-3 text-sm">
      <Link href={`/leads/${lead.id}`} className="font-semibold text-link underline">
        {name}
      </Link>
      <span className="text-muted">
        {lead.number}, {LEAD_STATUS_LABELS[lead.stage]}, added {day(lead.createdAt)}
      </span>
      <span className="[overflow-wrap:anywhere] text-text">{lead.email}</span>
      {lead.phone ? <span className="text-text">{lead.phone}</span> : null}
    </div>
  );
}
