'use client';

import {
  FIRMIVRA_REQUEST_STATUS_LABELS,
  type FirmivraRequestItem,
  type SupportTicketStatus,
} from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import { ChatText } from '@phosphor-icons/react';
import Link from 'next/link';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { Loaded, Quiet, SettingsCard, SettingsHeader } from '../../_components/settings-parts';

export const REQUESTS_KEY = ['firmivra-requests'] as const;

const TONES: Record<SupportTicketStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  WAITING_ON_CUSTOMER: 'warning',
  OPEN: 'info',
  IN_PROGRESS: 'info',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

export function RequestStatus({ status }: { status: SupportTicketStatus }) {
  return (
    <Badge tone={TONES[status]} dot>
      {FIRMIVRA_REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}

/** "Nov 19, 2026": the viewer's own day. */
export const dayText = (value: string) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value));

export const OWNER_ONLY =
  "Only the firm's Owner sees Firmivra's requests about the firm's account and answers them.";

function RequestRow({ item }: { item: FirmivraRequestItem }) {
  return (
    <li data-testid="firmivra-request" className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <Link
          href={`/settings/firmivra-requests/${item.id}`}
          className="font-semibold text-link hover:underline"
        >
          {item.subject}
        </Link>
        <p className="text-sm text-muted">
          Request #{item.number} · asked {dayText(item.requestedAt)} · last activity{' '}
          {dayText(item.lastActivityAt)}
        </p>
      </div>
      <RequestStatus status={item.status} />
    </li>
  );
}

function RequestsList() {
  const query = useApiQuery(REQUESTS_KEY, () => api.firmivraRequests.list());
  return (
    <SettingsCard
      title="Requests"
      subtitle="Answer with text and files. Your answer goes straight back to the Firmivra team."
      icon={ChatText}
      testId="firmivra-requests"
    >
      <Loaded query={query}>
        {(data) =>
          data.items.length ? (
            <ul className="flex flex-col divide-y divide-divider">
              {data.items.map((item) => (
                <RequestRow key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <Quiet>Firmivra hasn&apos;t asked you for anything.</Quiet>
          )
        }
      </Loaded>
    </SettingsCard>
  );
}

/**
 * Settings > Requests from Firmivra (SA-FRM-F06): what Firmivra asked about the firm's account,
 * newest first. The Owner only, as the API (others get 403); nothing is asked of anyone else.
 */
export function FirmivraRequestsScreen() {
  const { role } = useFirm();
  return (
    <div className="flex flex-col gap-6">
      <SettingsHeader
        icon={ChatText}
        title="Requests from Firmivra"
        subtitle="What Firmivra has asked about your firm's account, and your answers."
      />
      {role === 'OWNER' ? <RequestsList /> : <Quiet>{OWNER_ONLY}</Quiet>}
    </div>
  );
}
