'use client';

import { notificationLink } from '@firmivra/types';
import { Card } from '@firmivra/ui';
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

/**
 * "Recent Activity" next to Quick Links: the client's 5 newest notifications (client-visible
 * events only), each opening its page; View All goes to the Notification Center.
 */
export function RecentActivity({ slug }: { slug: string }) {
  const recent = useApiQuery(['my-notifications', slug, 'recent'], () =>
    api.myNotifications(slug).list({ limit: 5 }),
  );
  const items = recent.data?.items ?? [];
  return (
    <Card>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex-1 font-display text-2xl font-bold text-heading">Recent Activity</h2>
        <Link className="text-sm text-link underline" href={`/${slug}/notifications`}>
          View All
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{recent.isPending ? 'Loading…' : 'Nothing yet.'}</p>
      ) : (
        <ul aria-label="Recent activity" className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={
                  notificationLink(item.target, { site: 'portal', firmSlug: slug }) ??
                  `/${slug}/notifications`
                }
                className="flex flex-wrap items-baseline gap-x-3 py-2 hover:bg-folder-surface"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-heading">{item.title}</span>
                  <span className="block text-sm text-text">{item.body}</span>
                </span>
                <span className="text-xs text-muted">{when.format(new Date(item.createdAt))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
