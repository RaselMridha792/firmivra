'use client';

import { Badge, Card } from '@firmivra/ui';
import { CalendarCheck, CreditCard } from 'lucide-react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { ButtonLink } from '../../../../(public)/_components/button-link';
import { day, money } from '../../invoices/_components/invoice-parts';

/** Each tax year's status as the firm set it (the firm's own status names), with its note. */
export function TaxYearStatus({ slug }: { slug: string }) {
  const years = useApiQuery(['my-profile', slug, 'tax-years'], () =>
    api.myProfile(slug).taxYears(),
  );
  return (
    <Card className="grid min-w-0 content-start gap-3">
      <h2 className="flex items-center gap-2 font-display text-xl font-bold text-heading">
        <CalendarCheck aria-hidden className="size-6 text-firm-primary" /> Where Your Taxes Stand
      </h2>
      <PageState query={years} empty="Your firm hasn't set a status for any year yet.">
        {(items) => (
          <ul aria-label="Tax year status" className="grid gap-2">
            {items.map((y) => (
              <li key={y.taxYear} className="grid gap-1 border-b border-border pb-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="flex-1 font-semibold text-heading">{y.taxYear}</span>
                  <Badge tone="info">{y.status}</Badge>
                </span>
                {y.clientNote ? <span className="text-sm text-text">{y.clientNote}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </Card>
  );
}

/** "Tax Return Payment": the soonest invoice still to pay, with a link to pay it. */
export function TaxPaymentCard({ slug }: { slug: string }) {
  const due = useApiQuery(['my-invoices', slug, { view: 'DUE', section: 'CURRENT' }], () =>
    api.myInvoices(slug).list({ view: 'DUE', section: 'CURRENT', limit: 1 }),
  );
  const next = due.data?.items[0];
  return (
    <Card className="grid min-w-0 content-start gap-3">
      <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-bold text-heading">
        <CreditCard aria-hidden className="size-6 text-firm-primary" />
        <span className="flex-1">Tax Return Payment</span>
        {next ? <Badge tone="info">Payment Due</Badge> : null}
      </h2>
      {next ? (
        <>
          <p className="text-sm text-text">You have a balance due for {next.title}.</p>
          <p className="font-display text-3xl font-bold text-heading">
            {money(next.balanceDueCents, next.currency)}
          </p>
          {next.dueOn ? <p className="text-sm text-text">Due by {day(next.dueOn)}</p> : null}
          <ButtonLink href={`/${slug}/invoices`}>Make a Payment</ButtonLink>
        </>
      ) : (
        <p className="text-sm text-text">
          {due.isPending
            ? 'Loading…'
            : due.isError
              ? "We couldn't load your invoices. Open Receipts & Invoices to try again."
              : 'Nothing to pay right now.'}
        </p>
      )}
    </Card>
  );
}
