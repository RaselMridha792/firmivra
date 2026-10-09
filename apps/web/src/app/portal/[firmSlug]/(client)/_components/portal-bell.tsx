'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

/** The header bell: the client's unread notifications, opening the Notification Center. */
export function PortalBell({ slug }: { slug: string }) {
  const unread = useApiQuery(['my-notifications', slug, 'unread-count'], () =>
    api.myNotifications(slug).unreadCount(),
  );
  const count = unread.data ?? 0;
  return (
    <Link
      href={`/${slug}/notifications`}
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative rounded-control p-2 text-text hover:bg-canvas"
    >
      <Bell aria-hidden className="size-5" />
      {count > 0 ? (
        <span
          aria-hidden
          className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-firm-accent text-xs font-bold text-on-action"
        >
          {count > 9 ? '9+' : count}
        </span>
      ) : null}
    </Link>
  );
}
