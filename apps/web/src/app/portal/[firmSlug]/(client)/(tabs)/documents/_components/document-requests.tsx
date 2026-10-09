'use client';

import { DOCUMENT_ERRORS, type MyDocumentRequest, NotAvailableRequest } from '@firmivra/types';
import { Badge, Button, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';

const STATUS: Record<
  MyDocumentRequest['status'],
  [string, 'info' | 'success' | 'warning' | 'danger' | 'neutral']
> = {
  REQUESTED: ['Requested', 'warning'],
  REJECTED: ['Needs a new file', 'danger'],
  SUBMITTED: ['Received', 'info'],
  ACCEPTED: ['Accepted', 'success'],
  NOT_AVAILABLE: ["You don't have it", 'neutral'],
  CANCELLED: ['Cancelled', 'neutral'],
};
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
  const items = requests.data ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="next-steps" className="grid gap-2">
      <h2 id="next-steps" className="font-display text-2xl font-bold text-heading">
        Your Next Steps
      </h2>
      <ul className="grid gap-2">
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
          <Button onClick={onUpload}>Upload</Button>
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
            <Button type="submit" disabled={notAvailable.isPending}>
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
