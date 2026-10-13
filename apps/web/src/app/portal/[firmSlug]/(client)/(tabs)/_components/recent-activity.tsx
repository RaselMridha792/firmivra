'use client';

import { notificationLink, type NotificationItem } from '@firmivra/types';
import { Card } from '@firmivra/ui';
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

const when = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

type ActivityGlyph =
  | 'file'
  | 'document'
  | 'intake'
  | 'message'
  | 'note'
  | 'appointment'
  | 'invoice'
  | 'service'
  | 'person'
  | 'account';

function activityIcon(item: NotificationItem): { glyph: ActivityGlyph; color: string } {
  if (
    item.target.kind === 'message_thread' &&
    item.title.toLocaleLowerCase().includes('new message')
  ) {
    return { glyph: 'file', color: 'text-firm-primary' };
  }

  switch (item.target.kind) {
    case 'document':
    case 'document_request':
      return { glyph: 'document', color: 'text-success' };
    case 'intake':
      return { glyph: 'intake', color: 'text-purple' };
    case 'message_thread':
      return { glyph: 'message', color: 'text-firm-primary' };
    case 'client_note_reminder':
      return { glyph: 'note', color: 'text-firm-primary' };
    case 'appointment':
      return { glyph: 'appointment', color: 'text-firm-primary' };
    case 'invoice':
      return { glyph: 'invoice', color: 'text-success' };
    case 'engagement':
    case 'tax_return':
      return { glyph: 'service', color: 'text-firm-primary' };
    case 'client_account':
    case 'membership':
      return { glyph: 'person', color: 'text-purple' };
    case 'user':
      return { glyph: 'account', color: 'text-firm-primary' };
  }
}

function ActivityIcon({ item }: { item: NotificationItem }) {
  const { glyph, color } = activityIcon(item);
  const className = `mt-0.5 size-5 shrink-0 ${color}`;

  switch (glyph) {
    case 'file':
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
          className={`inline-flex items-center gap-1 text-sm underline ${blueAccents ? 'text-firm-primary' : 'text-link'}`}
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
                  className="flex flex-wrap items-start gap-x-3 py-2 hover:bg-folder-surface"
                >
                  <ActivityIcon item={item} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-heading">{item.title}</span>
                    <span className="block text-sm text-text">{item.body}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {when.format(new Date(item.createdAt))}
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
