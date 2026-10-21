'use client';

import { notificationLink } from '@firmivra/types';
import { Drawer, Skeleton } from '@firmivra/ui';
import {
  Bell,
  EnvelopeSimple,
  MagnifyingGlass,
  Plus,
  Question,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useId, useState } from 'react';
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

const SEARCH_LABEL = 'Search clients, locations, or team members';
/** Results show from this many typed characters. */
const MIN_SEARCH = 2;

/** The typed text, once it has been still for a moment (one request per pause, not per key). */
function useSettled(text: string, ms = 250) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}

function ResultGroup({
  title,
  query,
  rows,
}: {
  title: string;
  query: { isPending: boolean; isError: boolean };
  rows: { id: string; href: string; name: string; detail: string | null }[];
}) {
  return (
    <section aria-label={title} className="py-1">
      <h3 className="px-3 py-1 text-xs font-semibold uppercase text-muted">{title}</h3>
      {query.isPending ? (
        <Skeleton className="mx-3 my-2 h-8" />
      ) : query.isError ? (
        <p className="px-3 py-2 text-sm text-muted">Could not search {title.toLowerCase()} now.</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted">No matches.</p>
      ) : (
        rows.map((row) => (
          <Link
            key={row.id}
            href={row.href}
            className="block rounded-control px-3 py-2 hover:bg-canvas focus-visible:bg-canvas"
          >
            <span className="block truncate text-sm font-medium text-heading">{row.name}</span>
            {row.detail ? (
              <span className="block truncate text-xs text-muted">{row.detail}</span>
            ) : null}
          </Link>
        ))
      )}
    </section>
  );
}

/**
 * Header search (Settings review, Overview item 7): clients, and team members for those who manage
 * the team, as you type; each result opens its record. Enter opens the clients list with the text.
 * Locations join the results when their API exists (R1).
 */
export function FirmSearch({ team }: { team: boolean }) {
  const router = useRouter();
  const panelId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const term = useSettled(text.trim());
  const ready = term.length >= MIN_SEARCH;
  const clients = useQuery({
    queryKey: ['header-search', 'clients', term],
    queryFn: () => api.clients.list({ search: term, limit: 5 }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  const people = useQuery({
    queryKey: ['header-search', 'team', term],
    queryFn: () => api.staff.list({ search: term, pageSize: 10 }),
    enabled: ready && team,
    placeholderData: keepPreviousData,
  });
  const shown = open && ready;
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        const typed = text.trim();
        router.push(typed ? `/clients?search=${encodeURIComponent(typed)}` : '/clients');
      }}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      className="relative flex h-10 w-full min-w-0 max-w-xl flex-1 items-center gap-2 rounded-control border border-border bg-canvas px-3 text-sm text-muted"
    >
      <MagnifyingGlass aria-hidden weight="fill" className="size-5 shrink-0" />
      <input
        name="q"
        type="search"
        maxLength={100}
        autoComplete="off"
        placeholder={`${SEARCH_LABEL}…`}
        aria-label={SEARCH_LABEL}
        aria-expanded={shown}
        aria-controls={panelId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="min-h-0 w-full bg-transparent text-text outline-none"
      />
      {shown ? (
        <div
          id={panelId}
          role="region"
          aria-label="Search results"
          className={`${popover} left-0 top-full max-h-[70vh] w-full min-w-72 overflow-y-auto`}
        >
          <ResultGroup
            title="Clients"
            query={clients}
            rows={(clients.data?.items ?? []).map((client) => ({
              id: client.id,
              href: `/clients/${client.id}`,
              name: client.displayName,
              detail: client.email,
            }))}
          />
          {team ? (
            <ResultGroup
              title="Team members"
              query={people}
              rows={(people.data?.items ?? []).slice(0, 5).map((person) => ({
                id: person.id,
                href: `/team/${person.id}`,
                name: person.name,
                detail: person.jobTitle ?? person.email,
              }))}
            />
          ) : null}
          <button
            type="submit"
            className="mt-1 block w-full rounded-control border-t border-divider px-3 py-2 text-left text-sm font-medium text-link hover:bg-canvas"
          >
            See all clients matching “{term}”
          </button>
        </div>
      ) : null}
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

/** The "?" button: opens the Help & Support panel. */
export function HelpButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Help & Support"
      className="rounded-control p-2 text-text hover:bg-canvas"
    >
      <Question aria-hidden weight="fill" className="size-6" />
    </button>
  );
}

function HelpOption({
  icon: Glyph,
  title,
  body,
  href,
}: {
  icon: Icon;
  title: string;
  body: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex items-start gap-3 rounded-card border border-border p-4 hover:bg-canvas"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-info-soft text-action">
        <Glyph aria-hidden weight="fill" className="size-5" />
      </span>
      <span>
        <span className="block font-semibold text-heading">{title}</span>
        <span className="block text-sm text-text">{body}</span>
      </span>
    </a>
  );
}

/**
 * The shared Help & Support slide-out (Settings review, Overview item 8), from the "?" button and
 * the account menu. Contact Support keeps the support email; Report a Problem writes to it with the
 * firm and the page's path (no query, so nothing typed in a search travels). Help Center joins when
 * there is a help site to open (Rasel, Oct 21).
 */
export function HelpSupportPanel({
  open,
  onClose,
  email,
  firmName,
}: {
  open: boolean;
  onClose: () => void;
  email: string;
  firmName: string;
}) {
  const pathname = usePathname();
  const report = new URLSearchParams({
    subject: 'Report a Problem',
    body: `Firm: ${firmName}\nPage: ${pathname}\n\nWhat happened:\n`,
  })
    .toString()
    .replace(/\+/g, '%20');
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Help & Support"
      subtitle="Reach the Firmivra team."
    >
      <div className="flex flex-col gap-3">
        <HelpOption
          icon={EnvelopeSimple}
          title="Contact Support"
          body={`Email the Firmivra support team at ${email}.`}
          href={`mailto:${email}`}
        />
        <HelpOption
          icon={WarningCircle}
          title="Report a Problem"
          body="Tell us what went wrong. The email names your firm and the page you were on."
          href={`mailto:${email}?${report}`}
        />
      </div>
    </Drawer>
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
