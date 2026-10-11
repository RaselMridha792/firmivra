'use client';
import { Button } from './button';
import { Badge } from './badge';

export function NotificationBellButton({
  count,
  open,
  onClick,
}: {
  count: number;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className="relative shrink-0 px-2 text-text"
      aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
      data-testid="notification-bell"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-danger px-1 text-xs font-bold text-on-action"
          data-testid="notification-count"
        >
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Button>
  );
}

export interface NotificationEntry {
  id: string;
  title: string;
  body: string;
  when: string;
  unread: boolean;
  canOpen: boolean;
}
export function NotificationList({
  items,
  pending,
  onOpen,
}: {
  items: NotificationEntry[];
  pending: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="space-y-3" data-testid="notification-list">
      {items.map((item) => (
        <li
          key={item.id}
          className="space-y-2 rounded-card border border-border p-3"
          data-testid="notification-item"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-heading wrap-anywhere">{item.title}</p>
            <Badge>{item.unread ? 'Unread' : 'Read'}</Badge>
          </div>
          <p className="text-sm text-text wrap-anywhere">{item.body}</p>
          <p className="text-xs text-muted">{item.when}</p>
          {item.canOpen || item.unread ? (
            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              disabled={pending}
              onClick={() => onOpen(item.id)}
            >
              {item.canOpen ? 'Open' : 'Mark as read'}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
