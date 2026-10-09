'use client';

import type { EsignRequestDetail } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { EsignGate } from '../../../../../../../components/esign/esign-gate';
import { shortDate } from '../../../../../../../components/esign/format';
import { StatusBadge } from '../../../../../../../components/esign/status-badge';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { Recipients } from './recipients';
import { Timeline } from './timeline';

/** One signature request (/firm-sign/requests/{id}): where it is, who signed, and what happened. */
export function RequestDetail({ id }: { id: string }) {
  return <EsignGate>{() => <Detail id={id} />}</EsignGate>;
}

function Detail({ id }: { id: string }) {
  const request = useApiQuery(['esign', 'requests', id], () => api.esign.get(id));
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/firm-sign/requests"
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-link hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All requests
      </Link>
      <PageState query={request} isEmpty={() => false}>
        {(r) => (
          <>
            <Header r={r} />
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex flex-col gap-6">
                <Recipients recipients={r.recipients} ordered={r.routing === 'SEQUENTIAL'} />
                <Timeline id={id} />
              </div>
              <div className="flex flex-col gap-6">
                <Facts r={r} />
                {r.internalNote && (
                  <Card>
                    <h2 className="mb-2 font-semibold text-heading">Internal note</h2>
                    <p className="text-sm whitespace-pre-line text-text">{r.internalNote}</p>
                    <p className="mt-2 text-xs text-muted">Only your firm sees this.</p>
                  </Card>
                )}
              </div>
            </div>
          </>
        )}
      </PageState>
    </div>
  );
}

/** What the request waits on, in a sentence. */
function nextStep(r: EsignRequestDetail): string | null {
  const names = r.nextAction.waitingOn.join(', ');
  switch (r.nextAction.kind) {
    case 'FINISH_DRAFT':
      return 'Not sent yet: finish preparing it.';
    case 'AWAIT_APPROVAL':
      return names ? `Waiting for approval from ${names}.` : 'Waiting for approval.';
    case 'AWAIT_SIGNATURE':
      return names ? `Waiting for ${names} to sign.` : 'Waiting for signatures.';
    default:
      return null;
  }
}

function Header({ r }: { r: EsignRequestDetail }) {
  const next = nextStep(r);
  const edit = r.allowedActions.includes('EDIT');
  const inPerson = r.allowedActions.includes('START_IN_PERSON');
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 data-testid="page-title" className="font-display text-3xl break-words text-heading">
          {r.title}
        </h1>
        <StatusBadge status={r.status} />
      </div>
      {next && <p className="text-text">{next}</p>}
      {(edit || inPerson) && (
        <div className="flex flex-wrap gap-3">
          {edit && (
            <Link href={`/firm-sign/requests/${r.id}/prepare`} className={LINK_BUTTON}>
              Continue preparing
            </Link>
          )}
          {inPerson && (
            <Link href={`/firm-sign/in-person/${r.id}`} className={LINK_BUTTON}>
              Sign in person
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}

const LINK_BUTTON =
  'inline-flex min-h-11 items-center rounded-control bg-platform-navy px-4 text-sm font-semibold text-white hover:bg-platform-navy-raised focus-visible:outline-2 focus-visible:outline-focus';

function Facts({ r }: { r: EsignRequestDetail }) {
  const rows: [string, string][] = [
    ['Engagement', r.engagement?.title ?? '–'],
    ['Sent by', r.sender.name],
    ['Created', shortDate(r.createdAt)],
    ['Sent', shortDate(r.sentAt)],
    [r.completedAt ? 'Completed' : 'Expires', shortDate(r.completedAt ?? r.expiresAt)],
    ['Signing order', r.routing === 'SEQUENTIAL' ? 'One after another' : 'All at once'],
    ['Pages', String(r.pagePlan.length)],
  ];
  return (
    <Card>
      <h2 className="mb-4 font-semibold text-heading">Details</h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Client</dt>
        <dd className="break-words text-text">
          {r.client ? (
            <Link href={`/clients/${r.client.id}`} className="text-link hover:underline">
              {r.client.displayName}
            </Link>
          ) : (
            '–'
          )}
        </dd>
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-words text-text">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
