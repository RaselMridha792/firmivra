'use client';

import Link from 'next/link';
import { canCreate } from '../../../../../../../components/esign/esign-role';
import { EsignGate } from '../../../../../../../components/esign/esign-gate';
import { RequestsTable } from '../../../../../../../components/esign/requests-table';

/** A client's Signatures tab: their signature requests, and a new one for them. */
export function ClientSignatures({ clientId }: { clientId: string }) {
  return (
    <EsignGate>
      {(role) => (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 data-testid="page-title" className="text-2xl font-semibold text-heading">
              Client signatures
            </h1>
            {canCreate(role) && (
              // The primary button's look (the UI kit has no link button yet).
              <Link
                href={`/firm-sign/new?clientId=${clientId}`}
                className="inline-flex min-h-11 items-center justify-center rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Send for signature
              </Link>
            )}
          </div>
          <RequestsTable
            limit={25}
            caption="This client's signature requests"
            clientId={clientId}
            initial={{ range: 'all' }}
          />
        </div>
      )}
    </EsignGate>
  );
}
