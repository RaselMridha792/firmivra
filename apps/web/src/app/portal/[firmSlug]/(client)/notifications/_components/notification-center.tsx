'use client';

import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationItem,
  notificationLink,
} from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { Bell } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

const when = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * The Notification Center (N10, no mockup): newest first, All or Unread, mark all read. Opening
 * one marks it read and goes to its page (My Docs, Messages...), not the exact item.
 */
export function NotificationCenter() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const router = useRouter();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const list = useApiQuery(['my-notifications', slug, unreadOnly], () =>
    api.myNotifications(slug).list({ unreadOnly, limit: 50 }),
  );
  const markAll = useApiMutation(() => api.myNotifications(slug).markAllRead(), {
    invalidate: ['my-notifications', slug],
  });
  const open = useApiMutation(
    async (item: NotificationItem) => {
      if (!item.readAt) await api.myNotifications(slug).markRead(item.id);
      return notificationLink(item.target, { site: 'portal', firmSlug: slug });
    },
    { invalidate: ['my-notifications', slug] },
  );
  const unread = list.data?.unreadCount ?? 0;
  return (
    <Card className="mx-auto grid w-full max-w-4xl min-w-0 gap-4">
      <header className="flex flex-col gap-4 md:flex-row md:items-start">
        <Bell
          aria-hidden
          className="size-16 shrink-0 rounded-full bg-folder-surface p-4 text-firm-primary"
        />
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold text-heading">Notifications</h1>
          <p className="text-text">
            {unread === 0 ? 'You are all caught up.' : `You have ${unread} unread.`}
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all as read
        </Button>
      </header>
      <div role="group" aria-label="Show" className="flex gap-2">
        {(
          [
            [false, 'All'],
            [true, 'Unread'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={label}
            variant={unreadOnly === value ? 'primary' : 'secondary'}
            aria-pressed={unreadOnly === value}
            onClick={() => setUnreadOnly(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {markAll.isError || open.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(markAll.error ?? open.error)}
        </p>
      ) : null}
      <PageState
        query={list}
        isEmpty={(data) => data.items.length === 0}
        empty={unreadOnly ? 'No unread notifications.' : 'No notifications yet.'}
      >
        {(data) => (
          <ul className="grid gap-2">
            {data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={open.isPending}
                  onClick={() =>
                    open.mutate(item, {
                      onSuccess: (link) => {
                        if (link) router.push(link);
                      },
                    })
                  }
                  className={`grid w-full gap-1 rounded-card border p-4 text-left hover:bg-folder-hover ${item.readAt ? 'border-border' : 'border-firm-accent bg-folder-surface'}`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    {item.readAt ? null : <Badge tone="info">New</Badge>}
                    <span className="flex-1 font-semibold text-heading">{item.title}</span>
                    <span className="text-xs text-muted">
                      {when.format(new Date(item.createdAt))}
                    </span>
                  </span>
                  <span className="text-sm text-text">{item.body}</span>
                  <span className="text-xs text-muted">
                    {NOTIFICATION_CATEGORY_LABELS[item.category]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      {list.data?.nextCursor ? (
        <p className="text-sm text-muted">Showing your 50 newest notifications.</p>
      ) : null}
    </Card>
  );
}
