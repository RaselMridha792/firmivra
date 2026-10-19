'use client';

import type { ActionMenuSection } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  CheckCircle,
  DownloadSimple,
  Eye,
  PaperPlaneTilt,
  Prohibit,
  Receipt,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { adminBilling, type BillingCreditNote } from '../../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { ApplyCreditModal } from '../../_components/billing-actions';
import { formatMoney, saveFile } from '../../_components/billing-format';
import { BILLING_ERRORS } from '../../_components/billing-labels';
import type { Notice } from '../../_components/billing-parts';
import { RefundCreditModal, VoidCreditModal } from './credit-note-dialogs';

/**
 * What a credit note can do (docx §13.2): Apply to Invoice, Refund Remaining Balance, Download
 * PDF, Send to Customer and Void, plus Issue for a draft. Shared by the list's row menu and the
 * Credit Note Details drawer; render `dialogs` once on the page.
 */

export type CreditNoteRef = Pick<
  BillingCreditNote,
  'id' | 'number' | 'status' | 'appliedCents' | 'refundedCents'
>;

/** Which actions a credit note allows in its status (the mock refuses the rest anyway). */
export function creditAbilities(note: CreditNoteRef) {
  const open = note.status === 'AVAILABLE' || note.status === 'PARTIALLY_APPLIED';
  return {
    apply: open,
    refund: open,
    issue: note.status === 'DRAFT',
    send: note.status !== 'DRAFT' && note.status !== 'VOIDED',
    void:
      note.status === 'DRAFT' ||
      (note.status === 'AVAILABLE' && note.appliedCents + note.refundedCents === 0),
  };
}

type Dialog = { kind: 'apply' | 'refund' | 'void'; note: BillingCreditNote } | null;

export function useCreditNoteActions(
  onNotice: (notice: Notice) => void,
  onView: (note: BillingCreditNote) => void,
) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const fail = (error: unknown) =>
    onNotice({ tone: 'error', message: errorMessage(error, BILLING_ERRORS) });
  const sendMutation = useApiMutation(
    (note: BillingCreditNote) => adminBilling.sendCreditNote(note.id),
    { invalidate: ['admin-billing'] },
  );
  const issueMutation = useApiMutation(
    (note: BillingCreditNote) => adminBilling.issueCreditNote(note.id),
    { invalidate: ['admin-billing'] },
  );
  const downloadMutation = useApiMutation((note: BillingCreditNote) =>
    adminBilling.download({ kind: 'CREDIT_NOTE', refId: note.id }),
  );

  const open = (kind: NonNullable<Dialog>['kind'], note: BillingCreditNote) =>
    setDialog({ kind, note });
  const close = () => setDialog(null);
  const send = (note: BillingCreditNote) =>
    sendMutation.mutate(note, {
      onSuccess: (sent) =>
        onNotice({ tone: 'success', message: `${sent.number} was sent to ${sent.clientName}.` }),
      onError: fail,
    });
  const issue = (note: BillingCreditNote) =>
    issueMutation.mutate(note, {
      onSuccess: (issued) =>
        onNotice({
          tone: 'success',
          message: `${issued.number} was issued to ${issued.clientName}.`,
        }),
      onError: fail,
    });
  const download = (note: BillingCreditNote) =>
    downloadMutation.mutate(note, { onSuccess: saveFile, onError: fail });

  /** The row menu's sections for one credit note. */
  const menu = (note: BillingCreditNote): ActionMenuSection[] => {
    const can = creditAbilities(note);
    const sections: ActionMenuSection[] = [
      { items: [{ label: 'View Details', icon: Eye, onSelect: () => onView(note) }] },
      {
        items: [
          ...(can.apply
            ? [{ label: 'Apply to Invoice', icon: Receipt, onSelect: () => open('apply', note) }]
            : []),
          ...(can.refund
            ? [
                {
                  label: 'Refund Remaining Balance',
                  icon: ArrowCounterClockwise,
                  onSelect: () => open('refund', note),
                },
              ]
            : []),
        ],
      },
      {
        items: [
          ...(can.issue
            ? [{ label: 'Issue Credit Note', icon: CheckCircle, onSelect: () => issue(note) }]
            : []),
          { label: 'Download PDF', icon: DownloadSimple, onSelect: () => download(note) },
          ...(can.send
            ? [{ label: 'Send to Customer', icon: PaperPlaneTilt, onSelect: () => send(note) }]
            : []),
        ],
      },
      {
        items: can.void
          ? [{ label: 'Void', icon: Prohibit, danger: true, onSelect: () => open('void', note) }]
          : [],
      },
    ];
    return sections.filter((section) => section.items.length > 0);
  };

  const target = dialog?.note ?? null;
  const dialogs: ReactNode = (
    <>
      <ApplyCreditModal
        open={dialog?.kind === 'apply'}
        creditNoteId={target?.id}
        onClose={close}
        onApplied={(note) => {
          const last = note.applications[note.applications.length - 1];
          onNotice({
            tone: 'success',
            message: last
              ? `${formatMoney(last.amountCents, note.currency)} of ${note.number} was applied to ${last.invoiceNumber}.`
              : `${note.number} was applied.`,
          });
        }}
      />
      <RefundCreditModal
        open={dialog?.kind === 'refund'}
        note={target}
        onClose={close}
        onRefunded={(note) => {
          const last = note.refunds[note.refunds.length - 1];
          onNotice({
            tone: 'success',
            message: last
              ? `A refund of ${formatMoney(last.amountCents, note.currency)} was issued on ${note.number}.`
              : `A refund was issued on ${note.number}.`,
          });
        }}
      />
      <VoidCreditModal
        open={dialog?.kind === 'void'}
        note={target}
        onClose={close}
        onVoided={(note) => onNotice({ tone: 'success', message: `${note.number} was voided.` })}
      />
    </>
  );

  return {
    menu,
    open,
    send,
    issue,
    download,
    dialogs,
    sending: sendMutation.isPending,
    issuing: issueMutation.isPending,
    downloading: downloadMutation.isPending,
  };
}

export type CreditNoteActions = ReturnType<typeof useCreditNoteActions>;
