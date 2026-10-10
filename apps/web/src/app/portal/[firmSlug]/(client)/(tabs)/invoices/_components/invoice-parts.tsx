'use client';

import {
  INVOICE_ERRORS,
  MY_INVOICE_STATUS_LABELS,
  type MyInvoice,
  type MyInvoiceStatus,
} from '@firmivra/types';
import { Badge, Button } from '@firmivra/ui';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';

const TONE: Record<MyInvoiceStatus, 'info' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  PENDING: 'warning',
  DUE_SOON: 'danger',
  PAID: 'success',
  UPCOMING: 'info',
  CANCELED: 'neutral',
};

export const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(
    cents / 100,
  );

export const day = (date: string) =>
  new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** The client's status, or "Processing" while Stripe confirms a payment. */
export function InvoiceStatus({ invoice }: { invoice: MyInvoice }) {
  if (invoice.paymentProcessing) return <Badge tone="info">Processing</Badge>;
  return <Badge tone={TONE[invoice.status]}>{MY_INVOICE_STATUS_LABELS[invoice.status]}</Badge>;
}

/**
 * Pay Now: asks the API for a Stripe checkout and goes there. Only Stripe's https link is
 * followed; mock mode's `mock:` link opens nothing.
 */
export function usePay(slug: string) {
  return useApiMutation(async (id: string) => {
    const link = await api.myInvoices(slug).pay(id);
    if (link.url.startsWith('https://')) window.location.assign(link.url);
    return link;
  });
}

export function PayButton({
  invoice,
  pay,
}: {
  invoice: MyInvoice;
  pay: ReturnType<typeof usePay>;
}) {
  return (
    <Button
      disabled={pay.isPending}
      onClick={() => pay.mutate(invoice.id)}
      aria-label={`Pay ${invoice.number} now`}
    >
      Pay Now
    </Button>
  );
}

export function PayError({ pay }: { pay: ReturnType<typeof usePay> }) {
  return pay.isError ? (
    <p role="alert" className="text-sm text-danger">
      {errorMessage(pay.error, INVOICE_ERRORS)}
    </p>
  ) : null;
}
