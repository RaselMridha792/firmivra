'use client';

import {
  ESIGN_ERRORS,
  ESIGN_READINESS_TEXT,
  type EsignBulkBatch,
  type EsignBulkItemState,
} from '@firmivra/types';
import { Badge, Table, type Column } from '@firmivra/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { shortDate } from '../../../../../../components/esign/format';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { shouldRetry } from '../../../../../../lib/query';

type Item = EsignBulkBatch['items'][number];

const STATE: Record<EsignBulkItemState, { label: string; tone: 'info' | 'success' | 'danger' }> = {
  QUEUED: { label: 'Waiting', tone: 'info' },
  SENT: { label: 'Sent', tone: 'success' },
  NOT_SENT: { label: 'Not sent', tone: 'danger' },
};

/** Why a row wasn't sent, in words: a readiness problem or an error. */
function why(problem: Item['problem']) {
  if (!problem) return '';
  // In a bulk send the only roles left open are the client's and spouse's own logins.
  if (problem === 'TEMPLATE_ROLES_UNFILLED') {
    return 'The client (or spouse) has no portal login to sign with.';
  }
  return (
    (ESIGN_READINESS_TEXT as Record<string, string>)[problem] ??
    (ESIGN_ERRORS as Record<string, string>)[problem] ??
    'It could not be sent.'
  );
}

const COLUMNS: Column<Item>[] = [
  { id: 'client', label: 'Client', cell: (i) => i.clientName },
  {
    id: 'state',
    label: 'Result',
    cell: (i) => <Badge tone={STATE[i.state].tone}>{STATE[i.state].label}</Badge>,
  },
  { id: 'why', label: 'Why not', cell: (i) => why(i.problem) },
  {
    id: 'request',
    label: 'Request',
    cell: (i) =>
      i.requestId ? (
        <Link href={`/firm-sign/requests/${i.requestId}`} className="text-link">
          {i.state === 'NOT_SENT' ? 'Open the draft' : 'Open'}
        </Link>
      ) : (
        '–'
      ),
  },
];

/** A bulk send's progress: one row per client; refreshes until every row is done. */
export function BatchView({ id }: { id: string }) {
  const batch = useQuery<EsignBulkBatch, Error>({
    queryKey: ['esign', 'bulk', id],
    queryFn: () => api.esign.bulk(id),
    // Until every row is done; never after an error (a wrong or foreign batch id).
    refetchInterval: (q) => (q.state.data?.done || q.state.error ? false : 3000),
    retry: shouldRetry,
  });
  return (
    <PageState query={batch} isEmpty={() => false}>
      {(b) => {
        const sent = b.items.filter((i) => i.state === 'SENT').length;
        const notSent = b.items.filter((i) => i.state === 'NOT_SENT').length;
        return (
          <div className="flex flex-col gap-6">
            <Link href="/firm-sign/bulk" className="self-start text-sm text-link">
              New bulk send
            </Link>
            <h1 data-testid="page-title" className="font-display text-3xl text-heading">
              Bulk send: {b.templateName}
            </h1>
            <p data-testid="batch-summary" role="status" className="text-text">
              {b.done ? 'Finished' : 'Sending'}: {sent} sent, {notSent} not sent
              {b.done ? '' : `, ${b.items.length - sent - notSent} waiting`}. Started{' '}
              {shortDate(b.createdAt)} by {b.createdBy.name}.
            </p>
            <Table
              caption="Bulk send results"
              rows={b.items}
              columns={COLUMNS}
              rowKey={(i) => i.clientId}
              pageSize={50}
            />
          </div>
        );
      }}
    </PageState>
  );
}
