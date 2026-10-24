'use client';

import { Bell, ChevronDown, Menu, Search } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { useMe } from '../signed-in';
import { HeaderClock } from './header-clock';
import { initials } from './types';

/** One entry of the account menu above Sign out: a page, or an action such as opening a panel. */
export type AccountMenuItem =
  { label: string; href: string } | { label: string; onSelect: () => void };

/** Top bar: menu button (below 768 px), search (Super Admin) or greeting (portal), bell, user menu. */
export function Header({
  search,
  greeting,
  roleLabel,
  onOpenMenu,
  bell,
  hideRole = false,
  start,
  actions,
  accountMenu = [],
  clock = false,
}: {
  /** The current date and time with its time zone (SM10): the firm workspace and Super Admin. */
  clock?: boolean;
  /** Account menu entries above Sign out (the firm's My Profile, My Settings, Help & Support). */
  accountMenu?: AccountMenuItem[];
  /** Replaces the search box or greeting, for example the firm's search form. */
  start?: ReactNode;
  /** Controls before the bell, for example the firm's "+ New" menu. */
  actions?: ReactNode;
  /** Placeholder text for the search box; search is not connected yet. */
  search?: string;
  /** Centre text instead of a search box, for example "Welcome back, John!" in the portal. */
  greeting?: ReactNode;
  roleLabel: string;
  onOpenMenu: () => void;
  /** Replaces the plain bell button, for example the portal's bell with its unread count. */
  bell?: ReactNode;
  /**
   * The portal's user menu, as its mockups draw it: only the name next to the avatar (screen readers
   * still hear the role), with the name and chevron in the heading colour (R61).
   */
  hideRole?: boolean;
}) {
  const { me, signOut } = useMe();
  const [open, setOpen] = useState(false);

  return (
    <header
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
      // Super Admin (search): the header sits on the canvas as in its mockup; elsewhere a white bar.
      // Phones get tighter gaps so the controls fit a 320 px screen.
      className={`flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4 md:px-6 ${search && !start ? 'bg-canvas' : 'border-b border-border bg-surface'}`}
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded-control p-2 text-text hover:bg-canvas md:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      {start}
      {search && !start ? (
        <label className="hidden h-10 w-full max-w-xs flex-1 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-muted md:ml-auto md:flex">
          <Search aria-hidden className="size-4" />
          <input
            type="search"
            placeholder={search}
            aria-label="Search firms, applications, users"
            className="min-h-0 w-full bg-transparent outline-none"
          />
        </label>
      ) : null}
      {greeting ? <div className="text-lg font-semibold text-text">{greeting}</div> : null}

      <div
        className={
          search
            ? 'ml-auto flex items-center gap-2 rounded-card bg-surface px-2 py-1 md:ml-5'
            : 'ml-auto flex items-center gap-2'
        }
      >
        {clock ? <HeaderClock /> : null}
        {actions}
        {bell ?? (
          <button
            type="button"
            aria-label="Notifications"
            className="rounded-control p-2 text-text hover:bg-canvas"
          >
            <Bell aria-hidden className="size-5" />
          </button>
        )}
        {search ? <span aria-hidden className="h-8 w-px bg-border" /> : null}

        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-2 rounded-control p-1 hover:bg-canvas sm:pr-2"
          >
            <span
              className={`flex size-11 items-center justify-center rounded-full text-sm font-semibold ${start ? 'border-2 border-border bg-info-soft text-heading' : 'bg-brand-900 text-white'}`}
            >
              {initials(me.user.name)}
            </span>
            <span className="hidden text-left text-sm sm:block">
              <span className={`block font-semibold ${hideRole ? 'text-heading' : 'text-text'}`}>
                {me.user.name}
              </span>
              <span className={hideRole ? 'sr-only' : 'block text-muted'}>{roleLabel}</span>
            </span>
            <ChevronDown
              aria-hidden
              className={`hidden size-4 sm:block ${hideRole ? 'text-heading' : 'text-muted'}`}
            />
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
                <span className="text-muted">{roleLabel}</span>
              </p>
              {accountMenu.map((item) =>
                'href' in item ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="block w-full rounded-control px-3 py-2 text-left text-sm text-text hover:bg-canvas"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      item.onSelect();
                    }}
                    className="w-full rounded-control px-3 py-2 text-left text-sm text-text hover:bg-canvas"
                  >
                    {item.label}
                  </button>
                ),
              )}
              {accountMenu.length ? (
                <span aria-hidden className="my-1 block h-px bg-divider" />
              ) : null}
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
