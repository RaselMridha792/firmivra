'use client';

import { ApiRequestError } from '@firmivra/types';
import { ActionMenu, Button, Skeleton, Timeline, type TimelineItem } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowRight,
  CaretRight,
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  DownloadSimple,
  FilePdf,
  FileText,
  NotePencil,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  Receipt,
  Ticket,
  User,
  UserCircle,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  adminBilling,
  type BillingDocument,
  type InvoiceDetail,
  type InvoiceStatus,
} from '../../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  daysFromToday,
  formatDate,
  formatDateTime,
  formatDayOf,
  formatLongDate,
  formatMoney,
  plural,
  saveFile,
} from '../../_components/billing-format';
import { BILLING_ERRORS, PAYMENT_METHOD_LABELS } from '../../_components/billing-labels';
import {
  BillingCard,
  BillingNotice,
  InvoiceStatusBadge,
  PaymentStatusBadge,
  QuietLine,
  quietErrorText,
  useNotice,
  type Notice,
} from '../../_components/billing-parts';
import { BillingHeader } from '../../_components/billing-shell';
import { InvoiceDocument, type InvoiceDocumentData } from '../../_components/invoice-document';
import { invoiceAbilities, useInvoiceActions } from '../../_components/invoice-actions';

/**
 * Invoice Details (firmivra-invoice-dashboard.jpg, docx §8): the firm-branded invoice, its status
 * and next step, the client, related documents and the invoice actions; under the document the
 * payment history and the audit trail the docx asks for.
 */

const SAVED: Record<string, string> = {
  draft: 'Invoice saved as a draft.',
  sent: 'Invoice saved and sent to the client.',
  issued: 'Invoice saved and issued without an email.',
  updated: 'Invoice changes saved.',
  recurring: 'Invoice saved and set up as a recurring invoice.',
};

const primaryLink =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

interface StatusView {
  title: string;
  text: string;
  icon: Icon;
  box: string;
}

function statusView(invoice: InvoiceDetail): StatusView {
  const c = invoice.currency;
  const days = daysFromToday(invoice.dueDate);
  const due =
    days > 0
      ? `Due in ${plural(days, 'day')} (${formatLongDate(invoice.dueDate)})`
      : days === 0
        ? `Due today (${formatLongDate(invoice.dueDate)})`
        : `${plural(-days, 'day')} past due (${formatLongDate(invoice.dueDate)})`;
  const lastPaid = [...invoice.payments]
    .reverse()
    .find((row) => row.status !== 'FAILED' && row.status !== 'PENDING');
  const views: Record<InvoiceStatus, StatusView> = {
    DRAFT: {
      title: 'Draft',
      text: 'Not sent to the client yet.',
      icon: NotePencil,
      box: 'bg-disabled text-muted',
    },
    PENDING: {
      title: 'Pending Payment',
      text: due,
      icon: Clock,
      box: 'bg-warning-soft text-warning',
    },
    PARTIALLY_PAID: {
      title: 'Partially Paid',
      text: `${formatMoney(invoice.balanceCents, c)} left · ${due}`,
      icon: Clock,
      box: 'bg-info-soft text-info',
    },
    OVERDUE: {
      title: 'Overdue',
      text: `${formatMoney(invoice.balanceCents, c)} · ${due}`,
      icon: WarningCircle,
      box: 'bg-danger-soft text-danger',
    },
    PAID: {
      title: 'Paid in Full',
      text: lastPaid ? `Paid on ${formatLongDate(lastPaid.paidOn)}` : 'Settled with credits',
      icon: CheckCircle,
      box: 'bg-success-soft text-success',
    },
    VOIDED: {
      title: 'Voided',
      text: invoice.voidedAt
        ? `Voided on ${formatDayOf(invoice.voidedAt)}${invoice.voidReason ? `: ${invoice.voidReason}` : ''}`
        : 'Voided',
      icon: Prohibit,
      box: 'bg-disabled text-muted',
    },
    REFUNDED: {
      title: 'Refunded',
      text: `${formatMoney(invoice.refundedCents, c)} refunded`,
      icon: ArrowCounterClockwise,
      box: 'bg-purple-soft text-purple',
    },
    PARTIALLY_REFUNDED: {
      title: 'Partially Refunded',
      text: `${formatMoney(invoice.refundedCents, c)} of ${formatMoney(invoice.paidCents, c)} refunded`,
      icon: ArrowCounterClockwise,
      box: 'bg-purple-soft text-purple',
    },
  };
  return views[invoice.status];
}

const EVENT_ICONS: { match: RegExp; icon: Icon; tone: TimelineItem['tone'] }[] = [
  { match: /^Payment recorded|^Receipt/, icon: CreditCard, tone: 'green' },
  { match: /^Payment (failed|pending)/, icon: WarningCircle, tone: 'amber' },
  { match: /^Credit/, icon: Receipt, tone: 'purple' },
  { match: /^Refund/, icon: ArrowCounterClockwise, tone: 'amber' },
  { match: /^Void/, icon: Prohibit, tone: 'red' },
  { match: /^(Sent|Resent|Issued)/, icon: PaperPlaneTilt, tone: 'blue' },
  { match: /^Edited/, icon: PencilSimple, tone: 'grey' },
  { match: /^Duplicated/, icon: Copy, tone: 'grey' },
  { match: /^Converted/, icon: Ticket, tone: 'purple' },
];

function activityItems(invoice: InvoiceDetail): TimelineItem[] {
  return [...invoice.history].reverse().map((event) => {
    const look = EVENT_ICONS.find((row) => row.match.test(event.action));
    return {
      id: event.id,
      icon: look?.icon ?? FileText,
      tone: look?.tone ?? 'navy',
      title: (
        <>
          <span className="font-semibold">{event.action}</span>
          {event.detail ? `: ${event.detail}` : ''}
          {event.amountCents !== null
            ? ` (${formatMoney(event.amountCents, invoice.currency)})`
            : ''}
        </>
      ),
      time: formatDateTime(event.at),
      dateTime: event.at,
      actor: event.actor,
    };
  });
}

function documentData(invoice: InvoiceDetail): InvoiceDocumentData {
  return {
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    paymentTerms: invoice.paymentTerms,
    type: invoice.type,
    reference: invoice.reference,
    notes: invoice.notes,
    currency: invoice.currency,
    lines: invoice.lines,
    subtotalCents: invoice.subtotalCents,
    discountCents: invoice.discountCents,
    taxCents: invoice.taxCents,
    totalCents: invoice.totalCents,
    paidCents: invoice.paidCents,
    refundedCents: invoice.refundedCents,
    creditedCents: invoice.creditedCents,
    balanceCents: invoice.balanceCents,
  };
}

function ActionRow({
  icon: Glyph,
  label,
  onClick,
  disabled,
  reason,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is off, read on hover and by screen readers. */
  reason?: string;
}) {
  return (
    <li className="border-t border-divider first:border-t-0">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={disabled ? reason : undefined}
        className="flex w-full items-center gap-3 py-2.5 text-left text-sm text-heading hover:text-action disabled:cursor-not-allowed disabled:text-disabled-text"
      >
        <Glyph aria-hidden weight="fill" className="size-5 shrink-0" />
        <span className="flex-1">
          {label}
          {disabled && reason ? <span className="sr-only"> ({reason})</span> : null}
        </span>
        <CaretRight aria-hidden weight="bold" className="size-4 shrink-0" />
      </button>
    </li>
  );
}

/** The page's frames, each with a quiet line, while loading or when the invoice can't load. */
function DetailsFrames({ children }: { children: ReactNode }) {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-4">
      <BillingCard className="xl:col-span-3" testId="invoice-document-card">
        {children}
      </BillingCard>
      <div className="flex min-w-0 flex-col gap-6">
        <BillingCard title="Invoice Status" icon={Clock} iconClassName="text-gold">
          {children}
        </BillingCard>
        <BillingCard title="Client Information" icon={UserCircle}>
          {children}
        </BillingCard>
        <BillingCard title="Related Documents" icon={FileText}>
          {children}
        </BillingCard>
        <BillingCard title="Invoice Actions">{children}</BillingCard>
      </div>
    </div>
  );
}

export function InvoiceDetails({ invoiceId, saved }: { invoiceId: string; saved: string | null }) {
  const router = useRouter();
  const query = useApiQuery(['admin-billing', 'invoice', invoiceId], () =>
    adminBilling.invoice(invoiceId),
  );
  const initial: Notice | null =
    saved && SAVED[saved] ? { tone: 'success', message: SAVED[saved] } : null;
  const [notice, showNotice, clearNotice] = useNotice(initial);
  const actions = useInvoiceActions(showNotice);
  const downloadDoc = useApiMutation((doc: BillingDocument) => adminBilling.download(doc));
  const invoice = query.data;

  if (!invoice) {
    const missing = query.error instanceof ApiRequestError && query.error.code === 'NOT_FOUND';
    const line = query.isLoading ? (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    ) : (
      <QuietLine testId="invoice-error">
        {missing
          ? "We couldn't find this invoice. It may have been removed."
          : quietErrorText(query.error)}
      </QuietLine>
    );
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <BillingHeader
          title="Invoice"
          breadcrumbs={[
            { label: 'Billing', href: '/billing' },
            { label: 'Invoices', href: '/billing' },
            { label: 'Invoice' },
          ]}
          actions={
            <Link href="/billing" className="text-sm font-medium text-action hover:underline">
              Back to Billing
            </Link>
          }
        />
        <DetailsFrames>{line}</DetailsFrames>
      </div>
    );
  }

  const can = invoiceAbilities(invoice);
  const status = statusView(invoice);
  const StatusIcon = status.icon;
  const sendLabel = invoice.sentAt ? 'Resend' : 'Send';
  const failDownload = (error: unknown) =>
    showNotice({ tone: 'error', message: errorMessage(error, BILLING_ERRORS) });
  const completed = invoice.payments;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BillingHeader
        title={`Invoice ${invoice.number}`}
        badge={<InvoiceStatusBadge status={invoice.status} size="lg" />}
        breadcrumbs={[
          { label: 'Billing', href: '/billing' },
          { label: 'Invoices', href: '/billing' },
          { label: invoice.number },
        ]}
        meta={
          <>
            Created on {formatDayOf(invoice.createdAt)}{' '}
            <span aria-hidden className="px-2">
              |
            </span>
            <span className="sr-only">, </span>Last updated {formatDateTime(invoice.updatedAt)}
          </>
        }
        actions={
          <>
            {can.edit ? (
              <Link href={`/billing/invoices/${invoice.id}/edit`} className={primaryLink}>
                <PencilSimple aria-hidden weight="fill" className="size-4" />
                Edit
              </Link>
            ) : (
              <Button disabled>
                <PencilSimple aria-hidden weight="fill" className="size-4" />
                Edit
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={!can.send || actions.sending}
              onClick={() => actions.send(invoice)}
            >
              <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
              Send / Resend
            </Button>
            <Button
              variant="secondary"
              disabled={actions.downloading}
              onClick={() => actions.download(invoice)}
            >
              <FileText aria-hidden weight="fill" className="size-4" />
              Download PDF
            </Button>
            <Button
              variant="secondary"
              disabled={actions.duplicating}
              onClick={() => actions.duplicate(invoice)}
            >
              <Copy aria-hidden weight="fill" className="size-4" />
              Duplicate
            </Button>
            <ActionMenu
              label="More Actions"
              align="right"
              trigger="More Actions"
              className="[&>button]:min-h-11 [&>button]:rounded-control [&>button]:border-border [&>button]:px-4"
              sections={[
                {
                  items: [
                    ...(can.pay
                      ? [
                          {
                            label: 'Record Payment',
                            icon: CreditCard,
                            onSelect: () => actions.open('pay', invoice),
                          },
                        ]
                      : []),
                    ...(can.credit
                      ? [
                          {
                            label: 'Apply Credit Note',
                            icon: Receipt,
                            onSelect: () => actions.open('credit', invoice),
                          },
                        ]
                      : []),
                    ...(can.refund
                      ? [
                          {
                            label: 'Issue Refund',
                            icon: ArrowCounterClockwise,
                            onSelect: () => actions.open('refund', invoice),
                          },
                        ]
                      : []),
                    {
                      label: 'View Payments',
                      icon: CreditCard,
                      onSelect: () => router.push('/billing/payments'),
                    },
                  ],
                },
                ...(can.void
                  ? [
                      {
                        items: [
                          {
                            label: 'Void Invoice',
                            icon: Prohibit,
                            danger: true,
                            onSelect: () => actions.open('void', invoice),
                          },
                        ],
                      },
                    ]
                  : []),
              ]}
            />
          </>
        }
      />

      <div className="grid items-start gap-6 xl:grid-cols-4">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-3">
          <BillingCard testId="invoice-document-card" className="md:p-6">
            <InvoiceDocument
              data={documentData(invoice)}
              firm={invoice.firm}
              client={invoice.client}
            />
          </BillingCard>
          <BillingCard title="Payment History" icon={CreditCard} testId="payment-history">
            {completed.length === 0 && invoice.credits.length === 0 ? (
              <QuietLine>No payments or credits yet.</QuietLine>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-xl text-left text-sm text-text">
                  <caption className="sr-only">Payments and credits on this invoice</caption>
                  <thead className="bg-table-head text-heading">
                    <tr>
                      <th scope="col" className="rounded-l-lg px-3 py-2 font-semibold">
                        Date
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Reference
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Method
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-semibold">
                        Amount
                      </th>
                      <th scope="col" className="rounded-r-lg px-3 py-2 font-semibold">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {completed.map((payment) => (
                      <tr key={payment.id} className="border-t border-divider">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {formatDate(payment.paidOn)}
                        </td>
                        <td className="px-3 py-2.5">
                          {payment.number}
                          <span className="block text-xs text-muted">{payment.reference}</span>
                        </td>
                        <td className="px-3 py-2.5">{PAYMENT_METHOD_LABELS[payment.method]}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {formatMoney(payment.amountCents, payment.currency)}
                          {payment.refundedCents > 0 ? (
                            <span className="block text-xs text-muted">
                              {formatMoney(payment.refundedCents, payment.currency)} refunded
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <PaymentStatusBadge status={payment.status} />
                        </td>
                      </tr>
                    ))}
                    {invoice.credits.map((credit) => (
                      <tr key={credit.id} className="border-t border-divider">
                        <td className="px-3 py-2.5 whitespace-nowrap">{formatDayOf(credit.at)}</td>
                        <td className="px-3 py-2.5">{credit.creditNoteNumber}</td>
                        <td className="px-3 py-2.5">Credit note</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          {formatMoney(credit.amountCents, invoice.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-muted">Applied</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </BillingCard>
          <BillingCard title="Activity" icon={Clock} testId="invoice-activity">
            <Timeline
              items={activityItems(invoice)}
              variant="plain"
              label="Invoice activity"
              emptyText="No activity yet."
            />
          </BillingCard>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <BillingCard
            title="Invoice Status"
            icon={Clock}
            iconClassName="text-gold"
            testId="invoice-status-card"
          >
            <div
              className={`flex flex-col items-center gap-1 rounded-lg p-4 text-center ${status.box}`}
            >
              <p className="flex items-center gap-2 text-lg font-semibold">
                <StatusIcon aria-hidden weight="fill" className="size-6" />
                {status.title}
              </p>
              <p className="text-sm text-text">{status.text}</p>
            </div>
            {invoice.status === 'DRAFT' ? (
              <Button
                className="mt-4 w-full"
                disabled={actions.sending}
                onClick={() => actions.send(invoice)}
              >
                <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                Send Invoice
              </Button>
            ) : can.pay ? (
              <button
                type="button"
                onClick={() => actions.open('pay', invoice)}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-success px-4 text-sm font-medium text-on-action hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <CreditCard aria-hidden weight="fill" className="size-5" />
                Record Payment
              </button>
            ) : null}
          </BillingCard>

          <BillingCard title="Client Information" icon={UserCircle} testId="client-card">
            <div className="flex gap-3">
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-soft text-heading"
              >
                <User weight="fill" className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 text-sm">
                <p className="text-base font-semibold text-heading">{invoice.client.name}</p>
                <p className="text-muted">{invoice.client.contactName}</p>
                <p className="wrap-anywhere text-muted">{invoice.client.email}</p>
                <p className="text-muted">{invoice.client.phone}</p>
                <p className="text-muted">Client #{invoice.client.number}</p>
                <span
                  aria-disabled="true"
                  title="Client profiles open in Leads / CRM once that module is built."
                  className="mt-2 inline-flex items-center gap-1 font-medium text-muted"
                >
                  View Client Profile
                  <ArrowRight aria-hidden weight="bold" className="size-4" />
                  <span className="sr-only">(not available yet)</span>
                </span>
              </div>
            </div>
          </BillingCard>

          <BillingCard title="Related Documents" icon={FileText} testId="related-documents">
            {invoice.documents.length === 0 ? (
              <QuietLine>No documents yet.</QuietLine>
            ) : (
              <ul className="flex flex-col gap-3">
                {invoice.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-3">
                    <FilePdf aria-hidden weight="fill" className="size-7 shrink-0 text-danger" />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold wrap-anywhere text-heading">{doc.fileName}</p>
                      <p className="text-xs text-muted">
                        {doc.description}
                        {doc.date ? ` ${formatDayOf(doc.date)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Download ${doc.fileName}`}
                      title="Download"
                      disabled={downloadDoc.isPending}
                      onClick={() =>
                        downloadDoc.mutate(doc, { onSuccess: saveFile, onError: failDownload })
                      }
                      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-heading hover:bg-canvas disabled:opacity-50"
                    >
                      <DownloadSimple aria-hidden weight="bold" className="size-5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </BillingCard>

          <BillingCard title="Invoice Actions" testId="invoice-actions">
            <ul className="flex flex-col">
              <ActionRow
                icon={PaperPlaneTilt}
                label={`${sendLabel} Invoice`}
                disabled={!can.send || actions.sending}
                reason="A voided invoice can't be sent"
                onClick={() => actions.send(invoice)}
              />
              <ActionRow
                icon={CreditCard}
                label="Record Payment"
                disabled={!can.pay}
                reason="Nothing is owed on this invoice"
                onClick={() => actions.open('pay', invoice)}
              />
              <ActionRow
                icon={Receipt}
                label="Apply Credit Note"
                disabled={!can.credit}
                reason="Credits apply to open invoices only"
                onClick={() => actions.open('credit', invoice)}
              />
              <ActionRow
                icon={ArrowCounterClockwise}
                label="Issue Refund"
                disabled={!can.refund}
                reason="No completed payment to refund"
                onClick={() => actions.open('refund', invoice)}
              />
              <ActionRow
                icon={Prohibit}
                label="Void Invoice"
                disabled={!can.void}
                reason={
                  invoice.status === 'VOIDED'
                    ? 'Already voided'
                    : 'Refund payments and remove credits first'
                }
                onClick={() => actions.open('void', invoice)}
              />
            </ul>
          </BillingCard>
        </div>
      </div>

      {actions.dialogs}
      <BillingNotice notice={notice} onDismiss={clearNotice} />
    </div>
  );
}
