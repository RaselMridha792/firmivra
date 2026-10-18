'use client';

import {
  Button,
  FilterChip,
  SearchField,
  Table,
  Tabs,
  tileTones,
  type TileTone,
} from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Clock,
  FileText,
  FolderOpen,
  GearSix,
  Plus,
  SlidersHorizontal,
  User,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import {
  adminSupport,
  isActive,
  type SupportSummary,
  type SupportTicket,
  type TicketQuery,
  type TicketTab,
} from '../../../../../mocks/admin-support';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { NewTicketModal } from './new-ticket-modal';
import {
  formatDate,
  formatTime,
  loadError,
  SUPPORT,
  SUPPORT_ERRORS,
  supportKeys,
  ticketNo,
} from './support-data';
import {
  Breadcrumbs,
  Panel,
  PriorityBadge,
  QuietLine,
  ResultLine,
  RowMenu,
  StatusBadge,
  type RowMenuItem,
} from './support-parts';
import {
  FiltersPanel,
  filterChips,
  filterQuery,
  NO_FILTERS,
  type FilterState,
} from './ticket-filters';
import { TicketActionModal, type TicketAction } from './ticket-actions';

const PAGE_SIZE = 10;

const TABS: { id: TicketTab; label: string }[] = [
  { id: 'ALL', label: 'All Tickets' },
  { id: 'UNASSIGNED', label: 'Unassigned' },
  { id: 'MINE', label: 'My Tickets' },
  { id: 'HIGH_PRIORITY', label: 'High Priority' },
  { id: 'OVERDUE', label: 'Overdue' },
  { id: 'WAITING', label: 'Waiting on Customer' },
  { id: 'ESCALATED', label: 'Escalated' },
  { id: 'CLOSED', label: 'Closed' },
];

type CardKey = 'total' | 'open' | 'overdue' | 'waiting' | 'resolved30';
const CARDS: {
  key: CardKey;
  label: string;
  icon: Icon;
  tone: TileTone;
  /** Whether a rise is good news (green) or bad (red). */
  upIsGood: boolean;
}[] = [
  { key: 'total', label: 'Total Tickets', icon: FileText, tone: 'blue', upIsGood: true },
  { key: 'open', label: 'Open Tickets', icon: FolderOpen, tone: 'blue', upIsGood: false },
  { key: 'overdue', label: 'Overdue', icon: Clock, tone: 'red', upIsGood: false },
  { key: 'waiting', label: 'Waiting on Customer', icon: User, tone: 'blue', upIsGood: false },
  {
    key: 'resolved30',
    label: 'Resolved (30 days)',
    icon: CheckCircle,
    tone: 'green',
    upIsGood: true,
  },
];
type TicketSet = TicketQuery['set'];
/** What each card shows in the list. */
const CARD_VIEW: Record<CardKey, { tab: TicketTab; set: TicketSet }> = {
  total: { tab: 'ALL', set: undefined },
  open: { tab: 'ALL', set: 'OPEN' },
  overdue: { tab: 'OVERDUE', set: undefined },
  waiting: { tab: 'WAITING', set: undefined },
  resolved30: { tab: 'ALL', set: 'RESOLVED_30' },
};
const SET_LABELS: Record<NonNullable<TicketSet>, string> = {
  OPEN: 'Open tickets',
  RESOLVED_30: 'Resolved in the last 30 days',
};

function SummaryCard({
  card,
  summary,
  loading,
  failed,
  active,
  onSelect,
}: {
  card: (typeof CARDS)[number];
  summary: SupportSummary | undefined;
  loading: boolean;
  failed: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const value = summary?.[card.key];
  const trend = summary?.trends[card.key] ?? null;
  const good = trend === null || trend === 0 ? null : trend > 0 === card.upIsGood;
  const Arrow = trend !== null && trend < 0 ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={`kpi-${card.key}`}
      onClick={onSelect}
      className="flex min-w-0 items-start gap-3 rounded-xl border border-divider bg-surface p-4 text-left shadow-sm hover:border-action aria-pressed:border-action aria-pressed:ring-1 aria-pressed:ring-action"
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${tileTones[card.tone]}`}
      >
        <card.icon aria-hidden weight="fill" className="size-6" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-sm text-text">{card.label}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {loading ? (
            <span aria-hidden className="h-8 w-12 animate-pulse rounded-control bg-disabled" />
          ) : (
            <span data-testid={`kpi-${card.key}-value`} className="text-3xl font-bold text-heading">
              {failed || value === undefined ? '—' : value.toLocaleString('en-US')}
            </span>
          )}
          {trend !== null && !failed ? (
            <span className="flex flex-col text-xs leading-tight">
              <span
                className={`inline-flex items-center gap-0.5 font-semibold ${good === null ? 'text-muted' : good ? 'text-success' : 'text-danger'}`}
              >
                {trend === 0 ? null : <Arrow aria-hidden weight="bold" className="size-3" />}
                <span className="sr-only">
                  {trend > 0 ? 'Up' : trend < 0 ? 'Down' : 'No change,'}
                </span>
                {Math.abs(trend)}%
              </span>
              <span className="text-muted">vs. last 30 days</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

/** A ticket's place in the list's time column: date over time. */
function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="flex flex-col whitespace-nowrap">
      <span>{formatDate(iso)}</span>
      <span>{formatTime(iso)}</span>
    </time>
  );
}

/**
 * Support (support-ticket-management-dashboard.jpg, docx §1): the summary cards, the ticket tabs,
 * search, Filters, and the ticket list with each row's actions. New Support Ticket opens the
 * Create New Support Ticket modal (§2) on this page.
 */
export function SupportDashboard() {
  const router = useRouter();
  const panelId = useId();
  const [tab, setTab] = useState<TicketTab>('ALL');
  const [set, setSet] = useState<TicketSet>(undefined);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterState>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<{ kind: TicketAction; ticket: SupportTicket } | null>(null);
  const [message, setMessage] = useState('');

  const me = useApiQuery(supportKeys.me, () => adminSupport.me());
  const summary = useApiQuery(supportKeys.summary, () => adminSupport.summary());
  const directory = useApiQuery(supportKeys.directory, () => adminSupport.directory());
  const settings = useApiQuery(supportKeys.settings, () => adminSupport.settings());
  const query: TicketQuery = {
    tab,
    ...(set ? { set } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...filterQuery(filters),
    page,
    pageSize: PAGE_SIZE,
  };
  const tickets = useApiQuery(supportKeys.tickets(query), () => adminSupport.tickets(query));
  const resolve = useApiMutation(
    (ticket: SupportTicket) =>
      adminSupport.updateTicket(ticket.id, { version: ticket.version, status: 'RESOLVED' }),
    { invalidate: SUPPORT },
  );

  const permissions = me.data?.permissions ?? [];
  const can = (p: (typeof permissions)[number]) => permissions.includes(p);
  const chips = filterChips(filters, directory.data, settings.data);
  const narrowed = chips.length > 0 || Boolean(set) || Boolean(search.trim()) || tab !== 'ALL';
  const activeCard = (Object.keys(CARD_VIEW) as CardKey[]).find(
    (key) =>
      CARD_VIEW[key].tab === tab &&
      CARD_VIEW[key].set === set &&
      (key !== 'total' || (!chips.length && !search.trim())),
  );

  function resetAll() {
    setTab('ALL');
    setSet(undefined);
    setSearch('');
    setFilters(NO_FILTERS);
    setPage(1);
  }

  function rowItems(ticket: SupportTicket): RowMenuItem[] {
    const active = isActive(ticket.status);
    const open = (kind: TicketAction) => () => {
      setMessage('');
      setAction({ kind, ticket });
    };
    const items: (RowMenuItem | false)[] = [
      { label: 'Open', onSelect: () => router.push(`/support/tickets/${ticket.id}`) },
      can('ASSIGN') && { label: 'Assign', onSelect: open('assign') },
      { label: 'Change Status', onSelect: open('status') },
      can('ESCALATE') &&
        active &&
        !ticket.escalation && { label: 'Escalate', onSelect: open('escalate') },
      can('RESOLVE') &&
        active && {
          label: 'Resolve',
          onSelect: () => {
            setMessage('');
            resolve.mutate(ticket, {
              onSuccess: (saved) => setMessage(`${ticketNo(saved.number)} was resolved.`),
            });
          },
        },
      can('CLOSE') && ticket.status !== 'CLOSED' && { label: 'Close', onSelect: open('close') },
      can('MERGE') && !ticket.mergedInto && { label: 'Merge', onSelect: open('merge') },
    ];
    return items.filter((item): item is RowMenuItem => Boolean(item));
  }

  const data = tickets.data;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Breadcrumbs items={[{ label: 'Home', href: '/' }, { label: 'Support' }]} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-4xl font-bold text-heading">
              Support
            </h1>
            <p className="mt-1 text-base text-muted">
              Manage and resolve support requests from your firms and users. Track, assign and close
              tickets to keep your clients happy.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {can('EDIT_SETTINGS') ? (
              <Link
                href="/support/settings"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 py-2 text-sm font-medium text-heading hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <GearSix aria-hidden weight="fill" className="size-5" />
                Support Settings
              </Link>
            ) : null}
            <Button
              onClick={() => {
                setMessage('');
                setCreating(true);
              }}
            >
              <Plus aria-hidden weight="bold" className="size-5" />
              New Support Ticket
            </Button>
          </div>
        </div>
      </header>

      <ResultLine
        message={message}
        error={resolve.error ? errorMessage(resolve.error, SUPPORT_ERRORS) : undefined}
      />

      <section
        aria-label="Ticket summary"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 min-[1440px]:grid-cols-5"
      >
        {CARDS.map((card) => (
          <SummaryCard
            key={card.key}
            card={card}
            summary={summary.data}
            loading={summary.isPending}
            failed={summary.isError}
            active={activeCard === card.key}
            onSelect={() => {
              setTab(CARD_VIEW[card.key].tab);
              setSet(CARD_VIEW[card.key].set);
              if (card.key === 'total') {
                setFilters(NO_FILTERS);
                setSearch('');
              }
              setPage(1);
            }}
          />
        ))}
      </section>
      {summary.isError ? <QuietLine>{loadError(summary.error)}</QuietLine> : null}

      <Panel label="Support tickets" testId="ticket-list" className="contain-paint">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-4 pt-2">
          <div className="min-w-0 max-w-full flex-1 max-lg:[&_[role=tablist]]:flex-wrap max-lg:[&_[role=tablist]]:gap-x-4">
            <Tabs
              label="Ticket views"
              variant="underline"
              value={tab}
              onChange={(next) => {
                setTab(next as TicketTab);
                setSet(undefined);
                setPage(1);
              }}
              items={TABS.map(({ id, label }) => ({ id, label }))}
            />
          </div>
          <div className="flex w-full items-center gap-3 pb-2 sm:w-auto">
            <SearchField
              label="Search tickets"
              placeholder="Search tickets..."
              minWidth="10rem"
              maxLength={100}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls={panelId}
              onClick={() => setFiltersOpen(!filtersOpen)}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-divider bg-surface px-4 text-sm font-semibold text-heading hover:bg-canvas"
            >
              <SlidersHorizontal aria-hidden weight="fill" className="size-5" />
              Filters
              {chips.length ? (
                <span className="rounded-pill bg-action px-2 text-xs text-on-action">
                  {chips.length}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {filtersOpen ? (
          <FiltersPanel
            id={panelId}
            value={filters}
            directory={directory.data}
            settings={settings.data}
            onApply={(next) => {
              setFilters(next);
              setPage(1);
              setFiltersOpen(false);
            }}
          />
        ) : null}

        {chips.length || set ? (
          <div
            data-testid="active-filters"
            className="flex flex-wrap items-center gap-2 border-b border-divider px-4 py-3"
          >
            {set ? (
              <FilterChip
                label={SET_LABELS[set]}
                onRemove={() => {
                  setSet(undefined);
                  setPage(1);
                }}
              />
            ) : null}
            {chips.map((chip) => (
              <FilterChip
                key={chip.id}
                label={chip.label}
                onRemove={() => {
                  setFilters({ ...filters, ...chip.clear });
                  setPage(1);
                }}
              />
            ))}
            <button
              type="button"
              onClick={resetAll}
              className="text-sm font-medium text-link underline hover:text-action-hover"
            >
              Reset filters
            </button>
          </div>
        ) : null}

        <div className="p-4">
          {tickets.isError ? (
            <QuietLine testId="tickets-error">{loadError(tickets.error)}</QuietLine>
          ) : (
            <Table
              rows={data?.items ?? []}
              loading={tickets.isPending}
              rowKey={(t) => t.id}
              caption="Support tickets"
              noun="tickets"
              pageSize={PAGE_SIZE}
              emptyTitle={narrowed ? 'No tickets match' : 'No support tickets yet'}
              emptyText={
                narrowed
                  ? 'No ticket matches this view, search or filter.'
                  : 'Tickets from firms appear here as they come in.'
              }
              emptyAction={
                narrowed ? (
                  <Button variant="secondary" onClick={resetAll}>
                    Reset filters
                  </Button>
                ) : undefined
              }
              server={{
                page: data?.page ?? page,
                total: data?.total ?? 0,
                hasNext: (data?.page ?? page) * PAGE_SIZE < (data?.total ?? 0),
                hasPrevious: (data?.page ?? page) > 1,
                onNext: () => setPage((data?.page ?? page) + 1),
                onPrevious: () => setPage(Math.max(1, (data?.page ?? page) - 1)),
                onPage: setPage,
                onSort: () => undefined,
              }}
              rowActions={(t) => (
                <RowMenu label={`Actions for ticket ${ticketNo(t.number)}`} items={rowItems(t)} />
              )}
              columns={[
                {
                  id: 'number',
                  label: '#',
                  cell: (t) => (
                    <Link
                      href={`/support/tickets/${t.id}`}
                      data-testid="ticket-link"
                      className="font-medium text-link hover:underline"
                    >
                      {ticketNo(t.number)}
                    </Link>
                  ),
                },
                {
                  id: 'subject',
                  label: 'Subject',
                  cell: (t) => <span className="text-heading">{t.subject}</span>,
                },
                {
                  id: 'firm',
                  label: 'Firm / Contact',
                  cell: (t) => (
                    <span className="flex flex-col">
                      <span className="text-heading">{t.firm.name}</span>
                      <span className="text-muted">{t.contact.name}</span>
                    </span>
                  ),
                },
                { id: 'category', label: 'Category', cell: (t) => t.category.name },
                {
                  id: 'priority',
                  label: 'Priority',
                  cell: (t) => <PriorityBadge priority={t.priority} />,
                },
                { id: 'status', label: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
                {
                  id: 'assignee',
                  label: 'Assigned To',
                  cell: (t) => (
                    <span className="whitespace-nowrap">{t.assignee?.name ?? 'Unassigned'}</span>
                  ),
                },
                { id: 'activity', label: 'Last Activity', cell: (t) => <When iso={t.updatedAt} /> },
              ]}
            />
          )}
        </div>
      </Panel>

      {creating ? (
        <NewTicketModal
          onClose={() => setCreating(false)}
          onCreated={(ticket) => {
            setCreating(false);
            setMessage(`Ticket ${ticketNo(ticket.number)} was created.`);
          }}
        />
      ) : null}
      {action ? (
        <TicketActionModal
          action={action.kind}
          ticket={action.ticket}
          onClose={() => setAction(null)}
          onDone={(text) => {
            setAction(null);
            setMessage(text);
          }}
        />
      ) : null}
    </div>
  );
}
