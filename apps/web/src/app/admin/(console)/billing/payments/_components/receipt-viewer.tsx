'use client';

import { Skeleton } from '@firmivra/ui';
import {
  adminBilling,
  type BillingFirm,
  type BillingPayment,
} from '../../../../../../mocks/admin-billing';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  addressLines,
  formatDate,
  formatDayOf,
  formatMoney,
  saveFile,
} from '../../_components/billing-format';
import { PAYMENT_METHOD_LABELS } from '../../_components/billing-labels';
import { quietErrorText } from '../../_components/billing-parts';
import { DocumentViewer, FirmMark } from '../../_components/invoice-document';

/**
 * The Receipt Viewer (docx §16, §17.5): the firm-branded receipt of one payment, read-only, with
 * Download PDF. It shows the paying firm's name and contact details, never the console's.
 */

export function ReceiptViewer({
  payment,
  onClose,
  onFailed,
}: {
  payment: BillingPayment | null;
  onClose: () => void;
  onFailed: (error: unknown) => void;
}) {
  const firm = useApiQuery(['admin-billing', 'firm', payment?.firmId ?? 'none'], () =>
    payment ? adminBilling.firm(payment.firmId) : Promise.resolve(null),
  );
  const download = useApiMutation((id: string) =>
    adminBilling.download({ kind: 'RECEIPT', refId: id }),
  );
  return (
    <DocumentViewer
      open={payment !== null}
      title={payment ? `Receipt ${payment.number}` : 'Receipt'}
      onClose={onClose}
      onDownload={() =>
        payment && download.mutate(payment.id, { onSuccess: saveFile, onError: onFailed })
      }
      downloading={download.isPending}
    >
      {payment ? (
        <ReceiptDocument
          payment={payment}
          firm={firm.data ?? null}
          firmLoading={firm.isLoading}
          firmError={firm.error}
        />
      ) : null}
    </DocumentViewer>
  );
}

function ReceiptDocument({
  payment,
  firm,
  firmLoading,
  firmError,
}: {
  payment: BillingPayment;
  firm: BillingFirm | null;
  firmLoading: boolean;
  firmError: unknown;
}) {
  const c = payment.currency;
  const rows: [string, string][] = [
    ['Received from', payment.clientName],
    ['Invoice', payment.invoiceNumber],
    ['Payment date', formatDate(payment.paidOn)],
    ['Payment method', PAYMENT_METHOD_LABELS[payment.method]],
    ['Reference', payment.reference],
  ];
  return (
    <article
      data-testid="receipt-document"
      className="flex w-full max-w-xl flex-col gap-5 rounded-xl border border-divider p-5 text-sm"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          {firmLoading ? <Skeleton className="h-11 w-48" /> : <FirmMark firm={firm} size="sm" />}
          {firm ? (
            <address className="flex flex-col text-muted not-italic">
              {addressLines(firm.address).map((line) => (
                <span key={line}>{line}</span>
              ))}
              <span>{firm.phone}</span>
              <span className="wrap-anywhere">{firm.email}</span>
            </address>
          ) : firmError ? (
            <p className="text-muted">{quietErrorText(firmError)}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end text-right">
          <p className="text-2xl font-bold tracking-wide text-heading">RECEIPT</p>
          <p className="text-muted">{payment.number}</p>
        </div>
      </header>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 sm:flex-col sm:justify-start">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium text-heading">{value}</dd>
          </div>
        ))}
      </dl>
      <dl className="flex flex-col gap-1 rounded-lg bg-canvas p-4">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">Amount paid</dt>
          <dd className="font-semibold text-heading">{formatMoney(payment.amountCents, c)}</dd>
        </div>
        {payment.refunds.map((refund) => (
          <div key={refund.id} className="flex justify-between gap-4">
            <dt className="text-muted">
              Refund {refund.confirmation} ({formatDayOf(refund.at)})
            </dt>
            <dd className="text-heading">−{formatMoney(refund.amountCents, c)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-4 border-t border-divider pt-2 text-base">
          <dt className="font-semibold text-heading">Net received</dt>
          <dd data-testid="receipt-net" className="font-bold text-heading">
            {formatMoney(payment.amountCents - payment.refundedCents, c)}
          </dd>
        </div>
      </dl>
      <p className="text-muted">Thank you for your payment.</p>
    </article>
  );
}
