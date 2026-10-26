'use client';

import {
  ApiRequestError,
  type ClientSignUp,
  type ClientSignUpList,
  type ClientSignUpsQuery,
  type SignUpListStatus,
} from '@firmivra/types';
import { Avatar, Badge, Pagination, SearchField, Skeleton } from '@firmivra/ui';
import { CaretDown, CheckCircle, Info, WarningCircle } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { ApprovalCard } from './approval-card';
import { ClientViewPreview } from './client-view-preview';
import { FiltersMenu } from './filters-menu';
import { type Notice, RequestActivity, RequestPanel } from './request-panel';
import { dayText, SIGN_UP_ERRORS, SIGN_UPS, TABS } from './sign-up-parts';
import {
  SIGN_UP_PAGE_SIZE,
  type SignUpsPlace,
  signUpsPlaceFrom,
  signUpsPlaceQuery,
} from './sign-ups-place';

/** Waits until typing pauses, so each key press doesn't send a request. */
function useSettled(value: string, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Client Sign-ups (Octavia's spec of Oct 25 and its expanded-sidebar design): the firm's approval
 * mode, the three tabs with the firm's own counts, search, sort and filters, the requests with
 * their match check, the open request's panel and activity, and what a client sees. The tab,
 * search, sort, filters, page and open request live in the address, so Back returns to the same
 * view. Owner and Admin only: Staff get 403 from the API and the no-permission state.
 */
export function SignUpsScreen({
  portalBase,
}: {
  /** The client portal's address (PORTAL_BASE_URL), for the client view preview. */
  portalBase: string;
}) {
  // The address as the browser has it now: on Back, Next shows this page as it was first drawn,
  // so its place comes from the address, not from the first render's props.
  const params = useSearchParams();
  const [place, setPlace] = useState(() => signUpsPlaceFrom(Object.fromEntries(params)));
  const [searchText, setSearchText] = useState(place.search);
  // The API refuses control characters.
  const settled = useSettled(searchText.replace(/[\p{Cc}\p{Cs}]/gu, ' ').trim());
  const [notice, setNotice] = useState<Notice | null>(null);
  // A new search starts on the first page.
  if (settled !== place.search) setPlace({ ...place, search: settled, page: 1 });

  const change = (patch: Partial<SignUpsPlace>) => {
    // Any change of tab, sort or filter starts on the first page.
    setPlace({ ...place, page: 1, ...patch });
    setNotice(null);
  };
  const url = `/sign-ups${signUpsPlaceQuery(place) ? `?${signUpsPlaceQuery(place)}` : ''}`;
  useEffect(() => {
    // A null state lets Next keep its router in step with the address (Next's history docs).
    window.history.replaceState(null, '', url);
  }, [url]);

  const query = useMemo<ClientSignUpsQuery>(
    () => ({
      status: place.status,
      sort: place.sort,
      page: place.page,
      limit: SIGN_UP_PAGE_SIZE,
      ...(place.search ? { search: place.search } : {}),
      ...(place.from ? { from: place.from } : {}),
      ...(place.to ? { to: place.to } : {}),
      ...(place.match ? { match: place.match } : {}),
    }),
    [place],
  );
  const list = useApiQuery([...SIGN_UPS, 'list', query], () => api.clientSignUps.list(query));
  const settings = useApiQuery([...SIGN_UPS, 'settings'], () => api.clientSignUps.settings());
  const counts = list.data?.counts;
  const filtered = Boolean(place.search || place.from || place.to || place.match);
  const noun = TABS.find((t) => t.status === place.status)?.noun ?? '';

  // After a decision empties the last page, step back to the new last page.
  const pageCount = list.data ? Math.max(1, Math.ceil(list.data.total / SIGN_UP_PAGE_SIZE)) : 1;
  if (list.data && place.page > pageCount) setPlace({ ...place, page: pageCount });
  // Staff, or a role that lost access: nothing of the queue shows (spec, section 10).
  const forbidden = list.error instanceof ApiRequestError && list.error.code === 'FORBIDDEN';

  const header = (
    <header className="min-w-0">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/clients" className="text-link hover:underline">
          Clients
        </Link>
        <span aria-hidden className="mx-2 text-muted">
          /
        </span>
        <span aria-current="page" className="text-text">
          Sign-ups
        </span>
      </nav>
      <h1
        data-testid="page-title"
        className="mt-1 font-display text-3xl font-bold text-heading sm:text-4xl"
      >
        Client sign-ups
      </h1>
      <p className="mt-1 text-base text-muted">Review client self-sign-ups and manage access.</p>
    </header>
  );
  if (forbidden) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {header}
        <PageState query={list}>{() => null}</PageState>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {header}

      <ApprovalCard settings={settings} />
      {notice ? (
        <p
          data-testid="sign-ups-feedback"
          role={notice.ok ? 'status' : 'alert'}
          className={`text-sm ${notice.ok ? 'text-success' : 'text-danger'}`}
        >
          {notice.text}
          {notice.clientId ? (
            <>
              {' '}
              <Link href={`/clients/${notice.clientId}`} className="text-link hover:underline">
                Open client record
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-label="Sign-up requests" className="flex min-w-0 flex-col gap-4">
            <div
              role="tablist"
              aria-label="Sign-up status"
              className="flex gap-6 overflow-x-auto border-b border-divider"
            >
              {TABS.map((tab) => {
                const on = tab.status === place.status;
                const count = counts?.[tab.status];
                return (
                  <button
                    key={tab.status}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    tabIndex={on ? 0 : -1}
                    data-testid={`sign-ups-tab-${tab.status}`}
                    onClick={() => change({ status: tab.status, match: '', request: '' })}
                    onKeyDown={(event) => {
                      const at = TABS.indexOf(tab);
                      const next =
                        event.key === 'ArrowRight'
                          ? TABS[(at + 1) % TABS.length]
                          : event.key === 'ArrowLeft'
                            ? TABS[(at - 1 + TABS.length) % TABS.length]
                            : undefined;
                      if (!next) return;
                      event.preventDefault();
                      change({ status: next.status, match: '', request: '' });
                      event.currentTarget.parentElement
                        ?.querySelector<HTMLButtonElement>(
                          `[data-testid="sign-ups-tab-${next.status}"]`,
                        )
                        ?.focus();
                    }}
                    className={`-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-medium ${on ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
                  >
                    {tab.label}
                    {/* No false zero while the counts load (spec, section 10). */}
                    {count === undefined ? null : (
                      <span
                        aria-label={`${count} in total`}
                        className={`rounded-pill px-2 text-xs font-semibold ${on ? 'bg-accent-soft text-action' : 'bg-divider text-muted'}`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <SearchField
                label="Search name or email"
                placeholder="Search name or email"
                value={searchText}
                maxLength={100}
                onChange={(event) => setSearchText(event.target.value)}
                className="bg-surface!"
              />
              <label className="relative flex h-10 shrink-0 items-center">
                <span className="sr-only">Sort by date submitted</span>
                <select
                  data-testid="sign-ups-sort"
                  value={place.sort}
                  onChange={(event) =>
                    change({ sort: event.target.value === 'oldest' ? 'oldest' : 'newest' })
                  }
                  className="h-10 cursor-pointer appearance-none rounded-lg border border-divider bg-surface pl-3 pr-9 text-sm text-text"
                >
                  <option value="newest">Date submitted: newest first</option>
                  <option value="oldest">Date submitted: oldest first</option>
                </select>
                <CaretDown
                  aria-hidden
                  weight="bold"
                  className="pointer-events-none absolute right-3 size-4 text-muted"
                />
              </label>
              <FiltersMenu place={place} onApply={(patch) => change(patch)} />
            </div>
            <FilterChips
              place={place}
              onClear={(patch) => change(patch)}
              onClearAll={() => {
                setSearchText('');
                change({ search: '', from: '', to: '', match: '' });
              }}
            />

            <div className="min-w-0 overflow-hidden rounded-xl border border-divider bg-surface">
              <RequestsTable
                status={place.status}
                list={list}
                filtered={filtered}
                selected={place.request}
                onOpen={(row) => setPlace({ ...place, request: row.clientAccountId })}
                onClear={() => {
                  setSearchText('');
                  change({ search: '', from: '', to: '', match: '' });
                }}
              />
              {list.data && list.data.total > 0 ? (
                <div className="flex flex-col gap-3 border-t border-divider px-4 py-3">
                  <p aria-live="polite" data-testid="sign-ups-total" className="text-sm text-muted">
                    {filtered
                      ? `${list.data.total} matching ${list.data.total === 1 ? 'request' : 'requests'} · ${counts?.[place.status] ?? 0} ${noun} in total`
                      : `${list.data.total} ${noun} ${list.data.total === 1 ? 'request' : 'requests'}`}
                  </p>
                  {pageCount > 1 ? (
                    <Pagination
                      page={place.page}
                      pageCount={pageCount}
                      onPage={(page) => setPlace({ ...place, page })}
                    />
                  ) : null}
                </div>
              ) : null}
              <div className="border-t border-divider px-4 py-4">
                <RequestActivity id={place.request} />
              </div>
            </div>
          </section>
          <ClientViewPreview portalBase={portalBase} />
        </div>

        <RequestPanel
          id={place.request}
          onClose={() => setPlace({ ...place, request: '' })}
          onNotice={setNotice}
        />
      </div>

      <p className="flex items-start gap-3 rounded-xl border border-divider bg-info-soft px-4 py-3 text-sm text-text">
        <Info aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-info" />
        Actual duplicates require separate authorized review and client permission before any close,
        replace, or merge action.
      </p>
    </div>
  );
}

/** The current filters as chips, each with its own remove, and Clear. */
function FilterChips({
  place,
  onClear,
  onClearAll,
}: {
  place: SignUpsPlace;
  onClear: (patch: Partial<SignUpsPlace>) => void;
  onClearAll: () => void;
}) {
  const chips: { label: string; patch: Partial<SignUpsPlace> }[] = [];
  if (place.search) chips.push({ label: `Search: ${place.search}`, patch: { search: '' } });
  if (place.from || place.to) {
    const day = (d: string) => dayText(`${d}T12:00:00`);
    chips.push({
      label: `Submitted ${place.from ? `from ${day(place.from)}` : ''}${place.from && place.to ? ' ' : ''}${place.to ? `to ${day(place.to)}` : ''}`,
      patch: { from: '', to: '' },
    });
  }
  if (place.match) {
    chips.push({
      label: place.match === 'POTENTIAL_MATCH' ? 'Potential match' : 'No match found',
      patch: { match: '' },
    });
  }
  if (!chips.length) return null;
  return (
    <ul aria-label="Current filters" className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <li key={chip.label}>
          <button
            type="button"
            onClick={() => (chip.patch.search === '' ? onClearAll() : onClear(chip.patch))}
            aria-label={`Remove ${chip.label}`}
            className="inline-flex min-h-8 items-center gap-2 rounded-pill bg-accent-soft px-3 text-xs font-medium text-action hover:bg-folder-surface"
          >
            {chip.label}
            <span aria-hidden>×</span>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={onClearAll}
          className="min-h-8 px-2 text-xs font-medium text-link hover:underline"
        >
          Clear
        </button>
      </li>
    </ul>
  );
}

/** One page of the tab's requests: applicant, submitted date and the check or decision. */
function RequestsTable({
  status,
  list,
  filtered,
  selected,
  onOpen,
  onClear,
}: {
  status: SignUpListStatus;
  list: UseQueryResult<ClientSignUpList>;
  filtered: boolean;
  selected: string;
  onOpen: (row: ClientSignUp) => void;
  onClear: () => void;
}) {
  const third =
    status === 'PENDING_APPROVAL' ? 'Checks' : status === 'APPROVED' ? 'Client ID' : 'Declined';
  if (list.isPending) {
    return (
      <div
        aria-busy="true"
        aria-label="Loading sign-up requests"
        className="flex flex-col gap-3 p-4"
      >
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }
  if (list.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-danger">{errorMessage(list.error, SIGN_UP_ERRORS)}</p>
        <button
          type="button"
          onClick={() => void list.refetch()}
          className="min-h-10 rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
        >
          Try again
        </button>
      </div>
    );
  }
  const rows = list.data.items;
  if (!rows.length) {
    const noun = TABS.find((t) => t.status === status)?.noun ?? '';
    return (
      <div data-testid="sign-ups-empty" className="flex flex-col items-start gap-2 p-6">
        {filtered ? (
          <>
            <p className="font-semibold text-heading">No {noun} requests match</p>
            <p className="text-sm text-muted">
              Nothing matches your search and filters. Clear them to see every {noun} request.
            </p>
            <button
              type="button"
              onClick={onClear}
              className="min-h-10 text-sm font-medium text-link hover:underline"
            >
              Clear search and filters
            </button>
          </>
        ) : (
          <>
            <p className="font-semibold text-heading">No {noun} requests</p>
            <p className="text-sm text-muted">
              {status === 'PENDING_APPROVAL'
                ? 'When someone signs up on your client portal and verifies their email and phone, their request waits here.'
                : status === 'APPROVED'
                  ? 'Requests your firm approves are listed here with their Client ID.'
                  : 'Requests your firm declines are listed here.'}
            </p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm" data-testid="sign-ups-table">
        <caption className="sr-only">Sign-up requests</caption>
        <thead className="bg-table-head text-text">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Applicant
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Submitted
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              {third}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const on = row.clientAccountId === selected;
            return (
              <tr
                key={row.clientAccountId}
                data-testid="sign-up-row"
                aria-selected={on}
                onClick={() => onOpen(row)}
                className={`cursor-pointer border-t border-divider ${on ? 'bg-accent-soft shadow-[inset_3px_0_0_var(--color-action)]' : 'hover:bg-canvas'}`}
              >
                <td className="px-4 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={row.name} />
                    <span className="min-w-0">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(row);
                        }}
                        aria-label={`Review ${row.name}'s request`}
                        className="block text-left font-semibold text-heading hover:underline"
                      >
                        {row.name}
                      </button>
                      <span className="block text-muted wrap-anywhere">{row.email}</span>
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-text">
                  <time dateTime={row.signedUpAt}>{dayText(row.signedUpAt)}</time>
                </td>
                <td className="px-4 py-3">
                  <RowCheck row={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The third column: the match check while waiting, else the decision. Text, never colour only. */
function RowCheck({ row }: { row: ClientSignUp }) {
  if (row.status === 'APPROVED') {
    return row.client ? (
      <span className="whitespace-nowrap font-medium text-text">{row.client.clientNumber}</span>
    ) : (
      <span className="text-muted">Not linked</span>
    );
  }
  if (row.status === 'DECLINED') {
    return (
      <Badge tone="danger">
        {row.declinedAt ? `Declined ${dayText(row.declinedAt)}` : 'Declined'}
      </Badge>
    );
  }
  return row.match === 'POTENTIAL_MATCH' ? (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <WarningCircle aria-hidden weight="fill" className="size-5 text-warning" />
      <Badge tone="warning">Potential match</Badge>
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-success">
      <CheckCircle aria-hidden weight="fill" className="size-5" />
      No match found
    </span>
  );
}
