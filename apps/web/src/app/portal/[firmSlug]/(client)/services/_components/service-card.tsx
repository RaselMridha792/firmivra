'use client';

import { type MyService, RequestCancellationRequest } from '@firmivra/types';
import { Badge, Button, Card, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarClock } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';

const SERVICE_ERRORS = {
  TOO_LATE_TO_CANCEL: 'It is too late to cancel before the next billing date. Message the firm.',
  NOT_RECURRING: 'Only recurring services can be cancelled here.',
  INVALID_STATUS: 'This service can no longer be cancelled.',
  FORBIDDEN: 'Only the main account holder can ask to cancel a service.',
};
const STATUS: Record<MyService['status'], [string, 'info' | 'success' | 'neutral' | 'warning']> = {
  PENDING: ['Pending', 'warning'],
  ACTIVE: ['Active', 'success'],
  COMPLETED: ['Completed', 'info'],
  CANCELLED: ['Cancelled', 'neutral'],
};
const INTERVAL: Record<MyService['billingInterval'], string> = {
  ONE_TIME: 'One time',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
};
const day = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** One service: its status, next step and dates, and a cancellation request where allowed. */
export function ServiceCard({ slug, service: s }: { slug: string; service: MyService }) {
  const [asking, setAsking] = useState(false);
  const form = useForm<RequestCancellationRequest>({
    resolver: zodResolver(RequestCancellationRequest),
    defaultValues: { reason: '' },
  });
  const cancel = useApiMutation(
    (body: RequestCancellationRequest) => api.myServices(slug).requestCancellation(s.id, body),
    { invalidate: ['my-services', slug] },
  );
  const [label, tone] = STATUS[s.status];
  const canAsk = s.status === 'ACTIVE' && s.recurring && s.cancelBy && !s.cancelRequestedAt;
  return (
    <Card data-testid="service-card" className="grid h-full grid-cols-1 gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-heading">{s.service.name}</h2>
          <p className="text-sm text-muted">
            {s.title}
            {s.package ? `, ${s.package}` : ''}
          </p>
        </div>
        <Badge tone={tone}>{label}</Badge>
      </div>
      {s.stage ? (
        <p className="flex items-center gap-2 text-sm text-text">
          <CalendarClock aria-hidden className="size-5 shrink-0 text-firm-accent" />
          <span>
            <span className="block font-semibold text-heading">Next Step</span>
            {s.stage}
          </span>
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted">Billing</dt>
        <dd>{INTERVAL[s.billingInterval]}</dd>
        {s.nextBillingOn ? (
          <>
            <dt className="text-muted">Next billing</dt>
            <dd>{day(s.nextBillingOn)}</dd>
          </>
        ) : null}
        {s.documentAccessUntil ? (
          <>
            <dt className="text-muted">Documents until</dt>
            <dd>{day(s.documentAccessUntil)}</dd>
          </>
        ) : null}
      </dl>
      {s.cancelRequestedAt && s.status !== 'CANCELLED' ? (
        <p role="status" className="text-sm text-warning">
          Cancellation requested. The firm will confirm it.
        </p>
      ) : null}
      <div className="mt-auto flex flex-wrap gap-2">
        <Link
          href={`/${slug}/documents`}
          className="inline-flex min-h-11 items-center rounded-control border border-action px-4 text-sm text-action hover:bg-accent-soft"
        >
          Upload Documents
        </Link>
        {canAsk && !asking ? (
          <Button variant="ghost" className="underline" onClick={() => setAsking(true)}>
            Request cancellation
          </Button>
        ) : null}
      </div>
      {canAsk && asking ? (
        <form
          noValidate
          className="grid gap-2"
          onSubmit={form.handleSubmit((body) => cancel.mutate(body))}
        >
          <p className="text-sm text-text">You can ask until {day(s.cancelBy ?? '')}.</p>
          <Input
            label="Reason (optional)"
            error={form.formState.errors.reason?.message}
            {...form.register('reason')}
          />
          {cancel.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(cancel.error, SERVICE_ERRORS)}
            </p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={cancel.isPending}>
              Send request
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Keep service
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
