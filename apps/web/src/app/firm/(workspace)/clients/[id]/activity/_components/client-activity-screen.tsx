'use client';

import type { ClientTimelineEntry, ClientTimelineKind } from '@firmivra/types';
import { Button, Card, EmptyState, Skeleton } from '@firmivra/ui';
import {
  CalendarCheck,
  ChatCircleDots,
  CheckSquare,
  CurrencyDollar,
  DeviceMobile,
  EnvelopeSimple,
  FileText,
  type Icon,
  NotePencil,
  Phone,
  Pulse,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { OriginLink } from '../../../../../../../components/origin-link';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import { useFirmTimeZone } from '../../../../intake-forms/_components/expiry';
import { ClientTabHeader } from '../../_components/client-tab-header';

// MSG-F16: the client's Activity tab, their own timeline (newest first). An entry names what
// happened, when and by whom, and opens its record; it never shows a message's text or files.

const ICON: Record<ClientTimelineKind, Icon> = {
  MESSAGE: ChatCircleDots,
  EMAIL: EnvelopeSimple,
  SMS: DeviceMobile,
  NOTE: NotePencil,
  CALL: Phone,
  MEETING: CalendarCheck,
  DOCUMENT: FileText,
  TASK: CheckSquare,
  INVOICE: CurrencyDollar,
  OTHER: Pulse,
};

/** In the firm's time zone (the lead's N8-05 note), as every firm date. */
const when = (iso: string, timeZone: string | undefined) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export function ClientActivityScreen() {
  const { id } = useParams<{ id: string }>();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);
  const page = useApiQuery(['clients', id, 'timeline', cursor ?? ''], () =>
    api.clients.timeline(id, cursor ? { cursor } : {}),
  );
  const items = page.data?.items ?? [];
  const timeZone = useFirmTimeZone();
  return (
    <div className="flex flex-col gap-4">
      <ClientTabHeader
        title="Activity"
        description="Everything recorded about this client, newest first: their portal replies, documents and requests, tasks, appointments, invoices, signatures, notes and profile changes. A message from the firm appears when it is sent with Add to Client Timeline."
      />
      <Card>
        <section
          aria-label="Activity"
          data-testid="client-activity"
          className="flex flex-col gap-3"
        >
          {page.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : page.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(page.error)}
            </p>
          ) : items.length === 0 ? (
            <EmptyState
              title={cursor ? 'No more activity' : 'No activity yet'}
              description="Events for this client show here as they are recorded."
            />
          ) : (
            <ol
              className="flex flex-col divide-y divide-divider"
              aria-label="Activity, newest first"
            >
              {items.map((e) => (
                <Entry key={e.id} entry={e} timeZone={timeZone} />
              ))}
            </ol>
          )}
          <div className="flex gap-2">
            {cursors.length > 0 ? (
              <Button variant="secondary" onClick={() => setCursors((c) => c.slice(0, -1))}>
                Newer
              </Button>
            ) : null}
            {page.data?.nextCursor ? (
              <Button
                variant="secondary"
                onClick={() => setCursors((c) => [...c, page.data!.nextCursor!])}
              >
                Older
              </Button>
            ) : null}
          </div>
        </section>
      </Card>
    </div>
  );
}

function Entry({
  entry: e,
  timeZone,
}: {
  entry: ClientTimelineEntry;
  timeZone: string | undefined;
}) {
  const Glyph = ICON[e.kind];
  return (
    <li className="flex items-start gap-3 py-3" data-testid="activity-entry">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
        <Glyph aria-hidden weight="fill" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold break-words text-heading">{e.title}</span>
        {e.summary ? <span className="text-sm text-muted">{e.summary}</span> : null}
        <span className="text-xs text-muted">{when(e.occurredAt, timeZone)}</span>
      </span>
      {e.href ? (
        <OriginLink href={e.href} className="shrink-0 text-sm font-semibold text-link">
          Open
        </OriginLink>
      ) : null}
    </li>
  );
}

/**
 * Octavia's E4: Recent Activity at the bottom of Overview: the newest entries of the same timeline
 * (who or what, when, and the record it opens), with View All on the Activity tab.
 */
export function RecentActivityCard({ clientId }: { clientId: string }) {
  const page = useApiQuery(['clients', clientId, 'timeline', 'recent'], () =>
    api.clients.timeline(clientId, { limit: 5 }),
  );
  const items = page.data?.items ?? [];
  const timeZone = useFirmTimeZone();
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Recent Activity
          <Link
            href={`/clients/${clientId}/activity`}
            className="text-sm font-medium text-link hover:underline"
          >
            View All
          </Link>
        </span>
      }
    >
      <div data-testid="recent-activity">
        {page.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : page.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(page.error)}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-divider" aria-label="Recent activity">
            {items.map((e) => (
              <Entry key={e.id} entry={e} timeZone={timeZone} />
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}
