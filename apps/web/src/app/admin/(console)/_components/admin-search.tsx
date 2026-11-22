'use client';

import {
  type AdminSearchResult,
  FIRM_APPLICATION_STATUS_LABELS,
  type BusinessStatus,
} from '@firmivra/types';
import { Skeleton } from '@firmivra/ui';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { api } from '../../../../lib/api';

/** Firms and applications only: her rule is no employee or user search (SA-DSH-F01). */
export const ADMIN_SEARCH_LABEL = 'Search firms and applications';
/** Results show from this many typed characters (the API's minimum). */
const MIN_SEARCH = 2;

export const FIRM_STATUS_LABELS: Record<BusinessStatus, string> = {
  ACTIVE: 'Active',
  PENDING_SETUP: 'Pending Setup',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
};

/** The typed text, once it has been still for a moment (one request per pause, not per key). */
function useSettled(text: string, ms = 250) {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(text), ms);
    return () => clearTimeout(timer);
  }, [text, ms]);
  return settled;
}

/** One result: its type, name and a detail line, opening its record. */
export function ResultRow({
  href,
  type,
  name,
  detail,
}: {
  href: string;
  type: 'Firm' | 'Application';
  name: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      data-testid="search-result"
      className="flex items-start gap-3 rounded-control px-3 py-2 hover:bg-canvas focus-visible:bg-canvas"
    >
      <span className="mt-0.5 shrink-0 rounded-pill bg-info-soft px-2 py-0.5 text-xs font-semibold text-info">
        {type}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-heading">{name}</span>
        <span className="block truncate text-xs text-muted">{detail}</span>
      </span>
    </Link>
  );
}

/** A result as the box and the Search page list it. */
export interface SearchRow {
  key: string;
  href: string;
  type: 'Firm' | 'Application';
  name: string;
  detail: string;
}

export const firmRows = (data: AdminSearchResult): SearchRow[] =>
  data.firms.items.map((f) => ({
    key: f.id,
    href: `/firms/${f.id}`,
    type: 'Firm' as const,
    name: f.name,
    detail: [FIRM_STATUS_LABELS[f.status], f.ownerName, f.ownerEmail].filter(Boolean).join(' · '),
  }));
export const applicationRows = (data: AdminSearchResult): SearchRow[] =>
  data.applications.items.map((a) => ({
    key: a.id,
    href: `/applications/${a.id}`,
    type: 'Application' as const,
    name: a.legalName,
    detail: [FIRM_APPLICATION_STATUS_LABELS[a.status], a.contactName, a.contactEmail].join(' · '),
  }));

/**
 * The header search on every Super Admin page (SA-DSH-F01): firms and applications by name,
 * owner or applicant, email, id or status word, as you type; each result opens its record.
 * Enter opens every result on the Search page.
 */
export function AdminSearch() {
  const router = useRouter();
  const panelId = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const term = useSettled(text.trim());
  const ready = term.length >= MIN_SEARCH;
  const results = useQuery({
    queryKey: ['admin-search', term],
    queryFn: () => api.firmApplications.search({ q: term, limit: 5 }),
    enabled: ready,
    placeholderData: keepPreviousData,
  });
  const shown = open && ready;
  const rows = results.data ? [...firmRows(results.data), ...applicationRows(results.data)] : [];
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const typed = text.trim();
        if (typed.length < MIN_SEARCH) return;
        setOpen(false);
        router.push(`/search?q=${encodeURIComponent(typed)}`);
      }}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      // Where the mockup's search box sits: right of centre, from 768 px.
      className="relative hidden h-10 w-full min-w-0 max-w-sm flex-1 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm text-muted md:ml-auto md:flex"
    >
      <MagnifyingGlass aria-hidden weight="fill" className="size-5 shrink-0" />
      <input
        name="q"
        type="search"
        maxLength={100}
        autoComplete="off"
        placeholder={`${ADMIN_SEARCH_LABEL}…`}
        aria-label={ADMIN_SEARCH_LABEL}
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
          className="absolute left-0 top-full z-30 mt-2 max-h-[70vh] w-full min-w-72 overflow-y-auto rounded-card border border-border bg-surface p-2 shadow-card"
        >
          {results.isPending ? (
            <Skeleton className="mx-3 my-2 h-8" />
          ) : results.isError ? (
            <p className="px-3 py-2 text-sm text-muted">Could not search right now.</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted">No firms or applications match.</p>
          ) : (
            rows.map(({ key, ...row }) => <ResultRow key={key} {...row} />)
          )}
          <button
            type="submit"
            className="mt-1 block w-full rounded-control border-t border-divider px-3 py-2 text-left text-sm font-medium text-link hover:bg-canvas"
          >
            See all results for “{term}”
          </button>
        </div>
      ) : null}
    </form>
  );
}
