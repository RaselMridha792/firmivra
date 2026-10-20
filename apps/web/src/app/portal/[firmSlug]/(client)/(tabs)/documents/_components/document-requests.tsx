'use client';

import {
  DOCUMENT_ERRORS,
  type MyDocumentRequest,
  type MyRequestPacketRow,
  NotAvailableRequest,
} from '@firmivra/types';
import { Badge, Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';

const STATUS: Record<
  MyDocumentRequest['status'],
  [string, 'info' | 'success' | 'warning' | 'danger' | 'neutral']
> = {
  REQUESTED: ['Requested', 'info'],
  REJECTED: ['Needs a new file', 'danger'],
  SUBMITTED: ['Received', 'info'],
  ACCEPTED: ['Accepted', 'success'],
  NOT_AVAILABLE: ["You don't have it", 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
};
const dueText = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const PACKET_LABELS: Record<MyRequestPacketRow['view'], string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  READY: 'Ready to submit',
  SUBMITTED: 'Submitted',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
};
const PACKET_TONES = {
  NOT_STARTED: 'info',
  IN_PROGRESS: 'warning',
  READY: 'success',
  SUBMITTED: 'info',
  COMPLETED: 'success',
  EXPIRED: 'neutral',
} as const;
const open = (r: MyDocumentRequest) => r.status === 'REQUESTED' || r.status === 'REJECTED';

/**
 * "Your Next Steps": the documents the firm asked for. An open one can be uploaded (it opens the
 * pop-up for that service and request) or answered with "I don't have this".
 */
export function DocumentRequests({
  slug,
  onUpload,
}: {
  slug: string;
  onUpload: (request: MyDocumentRequest) => void;
}) {
  const requests = useApiQuery(['my-documents', slug, 'requests'], () =>
    api.myDocuments(slug).requests(),
  );
  // Items of a request packet show as their packet (one row that opens it), not one by one.
  const packets = useApiQuery(['my-documents', slug, 'packets'], () =>
    api.myDocuments(slug).packets(),
  );
  const items = (requests.data ?? []).filter((r) => !r.packet);
  const sent = packets.data ?? [];
  if (items.length === 0 && sent.length === 0) return null;
  return (
    <section aria-labelledby="next-steps" className="grid gap-2">
      <h2 id="next-steps" className="font-display text-2xl font-bold text-heading">
        Your Next Steps
      </h2>
      <ul className="grid gap-2">
        {sent.map((p) => (
          <li key={p.id} className="rounded-card border border-border p-4" data-testid="packet-row">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-heading">{p.title}</p>
                <p className="text-sm text-muted">
                  Request #{p.reference} · {p.progress.requiredAnswered} of{' '}
                  {p.progress.requiredTotal} required items uploaded
                  {p.dueOn ? ` · due ${dueText(p.dueOn)}` : ''}
                </p>
              </div>
              <Badge tone={PACKET_TONES[p.view]}>{PACKET_LABELS[p.view]}</Badge>
              <Link
                href={`/${slug}/requests/${p.id}`}
                className="inline-flex h-9 items-center rounded-lg border border-action px-3 text-sm font-semibold text-action"
              >
                {p.status === 'OPEN' && p.view !== 'EXPIRED' ? 'Open request' : 'View'}
              </Link>
            </div>
          </li>
        ))}
        {items.map((r) => (
          <li key={r.id} className="rounded-card border border-border p-4">
            <RequestRow slug={slug} request={r} onUpload={() => onUpload(r)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  slug,
  request: r,
  onUpload,
}: {
  slug: string;
  request: MyDocumentRequest;
  onUpload: () => void;
}) {
  const [answering, setAnswering] = useState(false);
  const form = useForm<NotAvailableRequest>({
    resolver: zodResolver(NotAvailableRequest),
    defaultValues: { reason: '' },
  });
  const notAvailable = useApiMutation(
    (body: NotAvailableRequest) => api.myDocuments(slug).notAvailable(r.id, body),
    { invalidate: ['my-documents', slug, 'requests'] },
  );
  const [label, tone] = STATUS[r.status];
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 font-semibold text-heading">{r.title}</p>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="text-sm text-muted">
        {r.service.title}
        {r.dueOn ? `, due ${r.dueOn}` : ''}
      </p>
      {r.instructions ? <p className="text-sm text-text">{r.instructions}</p> : null}
      {r.statusNote ? <p className="text-sm text-text">Note: {r.statusNote}</p> : null}
      {open(r) && !answering ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onUpload} className="bg-firm-button! hover:bg-firm-button-hover!">
            Upload
          </Button>
          <Button variant="secondary" onClick={() => setAnswering(true)}>
            I don&apos;t have this
          </Button>
        </div>
      ) : null}
      {open(r) && answering ? (
        <form
          noValidate
          className="grid gap-2"
          onSubmit={form.handleSubmit((body) => notAvailable.mutate(body))}
        >
          <Input
            label="Tell your firm why"
            error={form.formState.errors.reason?.message}
            {...form.register('reason')}
          />
          {notAvailable.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(notAvailable.error, DOCUMENT_ERRORS)}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={notAvailable.isPending}
              className="bg-firm-button! hover:bg-firm-button-hover!"
            >
              Send
            </Button>
            <Button variant="secondary" onClick={() => setAnswering(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
