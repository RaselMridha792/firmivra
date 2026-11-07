'use client';

import type { ClientActivityItem, ClientActivityKind } from '@firmivra/types';
import {
  CalendarBlank,
  CalendarCheck,
  CalendarX,
  ChatCircleDots,
  CheckSquare,
  ClipboardText,
  FileArrowUp,
  FileText,
  Files,
  type Icon,
  PaperPlaneTilt,
  Receipt,
} from '@phosphor-icons/react';
import { OriginLink } from '../../../../../components/origin-link';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

// MSG-F18 (Octavia's Oct 27 Messages review, MSG-033): Recent Activity in the contact panel. The
// client's latest records in the modules the member may view (the API decides), each opening its
// own page with Back to this conversation. Notes stay their own section below.

const ICONS: Record<ClientActivityKind, Icon> = {
  MESSAGE_RECEIVED: ChatCircleDots,
  MESSAGE_SENT: PaperPlaneTilt,
  APPOINTMENT_BOOKED: CalendarBlank,
  APPOINTMENT_CANCELLED: CalendarX,
  APPOINTMENT_HELD: CalendarCheck,
  FORM_SENT: ClipboardText,
  FORM_SUBMITTED: ClipboardText,
  INVOICE_CREATED: Receipt,
  INVOICE_PAID: Receipt,
  DOCUMENT_UPLOADED: FileArrowUp,
  DOCUMENT_SHARED: FileText,
  DOCUMENT_ADDED: FileText,
  DOCUMENTS_REQUESTED: Files,
  TASK_COMPLETED: CheckSquare,
};
const stamp = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const appointment = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function Row({
  item,
  onOpenThread,
}: {
  item: ClientActivityItem;
  onOpenThread: (threadId: string) => void;
}) {
  const Glyph = ICONS[item.kind];
  const body = (
    <>
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-action"
      >
        <Glyph weight="fill" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-heading">{item.title}</span>
        {item.detail ? (
          <span className="block truncate text-xs text-muted">{item.detail}</span>
        ) : null}
        <span className="block text-xs text-muted">
          {item.eventAt
            ? appointment.format(new Date(item.eventAt))
            : stamp.format(new Date(item.at))}
        </span>
      </span>
    </>
  );
  const cls = 'flex w-full items-start gap-3 rounded-lg p-1.5 text-left hover:bg-canvas';
  // A message is on this same page: its thread opens here, not as a page with a way back.
  const thread = item.href.startsWith('/messages?')
    ? new URLSearchParams(item.href.slice('/messages?'.length)).get('thread')
    : null;
  return thread ? (
    <button type="button" className={cls} onClick={() => onOpenThread(thread)}>
      {body}
    </button>
  ) : (
    <OriginLink href={item.href} className={cls}>
      {body}
    </OriginLink>
  );
}

export function RecentActivity({
  threadId,
  onOpenThread,
}: {
  threadId: string;
  onOpenThread: (threadId: string) => void;
}) {
  const activity = useApiQuery(['messages', 'activity', threadId], () =>
    api.messages.activity(threadId),
  );
  const items = activity.data?.items ?? [];
  return (
    <section aria-label="Recent activity" data-testid="recent-activity">
      <h3 className="mb-1 font-display text-lg font-bold text-heading">Recent Activity</h3>
      {activity.isError ? (
        <p className="text-sm text-muted">Recent activity is not available right now.</p>
      ) : activity.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.slice(0, 5).map((item) => (
            <li key={`${item.kind}${item.href}${item.at}`}>
              <Row item={item} onOpenThread={onOpenThread} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
