'use client';

import {
  type EsignAccessRole,
  type EsignQuickFilter,
  type EsignRequestStatus,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { useState } from 'react';
import { EsignGate } from '../../../../../../components/esign/esign-gate';
import { canApprove } from '../../../../../../components/esign/esign-role';
import { RequestsTable } from '../../../../../../components/esign/requests-table';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';

const QUICK: { id: EsignQuickFilter; label: string }[] = [
  { id: 'AWAITING_SIGNATURE', label: 'Awaiting signature' },
  { id: 'EXPIRING_SOON', label: 'Expiring soon' },
  { id: 'RECENTLY_COMPLETED', label: 'Recently completed' },
  { id: 'MY_REQUESTS', label: 'My requests' },
  { id: 'NEEDS_MY_APPROVAL', label: 'Needs my approval' },
];

/** /firm-sign/requests: every request the caller may see, with the quick filters. */
export function AllRequests({ status }: { status?: EsignRequestStatus }) {
  return <EsignGate>{(role) => <Requests status={status} role={role} />}</EsignGate>;
}

function Requests({ status, role }: { status?: EsignRequestStatus; role: EsignAccessRole | null }) {
  // Under ['esign', 'requests'], so a send, void or approval refreshes the counts too.
  const summary = useApiQuery(['esign', 'requests', 'summary'], () => api.esign.summary());
  // Only an Owner, Admin or Firm Sign Manager is ever an approver.
  const quickFilters = QUICK.filter((f) => f.id !== 'NEEDS_MY_APPROVAL' || canApprove(role));
  const [quick, setQuick] = useState<EsignQuickFilter | undefined>();
  return (
    <div className="flex flex-col gap-6">
      <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
        Signature requests
      </h1>
      <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-2">
        <Button
          variant={quick ? 'outline' : 'primary'}
          aria-pressed={!quick}
          onClick={() => setQuick(undefined)}
        >
          All
        </Button>
        {quickFilters.map((f) => (
          <Button
            key={f.id}
            variant={quick === f.id ? 'primary' : 'outline'}
            aria-pressed={quick === f.id}
            onClick={() => setQuick(f.id)}
          >
            {f.label}
            {summary.data && ` (${summary.data.quickFilters[f.id]})`}
          </Button>
        ))}
      </div>
      <RequestsTable
        // Another ?status= (a counter clicked again) starts over with it.
        key={status ?? 'all'}
        limit={25}
        caption="Signature requests"
        detailed
        quickFilter={quick}
        initial={{ range: 'all', ...(status && { status }) }}
      />
    </div>
  );
}
