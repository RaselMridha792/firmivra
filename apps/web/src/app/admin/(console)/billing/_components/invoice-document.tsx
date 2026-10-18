'use client';

import { Button, Modal } from '@firmivra/ui';
import { Buildings, DownloadSimple } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import type {
  BillingClient,
  BillingFirm,
  Currency,
  InvoiceType,
  PaymentTerms,
} from '../../../../../mocks/admin-billing';
import { addressLines, formatDate, formatLongDate, formatMoney } from './billing-format';
import { INVOICE_TYPE_LABELS, PAYMENT_TERMS_LABELS } from './billing-labels';

/**
 * The customer-facing invoice, in the selected firm's branding (docx §7.5): never Firmivra's or a
 * sample company's. Invoice Details shows it in full, Create / Edit Invoice as the live preview,
 * and the viewer full size.
 */

/** What the document needs: a saved invoice or the form's live values. */
export interface InvoiceDocumentData {
  number: string;
  issueDate: string;
  dueDate: string;
  paymentTerms: PaymentTerms;
  type: InvoiceType;
  reference: string;
  notes: string;
  currency: Currency;
  lines: {
    id: string;
    description: string;
    quantity: number;
    rateCents: number;
    amountCents: number;
    taxPercent: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  /** Shown under the total when money already came in. */
  paidCents?: number;
  refundedCents?: number;
  creditedCents?: number;
  balanceCents?: number;
}

/** "Tax (7%)" when the taxed lines share one rate, "Tax (0%)" without tax, else "Tax". */
export function taxLabel(lines: { taxPercent: number }[]): string {
  const rates = [...new Set(lines.map((line) => line.taxPercent).filter((rate) => rate > 0))];
  if (rates.length === 0) return 'Tax (0%)';
  return rates.length === 1 ? `Tax (${rates[0]}%)` : 'Tax';
}

/** The firm's mark: its initials on a tile, and its name (no uploaded logos in the mock). */
export function FirmMark({ firm, size = 'md' }: { firm: BillingFirm | null; size?: 'sm' | 'md' }) {
  const initials = firm
    ? firm.name
        .split(/\s+/)
        .filter((word) => /^\p{L}/u.test(word))
        .slice(0, 2)
        .map((word) => word[0]?.toUpperCase() ?? '')
        .join('')
    : '';
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center rounded-xl bg-action font-bold text-on-action ${size === 'md' ? 'size-14 text-xl' : 'size-11 text-base'}`}
      >
        {firm ? initials : <Buildings weight="fill" className="size-6" />}
      </span>
      <span className={`min-w-0 font-bold text-heading ${size === 'md' ? 'text-2xl' : 'text-lg'}`}>
        {firm?.name ?? 'Your Firm Name'}
      </span>
    </div>
  );
}

function ContactLines({
  firm,
  align = 'left',
}: {
  firm: BillingFirm | null;
  align?: 'left' | 'right';
}) {
  return (
    <address
      className={`flex flex-col text-sm text-muted not-italic ${align === 'right' ? 'items-end text-right' : ''}`}
    >
      {firm ? (
        <>
          {addressLines(firm.address).map((line) => (
            <span key={line}>{line}</span>
          ))}
          <span>{firm.phone}</span>
          <span className="wrap-anywhere">{firm.email}</span>
        </>
      ) : (
        <span>Select a firm to load its address and contact details.</span>
      )}
    </address>
  );
}

function Totals({ data, compact }: { data: InvoiceDocumentData; compact?: boolean }) {
  const c = data.currency;
  const rows: [string, number][] = [
    ['Subtotal', data.subtotalCents],
    ...(compact && data.discountCents === 0
      ? []
      : [['Discount', -data.discountCents] as [string, number]]),
    [taxLabel(data.lines), data.taxCents],
  ];
  const paid = (data.paidCents ?? 0) - (data.refundedCents ?? 0);
  const after: [string, number][] = [
    ...(paid > 0 ? [['Amount Paid', -paid] as [string, number]] : []),
    ...((data.creditedCents ?? 0) > 0
      ? [['Credits Applied', -(data.creditedCents ?? 0)] as [string, number]]
      : []),
  ];
  return (
    <dl data-testid="invoice-totals" className="ml-auto flex w-full max-w-sm flex-col text-sm">
      {rows.map(([label, cents]) => (
        <div key={label} className="flex justify-between gap-4 px-3 py-1.5">
          <dt className="text-text">{label}</dt>
          <dd className="text-text">{formatMoney(Math.abs(cents) === 0 ? 0 : cents, c)}</dd>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-4 rounded-lg bg-info-soft px-3 py-2.5 text-base font-bold">
        <dt className="text-heading">Total</dt>
        <dd data-testid="invoice-total" className="text-action">
          {formatMoney(data.totalCents, c)}
        </dd>
      </div>
      {after.map(([label, cents]) => (
        <div key={label} className="flex justify-between gap-4 px-3 py-1.5">
          <dt className="text-text">{label}</dt>
          <dd className="text-text">{formatMoney(cents, c)}</dd>
        </div>
      ))}
      {after.length > 0 && data.balanceCents !== undefined ? (
        <div className="flex justify-between gap-4 border-t border-divider px-3 py-2 font-bold">
          <dt className="text-heading">Balance Due</dt>
          <dd data-testid="invoice-balance" className="text-heading">
            {formatMoney(data.balanceCents, c)}
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * The line items. The full document keeps a minimum width (it scrolls inside its frame on a
 * phone); `compact` (the narrow live preview) drops it and uses tighter cells, so every column
 * fits the preview card.
 */
function LinesTable({
  data,
  numbered,
  compact,
}: {
  data: InvoiceDocumentData;
  numbered?: boolean;
  compact?: boolean;
}) {
  const c = data.currency;
  const cell = compact ? 'px-2 py-2.5' : 'px-3 py-2.5';
  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className={`w-full text-sm text-text ${compact ? '' : 'min-w-md'}`}>
        <caption className="sr-only">Line items</caption>
        <thead className="bg-table-head text-heading">
          <tr>
            {numbered ? (
              <th scope="col" className={`${cell} w-10 text-left font-semibold`}>
                <span aria-hidden>#</span>
                <span className="sr-only">Line</span>
              </th>
            ) : null}
            <th scope="col" className={`${cell} text-left font-semibold`}>
              Description
            </th>
            <th scope="col" className={`${cell} text-center font-semibold`}>
              Qty
            </th>
            <th scope="col" className={`${cell} text-right font-semibold`}>
              Rate
            </th>
            <th scope="col" className={`${cell} text-right font-semibold`}>
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((line, index) => (
            <tr key={line.id} className="border-t border-divider">
              {numbered ? <td className={cell}>{index + 1}</td> : null}
              <td className={`${cell} wrap-anywhere`}>{line.description || 'Item description'}</td>
              <td className={`${cell} text-center`}>{line.quantity}</td>
              <td className={`${cell} text-right whitespace-nowrap`}>
                {formatMoney(line.rateCents, c)}
              </td>
              <td className={`${cell} text-right whitespace-nowrap`}>
                {formatMoney(line.amountCents, c)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Party({ title, name, lines }: { title: string; name: string; lines: string[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-sm">
      <h3 className="font-semibold text-heading">{title}</h3>
      <p className="text-base font-semibold text-action">{name}</p>
      {lines.map((line) => (
        <p key={line} className="wrap-anywhere text-muted">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The invoice as the client will see it. `preview` is the narrow live preview of the form. */
export function InvoiceDocument({
  data,
  firm,
  client,
  variant = 'full',
}: {
  data: InvoiceDocumentData;
  firm: BillingFirm | null;
  client: BillingClient | null;
  variant?: 'full' | 'preview';
}) {
  const facts: [string, ReactNode][] = [
    ['Invoice Number', data.number || '—'],
    ['Invoice Date', data.issueDate ? formatLongDate(data.issueDate) : '—'],
    ['Due Date', data.dueDate ? formatLongDate(data.dueDate) : '—'],
    ['Payment Terms', PAYMENT_TERMS_LABELS[data.paymentTerms]],
    ['Invoice Type', INVOICE_TYPE_LABELS[data.type]],
    ...(data.reference ? [['Reference', data.reference] as [string, ReactNode]] : []),
  ];
  if (variant === 'preview') {
    return (
      <article
        aria-label="Invoice preview"
        data-testid="invoice-preview"
        className="flex flex-col gap-5 rounded-lg border border-divider bg-surface p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-divider pb-5">
          <FirmMark firm={firm} size="sm" />
          <div className="flex flex-col items-end text-right">
            <p className="font-bold text-heading">{firm?.name ?? 'Your Firm Name'}</p>
            <ContactLines firm={firm} align="right" />
          </div>
        </div>
        <div className="flex flex-wrap justify-between gap-4 text-sm">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-semibold text-heading">Bill To</h3>
            {client ? (
              <>
                <p className="text-text">{client.name}</p>
                {addressLines(client.address).map((line) => (
                  <p key={line} className="text-muted">
                    {line}
                  </p>
                ))}
              </>
            ) : (
              <>
                <p className="text-text">Client Name</p>
                <p className="text-muted">Client Address Line 1</p>
                <p className="text-muted">Client Address Line 2</p>
                <p className="text-muted">City, State ZIP</p>
              </>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="font-semibold text-heading">Invoice #</dt>
            <dd className="text-text">{data.number || '—'}</dd>
            <dt className="font-semibold text-heading">Issue Date</dt>
            <dd className="text-text">{data.issueDate ? formatDate(data.issueDate) : '—'}</dd>
            <dt className="font-semibold text-heading">Due Date</dt>
            <dd className="text-text">{data.dueDate ? formatDate(data.dueDate) : '—'}</dd>
            <dt className="font-semibold text-heading">Terms</dt>
            <dd className="text-text">{PAYMENT_TERMS_LABELS[data.paymentTerms]}</dd>
          </dl>
        </div>
        <LinesTable data={data} compact />
        <Totals data={data} compact />
        <p className="text-sm text-text">{firm?.invoiceFooter ?? 'Thank you for your business!'}</p>
      </article>
    );
  }
  return (
    <article
      aria-label={`Invoice ${data.number}`}
      data-testid="invoice-document"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col justify-between gap-6 border-b border-divider pb-6 lg:flex-row">
        <div className="flex min-w-0 flex-col gap-3">
          <FirmMark firm={firm} />
          <div className="pl-1">
            <ContactLines firm={firm} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:w-1/2">
          <h2 className="text-3xl font-bold text-heading">Invoice</h2>
          <dl className="grid grid-cols-5 gap-y-1.5 text-sm md:text-base">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="col-span-2 text-muted">{label}</dt>
                <dd className="col-span-3 font-semibold wrap-anywhere text-heading">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Party
          title="Bill To"
          name={client?.name ?? ''}
          lines={
            client
              ? [client.contactName, client.email, client.phone, ...addressLines(client.address)]
              : []
          }
        />
        <Party
          title="Ship To"
          name={client?.name ?? ''}
          lines={
            client
              ? client.shipTo
                ? [client.shipTo.label, ...addressLines(client.shipTo.address)]
                : ['Same as billing address']
              : []
          }
        />
      </div>
      <LinesTable data={data} numbered />
      <Totals data={data} />
      {data.notes ? (
        <section className="rounded-lg border border-divider bg-subtle p-4 text-sm">
          <h3 className="font-semibold text-heading">Notes</h3>
          <p className="whitespace-pre-line text-text">{data.notes}</p>
        </section>
      ) : null}
      {firm ? (
        <p className="text-sm text-muted">
          {firm.paymentInstructions} {firm.invoiceFooter}
        </p>
      ) : null}
    </article>
  );
}

/** A read-only document in a dialog, with Download PDF (docx §17.5: the shared viewer). */
export function DocumentViewer({
  open,
  title,
  onClose,
  onDownload,
  downloading,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onDownload?: () => void;
  downloading?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {onDownload ? (
            <Button onClick={onDownload} disabled={downloading}>
              <DownloadSimple aria-hidden weight="fill" className="size-4" />
              {downloading ? 'Preparing…' : 'Download PDF'}
            </Button>
          ) : null}
        </>
      }
    >
      {open ? children : null}
    </Modal>
  );
}
