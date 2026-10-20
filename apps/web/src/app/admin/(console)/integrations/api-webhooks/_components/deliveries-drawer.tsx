'use client';

import { Button, Drawer, Pagination, Select } from '@firmivra/ui';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  DELIVERY_STATUSES,
  type DeliveryStatus,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '../../_components/integrations-contract';
import { DeliveryStatusBadge } from '../../_components/integration-badges';
import { formatDateTime, formatDuration } from '../../_components/integration-format';
import {
  integrationErrorMessage,
  loadError,
  QuietLine,
  SkeletonLines,
} from '../../_components/integration-states';
import type { Notice } from '../../_components/platform-actions';
import { Facts, RowButton } from './api-webhooks-parts';

/**
 * One endpoint's delivery history (docx §8): event, status code, duration, retries, time and
 * request id, the payload with sensitive fields redacted, a status filter, and Redeliver after a
 * confirmation. A redelivery is a new attempt of the same event, linked to the original; the
 * receiver stays idempotent on the event id.
 */

const PAGE_SIZE = 10;
const STATUS_LABELS: Record<DeliveryStatus, string> = {
  PENDING: 'Pending',
  SUCCEEDED: 'Delivered',
  FAILED: 'Failed',
};

export function DeliveriesDrawer({
  endpoint,
  onClose,
  onNotice,
}: {
  endpoint: WebhookEndpoint;
  onClose: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [status, setStatus] = useState<DeliveryStatus | ''>('');
  const [page, setPage] = useState(1);
  const [confirming, setConfirming] = useState<string | null>(null);
  const deliveries = useApiQuery(
    ['admin-integrations', 'webhooks', endpoint.id, 'deliveries', status, page],
    () =>
      adminIntegrations.webhookDeliveries(endpoint.id, {
        status: status || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  );
  const redeliver = useApiMutation((id: string) => adminIntegrations.redeliver(id), {
    invalidate: ['admin-integrations'],
  });

  function send(delivery: WebhookDelivery) {
    redeliver.mutate(delivery.id, {
      onSuccess: (attempt) => {
        setConfirming(null);
        setPage(1);
        onNotice(
          attempt.status === 'SUCCEEDED'
            ? {
                tone: 'success',
                text: `${delivery.eventType} was redelivered (attempt ${attempt.attempt}, ${attempt.responseStatusCode ?? 'no'} response).`,
              }
            : {
                tone: 'error',
                text: `The redelivery of ${delivery.eventType} failed (attempt ${attempt.attempt}${attempt.errorCode ? `, ${attempt.errorCode}` : ''}).`,
              },
        );
      },
    });
  }

  const data = deliveries.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <Drawer
      open
      title="Deliveries"
      subtitle={endpoint.url}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div data-testid="webhook-deliveries" className="flex flex-col gap-4">
        <Select
          label="Delivery status"
          value={status}
          onChange={(event) => {
            const next = DELIVERY_STATUSES.find((item) => item === event.target.value);
            setStatus(next ?? '');
            setPage(1);
            setConfirming(null);
          }}
          options={[
            { value: '', label: 'All deliveries' },
            ...DELIVERY_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
          ]}
        />
        {deliveries.isPending ? (
          <SkeletonLines rows={6} label="Loading deliveries" />
        ) : deliveries.isError ? (
          <QuietLine>{loadError(deliveries.error)}</QuietLine>
        ) : !deliveries.data.items.length ? (
          <QuietLine>
            {status
              ? `No ${STATUS_LABELS[status].toLowerCase()} deliveries.`
              : 'No deliveries to this endpoint yet.'}
          </QuietLine>
        ) : (
          <ul className="flex flex-col divide-y divide-divider">
            {deliveries.data.items.map((delivery) => (
              <li key={delivery.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold wrap-anywhere text-heading">
                    {delivery.eventType}
                  </span>
                  <DeliveryStatusBadge status={delivery.status} />
                </div>
                <Facts
                  items={[
                    formatDateTime(delivery.createdAt),
                    `Attempt ${delivery.attempt}`,
                    delivery.redeliveryOfId ? 'Redelivery' : null,
                    delivery.responseStatusCode === null
                      ? 'No response'
                      : `HTTP ${delivery.responseStatusCode}`,
                    formatDuration(delivery.durationMs),
                    `${delivery.retries} ${delivery.retries === 1 ? 'retry' : 'retries'}`,
                  ]}
                />
                <Facts
                  items={[
                    `Event ${delivery.eventId}`,
                    delivery.requestId ? `Request ${delivery.requestId}` : null,
                    delivery.errorCode ? `Error ${delivery.errorCode}` : null,
                    delivery.requestedBy ? `Redelivered by ${delivery.requestedBy}` : null,
                  ]}
                />
                {delivery.payload ? (
                  <details className="rounded-control border border-divider bg-subtle px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium text-heading">
                      Payload (sensitive fields redacted)
                    </summary>
                    <pre className="mt-2 max-h-60 overflow-auto font-mono text-xs whitespace-pre-wrap wrap-anywhere text-text">
                      {delivery.payload}
                    </pre>
                  </details>
                ) : (
                  <p className="text-xs text-muted">The payload is not kept for deliveries.</p>
                )}
                {delivery.canRedeliver ? (
                  confirming === delivery.id ? (
                    <div
                      role="group"
                      aria-label={`Confirm redelivery of ${delivery.eventType}`}
                      className="flex flex-col gap-2 rounded-control bg-warning-soft p-3 text-sm text-text"
                    >
                      <p>
                        Send {delivery.eventType} again as a new attempt? The receiver gets the same
                        event id ({delivery.eventId}), so it can skip a repeat.
                      </p>
                      {redeliver.isError ? (
                        <p role="alert" className="text-danger">
                          {integrationErrorMessage(redeliver.error)}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={redeliver.isPending} onClick={() => send(delivery)}>
                          {redeliver.isPending ? 'Sending…' : 'Redeliver'}
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <RowButton
                        onClick={() => {
                          redeliver.reset();
                          setConfirming(delivery.id);
                        }}
                      >
                        <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
                        Redeliver
                        <span className="sr-only"> {delivery.eventType}</span>
                      </RowButton>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data && data.total > data.pageSize ? (
          <Pagination
            page={data.page}
            pageCount={pageCount}
            onPage={(next) => {
              setPage(next);
              setConfirming(null);
            }}
            summary={`${data.total} deliveries`}
          />
        ) : null}
      </div>
    </Drawer>
  );
}
