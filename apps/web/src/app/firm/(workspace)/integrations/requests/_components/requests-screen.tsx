'use client';

import type { IntegrationRequestRow } from '@firmivra/types';
import { Badge, Button, Table } from '@firmivra/ui';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { IntegrationsNav } from '../../_components/integrations-nav';
import {
  REQUEST_STATUS_LABELS,
  requestDay,
  requestReference,
} from '../../_components/requests-shared';
import { RequestIntegrationModal } from '../../marketplace/_components/request-integration-modal';

const TONES: Record<IntegrationRequestRow['status'], 'neutral' | 'info' | 'success' | 'danger'> = {
  NEW: 'info',
  REVIEWING: 'info',
  PLANNED: 'neutral',
  IN_DEVELOPMENT: 'neutral',
  AVAILABLE: 'success',
  DECLINED: 'danger',
};

/**
 * I-UA02 and I-UA03 (Integrations Review Two): the firm's integration requests, newest first, each
 * with its reference, the day it was sent, its status and when that last changed.
 */
export function RequestsScreen() {
  const environment = useSearchParams().get('environment') === 'TEST' ? 'TEST' : 'LIVE';
  const requests = useApiQuery(['integration-requests'], () => api.integrations.requests());
  // R61 sweep: only an Owner or Admin may send a request (the API answers 403 otherwise); the same
  // capability (and cache) as the marketplace's request buttons.
  const permission = useApiQuery(['integrations-marketplace', 'capabilities'], () =>
    api.integrations.overview(),
  );
  const canRequest = permission.isSuccess && permission.data.canManage;
  const [asking, setAsking] = useState(false);
  const rows = [...(requests.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <div data-testid="integration-requests" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-heading">My integration requests</h1>
          <p className="mt-1 text-sm text-muted">
            The tools your firm asked Firmivra to connect, and where each request stands.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button
            disabled={!canRequest}
            aria-describedby={permission.isSuccess && !canRequest ? 'request-why' : undefined}
            onClick={() => setAsking(true)}
          >
            Request an integration
          </Button>
          {permission.isSuccess && !canRequest ? (
            <p id="request-why" className="text-xs text-muted" data-testid="request-why">
              Only an Owner or Admin can request an integration.
            </p>
          ) : null}
        </div>
      </header>
      <IntegrationsNav current="requests" environment={environment} />
      {requests.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(requests.error)}{' '}
          <Button variant="secondary" onClick={() => void requests.refetch()}>
            Retry
          </Button>
        </p>
      ) : (
        <Table
          caption="Your firm's integration requests"
          loading={requests.isPending}
          rows={rows}
          rowKey={(r) => r.id}
          emptyTitle="No requests yet"
          emptyText="Ask for a tool Firmivra does not connect yet with Request an integration."
          columns={[
            {
              id: 'reference',
              label: 'Reference',
              cell: (r) => <span className="font-mono text-sm">{requestReference(r.id)}</span>,
            },
            {
              id: 'provider',
              label: 'Tool',
              cell: (r) => <span className="font-semibold text-heading">{r.providerName}</span>,
            },
            { id: 'sent', label: 'Sent', cell: (r) => requestDay(r.createdAt) },
            {
              id: 'status',
              label: 'Status',
              cell: (r) => <Badge tone={TONES[r.status]}>{REQUEST_STATUS_LABELS[r.status]}</Badge>,
            },
            {
              id: 'changed',
              label: 'Last change',
              cell: (r) => (r.statusChangedAt ? requestDay(r.statusChangedAt) : 'Not yet'),
            },
            { id: 'by', label: 'Requested by', cell: (r) => r.requestedBy.name },
          ]}
        />
      )}
      <RequestIntegrationModal open={asking} onClose={() => setAsking(false)} />
    </div>
  );
}
