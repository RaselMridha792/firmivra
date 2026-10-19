'use client';

import { Skeleton } from '@firmivra/ui';
import { Copy, FileText, PencilSimple, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { type BillingEstimate } from '../../../../../../mocks/admin-billing';
import { useApiQuery } from '../../../../../../lib/query';
import { formatDate, formatMoney } from '../../_components/billing-format';
import { ESTIMATE_STATUS_LABELS } from '../../_components/billing-labels';
import {
  DetailRow,
  EstimateStatusBadge,
  QuietLine,
  quietErrorText,
} from '../../_components/billing-parts';
import { convertHref, editHref } from './estimate-actions';
import {
  convertBlockedReason,
  estimateAbilities,
  formatStamp,
  PanelButton,
} from './estimate-parts';
import { adminBilling } from '../../_components/billing-api';

/**
 * The Estimate Details panel's body (docx §10.2): status, amount, client and number, the facts,
 * and View / Edit / Convert to Invoice / Duplicate / Delete. The Estimates page shows it as a
 * column at 1440 px and in the kit's Drawer below that.
 */

export interface DetailActions {
  view: (estimate: BillingEstimate) => void;
  duplicate: (estimate: BillingEstimate) => void;
  confirmDelete: (estimate: BillingEstimate) => void;
  duplicating: boolean;
}

function PanelSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-3">
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="w-32" />
      {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
        <Skeleton key={key} />
      ))}
    </div>
  );
}

/**
 * `estimateId` null shows `fallback` (the list is loading, failed or empty); otherwise the
 * estimate loads by id, so it shows even when it is not on the current page of the list.
 */
export function EstimateDetails({
  estimateId,
  fallback,
  actions,
}: {
  estimateId: string | null;
  fallback: ReactNode;
  actions: DetailActions;
}) {
  const query = useApiQuery(['admin-billing', 'estimate', estimateId ?? 'none'], () =>
    estimateId ? adminBilling.estimate(estimateId) : Promise.resolve(null),
  );
  if (!estimateId) return <>{fallback}</>;
  if (query.isLoading) return <PanelSkeleton />;
  if (query.error || !query.data)
    return <QuietLine testId="estimate-details-error">{quietErrorText(query.error)}</QuietLine>;
  const estimate = query.data;
  const can = estimateAbilities(estimate);
  const invoiceId = estimate.convertedInvoiceId;
  return (
    <div data-testid="estimate-details" className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-2">
        <EstimateStatusBadge status={estimate.status} />
        <p data-testid="estimate-details-amount" className="text-2xl font-bold text-heading">
          {formatMoney(estimate.totalCents, estimate.currency)}
        </p>
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-medium wrap-anywhere text-heading">{estimate.clientName}</p>
          <p className="text-sm text-muted">Estimate # {estimate.number}</p>
        </div>
      </div>
      <dl className="flex flex-col border-t border-divider pt-3">
        <DetailRow label="Issue Date">{formatDate(estimate.issueDate)}</DetailRow>
        <DetailRow label="Expiration Date">{formatDate(estimate.expirationDate)}</DetailRow>
        <DetailRow label="Firm">{estimate.firmName}</DetailRow>
        <DetailRow label="Client">{estimate.clientName}</DetailRow>
        <DetailRow label="Status">{ESTIMATE_STATUS_LABELS[estimate.status]}</DetailRow>
        {invoiceId ? (
          <DetailRow label="Invoice">
            <Link
              href={`/billing/invoices/${invoiceId}`}
              className="font-medium text-action hover:underline"
            >
              {estimate.convertedInvoiceNumber ?? 'View invoice'}
            </Link>
          </DetailRow>
        ) : null}
        <DetailRow label="Created By">{estimate.createdBy}</DetailRow>
        <DetailRow label="Created On">{formatStamp(estimate.createdAt)}</DetailRow>
        <DetailRow label="Notes">
          <span className="whitespace-pre-line">{estimate.notes || '—'}</span>
        </DetailRow>
      </dl>
      <div className="flex flex-col gap-2.5">
        <PanelButton
          tone="primary"
          icon={FileText}
          testId="view-estimate"
          onClick={() => actions.view(estimate)}
        >
          View Estimate
        </PanelButton>
        <PanelButton
          icon={PencilSimple}
          href={editHref(estimate.id)}
          disabled={!can.edit}
          title="A converted estimate stays as it was converted."
        >
          Edit Estimate
        </PanelButton>
        {invoiceId ? (
          <PanelButton icon={FileText} href={`/billing/invoices/${invoiceId}`}>
            View Invoice
          </PanelButton>
        ) : (
          <PanelButton
            icon={FileText}
            testId="convert-estimate"
            href={convertHref(estimate.id)}
            disabled={!can.convert}
            title={convertBlockedReason(estimate)}
          >
            Convert to Invoice
          </PanelButton>
        )}
        <PanelButton
          icon={Copy}
          disabled={actions.duplicating}
          onClick={() => actions.duplicate(estimate)}
        >
          {actions.duplicating ? 'Duplicating…' : 'Duplicate Estimate'}
        </PanelButton>
        <PanelButton
          tone="danger"
          icon={Trash}
          disabled={!can.remove}
          title="A converted estimate stays linked to its invoice."
          onClick={() => actions.confirmDelete(estimate)}
        >
          Delete Estimate
        </PanelButton>
      </div>
    </div>
  );
}
