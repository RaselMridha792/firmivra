'use client';

import { notificationLink, type NotificationItem } from '@firmivra/types';
import { Card, portalIconTones } from '@firmivra/ui';
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  ClipboardCheck,
  CloudUpload,
  CreditCard,
  FileText,
  MessageSquareText,
  NotebookPen,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';

// The date over the time, at the row's right (Intake form tab.png).
const day = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

type ActivityGlyph =
  | 'file'
  | 'return'
  | 'document'
  | 'intake'
  | 'message'
  | 'note'
  | 'appointment'
  | 'invoice'
  | 'service'
  | 'person'
  | 'account';

/**
 * Each event's icon and colour. Intake form tab.png and Messages and notes.png colour four of them
 * (R61): an upload green, a message blue, a submitted form magenta, a tax return orange.
 */
function activityIcon(item: NotificationItem): { glyph: ActivityGlyph; color: string } {
  if (
    item.target.kind === 'message_thread' &&
    item.title.toLocaleLowerCase().includes('new message')
  ) {
    return { glyph: 'file', color: portalIconTones.blue };
  }

  switch (item.target.kind) {
    case 'document':
    case 'document_request':
      return { glyph: 'document', color: portalIconTones.green };
    case 'intake':
      return { glyph: 'intake', color: portalIconTones.magenta };
    case 'message_thread':
      return { glyph: 'message', color: portalIconTones.blue };
    case 'client_note_reminder':
      return { glyph: 'note', color: 'text-firm-text' };
    case 'appointment':
      return { glyph: 'appointment', color: 'text-firm-text' };
    case 'invoice':
      return { glyph: 'invoice', color: 'text-success' };
    case 'tax_return':
      return { glyph: 'return', color: portalIconTones.orange };
    case 'engagement':
      return { glyph: 'service', color: 'text-firm-text' };
    case 'client_account':
    case 'membership':
      return { glyph: 'person', color: 'text-purple' };
    case 'user':
      return { glyph: 'account', color: 'text-firm-text' };
  }
}

function ActivityIcon({ item }: { item: NotificationItem }) {
  const { glyph, color } = activityIcon(item);
  const className = `mt-0.5 size-7 shrink-0 ${color}`;

  switch (glyph) {
    case 'file':
    case 'return':
      return <FileText aria-hidden className={className} />;
    case 'document':
      return <CloudUpload aria-hidden className={className} />;
    case 'intake':
      return <ClipboardCheck aria-hidden className={className} />;
    case 'message':
      return <MessageSquareText aria-hidden className={className} />;
    case 'note':
      return <NotebookPen aria-hidden className={className} />;
    case 'appointment':
      return <CalendarDays aria-hidden className={className} />;
    case 'invoice':
      return <CreditCard aria-hidden className={className} />;
    case 'service':
      return <BriefcaseBusiness aria-hidden className={className} />;
    case 'person':
      return <UserRound aria-hidden className={className} />;
    case 'account':
      return <ShieldCheck aria-hidden className={className} />;
  }
}

/**
 * "Recent Activity" next to Quick Links: the client's 5 newest notifications (client-visible
 * events only), each opening its page; View All goes to the Notification Center.
 */
export function RecentActivity({
  slug,
  blueAccents = false,
}: {
  slug: string;
  blueAccents?: boolean;
}) {
  const recent = useApiQuery(['my-notifications', slug, 'recent'], () =>
    api.myNotifications(slug).list({ limit: 5 }),
  );
  const items = recent.data?.items ?? [];
  return (
    <Card>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex-1 font-display text-2xl font-bold text-heading">Recent Activity</h2>
        <Link
          className={`inline-flex items-center gap-1 text-sm underline ${blueAccents ? 'text-firm-text' : 'text-link'}`}
          href={`/${slug}/notifications`}
        >
          View All <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{recent.isPending ? 'Loading…' : 'Nothing yet.'}</p>
      ) : (
        <ul aria-label="Recent activity" className="divide-y divide-border">
          {items.map((item) => {
            return (
              <li key={item.id}>
                <Link
                  href={
                    notificationLink(item.target, { site: 'portal', firmSlug: slug }) ??
                    `/${slug}/notifications`
                  }
                  className="flex items-start gap-x-3 py-1.5 hover:bg-folder-surface"
                >
                  <ActivityIcon item={item} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-sm font-semibold text-heading">{item.title}</span>
                    <span className="block truncate text-xs text-text">{item.body}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs leading-tight text-text">
                    <span className="block">{day.format(new Date(item.createdAt))}</span>
                    <span className="block">{time.format(new Date(item.createdAt))}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
