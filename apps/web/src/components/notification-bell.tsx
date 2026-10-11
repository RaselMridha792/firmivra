'use client';
import {
  notificationLink,
  type NotificationItem,
  type NotificationsClient,
  type NotificationSite,
} from '@firmivra/types';
import { Button, Modal, NotificationBellButton, NotificationList } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageState } from './page-state';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useApiMutation, useApiQuery } from '../lib/query';

interface Props {
  client?: NotificationsClient;
  site?: NotificationSite;
}
const firmSite: NotificationSite = { site: 'firm' };
const when = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
/** One controller for both sites; portal callers pass api.myNotifications(slug) and their site. */
export function NotificationBell({ client = api.notifications, site = firmSite }: Props) {
  const [open, setOpen] = useState(false);
  const key =
    site.site === 'firm' ? ['notifications', 'firm'] : ['my-notifications', site.firmSlug];
  const unread = useApiQuery([...key, 'unread-count'], () => client.unreadCount());
  const refetch = unread.refetch;
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refetch]);
  return (
    <>
      <NotificationBellButton count={unread.data ?? 0} open={open} onClick={() => setOpen(true)} />
      <Modal open={open} title="Notifications" onClose={() => setOpen(false)}>
        {open ? (
          <NotificationPanel
            client={client}
            site={site}
            queryKey={key}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </Modal>
    </>
  );
}
function NotificationPanel({
  client,
  site,
  queryKey,
  onClose,
}: {
  client: NotificationsClient;
  site: NotificationSite;
  queryKey: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const list = useApiQuery([...queryKey, 'list', cursors.at(-1)], () =>
    client.list({ limit: 10, cursor: cursors.at(-1) }),
  );
  const markAll = useApiMutation(() => client.markAllRead(), { invalidate: queryKey });
  const read = useApiMutation(
    async (item: NotificationItem) => {
      if (!item.readAt) await client.markRead(item.id);
      return notificationLink(item.target, site);
    },
    { invalidate: queryKey },
  );
  return (
    <div className="min-w-0 space-y-4" data-testid="notification-panel">
      <Button
        variant="secondary"
        className="w-full sm:w-auto"
        disabled={!list.data?.unreadCount || markAll.isPending || read.isPending}
        onClick={() => markAll.mutate()}
      >
        Mark all as read
      </Button>
      {read.error || markAll.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(read.error ?? markAll.error)}
        </p>
      ) : null}
      <PageState
        query={list}
        empty="No notifications yet."
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => (
          <>
            <NotificationList
              items={data.items.map((item) => ({
                id: item.id,
                title: item.title,
                body: item.body,
                when: when.format(new Date(item.createdAt)),
                unread: !item.readAt,
                canOpen: !!notificationLink(item.target, site),
              }))}
              pending={read.isPending || markAll.isPending}
              onOpen={(id) => {
                const item = data.items.find((row) => row.id === id);
                if (item)
                  read.mutate(item, {
                    onSuccess: (link) => {
                      if (link) {
                        onClose();
                        router.push(link);
                      }
                    },
                  });
              }}
            />
            <nav aria-label="Notification pages" className="grid grid-cols-2 gap-3">
              <Button
                variant="secondary"
                disabled={cursors.length === 1}
                onClick={() => setCursors((value) => value.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={!data.nextCursor}
                onClick={() => {
                  if (data.nextCursor) setCursors((value) => [...value, data.nextCursor!]);
                }}
              >
                Next
              </Button>
            </nav>
          </>
        )}
      </PageState>
    </div>
  );
}
