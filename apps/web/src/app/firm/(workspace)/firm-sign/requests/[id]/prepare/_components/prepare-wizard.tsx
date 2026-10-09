'use client';

import type { EsignRequestDetail } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { EsignGate } from '../../../../../../../../components/esign/esign-gate';
import { canCreate } from '../../../../../../../../components/esign/esign-role';
import { PageState } from '../../../../../../../../components/page-state';
import { api } from '../../../../../../../../lib/api';
import { DocumentsStep } from './documents-step';
import { RecipientsStep } from './recipients-step';
import { ReviewStep } from './review-step';
import { SettingsStep } from './settings-step';
import { requestKey, stepHref, type StepId } from './steps';

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
    queryKey: requestKey(id),
    queryFn: () => api.esign.get(id),
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
              <StepNav id={r.id} current={step} />
              <Step r={r} step={step} />
            </>
          ) : (
            <Card>
              <p className="text-text">{LOCKED[r.status] ?? LOCKED.SENT}</p>
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

const LOCKED: Partial<Record<EsignRequestDetail['status'], string>> = {
  NEEDS_APPROVAL:
    'This request is waiting for approval, so it can’t change. If an approver asks for changes, it comes back here as a draft.',
  SENT: 'This request has been sent, so it can no longer change.',
  COMPLETED: 'This request is completed.',
  DECLINED: 'This request was declined, so it is closed.',
  EXPIRED: 'This request expired, so it is closed.',
  VOIDED: 'This request was voided, so it is closed.',
};

/**
 * The steps as links, the current one marked. Not the setup Stepper: that marks every earlier
 * step as done, and here a step can be skipped and come back to.
 */
function StepNav({ id, current }: { id: string; current: StepId }) {
  return (
    <nav aria-label="Steps">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <Link
              href={stepHref(id, s.id)}
              aria-current={s.id === current ? 'step' : undefined}
              className={`inline-flex min-h-11 items-center gap-2 rounded-pill px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-focus ${
                s.id === current
                  ? 'bg-action text-on-action'
                  : 'bg-brand-50 text-heading hover:bg-brand-100'
              }`}
            >
              <span aria-hidden="true">{i + 1}.</span>
              {s.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Step({ r, step }: { r: EsignRequestDetail; step: StepId }) {
  if (step === 'documents') return <DocumentsStep r={r} />;
  if (step === 'recipients') return <RecipientsStep key={r.id} r={r} />;
  if (step === 'settings') return <SettingsStep key={r.id} r={r} />;
  if (step === 'review') return <ReviewStep r={r} />;
  return (
    <Card>
      <p className="text-text">{STEPS.find((s) => s.id === step)?.label} is being built.</p>
      <Link
        href={stepHref(r.id, 'documents')}
        className="mt-2 inline-flex min-h-11 items-center text-link underline"
      >
        Back to Documents
      </Link>
    </Card>
  );
}
