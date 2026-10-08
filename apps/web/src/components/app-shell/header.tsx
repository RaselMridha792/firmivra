'use client';

import { Bell, ChevronDown, Menu, Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useMe } from '../signed-in';
import { initials } from './types';

/** Top bar: menu button (below 768 px), search (Super Admin) or greeting (portal), bell, user menu. */
export function Header({
  search,
  greeting,
  roleLabel,
  onOpenMenu,
}: {
  /** Placeholder text for the search box; search is not connected yet. */
  search?: string;
  /** Centre text instead of a search box, for example "Welcome back, John!" in the portal. */
  greeting?: ReactNode;
  roleLabel: string;
  onOpenMenu: () => void;
}) {
  const { me, signOut } = useMe();
  const [open, setOpen] = useState(false);

  return (
    <header
      onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
      className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2 md:px-6"
    >
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded-control p-2 text-text hover:bg-canvas md:hidden"
      >
        <Menu aria-hidden className="size-5" />
      </button>

      {search ? (
        <label className="hidden w-full max-w-xs flex-1 items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm text-muted md:ml-auto md:flex">
          <Search aria-hidden className="size-4" />
          <input
            type="search"
            placeholder={search}
            aria-label="Search firms, applications, users"
            className="w-full bg-transparent outline-none"
          />
        </label>
      ) : null}
      {greeting ? <p className="text-lg font-semibold text-text">{greeting}</p> : null}

      <div
        className={
          search ? 'ml-auto flex items-center gap-2 md:ml-5' : 'ml-auto flex items-center gap-2'
        }
      >
        <button
          type="button"
          aria-label="Notifications"
          className="rounded-control p-2 text-text hover:bg-canvas"
        >
          <Bell aria-hidden className="size-5" />
        </button>

        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex items-center gap-2 rounded-control p-1 pr-2 hover:bg-canvas"
          >
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-900 text-sm font-semibold text-white">
              {initials(me.user.name)}
            </span>
            <span className="hidden text-left text-sm sm:block">
              <span className="block font-semibold text-text">{me.user.name}</span>
              <span className="block text-muted">{roleLabel}</span>
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
                <span className="text-muted">{roleLabel}</span>
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
