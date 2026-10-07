'use client';

import { Bell, ChevronDown, Menu, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useMe } from '../signed-in';
import { initials, type ShellNotification, type ShellSearchItem } from './types';

/** Top bar: menu button (below 768 px), search (Super Admin) or greeting (portal), bell, user menu. */
export function Header({
  search,
  searchItems,
  notifications,
  greeting,
  roleLabel,
  onOpenMenu,
}: {
  /** Placeholder text for the search box; no box without it. */
  search?: string;
  searchItems?: readonly ShellSearchItem[];
  notifications?: readonly ShellNotification[];
  /** Centre text instead of a search box, for example "Welcome back, John!" in the portal. */
  greeting?: ReactNode;
  roleLabel: string;
  onOpenMenu: () => void;
}) {
  const { me, signOut } = useMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const unreadCount = (notifications ?? []).filter(
    (notification) => !readNotifications.includes(notification.id),
  ).length;
  const searchResults = (searchItems ?? []).filter((item) =>
    `${item.kind} ${item.label} ${item.detail}`
      .toLowerCase()
      .includes(searchTerm.trim().toLowerCase()),
  );
  const displayRole = me.platformAdmin ? 'Super Admin' : roleLabel;

  return (
    <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2 md:px-6">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded-control p-2 text-text hover:bg-canvas md:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      {search ? (
        <div className="relative hidden w-full max-w-xs flex-1 md:ml-auto md:block">
          <label className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm text-muted">
            <Search aria-hidden className="size-4" />
            <input
              type="search"
              placeholder={search}
              aria-label="Search firms, applications, users"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="shell-search-results"
              aria-expanded={Boolean(searchTerm.trim())}
              aria-activedescendant={
                searchResults[selectedSearchIndex]
                  ? `shell-search-${searchResults[selectedSearchIndex].id}`
                  : undefined
              }
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                setSelectedSearchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' && searchResults.length) {
                  event.preventDefault();
                  setSelectedSearchIndex((index) => (index + 1) % searchResults.length);
                } else if (event.key === 'ArrowUp' && searchResults.length) {
                  event.preventDefault();
                  setSelectedSearchIndex(
                    (index) => (index - 1 + searchResults.length) % searchResults.length,
                  );
                } else if (event.key === 'Escape') {
                  setSearchTerm('');
                } else if (event.key === 'Enter' && searchResults[selectedSearchIndex]) {
                  event.preventDefault();
                  router.push(searchResults[selectedSearchIndex].href);
                  setSearchTerm('');
                }
              }}
              className="w-full bg-transparent outline-none"
            />
            {searchTerm ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchTerm('')}
                className="rounded-control p-1 text-muted hover:bg-canvas hover:text-text"
              >
                <X aria-hidden className="size-4" />
              </button>
            ) : null}
          </label>
          {searchTerm.trim() ? (
            <ul
              id="shell-search-results"
              role="listbox"
              aria-label="Search results"
              className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-card border border-border bg-surface p-1 shadow-card"
            >
              {searchResults.length ? (
                searchResults.map((item) => (
                  <li key={item.id}>
                    <Link
                      id={`shell-search-${item.id}`}
                      href={item.href}
                      role="option"
                      aria-selected={selectedSearchIndex === searchResults.indexOf(item)}
                      className={`block rounded-control px-3 py-2 hover:bg-canvas ${selectedSearchIndex === searchResults.indexOf(item) ? 'bg-canvas' : ''}`}
                    >
                      <span className="block text-xs text-muted">{item.kind}</span>
                      <span className="block text-sm font-medium text-text">{item.label}</span>
                      <span className="block truncate text-xs text-muted">{item.detail}</span>
                    </Link>
                  </li>
                ))
              ) : (
                <li className="px-3 py-3 text-sm text-muted">No matching mock records.</li>
              )}
            </ul>
          ) : null}
        </div>
      ) : null}
      {greeting ? <p className="text-lg font-semibold text-text">{greeting}</p> : null}

      <div
        className={
          search ? 'ml-auto flex items-center gap-2 md:ml-5' : 'ml-auto flex items-center gap-2'
        }
      >
        {notifications ? (
          <div className="relative">
            <button
              type="button"
              aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((value) => !value)}
              className="relative rounded-control p-2 text-text hover:bg-canvas"
            >
              <Bell aria-hidden className="size-5" />
              {unreadCount ? (
                <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </button>
            {notificationsOpen ? (
              <section
                aria-label="Notifications panel"
                className="absolute right-0 z-30 mt-2 w-80 rounded-card border border-border bg-surface p-3 shadow-card"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-text">Notifications</h2>
                  <button
                    type="button"
                    disabled={!unreadCount}
                    onClick={() => setReadNotifications((notifications ?? []).map(({ id }) => id))}
                    className="text-xs text-brand-700 hover:underline disabled:text-muted disabled:no-underline"
                  >
                    Mark all read
                  </button>
                </div>
                <ul className="grid gap-1">
                  {notifications.length ? (
                    notifications.map((notification) => {
                      const isRead = readNotifications.includes(notification.id);
                      return (
                        <li key={notification.id}>
                          <Link
                            href={notification.href}
                            onClick={() => {
                              setReadNotifications((ids) => [
                                ...new Set([...ids, notification.id]),
                              ]);
                              setNotificationsOpen(false);
                            }}
                            className={`block rounded-control px-3 py-2 hover:bg-canvas ${isRead ? 'opacity-70' : 'bg-brand-50'}`}
                          >
                            <span className="block text-sm font-medium text-text">
                              {notification.title}
                            </span>
                            <span className="block text-xs text-muted">{notification.detail}</span>
                          </Link>
                        </li>
                      );
                    })
                  ) : (
                    <li className="px-3 py-4 text-sm text-muted">You&apos;re all caught up.</li>
                  )}
                </ul>
              </section>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            aria-label="Notifications"
            className="relative rounded-control p-2 text-text hover:bg-canvas"
          >
            <Bell aria-hidden className="size-5" />
            <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-danger" />
          </button>
        )}

        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
            className="flex items-center gap-2 rounded-control p-1 pr-2 hover:bg-canvas"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-900 text-sm font-semibold text-white">
              {initials(me.user.name)}
            </span>
            <span className="hidden text-left text-sm sm:block">
              <span className="block font-semibold text-text">{me.user.name}</span>
              <span className="block text-muted">{displayRole}</span>
            </span>
            <ChevronDown aria-hidden className="size-4 text-muted" />
          </button>
          {open ? (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-2 w-64 rounded-card border border-border bg-surface p-2 shadow-card"
            >
              <p className="px-3 py-2 text-sm">
                <span data-testid="me-email" className="block font-medium text-text">
                  {me.user.email}
                </span>
                <span className="text-muted">{displayRole}</span>
              </p>
              <button
                type="button"
                role="menuitem"
                onClick={() => void signOut()}
                className="w-full rounded-control px-3 py-2 text-left text-sm text-text hover:bg-canvas"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
