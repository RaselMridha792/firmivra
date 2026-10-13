'use client';

import { notificationLink } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { ArrowRight, CloudUpload, FileText, MessageSquare } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';

const when = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

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
          {items.map((item) => (
            <li key={item.id}>
              <ActivityLink
                href={
                  notificationLink(item.target, { site: 'portal', firmSlug: slug }) ??
                  `/${slug}/notifications`
                }
                title={item.title}
                blueAccents={blueAccents}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-heading">{item.title}</span>
                  <span className="block text-sm text-text">{item.body}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  {when.format(new Date(item.createdAt))}
                </span>
              </ActivityLink>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityLink({
  href,
  title,
  blueAccents,
  children,
}: {
  href: string;
  title: string;
  blueAccents: boolean;
  children: ReactNode;
}) {
  const normalized = title.toLowerCase();
  const tone =
    normalized.includes('upload') || normalized.includes('document')
      ? 'text-success'
      : normalized.includes('form')
        ? 'text-purple'
        : normalized.includes('tax')
          ? 'text-warning'
          : blueAccents
            ? 'text-firm-primary'
            : 'text-link';
  return (
    <Link href={href} className="flex items-center gap-3 py-2 hover:bg-folder-surface">
      {normalized.includes('upload') || normalized.includes('document') ? (
        <CloudUpload aria-hidden className={`size-6 shrink-0 ${tone}`} />
      ) : normalized.includes('message') ? (
        <MessageSquare aria-hidden className={`size-6 shrink-0 ${tone}`} />
      ) : (
        <FileText aria-hidden className={`size-6 shrink-0 ${tone}`} />
      )}
      {children}
    </Link>
  );
}
