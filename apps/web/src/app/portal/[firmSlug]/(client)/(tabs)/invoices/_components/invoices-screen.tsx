'use client';

import {
  CheckoutReturn,
  MY_INVOICE_STATUS_LABELS,
  MyInvoiceStatus,
  type MyInvoice,
  type MyInvoiceView,
  type MyInvoiceSection,
} from '@firmivra/types';
import { type Column, Input, Select, Table } from '@firmivra/ui';
import { Eye, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useDeferredValue, useEffect, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { usePortal } from '../../../../layout';
import { InvoiceStatus, PayButton, PayError, day, money, usePay } from './invoice-parts';

const VIEWS: [MyInvoiceView, string][] = [
  ['ALL', 'All Invoices'],
  ['DUE', 'Due Invoices'],
  ['PAID', 'Paid Invoices'],
  ['UPCOMING', 'Upcoming Invoices'],
  ['CANCELED', 'Canceled Invoices'],
];

/**
 * "Receipts & Invoices" (docs/mockups/client-portal/invoices tab.png, N09): the open and upcoming
 * invoices with Pay Now, and the Past Invoices. Stripe sends the client back here with
 * `?checkout=`; a success shows once and the list is fetched again until the payment shows.
 */
export function InvoicesScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const { business } = usePortal();
  const back = CheckoutReturn.parse(Object.fromEntries(useSearchParams()));
  const [view, setView] = useState<MyInvoiceView>('ALL');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const query = {
    view,
    status: status ? MyInvoiceStatus.parse(status) : undefined,
    search: term || undefined,
    limit: 100,
  };
  const list = useApiQuery(['my-invoices', slug, query], () => api.myInvoices(slug).list(query));
  const pay = usePay(slug);
  const { refetch } = list;
  useEffect(() => {
    if (back.checkout !== 'success') return;
    const timer = setTimeout(() => void refetch(), 3000);
    return () => clearTimeout(timer);
  }, [back.checkout, refetch]);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 rounded-card bg-surface p-4 md:p-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-start">
        <Receipt
          aria-hidden
          className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary"
        />
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold text-heading">Receipts &amp; Invoices</h1>
          <p className="text-text">
            View and manage your invoices from {business.name}. Pay securely, download copies, and
            keep your records in one place.
          </p>
        </div>
      </header>
      {back.checkout === 'success' ? (
        <p role="status" className="rounded-card bg-success-soft p-3 text-sm text-success">
          Thank you. Your payment was submitted; the invoice shows as paid once it is confirmed.
        </p>
      ) : back.checkout === 'canceled' ? (
        <p role="status" className="rounded-card bg-folder-surface p-3 text-sm text-text">
          The payment was canceled. Nothing was charged.
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        <Select
          label="Show"
          value={view}
          onChange={(e) => setView(e.target.value as MyInvoiceView)}
          options={VIEWS.map(([value, label]) => ({ value, label }))}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'All Statuses' },
            ...MyInvoiceStatus.options.map((s) => ({
              value: s,
              label: MY_INVOICE_STATUS_LABELS[s],
            })),
          ]}
        />
        <Input
          label="Search"
          type="search"
          placeholder="Search invoices…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <PayError pay={pay} />
      {pay.isSuccess && !pay.data.url.startsWith('https://') ? (
        <p role="status" className="text-sm text-muted">
          Mock data: the checkout opens Stripe once the payments API is on.
        </p>
      ) : null}
      <PageState query={list}>
        {(data) => (
          <>
            {data.paymentsEnabled ? null : (
              <p className="rounded-card bg-folder-surface p-3 text-sm text-text">
                Online payment is not available yet. Please contact {business.name} to pay.
              </p>
            )}
            <InvoiceTable slug={slug} section="CURRENT" rows={data.items} pay={pay} />
            <h2 className="font-display text-2xl font-bold text-heading">Past Invoices</h2>
            <InvoiceTable slug={slug} section="PAST" rows={data.items} pay={pay} />
          </>
        )}
      </PageState>
    </div>
  );
}

function InvoiceTable({
  slug,
  section,
  rows,
  pay,
}: {
  slug: string;
  section: MyInvoiceSection;
  rows: MyInvoice[];
  pay: ReturnType<typeof usePay>;
}) {
  const current = section === 'CURRENT';
  const columns: Column<MyInvoice>[] = [
    { id: 'number', label: 'Invoice #', cell: (i) => i.number },
    { id: 'service', label: 'Service', cell: (i) => i.title },
    { id: 'issued', label: 'Issue Date', cell: (i) => day(i.issuedOn) },
    {
      id: 'due',
      label: 'Due Date',
      cell: (i) =>
        i.dueOn ? (
          <span className={i.overdue ? 'font-semibold text-danger' : undefined}>
            {day(i.dueOn)}
          </span>
        ) : (
          'N/A'
        ),
    },
    {
      id: 'amount',
      label: 'Amount',
      cell: (i) => money(current ? i.balanceDueCents : i.totalCents, i.currency),
    },
    { id: 'status', label: 'Status', cell: (i) => <InvoiceStatus invoice={i} /> },
    {
      id: 'actions',
      label: 'Actions',
      cell: (i) => (
        <span className="flex flex-wrap items-center gap-3">
          {i.canPay ? <PayButton invoice={i} pay={pay} /> : null}
          <Link
            href={`/${slug}/invoices/${i.id}`}
            className="inline-flex items-center gap-1 text-link underline"
            aria-label={`View ${i.number}`}
          >
            <Eye aria-hidden className="size-4" /> View
          </Link>
        </span>
      ),
    },
  ];
  return (
    <Table
      caption={current ? 'Current invoices' : 'Past invoices'}
      rows={rows.filter((i) => i.section === section)}
      columns={columns}
      rowKey={(i) => i.id}
      pageSize={10}
      emptyTitle={current ? 'Nothing to pay' : 'No past invoices'}
      emptyText={
        current ? 'Open and upcoming invoices will appear here.' : 'Paid and canceled invoices.'
      }
    />
  );
}
