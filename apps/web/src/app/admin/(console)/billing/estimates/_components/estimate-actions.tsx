'use client';

import { Button, Modal, type ActionMenuSection } from '@firmivra/ui';
import {
  ArrowSquareOut,
  CheckCircle,
  Copy,
  DownloadSimple,
  Eye,
  FileText,
  PaperPlaneTilt,
  PencilSimple,
  Receipt,
  Trash,
  XCircle,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  type BillingEstimate,
  type EstimateSetStatus,
} from '../../../../../../mocks/admin-billing';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { saveFile } from '../../_components/billing-format';
import { BILLING_ERRORS, ESTIMATE_STATUS_LABELS } from '../../_components/billing-labels';
import type { Notice } from '../../_components/billing-parts';
import { EstimateViewer } from './estimate-document';
import { estimateAbilities } from './estimate-parts';
import { adminBilling } from '../../_components/billing-api';

/**
 * Everything an estimate can do (docx §10.2), shared by the row menu and the Estimate Details
 * panel: view, edit, send, approve or decline, convert, duplicate, download and delete.
 */

/** The edit page and the conversion (Create Invoice filled from the estimate, docx §10.2). */
export const editHref = (id: string) => `/billing/estimates/${id}/edit`;
export const convertHref = (id: string) => `/billing/invoices/new?estimate=${id}`;

export function useEstimateActions(
  showNotice: (notice: Notice) => void,
  options: {
    /** The row menu's "View Details": open the panel on this estimate. */
    onDetails?: (estimate: BillingEstimate) => void;
    /** A copy was made: show it. */
    onDuplicated?: (copy: BillingEstimate) => void;
    /** It was deleted: let go of it. */
    onDeleted?: (id: string) => void;
  } = {},
) {
  const router = useRouter();
  const [viewing, setViewing] = useState<BillingEstimate | null>(null);
  const [deleting, setDeleting] = useState<BillingEstimate | null>(null);
  const fail = (error: Error) =>
    showNotice({ tone: 'error', message: errorMessage(error, BILLING_ERRORS) });

  const send = useApiMutation((id: string) => adminBilling.sendEstimate(id), {
    invalidate: ['admin-billing'],
  });
  const setStatus = useApiMutation(
    (input: { id: string; status: EstimateSetStatus }) =>
      adminBilling.setEstimateStatus(input.id, input.status),
    { invalidate: ['admin-billing'] },
  );
  const duplicate = useApiMutation((id: string) => adminBilling.duplicateEstimate(id), {
    invalidate: ['admin-billing'],
  });
  const remove = useApiMutation((id: string) => adminBilling.deleteEstimate(id), {
    invalidate: ['admin-billing'],
  });
  const download = useApiMutation((id: string) =>
    adminBilling.download({ kind: 'ESTIMATE', refId: id }),
  );

  const busy = send.isPending || setStatus.isPending || duplicate.isPending || remove.isPending;

  function doSend(estimate: BillingEstimate) {
    send.mutate(estimate.id, {
      onSuccess: (saved) =>
        showNotice({
          tone: 'success',
          message: `${saved.number} sent to ${saved.email || saved.clientName}.`,
        }),
      onError: fail,
    });
  }
  function doStatus(estimate: BillingEstimate, status: EstimateSetStatus) {
    setStatus.mutate(
      { id: estimate.id, status },
      {
        onSuccess: (saved) =>
          showNotice({
            tone: 'success',
            message: `${saved.number} marked as ${ESTIMATE_STATUS_LABELS[saved.status].toLowerCase()}.`,
          }),
        onError: fail,
      },
    );
  }
  function doDuplicate(estimate: BillingEstimate) {
    duplicate.mutate(estimate.id, {
      onSuccess: (copy) => {
        showNotice({
          tone: 'success',
          message: `${copy.number} created as a draft copy of ${estimate.number}.`,
        });
        options.onDuplicated?.(copy);
      },
      onError: fail,
    });
  }
  function doDownload(estimate: BillingEstimate) {
    download.mutate(estimate.id, { onSuccess: saveFile, onError: fail });
  }

  /** The row menu: what the estimate allows in its status. */
  function menu(estimate: BillingEstimate): ActionMenuSection[] {
    const can = estimateAbilities(estimate);
    const invoiceId = estimate.convertedInvoiceId;
    return [
      {
        items: [
          ...(options.onDetails
            ? [
                {
                  label: 'View Details',
                  icon: Eye,
                  onSelect: () => options.onDetails?.(estimate),
                },
              ]
            : []),
          { label: 'View Estimate', icon: FileText, onSelect: () => setViewing(estimate) },
          ...(can.edit
            ? [
                {
                  label: 'Edit Estimate',
                  icon: PencilSimple,
                  onSelect: () => router.push(editHref(estimate.id)),
                },
              ]
            : []),
          { label: 'Download PDF', icon: DownloadSimple, onSelect: () => doDownload(estimate) },
        ],
      },
      {
        items: [
          ...(can.send
            ? [
                {
                  label: estimate.sentAt ? 'Resend Estimate' : 'Send Estimate',
                  icon: PaperPlaneTilt,
                  onSelect: () => doSend(estimate),
                },
              ]
            : []),
          ...(can.approve
            ? [
                {
                  label: 'Mark as Approved',
                  icon: CheckCircle,
                  onSelect: () => doStatus(estimate, 'APPROVED'),
                },
              ]
            : []),
          ...(can.decline
            ? [
                {
                  label: 'Mark as Declined',
                  icon: XCircle,
                  onSelect: () => doStatus(estimate, 'DECLINED'),
                },
              ]
            : []),
          ...(can.convert
            ? [
                {
                  label: 'Convert to Invoice',
                  icon: Receipt,
                  onSelect: () => router.push(convertHref(estimate.id)),
                },
              ]
            : []),
          ...(invoiceId
            ? [
                {
                  label: `View Invoice ${estimate.convertedInvoiceNumber ?? ''}`.trim(),
                  icon: ArrowSquareOut,
                  onSelect: () => router.push(`/billing/invoices/${invoiceId}`),
                },
              ]
            : []),
        ],
      },
      {
        items: [
          { label: 'Duplicate Estimate', icon: Copy, onSelect: () => doDuplicate(estimate) },
          ...(can.remove
            ? [
                {
                  label: 'Delete Estimate',
                  icon: Trash,
                  danger: true,
                  onSelect: () => setDeleting(estimate),
                },
              ]
            : []),
        ],
      },
    ].filter((section) => section.items.length > 0);
  }

  const dialogs: ReactNode = (
    <>
      <EstimateViewer estimate={viewing} onClose={() => setViewing(null)} />
      <Modal
        open={deleting !== null}
        title="Delete Estimate"
        onClose={() => {
          setDeleting(null);
          remove.reset();
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleting(null);
                remove.reset();
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={remove.isPending || deleting === null}
              onClick={() => {
                if (!deleting) return;
                const target = deleting;
                remove.mutate(target.id, {
                  onSuccess: () => {
                    setDeleting(null);
                    showNotice({ tone: 'success', message: `${target.number} deleted.` });
                    options.onDeleted?.(target.id);
                  },
                });
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete Estimate'}
            </Button>
          </>
        }
      >
        {deleting ? (
          <div className="flex max-w-md flex-col gap-3">
            <p className="text-sm text-text">
              Delete {deleting.number} for {deleting.clientName}? It is removed from the estimates
              list and can&apos;t be restored.
            </p>
            {remove.error ? (
              <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
                {errorMessage(remove.error, BILLING_ERRORS)}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );

  return {
    menu,
    view: (estimate: BillingEstimate) => setViewing(estimate),
    duplicate: doDuplicate,
    confirmDelete: (estimate: BillingEstimate) => setDeleting(estimate),
    duplicating: duplicate.isPending,
    busy,
    dialogs,
  };
}
