'use client';

import { Skeleton } from '@firmivra/ui';
import type { ReactNode } from 'react';
import {
  adminBilling,
  type BillingClient,
  type BillingEstimate,
  type BillingFirm,
  type Currency,
} from '../../../../../../mocks/admin-billing';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  addressLines,
  formatLongDate,
  formatMoney,
  saveFile,
} from '../../_components/billing-format';
import { QuietLine, quietErrorText } from '../../_components/billing-parts';
import { DocumentViewer, FirmMark } from '../../_components/invoice-document';

/**
 * The customer-facing estimate (docx §16 "Estimate Preview"): the selected firm's name, contact
 * details and terms, never Firmivra's or a sample company's. Create / Edit Estimate preview the
 * form's live values; the Estimates page shows a saved estimate in the shared viewer.
 */

/** What the document needs: a saved estimate or the form's live values. */
export interface EstimateDocumentData {
  number: string;
  issueDate: string;
  expirationDate: string;
  reference: string;
  currency: Currency;
  contactName: string;
  email: string;
  phone: string;
  lines: {
    id: string;
    description: string;
    quantity: number;
    rateCents: number;
    amountCents: number;
  }[];
  subtotalCents: number;
  discountCents: number;
  taxPercent: number;
  taxCents: number;
  totalCents: number;
  notes: string;
  terms: string;
}

/** A saved estimate as document data. */
export const documentDataOf = (estimate: BillingEstimate): EstimateDocumentData => ({
  number: estimate.number,
  issueDate: estimate.issueDate,
  expirationDate: estimate.expirationDate,
  reference: estimate.reference,
  currency: estimate.currency,
  contactName: estimate.contactName,
  email: estimate.email,
  phone: estimate.phone,
  lines: estimate.lines,
  subtotalCents: estimate.subtotalCents,
  discountCents: estimate.discountCents,
  taxPercent: estimate.taxPercent,
  taxCents: estimate.taxCents,
  totalCents: estimate.totalCents,
  notes: estimate.notes,
  terms: estimate.terms,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 rounded-lg border border-divider bg-subtle p-4 text-sm">
      <h3 className="font-semibold text-heading">{title}</h3>
      {children}
    </section>
  );
}

/** The estimate as the client will see it. */
export function EstimateDocument({
  data,
  firm,
  client,
}: {
  data: EstimateDocumentData;
  firm: BillingFirm | null;
  client: BillingClient | null;
}) {
  const c = data.currency;
  const facts: [string, string][] = [
    ['Estimate #', data.number || '—'],
    ['Issue Date', data.issueDate ? formatLongDate(data.issueDate) : '—'],
    ['Expiration Date', data.expirationDate ? formatLongDate(data.expirationDate) : '—'],
    ...(data.reference ? [['Reference', data.reference] as [string, string]] : []),
  ];
  const preparedFor = [
    data.contactName,
    data.email,
    data.phone,
    ...(client ? addressLines(client.address) : []),
  ].filter(Boolean);
  const totals: [string, number][] = [
    ['Subtotal', data.subtotalCents],
    ...(data.discountCents > 0 ? [['Discount', -data.discountCents] as [string, number]] : []),
    [`Tax (${data.taxPercent}%)`, data.taxCents],
  ];
  const cell = 'px-3 py-2.5';
  return (
    <article
      aria-label={`Estimate ${data.number}`}
      data-testid="estimate-document"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col justify-between gap-6 border-b border-divider pb-6 lg:flex-row">
        <div className="flex min-w-0 flex-col gap-3">
          <FirmMark firm={firm} />
          <address className="flex flex-col pl-1 text-sm text-muted not-italic">
            {firm ? (
              <>
                {addressLines(firm.address).map((line) => (
                  <span key={line}>{line}</span>
                ))}
                <span>{firm.phone}</span>
                <span className="wrap-anywhere">{firm.email}</span>
              </>
            ) : (
              <span>Select a client to load its firm&apos;s address and contact details.</span>
            )}
          </address>
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:w-1/2">
          <h2 className="text-3xl font-bold text-heading">Estimate</h2>
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

      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <h3 className="font-semibold text-heading">Prepared For</h3>
        <p className="text-base font-semibold text-action">{client?.name ?? 'Client Name'}</p>
        {preparedFor.map((line) => (
          <p key={line} className="wrap-anywhere text-muted">
            {line}
          </p>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-divider">
        <table className="w-full min-w-md text-sm text-text">
          <caption className="sr-only">Line items</caption>
          <thead className="bg-table-head text-heading">
            <tr>
              <th scope="col" className={`${cell} w-10 text-left font-semibold`}>
                <span aria-hidden>#</span>
                <span className="sr-only">Line</span>
              </th>
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
                <td className={cell}>{index + 1}</td>
                <td className={`${cell} wrap-anywhere`}>
                  {line.description || 'Item description'}
                </td>
                <td className={`${cell} text-center`}>{line.quantity}</td>
                <td className={`${cell} text-right`}>{formatMoney(line.rateCents, c)}</td>
                <td className={`${cell} text-right`}>{formatMoney(line.amountCents, c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl data-testid="estimate-totals" className="ml-auto flex w-full max-w-sm flex-col text-sm">
        {totals.map(([label, cents]) => (
          <div key={label} className="flex justify-between gap-4 px-3 py-1.5">
            <dt className="text-text">{label}</dt>
            <dd className="text-text">{formatMoney(cents, c)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-4 rounded-lg bg-info-soft px-3 py-2.5 text-base font-bold">
          <dt className="text-heading">Total ({c})</dt>
          <dd data-testid="estimate-document-total" className="text-action">
            {formatMoney(data.totalCents, c)}
          </dd>
        </div>
      </dl>

      {data.notes ? (
        <Section title="Notes">
          <p className="whitespace-pre-line text-text">{data.notes}</p>
        </Section>
      ) : null}
      {data.terms ? (
        <Section title="Terms & Conditions">
          <p className="whitespace-pre-line text-text">{data.terms}</p>
        </Section>
      ) : null}
    </article>
  );
}

/** A saved estimate in the shared viewer: loads its firm and client, offers Download PDF. */
export function EstimateViewer({
  estimate,
  onClose,
}: {
  estimate: BillingEstimate | null;
  onClose: () => void;
}) {
  const download = useApiMutation((id: string) =>
    adminBilling.download({ kind: 'ESTIMATE', refId: id }),
  );
  return (
    <DocumentViewer
      open={estimate !== null}
      title={estimate ? `Estimate ${estimate.number}` : 'Estimate'}
      onClose={onClose}
      downloading={download.isPending}
      onDownload={
        estimate ? () => download.mutate(estimate.id, { onSuccess: saveFile }) : undefined
      }
    >
      {estimate ? <ViewerBody estimate={estimate} /> : null}
      {download.error ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          The PDF could not be prepared. Try again in a moment.
        </p>
      ) : null}
    </DocumentViewer>
  );
}

function ViewerBody({ estimate }: { estimate: BillingEstimate }) {
  const firm = useApiQuery(['admin-billing', 'firm', estimate.firmId], () =>
    adminBilling.firm(estimate.firmId),
  );
  const client = useApiQuery(['admin-billing', 'client', estimate.clientId], () =>
    adminBilling.client(estimate.clientId),
  );
  if (firm.isLoading || client.isLoading)
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3">
        {['a', 'b', 'c', 'd'].map((key) => (
          <Skeleton key={key} className="h-8" />
        ))}
      </div>
    );
  const failed = firm.error ?? client.error;
  if (failed) return <QuietLine>{quietErrorText(failed)}</QuietLine>;
  return (
    <EstimateDocument
      data={documentDataOf(estimate)}
      firm={firm.data ?? null}
      client={client.data ?? null}
    />
  );
}
