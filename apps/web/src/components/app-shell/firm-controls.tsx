'use client';

import { notificationLink } from '@firmivra/types';
import { Skeleton } from '@firmivra/ui';
import { Bell, MagnifyingGlass, Plus, Question } from '@phosphor-icons/react';
import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { api } from '../../lib/api';
import { useApiQuery } from '../../lib/query';

const popover =
  'absolute right-0 z-30 mt-2 rounded-card border border-border bg-surface p-2 shadow-card';

/** Opens its panel on click; closes on Escape, a click on the panel or a click elsewhere. */
function Popover({
  trigger,
  children,
}: {
  trigger: (open: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="contents"
      >
        {trigger(open)}
      </button>
      {open ? (
        <div role="menu" onClick={() => setOpen(false)} className={popover}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Header search: opens the clients list with the typed text. */
export function FirmSearch() {
  const router = useRouter();
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const text = String(new FormData(e.currentTarget).get('q') ?? '').trim();
        router.push(text ? `/clients?search=${encodeURIComponent(text)}` : '/clients');
      }}
      className="flex h-10 w-full min-w-0 max-w-xl flex-1 items-center gap-2 rounded-control border border-border bg-canvas px-3 text-sm text-muted"
    >
      <MagnifyingGlass aria-hidden weight="fill" className="size-5 shrink-0" />
      <input
        name="q"
        type="search"
        maxLength={100}
        placeholder="Search clients…"
        aria-label="Search clients"
        className="min-h-0 w-full bg-transparent text-text outline-none"
      />
    </form>
  );
}

/** "+ New": a menu of places where something new is created; opening it creates nothing. */
export function NewMenu({ links }: { links: readonly { label: string; href: string }[] }) {
  return (
    <Popover
      trigger={() => (
        // On phones only the plus shows; the name stays for screen readers.
        <span className="flex min-h-9 items-center gap-1 rounded-control bg-gold px-3 py-2 text-sm font-semibold text-heading hover:brightness-95 sm:px-4">
          <Plus aria-hidden weight="bold" className="size-4" />
          <span className="sr-only sm:not-sr-only">New</span>
          <ChevronDown aria-hidden className="hidden size-4 sm:block" />
        </span>
      )}
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          role="menuitem"
          className="block whitespace-nowrap rounded-control px-4 py-2 text-sm text-text hover:bg-canvas"
        >
          {link.label}
        </Link>
      ))}
    </Popover>
  );
}

/** The bell: the unread count and the latest notifications. */
export function FirmBell() {
  const list = useApiQuery(['notifications', 'bell'], () => api.notifications.list({ limit: 5 }));
  const unread = list.data?.unreadCount ?? 0;
  return (
    <Popover
      trigger={() => (
        <span className="relative block rounded-control p-2 text-text hover:bg-canvas">
          <Bell aria-hidden weight="fill" className="size-6" />
          <span className="sr-only">Notifications{unread ? `, ${unread} unread` : ''}</span>
          {unread ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 min-w-5 rounded-pill bg-danger px-1 text-center text-xs font-semibold text-on-action"
            >
              {unread}
            </span>
          ) : null}
        </span>
      )}
    >
      <div className="w-80 max-w-[calc(100vw-2rem)]">
        {list.isPending ? (
          <Skeleton className="m-3 h-10" />
        ) : list.isError ? (
          <p className="px-3 py-2 text-sm text-danger">We couldn&apos;t load your notifications.</p>
        ) : list.data.items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted">You&apos;re all caught up.</p>
        ) : (
          list.data.items.map((item) => {
            const href = notificationLink(item.target, { site: 'firm' });
            const body = (
              <>
                <span className={`block text-sm text-text ${item.readAt ? '' : 'font-semibold'}`}>
                  {item.title}
                </span>
                <span className="line-clamp-2 text-xs text-muted">{item.body}</span>
              </>
            );
            return href ? (
              <Link
                key={item.id}
                href={href}
                role="menuitem"
                className="block rounded-control px-3 py-2 hover:bg-canvas"
              >
                {body}
              </Link>
            ) : (
              <p key={item.id} className="px-3 py-2">
                {body}
              </p>
            );
          })
        )}
      </div>
    </Popover>
  );
}

/** Help opens Firmivra's support address. */
export function HelpLink({ email }: { email: string }) {
  return (
    <a
      href={`mailto:${email}`}
      aria-label="Help"
      className="rounded-control p-2 text-text hover:bg-canvas"
    >
      <Question aria-hidden weight="fill" className="size-6" />
    </a>
  );
}

/**
 * The strip under every page: the firm's logo for light backgrounds, or its name, on the left and
 * the links that have pages on the right (only Support has one so far).
 */
export function FirmFooter({
  name,
  logoUrl,
  supportEmail,
}: {
  name: string;
  logoUrl: string | null;
  supportEmail: string;
}) {
  return (
    <footer className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-4 py-4 md:px-6">
      {logoUrl ? (
        <Image
          unoptimized
          src={logoUrl}
          alt={name}
          width={270}
          height={36}
          className="block h-9 w-auto max-w-[270px] object-contain object-left"
        />
      ) : (
        <p className="font-semibold text-heading">{name}</p>
      )}
      <a href={`mailto:${supportEmail}`} className="text-sm font-medium text-link">
        Support
      </a>
    </footer>
  );
}
