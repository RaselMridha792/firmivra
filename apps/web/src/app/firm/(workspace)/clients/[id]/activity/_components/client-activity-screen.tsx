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
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { OriginLink } from '../../../../../../../components/origin-link';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';

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

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
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
  return (
    <Card>
      <section aria-label="Activity" data-testid="client-activity" className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold text-heading">Activity</h2>
          <p className="text-sm text-muted">
            What happened with this client, newest first. Messages appear here when they are sent
            with Add to Client Timeline.
          </p>
        </div>
        {page.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : page.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(page.error)}
          </p>
        ) : items.length === 0 ? (
          <EmptyState
            title={cursor ? 'No more activity' : 'No activity yet'}
            description="Send a message with Add to Client Timeline and it shows here."
          />
        ) : (
          <ol className="flex flex-col divide-y divide-divider" aria-label="Activity, newest first">
            {items.map((e) => (
              <Entry key={e.id} entry={e} />
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
  );
}

function Entry({ entry: e }: { entry: ClientTimelineEntry }) {
  const Glyph = ICON[e.kind];
  return (
    <li className="flex items-start gap-3 py-3" data-testid="activity-entry">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
        <Glyph aria-hidden weight="fill" className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold break-words text-heading">{e.title}</span>
        {e.summary ? <span className="text-sm text-muted">{e.summary}</span> : null}
        <span className="text-xs text-muted">{when(e.occurredAt)}</span>
      </span>
      {e.href ? (
        <OriginLink href={e.href} className="shrink-0 text-sm font-semibold text-link">
          Open
        </OriginLink>
      ) : null}
    </li>
  );
}
