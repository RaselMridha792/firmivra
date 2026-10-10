'use client';

import type { MyInvoiceDetail } from '@firmivra/types';
import { Button, Card } from '@firmivra/ui';
import { ArrowLeft, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { usePortal } from '../../../../layout';
import {
  InvoiceStatus,
  PayButton,
  PayError,
  day,
  money,
  usePay,
} from '../../../(tabs)/invoices/_components/invoice-parts';

/**
 * One invoice ("View"): lines, totals and payments. "Download" is the browser's print of this
 * page (Save as PDF); the portal's menus and footer are left out of the print.
 */
export function InvoiceDetail() {
  const { firmSlug: slug, invoiceId } = useParams<{ firmSlug: string; invoiceId: string }>();
  const invoice = useApiQuery(['my-invoices', slug, 'detail', invoiceId], () =>
    api.myInvoices(slug).get(invoiceId),
  );
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <Link
        href={`/${slug}/invoices`}
        className="inline-flex items-center gap-2 text-link underline print:hidden"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to Receipts &amp; Invoices
      </Link>
      <PageState query={invoice}>{(i) => <InvoiceCard slug={slug} invoice={i} />}</PageState>
    </div>
  );
}

function InvoiceCard({ slug, invoice: i }: { slug: string; invoice: MyInvoiceDetail }) {
  const { business } = usePortal();
  const pay = usePay(slug);
  const m = (cents: number) => money(cents, i.currency);
  const totals: [string, number][] = [
    ['Subtotal', i.subtotalCents],
    ...(i.discountCents > 0 ? [['Discount', -i.discountCents] as [string, number]] : []),
    ['Total', i.totalCents],
    ['Paid', i.amountPaidCents],
    ...(i.refundedCents > 0 ? [['Refunded', i.refundedCents] as [string, number]] : []),
    ['Balance due', i.balanceDueCents],
  ];
  return (
    <Card className="grid min-w-0 gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <p className="text-sm text-muted">{business.name}</p>
          <h1 className="font-display text-3xl font-bold text-heading">Invoice {i.number}</h1>
          <p className="text-text">{i.title}</p>
        </div>
        <InvoiceStatus invoice={i} />
      </header>
      <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div>
          <dt className="text-muted">Issue Date</dt>
          <dd className="text-heading">{day(i.issuedOn)}</dd>
        </div>
        <div>
          <dt className="text-muted">Due Date</dt>
          <dd className={i.overdue ? 'font-semibold text-danger' : 'text-heading'}>
            {i.dueOn ? day(i.dueOn) : 'N/A'}
          </dd>
        </div>
        {i.paidAt ? (
          <div>
            <dt className="text-muted">Paid</dt>
            <dd className="text-heading">{day(i.paidAt)}</dd>
          </div>
        ) : null}
      </dl>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2">Description</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {i.lines.map((l) => (
              <tr key={l.id} className="border-b border-border">
                <td className="py-2 text-heading">{l.description}</td>
                <td className="py-2 text-right">{l.quantity}</td>
                <td className="py-2 text-right">{m(l.unitAmountCents)}</td>
                <td className="py-2 text-right">{m(l.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto grid w-full max-w-xs gap-1 text-sm">
        {totals.map(([label, cents]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-muted">{label}</dt>
            <dd className="font-semibold text-heading">{m(cents)}</dd>
          </div>
        ))}
      </dl>
      {i.payments.length > 0 ? (
        <section aria-labelledby="payments" className="grid gap-2">
          <h2 id="payments" className="font-display text-xl font-bold text-heading">
            Payments
          </h2>
          <ul className="grid gap-1 text-sm">
            {i.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2">
                <span>{day(p.paidAt ?? p.createdAt)}</span>
                <span>
                  {money(p.amountCents, p.currency)}
                  {p.status === 'PENDING' ? ' (processing)' : ''}
                  {p.status === 'FAILED' ? ' (failed)' : ''}
                  {p.refundedCents > 0 ? `, refunded ${money(p.refundedCents, p.currency)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <PayError pay={pay} />
      <div className="flex flex-wrap gap-2 print:hidden">
        {i.canPay ? <PayButton invoice={i} pay={pay} /> : null}
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" /> Print or save as PDF
        </Button>
      </div>
    </Card>
  );
}
