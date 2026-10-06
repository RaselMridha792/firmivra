'use client';

import { Button } from './button';
import { Alert, EmptyState, Skeleton } from './states';
export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  read: boolean;
  href?: string;
  time: string;
}
export function NotificationList({
  items,
  onRead,
  loading = false,
  error,
  onReadAll,
}: {
  items: NotificationItem[];
  onRead?: (id: string) => void;
  onReadAll?: () => void;
  loading?: boolean;
  error?: string;
}) {
  if (loading)
    return (
      <div role="status" aria-label="Loading notifications" className="space-y-4">
        <Skeleton />
        <Skeleton />
      </div>
    );
  if (error) return <Alert title={error} tone="danger" />;
  if (!items.length)
    return (
      <EmptyState title="No notifications" description="Updates from your firm will appear here." />
    );
  return (
    <div className="space-y-4">
      {onReadAll ? (
        <Button variant="link" disabled={items.every((n) => n.read)} onClick={onReadAll}>
          Mark all as read
        </Button>
      ) : null}
      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className={`rounded-card border border-border p-4 ${item.read ? 'bg-surface' : 'bg-folder-surface'}`}
          >
            <p className="font-semibold text-heading">
              {!item.read ? '● ' : ''}
              {item.title}
            </p>
            <p className="mt-1 text-sm text-muted">{item.message}</p>
            <p className="mt-2 text-xs text-muted">{item.time}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {item.href?.startsWith('/') &&
              !item.href.startsWith('//') &&
              !item.href.includes('\\') ? (
                <a
                  href={item.href}
                  className="inline-flex min-h-11 items-center text-sm text-link underline"
                >
                  Open record
                </a>
              ) : null}
              {!item.read && onRead ? (
                <Button variant="link" onClick={() => onRead(item.id)}>
                  Mark as read
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
export function NotificationBell({
  items,
  onRead,
  loading,
  error,
  centerHref = '/notifications',
}: {
  items: NotificationItem[];
  onRead?: (id: string) => void;
  loading?: boolean;
  error?: string;
  centerHref?: string;
}) {
  const count = items.filter((n) => !n.read).length;
  return (
    <details className="relative">
      <summary
        aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
        className="flex min-h-11 list-none items-center gap-2 rounded-control px-3 text-link"
      >
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {count ? (
          <span className="rounded-pill bg-action px-2 py-1 text-xs text-white">{count}</span>
        ) : null}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-72 max-w-auth rounded-card border border-border bg-surface p-4 shadow-md">
        <NotificationList
          items={items.slice(0, 3)}
          onRead={onRead}
          loading={loading}
          error={error}
        />
        <a
          href={centerHref}
          className="mt-4 inline-flex min-h-11 items-center text-sm text-link underline"
        >
          View all notifications
        </a>
      </div>
    </details>
  );
}
