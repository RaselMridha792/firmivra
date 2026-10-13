'use client';

import { type MyService, RequestCancellationRequest } from '@firmivra/types';
import { Badge, Button, Card, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  BookOpen,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  FileText,
  Lightbulb,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
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
export const STATUS: Record<
  MyService['status'],
  [string, 'info' | 'success' | 'neutral' | 'warning']
> = {
  PENDING: ['Pending', 'info'],
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
const SERVICE_ICON: Record<MyService['service']['kind'], LucideIcon> = {
  ANNUAL_TAX: FileText,
  QUARTERLY_TAX: CalendarClock,
  BOOKKEEPING: BookOpen,
  PAYROLL: UsersRound,
  TAX_PLANNING: Lightbulb,
  BUSINESS_DEVELOPMENT: BriefcaseBusiness,
  OTHER: FileText,
};
const SERVICE_DESCRIPTION: Record<MyService['service']['kind'], string> = {
  ANNUAL_TAX: 'Preparation and filing of your personal federal and state tax return.',
  QUARTERLY_TAX: 'Estimated tax planning and quarterly tax return support.',
  BOOKKEEPING: 'Monthly bookkeeping, financial reports, and account reconciliation.',
  PAYROLL: 'Payroll processing, tax filings, and employee support.',
  TAX_PLANNING: 'Tax planning and guidance to help you prepare for the year ahead.',
  BUSINESS_DEVELOPMENT: 'Business formation and documentation support.',
  OTHER: 'Track progress and manage documents for this service.',
};
const SERVICE_ICON_TONE: Record<MyService['service']['kind'], string> = {
  ANNUAL_TAX: 'bg-success-soft text-success',
  QUARTERLY_TAX: 'bg-info-soft text-info',
  BOOKKEEPING: 'bg-accent-soft text-firm-primary',
  PAYROLL: 'bg-info-soft text-info',
  TAX_PLANNING: 'bg-accent-soft text-firm-primary',
  BUSINESS_DEVELOPMENT: 'bg-success-soft text-success',
  OTHER: 'bg-accent-soft text-firm-primary',
};
const day = (date: string) =>
  new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const nextStepTarget = (stage: string) => {
  const value = stage.toLowerCase();
  if (/upload|document|file/.test(value)) {
    return { path: 'documents', action: 'Open your documents' };
  }
  if (/appointment|schedule|meeting|consultation/.test(value)) {
    return { path: 'appointments', action: 'Open appointments' };
  }
  if (/payment|invoice|billing|pay/.test(value)) {
    return { path: 'invoices', action: 'Open invoices and payments' };
  }
  return { path: 'messages', action: 'Message the firm about this step' };
};

/** One service card. The existing upload and cancellation actions stay attached to the service. */
export function ServiceCard({ slug, service: s }: { slug: string; service: MyService }) {
  const [asking, setAsking] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
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
  const Icon = SERVICE_ICON[s.service.kind];
  const nextStep = s.stage ? nextStepTarget(s.stage) : null;

  return (
    <Card
      data-testid="service-card"
      variant="elevated"
      className="flex h-full flex-col gap-3 border border-folder-border p-4! transition-shadow hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-xl ${SERVICE_ICON_TONE[s.service.kind]}`}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-base font-bold leading-tight text-heading">
              {s.service.name}
            </h2>
            <Badge tone={tone}>{label}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {s.title}
            {s.taxYear ? ' (' + s.taxYear + ')' : ''}
            {s.package ? ' · ' + s.package : ''}
          </p>
        </div>
      </div>

      <p className="text-sm leading-5 text-muted">{SERVICE_DESCRIPTION[s.service.kind]}</p>

      {s.stage && nextStep ? (
        <Link
          href={'/' + slug + '/' + nextStep.path}
          aria-label={`Next step: ${s.stage}. ${nextStep.action}.`}
          className="flex min-h-[4.25rem] items-center gap-3 rounded-control bg-canvas px-3 py-2.5 transition-colors hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-firm-primary">
            <CalendarCheck aria-hidden className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-eyebrow text-muted">Next Step</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-heading">{s.stage}</p>
          </div>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-link" />
        </Link>
      ) : null}

      <div className="mt-auto flex gap-2">
        <Button
          aria-expanded={detailsOpen}
          aria-controls={'service-details-' + s.id}
          className="min-h-10 min-w-0 flex-1 cursor-pointer whitespace-nowrap px-2 text-xs"
          onClick={() => setDetailsOpen((open) => !open)}
        >
          View Details
        </Button>
        <Link
          href={'/' + slug + '/documents'}
          className="inline-flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-action bg-surface px-2 py-2 text-center text-xs font-semibold text-action hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <FileText aria-hidden className="size-4" />
          Upload Documents
        </Link>
      </div>

      <div
        id={'service-details-' + s.id}
        className={`${detailsOpen ? 'grid' : 'hidden'} gap-3 border-t border-folder-border pt-3`}
      >
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Billing</dt>
          <dd className="text-right font-medium text-heading">{INTERVAL[s.billingInterval]}</dd>
          {s.nextBillingOn ? (
            <>
              <dt className="text-muted">Next billing</dt>
              <dd className="text-right font-medium text-heading">{day(s.nextBillingOn)}</dd>
            </>
          ) : null}
          {s.documentAccessUntil ? (
            <>
              <dt className="text-muted">Documents until</dt>
              <dd className="text-right font-medium text-heading">{day(s.documentAccessUntil)}</dd>
            </>
          ) : null}
        </dl>

        {s.cancelRequestedAt && s.status !== 'CANCELLED' ? (
          <p
            role="status"
            className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning"
          >
            Cancellation requested. The firm will confirm it.
          </p>
        ) : null}

        {canAsk && !asking ? (
          <Button
            variant="outline"
            className="min-h-10 justify-self-start px-3"
            onClick={() => setAsking(true)}
          >
            Request cancellation
          </Button>
        ) : null}

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
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={cancel.isPending}>
                Send request
              </Button>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                Keep service
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
