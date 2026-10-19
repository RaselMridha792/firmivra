'use client';

import type { ActionMenuSection } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  Copy,
  CreditCard,
  DownloadSimple,
  Eye,
  PaperPlaneTilt,
  PencilSimple,
  Prohibit,
  Receipt,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { type BillingInvoice } from '../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import {
  ApplyCreditModal,
  isOpenInvoice,
  RecordPaymentModal,
  RefundModal,
  VoidInvoiceModal,
} from './billing-actions';
import { formatMoney, saveFile } from './billing-format';
import { BILLING_ERRORS } from './billing-labels';
import type { Notice } from './billing-parts';
import { adminBilling } from './billing-api';

/**
 * Everything an invoice can do (docx §6.4, §8.2), shared by the invoice list's row menu and
 * Invoice Details: what is allowed for its status, the actions, and their dialogs.
 */

/** The invoice fields the actions need. */
export type InvoiceRef = Pick<
  BillingInvoice,
  | 'id'
  | 'number'
  | 'status'
  | 'balanceCents'
  | 'paidCents'
  | 'refundedCents'
  | 'creditedCents'
  | 'currency'
>;

/** Which actions an invoice allows in its status (the mock refuses the rest anyway). */
export function invoiceAbilities(invoice: InvoiceRef) {
  const net = invoice.paidCents - invoice.refundedCents;
  return {
    edit: invoice.status !== 'VOIDED' && invoice.status !== 'REFUNDED',
    send: invoice.status !== 'VOIDED',
    pay: isOpenInvoice(invoice),
    credit: isOpenInvoice(invoice),
    refund: net > 0,
    void: invoice.status !== 'VOIDED' && net <= 0 && invoice.creditedCents === 0,
  };
}

type Dialog = { kind: 'pay' | 'credit' | 'refund' | 'void'; invoice: InvoiceRef } | null;

/**
 * The actions with their dialogs. Render `dialogs` once on the page; call `open`, `send`,
 * `download` and `duplicate` from buttons, or use `menu(invoice)` for a RowMenu.
 */
export function useInvoiceActions(onNotice: (notice: Notice) => void) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const fail = (error: unknown) =>
    onNotice({ tone: 'error', message: errorMessage(error, BILLING_ERRORS) });
  const sendMutation = useApiMutation(
    (invoice: InvoiceRef) => adminBilling.sendInvoice(invoice.id),
    {
      invalidate: ['admin-billing'],
    },
  );
  const downloadMutation = useApiMutation((invoice: InvoiceRef) =>
    adminBilling.download({ kind: 'INVOICE', refId: invoice.id }),
  );
  const duplicateMutation = useApiMutation(
    (invoice: InvoiceRef) => adminBilling.duplicateInvoice(invoice.id),
    { invalidate: ['admin-billing'] },
  );

  const open = (kind: NonNullable<Dialog>['kind'], invoice: InvoiceRef) =>
    setDialog({ kind, invoice });
  const close = () => setDialog(null);
  const send = (invoice: InvoiceRef) =>
    sendMutation.mutate(invoice, {
      onSuccess: (sent) =>
        onNotice({ tone: 'success', message: `${sent.number} was sent to ${sent.client.email}.` }),
      onError: fail,
    });
  const download = (invoice: InvoiceRef) =>
    downloadMutation.mutate(invoice, { onSuccess: saveFile, onError: fail });
  const duplicate = (invoice: InvoiceRef) =>
    duplicateMutation.mutate(invoice, {
      onSuccess: (copy) => {
        onNotice({
          tone: 'success',
          message: `${invoice.number} was copied to draft ${copy.number}.`,
        });
        router.push(`/billing/invoices/${copy.id}`);
      },
      onError: fail,
    });

  /** The row menu's sections for one invoice. */
  const menu = (invoice: InvoiceRef): ActionMenuSection[] => {
    const can = invoiceAbilities(invoice);
    const first: ActionMenuSection = {
      items: [
        {
          label: 'View',
          icon: Eye,
          onSelect: () => router.push(`/billing/invoices/${invoice.id}`),
        },
        ...(can.edit
          ? [
              {
                label: 'Edit',
                icon: PencilSimple,
                onSelect: () => router.push(`/billing/invoices/${invoice.id}/edit`),
              },
            ]
          : []),
        ...(can.send
          ? [{ label: 'Send / Resend', icon: PaperPlaneTilt, onSelect: () => send(invoice) }]
          : []),
        { label: 'Download PDF', icon: DownloadSimple, onSelect: () => download(invoice) },
        { label: 'Duplicate', icon: Copy, onSelect: () => duplicate(invoice) },
      ],
    };
    const money: ActionMenuSection = {
      items: [
        ...(can.pay
          ? [{ label: 'Record Payment', icon: CreditCard, onSelect: () => open('pay', invoice) }]
          : []),
        ...(can.credit
          ? [{ label: 'Apply Credit Note', icon: Receipt, onSelect: () => open('credit', invoice) }]
          : []),
        ...(can.refund
          ? [
              {
                label: 'Issue Refund',
                icon: ArrowCounterClockwise,
                onSelect: () => open('refund', invoice),
              },
            ]
          : []),
      ],
    };
    const danger: ActionMenuSection = {
      items: can.void
        ? [{ label: 'Void', icon: Prohibit, danger: true, onSelect: () => open('void', invoice) }]
        : [],
    };
    return [first, money, danger].filter((section) => section.items.length > 0);
  };

  const target = dialog?.invoice ?? null;
  const dialogs: ReactNode = (
    <>
      <RecordPaymentModal
        open={dialog?.kind === 'pay'}
        invoiceId={target?.id}
        onClose={close}
        onRecorded={(payment) =>
          onNotice({
            tone: 'success',
            message: `Payment of ${formatMoney(payment.amountCents, payment.currency)} recorded on ${payment.invoiceNumber}.`,
          })
        }
      />
      <ApplyCreditModal
        open={dialog?.kind === 'credit'}
        invoiceId={target?.id}
        onClose={close}
        onApplied={(note) =>
          onNotice({
            tone: 'success',
            message: `${note.number} was applied to ${target?.number ?? 'the invoice'}.`,
          })
        }
      />
      <RefundModal
        open={dialog?.kind === 'refund'}
        invoiceId={target?.id}
        onClose={close}
        onRefunded={(payment) =>
          onNotice({ tone: 'success', message: `Refund issued on ${payment.number}.` })
        }
      />
      <VoidInvoiceModal
        open={dialog?.kind === 'void'}
        invoice={target}
        onClose={close}
        onVoided={() =>
          onNotice({ tone: 'success', message: `${target?.number ?? 'The invoice'} was voided.` })
        }
      />
    </>
  );

  return {
    menu,
    open,
    send,
    download,
    duplicate,
    dialogs,
    sending: sendMutation.isPending,
    downloading: downloadMutation.isPending,
    duplicating: duplicateMutation.isPending,
  };
}
