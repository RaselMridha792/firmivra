'use client';

import type { Invoice } from '@firmivra/types';
import { Modal } from '@firmivra/ui';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { dayText, INV_KEY, money } from './inv-shared';

/**
 * Invoices Review 2 I-N08: Preview on an existing invoice opens here, on screen: what the client is
 * billed (the lines, the totals and the note), read from the invoice itself. Download PDF stays
 * the separate file. Nothing changes and nothing is sent.
 */
export function InvoicePreviewDialog({
  invoiceId,
  onClose,
}: {
  invoiceId: string;
  onClose: () => void;
}) {
  const q = useApiQuery([...INV_KEY, 'one', invoiceId], () => api.invoices.get(invoiceId));
  return (
    <Modal
      open
      title="Invoice preview"
      subtitle="What your client sees. Nothing is changed or sent."
      onClose={onClose}
    >
      {q.data ? (
        <PreviewBody invoice={q.data} />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-danger">
          This invoice can&apos;t be shown right now.
        </p>
      ) : (
        <p className="text-sm text-muted">Loading the invoice…</p>
      )}
    </Modal>
  );
}

function PreviewBody({ invoice: i }: { invoice: Invoice }) {
  const row = (label: string, value: string, strong = false) => (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-semibold text-heading' : 'text-muted'}>{label}</dt>
      <dd className={strong ? 'font-semibold text-heading' : 'text-text'}>{value}</dd>
    </div>
  );
  return (
    <div data-testid="invoice-preview" className="flex flex-col gap-3 text-sm text-text">
      <div className="flex flex-wrap justify-between gap-2">
        <p>
          <span className="block text-xs text-muted">Bill to</span>
          <span className="font-semibold text-heading">{i.client.displayName}</span>
        </p>
        <p className="text-right">
          <span className="block text-xs text-muted">Invoice</span>
          <span className="font-semibold text-heading">{i.number}</span>
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-muted">Issued</dt>
          <dd>{dayText(i.issuedAt ?? i.scheduledFor)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Due</dt>
          <dd>{dayText(i.dueOn)}</dd>
        </div>
      </dl>
      <table className="w-full text-left">
        <caption className="sr-only">The invoice&apos;s lines</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th scope="col" className="py-1 font-medium">
              Description
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Qty
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {i.lines.map((l) => (
            <tr key={l.id} className="border-t border-divider">
              <td className="py-1 wrap-anywhere">{l.description}</td>
              <td className="py-1 text-right">{l.quantity}</td>
              <td className="py-1 text-right">{money(l.amountCents, i.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="flex flex-col gap-1 border-t border-divider pt-2">
        {row('Subtotal', money(i.subtotalCents, i.currency))}
        {i.discountCents > 0 ? row('Discount', `−${money(i.discountCents, i.currency)}`) : null}
        {i.tax ? row(i.tax.name, money(i.tax.cents, i.currency)) : null}
        {row('Total', money(i.totalCents, i.currency), true)}
        {i.amountPaidCents > 0 ? row('Amount paid', money(i.amountPaidCents, i.currency)) : null}
        {row('Balance due', money(i.balanceDueCents, i.currency), true)}
      </dl>
      {i.notesToClient ? (
        <p className="rounded-lg bg-canvas p-2 whitespace-pre-wrap">{i.notesToClient}</p>
      ) : null}
    </div>
  );
}
