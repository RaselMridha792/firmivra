'use client';

import type { AdminNotification } from '@firmivra/types';
import { Bell } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { recordHref } from './notification-links';

const queryKey = ['admin-notifications'] as const;

function priorityTone(item: AdminNotification) {
  if (item.priority === 'CRITICAL') return 'border-l-danger bg-danger-soft';
  if (item.priority === 'HIGH') return 'border-l-gold bg-amber-surface';
  return 'border-l-transparent';
}

export function AdminNotificationBell() {
  const recent = useApiQuery([...queryKey, 'bell'], () =>
    api.adminNotifications.recent({ limit: 5 }),
  );
  const client = useQueryClient();
  const router = useRouter();
  const unread = recent.data?.unread ?? 0;

  function markRead(item: AdminNotification) {
    if (!item.readAt) {
      void api.adminNotifications.read(item.id).then(() => client.invalidateQueries({ queryKey }));
    }
  }

  function open(item: AdminNotification) {
    markRead(item);
    router.push(recordHref(item) ?? '/notifications');
  }

  return (
    <details className="relative">
      <summary
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        className="relative flex size-10 cursor-pointer list-none items-center justify-center rounded-control text-text hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Bell aria-hidden className="size-5" />
        {unread ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 min-w-5 rounded-pill bg-danger px-1 text-center text-xs font-semibold text-on-action"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </summary>
      <section
        aria-label="Recent notifications"
        className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-divider bg-surface shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-divider px-3 py-2">
          <h2 className="text-sm font-semibold text-heading">Notifications</h2>
          <Link href="/notifications" className="text-xs font-semibold text-link hover:underline">
            View all
          </Link>
        </div>
        <div className="max-h-[60vh] overflow-y-auto" data-testid="admin-bell-list">
          {recent.isPending ? (
            <p className="px-3 py-4 text-sm text-muted">Loading notifications…</p>
          ) : recent.isError ? (
            <p className="px-3 py-4 text-sm text-danger">Notifications could not be loaded.</p>
          ) : recent.data.items.length ? (
            recent.data.items.map((item) => {
              const href = recordHref(item);
              const content = (
                <>
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 font-semibold text-heading">{item.title}</span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${item.priority === 'CRITICAL' ? 'bg-danger text-on-action' : item.priority === 'HIGH' ? 'bg-gold text-heading' : 'bg-disabled text-muted'}`}
                    >
                      {item.priority === 'CRITICAL' ? 'Urgent' : item.priority.toLowerCase()}
                    </span>
                  </span>
                  {item.body ? (
                    <span className="mt-1 block text-xs text-muted">{item.body}</span>
                  ) : null}
                </>
              );
              return href ? (
                <Link
                  key={item.id}
                  href={href}
                  onClick={() => markRead(item)}
                  className={`block border-l-4 px-3 py-2 hover:bg-canvas ${priorityTone(item)} ${item.readAt ? '' : 'font-semibold'}`}
                >
                  {content}
                </Link>
              ) : (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => open(item)}
                  className={`block w-full border-l-4 px-3 py-2 text-left hover:bg-canvas ${priorityTone(item)}`}
                >
                  {content}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-4 text-sm text-muted">You’re all caught up.</p>
          )}
        </div>
      </section>
    </details>
  );
}
