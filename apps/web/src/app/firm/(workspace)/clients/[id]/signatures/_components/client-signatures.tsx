'use client';

import { canCreate } from '../../../../../../../components/esign/esign-role';
import { EsignGate } from '../../../../../../../components/esign/esign-gate';
import { RequestsTable } from '../../../../../../../components/esign/requests-table';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { ClientTabHeader, ClientTabLink } from '../../_components/client-tab-header';

/** A client's Signatures tab: their signature requests, and a new one for them. */
export function ClientSignatures({ clientId }: { clientId: string }) {
  // The gate's own read (one request): Send for signature only with Firm Sign on and a role that
  // may start requests.
  const status = useApiQuery(['esign', 'status'], () => api.esign.status());
  const sends = !!status.data?.enabled && canCreate(status.data.myEsignRole);
  return (
    <div className="flex flex-col gap-4">
      {/* The client record's layout owns the page's h1 (the client's name); P4-7: the profile's
          one heading row. */}
      <ClientTabHeader
        title="Signatures"
        primary={
          sends ? (
            <ClientTabLink origin={false} href={`/firm-sign/new?clientId=${clientId}`}>
              Send for signature
            </ClientTabLink>
          ) : null
        }
      />
      <EsignGate>
        {() => (
          <RequestsTable
            limit={25}
            caption="This client's signature requests"
            clientId={clientId}
            initial={{ range: 'all' }}
          />
        )}
      </EsignGate>
    </div>
  );
}
