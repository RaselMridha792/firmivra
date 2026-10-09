'use client';

import type { EsignRequestDetail } from '@firmivra/types';
import { Card, Stepper } from '@firmivra/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { EsignGate } from '../../../../../../../../components/esign/esign-gate';
import { canCreate } from '../../../../../../../../components/esign/esign-role';
import { PageState } from '../../../../../../../../components/page-state';
import { api } from '../../../../../../../../lib/api';
import { shouldRetry } from '../../../../../../../../lib/query';
import { DocumentsStep } from './documents-step';
import { stepHref, type StepId } from './steps';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'recipients', label: 'Recipients' },
  { id: 'fields', label: 'Fields' },
  { id: 'settings', label: 'Settings' },
  { id: 'review', label: 'Review and send' },
];

/** Preparing a draft (/firm-sign/requests/{id}/prepare?step=): one step at a time. */
export function PrepareWizard({ id, step }: { id: string; step: StepId }) {
  return (
    <EsignGate>
      {(role) =>
        canCreate(role) ? (
          <Wizard id={id} step={step} />
        ) : (
          <Card>
            <p className="text-text">You can view signature requests, but not prepare them.</p>
          </Card>
        )
      }
    </EsignGate>
  );
}

function Wizard({ id, step }: { id: string; step: StepId }) {
  const request = useQuery<EsignRequestDetail, Error>({
    queryKey: ['esign', 'requests', id],
    queryFn: () => api.esign.get(id),
    retry: shouldRetry,
    // A new upload is checked for viruses: look again until every file is ready.
    refetchInterval: (q) =>
      q.state.data?.documents.some((d) => d.scanStatus === 'PENDING') ? 2000 : false,
  });
  return (
    <PageState query={request} isEmpty={() => false}>
      {(r) => (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 data-testid="page-title" className="font-display text-3xl break-words text-heading">
              {r.title}
            </h1>
            <p className="text-sm text-muted">
              {r.client ? `For ${r.client.displayName}` : 'No client'}
              {r.engagement && ` · ${r.engagement.title}`}
            </p>
          </div>
          {r.status === 'DRAFT' ? (
            <>
              <Stepper label="Steps" steps={STEPS} current={step} />
              <Step r={r} step={step} />
            </>
          ) : (
            <Card>
              <p className="text-text">This request has been sent, so it can no longer change.</p>
              <Link
                href={`/firm-sign/requests/${r.id}`}
                className="mt-2 inline-flex min-h-11 items-center text-link underline"
              >
                Open the request
              </Link>
            </Card>
          )}
        </div>
      )}
    </PageState>
  );
}

function Step({ r, step }: { r: EsignRequestDetail; step: StepId }) {
  if (step === 'documents') return <DocumentsStep r={r} />;
  return (
    <Card>
      <p className="text-text">This step is being built.</p>
      <Link
        href={stepHref(r.id, 'documents')}
        className="mt-2 inline-flex min-h-11 items-center text-link underline"
      >
        Back to Documents
      </Link>
    </Card>
  );
}
