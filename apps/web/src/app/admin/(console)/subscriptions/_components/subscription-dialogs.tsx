'use client';

import {
  ActivityLogDialog,
  AddSubscriptionDialog,
  ExportDialog,
  NoteDialog,
  SupportViewDialog,
} from './account-dialogs';
import {
  BillingDateDialog,
  DiscountDialog,
  PaymentLinkDialog,
  ResendInvoiceDialog,
  RetryDialog,
} from './billing-dialogs';
import {
  CancelDialog,
  CloseDialog,
  ExtendTrialDialog,
  ReactivateDialog,
  ReverseDialog,
  SuspendDialog,
} from './lifecycle-dialogs';
import { AddonsDialog, ChangePlanDialog, ConvertDialog, SeatsDialog } from './plan-dialogs';

/** Every action the docx names, each a dialog on this page (no routes). */
export type DialogKind =
  | 'changePlan'
  | 'seats'
  | 'addons'
  | 'extendTrial'
  | 'convert'
  | 'cancel'
  | 'autoRenewOff'
  | 'reverse'
  | 'suspend'
  | 'reactivate'
  | 'retry'
  | 'note'
  | 'activity'
  | 'discount'
  | 'paymentLink'
  | 'cardUpdate'
  | 'resendInvoice'
  | 'billingDate'
  | 'supportView'
  | 'close';

export type DialogState =
  | { kind: DialogKind; id: string; firm: string; invoiceId?: string }
  | { kind: 'add'; trial: boolean }
  | { kind: 'export'; ids: string[]; scope: string }
  | null;

export function SubscriptionDialog({
  dialog,
  onClose,
  onDone,
}: {
  dialog: DialogState;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  if (!dialog) return null;
  if (dialog.kind === 'add')
    return <AddSubscriptionDialog trial={dialog.trial} onClose={onClose} onDone={onDone} />;
  if (dialog.kind === 'export')
    return <ExportDialog ids={dialog.ids} scope={dialog.scope} onClose={onClose} onDone={onDone} />;
  const props = { id: dialog.id, firm: dialog.firm, onClose, onDone };
  switch (dialog.kind) {
    case 'changePlan':
      return <ChangePlanDialog {...props} />;
    case 'seats':
      return <SeatsDialog {...props} />;
    case 'addons':
      return <AddonsDialog {...props} />;
    case 'extendTrial':
      return <ExtendTrialDialog {...props} />;
    case 'convert':
      return <ConvertDialog {...props} />;
    case 'cancel':
      return <CancelDialog {...props} mode="cancel" />;
    case 'autoRenewOff':
      return <CancelDialog {...props} mode="off" />;
    case 'reverse':
      return <ReverseDialog {...props} />;
    case 'suspend':
      return <SuspendDialog {...props} />;
    case 'reactivate':
      return <ReactivateDialog {...props} />;
    case 'retry':
      return <RetryDialog {...props} />;
    case 'note':
      return <NoteDialog {...props} />;
    case 'activity':
      return <ActivityLogDialog {...props} />;
    case 'discount':
      return <DiscountDialog {...props} />;
    case 'paymentLink':
      return <PaymentLinkDialog {...props} purpose="BALANCE" />;
    case 'cardUpdate':
      return <PaymentLinkDialog {...props} purpose="CARD_UPDATE" />;
    case 'resendInvoice':
      return <ResendInvoiceDialog {...props} invoiceId={dialog.invoiceId} />;
    case 'billingDate':
      return <BillingDateDialog {...props} />;
    case 'supportView':
      return <SupportViewDialog {...props} />;
    case 'close':
      return <CloseDialog {...props} />;
  }
}
