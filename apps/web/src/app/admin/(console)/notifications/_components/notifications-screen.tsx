'use client';

import {
  Bell,
  Buildings,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  CheckCircle,
  DotsThreeVertical,
  EnvelopeSimple,
  Info,
  Megaphone,
  Shield,
  Warning,
  WarningCircle,
  UsersThree,
  X,
  type Icon,
} from '@phosphor-icons/react';
import { Button, Drawer, EmptyState, SearchField, Select } from '@firmivra/ui';
import {
  ADMIN_NOTIFICATION_ERRORS,
  type AdminNotification,
  type AdminNotificationAction,
  type AdminNotificationStatus,
  type ListAdminNotificationsQuery,
  type PlatformNotificationAttention,
  type PlatformNotificationCategory,
  type PlatformNotificationPriority,
} from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { recordHref } from './notification-links';

type CategoryFilter = 'ALL' | PlatformNotificationCategory;
type PriorityFilter = 'ALL' | PlatformNotificationPriority;
type StatusFilter = 'ALL' | AdminNotificationStatus;
type DateFilter = 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'CUSTOM';

const categoryTabs: { id: CategoryFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'FIRMS', label: 'Firms' },
  { id: 'FIRM_APPLICATIONS', label: 'Firm Applications' },
  { id: 'SALES_LEADS', label: 'Sales / Leads' },
  { id: 'BILLING_SUBSCRIPTIONS', label: 'Billing & Subscriptions' },
  { id: 'SUPPORT', label: 'Support' },
  { id: 'INTEGRATIONS', label: 'Integrations' },
  { id: 'SECURITY', label: 'Security' },
  { id: 'SYSTEM', label: 'System' },
];

const categoryLabels: Record<PlatformNotificationCategory, string> = {
  FIRMS: 'Firms',
  FIRM_APPLICATIONS: 'Firm Applications',
  SALES_LEADS: 'Sales / Leads',
  BILLING_SUBSCRIPTIONS: 'Billing',
  SUPPORT: 'Support',
  INTEGRATIONS: 'Integrations',
  SECURITY: 'Security',
  SYSTEM: 'System',
};

const priorityLabels: Record<PlatformNotificationPriority, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  NORMAL: 'Normal',
  INFORMATIONAL: 'Informational',
};

const categoryStyle: Record<PlatformNotificationCategory, string> = {
  FIRMS: 'bg-info-soft text-info',
  FIRM_APPLICATIONS: 'bg-purple-soft text-purple',
  SALES_LEADS: 'bg-info-soft text-info',
  BILLING_SUBSCRIPTIONS: 'bg-info-soft text-info',
  SUPPORT: 'bg-accent-soft text-accent',
  INTEGRATIONS: 'bg-accent-soft text-accent',
  SECURITY: 'bg-danger-soft text-danger',
  SYSTEM: 'bg-disabled text-text',
};

const priorityStyle: Record<PlatformNotificationPriority, string> = {
  CRITICAL: 'bg-danger-soft text-danger',
  HIGH: 'bg-amber-surface text-gold',
  NORMAL: 'bg-info-soft text-info',
  INFORMATIONAL: 'bg-disabled text-text',
};

const rowIcon: Record<PlatformNotificationCategory, Icon> = {
  FIRMS: UsersThree,
  FIRM_APPLICATIONS: Warning,
  SALES_LEADS: Buildings,
  BILLING_SUBSCRIPTIONS: WarningCircle,
  SUPPORT: Info,
  INTEGRATIONS: Info,
  SECURITY: Shield,
  SYSTEM: Megaphone,
};

const iconStyle: Record<PlatformNotificationCategory, string> = {
  FIRMS: 'bg-disabled text-heading',
  FIRM_APPLICATIONS: 'bg-amber-surface text-gold',
  SALES_LEADS: 'bg-info-soft text-info',
  BILLING_SUBSCRIPTIONS: 'bg-danger-soft text-danger',
  SUPPORT: 'bg-info-soft text-info',
  INTEGRATIONS: 'bg-info-soft text-info',
  SECURITY: 'bg-subtle text-heading',
  SYSTEM: 'bg-purple-soft text-purple',
};

const pageSize = 7;
const DAY_MS = 86_400_000;
const NOTIFICATIONS = ['admin-notifications'] as const;

/** What a notification's source record is, as the Related To column names it. */
const sourceTypeLabels: Record<string, string> = {
  business: 'Firm Account',
  firm: 'Firm Account',
  firm_application: 'Firm Application',
  user: 'User Account',
  lead: 'Sales Lead',
  support_ticket: 'Support Ticket',
  invoice: 'Invoice',
  subscription: 'Subscription',
  platform_integration: 'Integration',
  system: 'Platform Update',
};
const isRead = (item: AdminNotification) => item.readAt !== null;
const relatedName = (item: AdminNotification) =>
  item.source.label ?? item.business?.name ?? 'Firmivra';
const relatedType = (item: AdminNotification) =>
  sourceTypeLabels[item.source.type] ??
  item.source.type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const actionLabel = (item: AdminNotification) =>
  item.attention === 'ACTION_REQUIRED' ? 'Review' : 'View Details';

/** The list's date range: from the start of a day (local time); a custom end is inclusive. */
function rangeOf(filter: DateFilter, customFrom: string, customTo: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAgo = (days: number) => new Date(today.getTime() - days * DAY_MS).toISOString();
  if (filter === 'TODAY') return { from: today.toISOString() };
  if (filter === 'LAST_7_DAYS') return { from: daysAgo(7) };
  if (filter === 'LAST_30_DAYS') return { from: daysAgo(30) };
  const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
  const to = customTo ? new Date(new Date(`${customTo}T00:00:00`).getTime() + DAY_MS) : null;
  return {
    ...(from ? { from: from.toISOString() } : {}),
    ...(to && (!from || from < to) ? { to: to.toISOString() } : {}),
  };
}

export function NotificationsScreen() {
  const client = useQueryClient();
  const router = useRouter();
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [search, setSearch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('LAST_30_DAYS');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminNotification | null>(null);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // The search box asks the API once typing pauses.
  useEffect(() => {
    const timeout = window.setTimeout(() => setSearchText(search.trim()), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const filters: ListAdminNotificationsQuery = useMemo(
    () => ({
      ...(category !== 'ALL' ? { category } : {}),
      ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
      ...(priorityFilter !== 'ALL' ? { priority: priorityFilter } : {}),
      ...(searchText ? { search: searchText } : {}),
      ...rangeOf(dateFilter, customFrom, customTo),
    }),
    [category, statusFilter, priorityFilter, searchText, dateFilter, customFrom, customTo],
  );
  const list = useApiQuery([...NOTIFICATIONS, 'list', filters, page], () =>
    api.adminNotifications.list({ ...filters, page, pageSize }),
  );
  const summary = useApiQuery([...NOTIFICATIONS, 'summary'], () =>
    api.adminNotifications.summary(),
  );

  const visible = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const loading = list.isPending;
  const loadError = list.isError;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const counts = summary.data;
  const hasActionRequired = visible.some(
    (item) => selected.includes(item.id) && item.attention === 'ACTION_REQUIRED',
  );
  const filtered =
    dateFilter !== 'LAST_30_DAYS' ||
    category !== 'ALL' ||
    statusFilter !== 'ALL' ||
    priorityFilter !== 'ALL' ||
    searchText !== '';

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  /** Runs a change, then refetches the list, the cards and the bell. */
  async function change(work: () => Promise<string>) {
    setBusy(true);
    try {
      setToast({ message: await work() });
      setSelected([]);
    } catch (error) {
      setToast({ message: errorMessage(error, ADMIN_NOTIFICATION_ERRORS), error: true });
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: NOTIFICATIONS });
    }
  }

  /** One item through its own route; several through the bulk route, which skips the rest. */
  function act(ids: string[], action: AdminNotificationAction, done: [string, string]) {
    void change(async () => {
      const [one, many] = done;
      const [first] = ids;
      if (ids.length === 1 && first) {
        const call = {
          READ: api.adminNotifications.read,
          UNREAD: api.adminNotifications.unread,
          RESOLVE: api.adminNotifications.resolve,
          DISMISS: api.adminNotifications.dismiss,
        }[action];
        await call(first);
        return one;
      }
      const result = await api.adminNotifications.bulk({ ids, action });
      return result.skipped.length
        ? `${result.updated} updated; ${result.skipped.length} did not apply.`
        : many;
    });
  }

  function markRead(ids: string[]) {
    act(ids, 'READ', ['Notification marked as read.', 'Notifications marked as read.']);
  }

  function markUnread(ids: string[]) {
    act(ids, 'UNREAD', ['Notification marked as unread.', 'Notifications marked as unread.']);
  }

  function setAttention(ids: string[], attention: PlatformNotificationAttention, message: string) {
    act(ids, attention === 'RESOLVED' ? 'RESOLVE' : 'DISMISS', [message, message]);
  }

  /** Opening marks it read, then goes to the record behind it, or shows the details panel. */
  function openItem(item: AdminNotification) {
    if (!isRead(item))
      void api.adminNotifications
        .read(item.id)
        .then(() => client.invalidateQueries({ queryKey: NOTIFICATIONS }))
        .catch(() => undefined);
    const href = recordHref(item);
    if (href) router.push(href);
    else setDetail(item);
  }

  function markAllFilteredRead() {
    void change(async () => {
      const { updated } = await api.adminNotifications.markAllRead(filters);
      return updated
        ? `${updated} ${updated === 1 ? 'notification' : 'notifications'} marked as read.`
        : 'All notifications in this view are already read.';
    });
  }

  function setSummaryFilter(filter: 'ALL' | 'UNREAD' | 'ACTION_REQUIRED' | 'CRITICAL') {
    setPage(1);
    if (filter === 'ALL') {
      setStatusFilter('ALL');
      setPriorityFilter('ALL');
    } else if (filter === 'UNREAD') {
      setStatusFilter('UNREAD');
    } else if (filter === 'ACTION_REQUIRED') {
      setStatusFilter('ACTION_REQUIRED');
    } else {
      setPriorityFilter('CRITICAL');
    }
  }

  function clearFilters() {
    setPage(1);
    setCategory('ALL');
    setSearch('');
    setSearchText('');
    setDateFilter('LAST_30_DAYS');
    setStatusFilter('ALL');
    setPriorityFilter('ALL');
    setCustomFrom('');
    setCustomTo('');
    setSelected([]);
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((item) => selected.includes(item.id));
  const pageNumbers = Array.from(
    { length: Math.min(5, pageCount) },
    (_, index) => Math.min(Math.max(1, currentPage - 4), Math.max(1, pageCount - 4)) + index,
  );
  const emptyTitle = loadError
    ? 'Notifications are unavailable'
    : loading
      ? 'Loading notifications'
      : filtered
        ? 'No notifications match your filters'
        : 'No notifications yet';
  const emptyDescription = loadError
    ? 'We could not reach notifications. Try again in a moment.'
    : loading
      ? 'Fetching the latest platform activity.'
      : filtered
        ? 'Try changing or clearing the filters above.'
        : 'New platform activity will appear here.';
  const emptyAction = loadError ? (
    <Button
      variant="secondary"
      onClick={() => void client.invalidateQueries({ queryKey: NOTIFICATIONS })}
    >
      Try Again
    </Button>
  ) : filtered && !loading ? (
    <Button variant="secondary" onClick={clearFilters}>
      Clear Filters
    </Button>
  ) : undefined;
  const cardValue = (value: number | undefined) =>
    summary.isPending || summary.isError || value === undefined ? '—' : value;

  return (
    <main className="flex min-w-0 flex-col gap-5 pb-2">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1
            data-testid="page-title"
            className="text-2xl font-bold leading-tight text-heading sm:text-3xl"
          >
            Notifications
          </h1>
          <p className="mt-1 max-w-4xl text-sm text-muted sm:text-base">
            View and manage important system alerts, firm activity, billing notices, security
            events, and platform updates.
          </p>
        </div>
        <Button
          onClick={markAllFilteredRead}
          disabled={busy || loading || loadError || total === 0}
          className="min-h-10 shrink-0 self-start px-4"
        >
          <Check aria-hidden weight="bold" className="size-4" />
          Mark All as Read
        </Button>
      </header>

      <section
        aria-label="Notification summary"
        className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
      >
        <SummaryCard
          icon={Bell}
          tone="blue"
          value={cardValue(counts?.total)}
          label="All Notifications"
          onClick={() => setSummaryFilter('ALL')}
        />
        <SummaryCard
          icon={EnvelopeSimple}
          tone="green"
          value={cardValue(counts?.unread)}
          label="Unread"
          onClick={() => setSummaryFilter('UNREAD')}
        />
        <SummaryCard
          icon={Warning}
          tone="amber"
          value={cardValue(counts?.actionRequired)}
          label="Action Required"
          onClick={() => setSummaryFilter('ACTION_REQUIRED')}
        />
        <SummaryCard
          icon={Warning}
          tone="red"
          value={cardValue(counts?.critical)}
          label="Critical Alerts"
          onClick={() => setSummaryFilter('CRITICAL')}
        />
      </section>

      <nav aria-label="Notification categories" className="-mx-1 overflow-x-auto px-1 pb-1">
        <div id="notification-category-tabs" role="tablist" className="flex min-w-max gap-2">
          {categoryTabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`notification-tab-${tab.id.toLowerCase().replaceAll('_', '-')}`}
              aria-controls="notification-results"
              aria-selected={category === tab.id}
              tabIndex={category === tab.id ? 0 : -1}
              onClick={() => {
                setPage(1);
                setCategory(tab.id);
              }}
              onKeyDown={(event) => {
                const nextIndex =
                  event.key === 'ArrowRight'
                    ? (index + 1) % categoryTabs.length
                    : event.key === 'ArrowLeft'
                      ? (index - 1 + categoryTabs.length) % categoryTabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? categoryTabs.length - 1
                          : undefined;
                if (nextIndex === undefined) return;
                event.preventDefault();
                const next = categoryTabs[nextIndex];
                if (!next) return;
                setPage(1);
                setCategory(next.id);
                document
                  .getElementById(`notification-tab-${next.id.toLowerCase().replaceAll('_', '-')}`)
                  ?.focus();
              }}
              className={`min-h-10 shrink-0 rounded-control border px-4 text-sm font-medium transition-colors ${
                category === tab.id
                  ? 'border-action bg-action text-on-action'
                  : 'border-divider bg-surface text-text hover:bg-canvas'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <section
        aria-label="Search and filters"
        className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6"
      >
        <SearchField
          label="Search notifications, firms, users"
          placeholder="Search notifications, firms, users..."
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          className="min-w-0 xl:col-span-2"
        />
        <div className="relative min-w-0">
          <CalendarBlank
            aria-hidden
            weight="bold"
            className="pointer-events-none absolute top-3 left-3 z-10 size-4 text-muted"
          />
          <Select
            label="Date range"
            hideLabel
            value={dateFilter}
            onChange={(event) => {
              setPage(1);
              setDateFilter(event.target.value as DateFilter);
            }}
            options={[
              { value: 'TODAY', label: 'Today' },
              { value: 'LAST_7_DAYS', label: 'Last 7 Days' },
              { value: 'LAST_30_DAYS', label: 'Last 30 Days' },
              { value: 'CUSTOM', label: 'Custom Range' },
            ]}
            className="h-10 min-h-0 pl-9 text-sm"
          />
        </div>
        <Select
          label="Notification status"
          hideLabel
          value={statusFilter}
          onChange={(event) => {
            setPage(1);
            setStatusFilter(event.target.value as StatusFilter);
          }}
          options={[
            { value: 'ALL', label: 'All Status' },
            { value: 'UNREAD', label: 'Unread' },
            { value: 'READ', label: 'Read' },
            { value: 'ACTION_REQUIRED', label: 'Action Required' },
            { value: 'RESOLVED', label: 'Resolved' },
            { value: 'DISMISSED', label: 'Dismissed' },
          ]}
          className="h-10 min-h-0 text-sm"
        />
        <Select
          label="Notification priority"
          hideLabel
          value={priorityFilter}
          onChange={(event) => {
            setPage(1);
            setPriorityFilter(event.target.value as PriorityFilter);
          }}
          options={[
            { value: 'ALL', label: 'All Priority' },
            { value: 'CRITICAL', label: 'Critical' },
            { value: 'HIGH', label: 'High' },
            { value: 'NORMAL', label: 'Normal' },
            { value: 'INFORMATIONAL', label: 'Informational' },
          ]}
          className="h-10 min-h-0 text-sm"
        />
        <div className="flex justify-end sm:col-span-2 xl:col-span-1">
          <DropdownMenu
            label="Bulk Actions"
            trigger={<span>Bulk Actions</span>}
            disabled={busy || selected.length === 0}
            items={[
              {
                label: 'Mark as Read',
                disabled: selected.length === 0,
                onSelect: () => markRead(selected),
              },
              {
                label: 'Mark as Unread',
                disabled: selected.length === 0,
                onSelect: () => markUnread(selected),
              },
              {
                label: 'Resolve',
                disabled: !hasActionRequired,
                onSelect: () =>
                  setAttention(selected, 'RESOLVED', 'Selected notifications resolved.'),
              },
              {
                label: 'Dismiss',
                disabled: selected.length === 0,
                onSelect: () =>
                  setAttention(selected, 'DISMISSED', 'Selected notifications dismissed.'),
              },
            ]}
          />
        </div>
        {dateFilter === 'CUSTOM' ? (
          <div className="grid grid-cols-2 gap-3 sm:col-span-2 xl:col-span-2">
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
              From
              <input
                aria-label="From date"
                type="date"
                value={customFrom}
                onChange={(event) => {
                  setPage(1);
                  setCustomFrom(event.target.value);
                }}
                className="h-10 min-h-0 min-w-0 rounded-control border border-divider bg-surface px-3 text-sm text-text"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-muted">
              To
              <input
                aria-label="To date"
                type="date"
                value={customTo}
                onChange={(event) => {
                  setPage(1);
                  setCustomTo(event.target.value);
                }}
                className="h-10 min-h-0 min-w-0 rounded-control border border-divider bg-surface px-3 text-sm text-text"
              />
            </label>
          </div>
        ) : null}
      </section>

      <div
        id="notification-results"
        role="tabpanel"
        aria-label="Filtered notification results"
        className="overflow-hidden rounded-card border border-divider bg-surface"
      >
        <div className="hidden overflow-x-auto xl:block">
          <table className="w-full border-collapse text-left text-sm text-text">
            <caption className="sr-only">Platform notifications</caption>
            <colgroup>
              <col className="w-12" />
              <col className="w-72 2xl:w-80" />
              <col className="w-36 2xl:w-40" />
              <col className="w-32" />
              <col className="w-32" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-40 2xl:w-44" />
            </colgroup>
            <thead className="border-b border-divider bg-subtle text-muted">
              <tr className="h-10">
                <th scope="col" className="px-4">
                  <input
                    type="checkbox"
                    aria-label="Select all notifications on this page"
                    checked={allVisibleSelected}
                    ref={(input) => {
                      if (input)
                        input.indeterminate =
                          !allVisibleSelected && visible.some((item) => selected.includes(item.id));
                    }}
                    onChange={(event) =>
                      togglePageSelection(visible, selected, setSelected, event.target.checked)
                    }
                    className="size-4 rounded-sm"
                  />
                </th>
                <th scope="col" className="px-3 font-semibold">
                  Notification
                </th>
                <th scope="col" className="px-3 font-semibold">
                  Related To
                </th>
                <th scope="col" className="px-3 font-semibold">
                  Category
                </th>
                <th scope="col" className="px-3 font-semibold">
                  Date &amp; Time
                </th>
                <th scope="col" className="px-3 font-semibold">
                  Priority
                </th>
                <th scope="col" className="px-3 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-3 text-right font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr
                  key={item.id}
                  className={`border-b border-divider last:border-b-0 hover:bg-canvas ${
                    !isRead(item) && item.priority === 'CRITICAL' ? 'bg-danger-soft/50' : ''
                  }`}
                >
                  <td className="px-4 py-1.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.title}`}
                      checked={selected.includes(item.id)}
                      onChange={(event) =>
                        toggleOneSelection(item.id, selected, setSelected, event.target.checked)
                      }
                      className="size-4 rounded-sm"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <NotificationDescription item={item} onOpen={() => openItem(item)} />
                  </td>
                  <td className="px-3 py-1.5">
                    <p className="truncate font-medium text-heading">{relatedName(item)}</p>
                    <p className="mt-0.5 truncate text-sm text-muted">{relatedType(item)}</p>
                  </td>
                  <td className="px-3 py-1.5">
                    <CategoryBadge category={item.category} />
                  </td>
                  <td className="px-3 py-1.5">
                    <p className="whitespace-nowrap text-heading">{formatDate(item.occurredAt)}</p>
                    <p className="mt-0.5 whitespace-nowrap text-sm text-muted">
                      {formatTime(item.occurredAt)}
                    </p>
                  </td>
                  <td className="px-3 py-1.5">
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td className="px-3 py-1.5">
                    <StatusBadge item={item} />
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => openItem(item)}
                        className={`min-h-9 whitespace-nowrap px-3 text-sm font-medium ${
                          isRead(item) ? 'border-divider text-heading' : 'border-action text-action'
                        }`}
                      >
                        {actionLabel(item)}
                      </Button>
                      <NotificationRowMenu
                        item={item}
                        onRead={() => markRead([item.id])}
                        onUnread={() => markUnread([item.id])}
                        onResolve={() =>
                          setAttention([item.id], 'RESOLVED', 'Notification resolved.')
                        }
                        onDismiss={() =>
                          setAttention([item.id], 'DISMISSED', 'Notification dismissed.')
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {!visible.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10">
                    <EmptyState
                      title={emptyTitle}
                      description={emptyDescription}
                      action={emptyAction}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-3 md:grid-cols-2 xl:hidden">
          <label className="flex min-h-9 items-center gap-2 px-1 text-sm text-muted md:col-span-2">
            <input
              type="checkbox"
              aria-label="Select all notifications on this page"
              checked={allVisibleSelected}
              ref={(input) => {
                if (input)
                  input.indeterminate =
                    !allVisibleSelected && visible.some((item) => selected.includes(item.id));
              }}
              onChange={(event) =>
                togglePageSelection(visible, selected, setSelected, event.target.checked)
              }
              className="size-4 rounded-sm"
            />
            Select all visible notifications
          </label>
          {visible.map((item) => (
            <article
              key={item.id}
              className={`min-w-0 rounded-card border border-divider p-4 ${!isRead(item) && item.priority === 'CRITICAL' ? 'bg-danger-soft/50' : 'bg-surface'}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${item.title}`}
                  checked={selected.includes(item.id)}
                  onChange={(event) =>
                    toggleOneSelection(item.id, selected, setSelected, event.target.checked)
                  }
                  className="mt-1 size-4 shrink-0 rounded-sm"
                />
                <NotificationIcon item={item} />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => openItem(item)}
                    className="block text-left text-sm font-semibold text-heading hover:text-action"
                  >
                    {item.title}
                  </button>
                  <p className="mt-1 text-sm leading-5 text-muted">{item.body}</p>
                </div>
                <NotificationRowMenu
                  item={item}
                  onRead={() => markRead([item.id])}
                  onUnread={() => markUnread([item.id])}
                  onResolve={() => setAttention([item.id], 'RESOLVED', 'Notification resolved.')}
                  onDismiss={() => setAttention([item.id], 'DISMISSED', 'Notification dismissed.')}
                />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-divider pt-3 text-sm">
                <div className="min-w-0">
                  <dt className="text-xs text-muted">Related To</dt>
                  <dd className="mt-0.5 truncate font-medium text-heading">{relatedName(item)}</dd>
                  <dd className="truncate text-xs text-muted">{relatedType(item)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Date &amp; Time</dt>
                  <dd className="mt-0.5 font-medium text-heading">{formatDate(item.occurredAt)}</dd>
                  <dd className="text-xs text-muted">{formatTime(item.occurredAt)}</dd>
                </div>
                <div>
                  <dt className="mb-1 text-xs text-muted">Category</dt>
                  <dd>
                    <CategoryBadge category={item.category} />
                  </dd>
                </div>
                <div>
                  <dt className="mb-1 text-xs text-muted">Priority &amp; Status</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    <PriorityBadge priority={item.priority} />
                    <StatusBadge item={item} />
                  </dd>
                </div>
              </dl>
              <Button
                variant="outline"
                onClick={() => openItem(item)}
                className="mt-4 min-h-9 w-full border-divider text-action"
              >
                {actionLabel(item)}
              </Button>
            </article>
          ))}
          {!visible.length ? (
            <div className="md:col-span-2">
              <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex flex-col gap-3 text-sm text-muted sm:flex-row sm:items-center">
        <p aria-live="polite">
          Showing {total ? (currentPage - 1) * pageSize + 1 : 0}–
          {Math.min(currentPage * pageSize, total)} of {total} notifications
        </p>
        <nav
          aria-label="Notification pages"
          className="flex flex-wrap items-center justify-end gap-1.5 sm:ml-auto"
        >
          <PageButton
            label="Previous page"
            disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}
          >
            <CaretLeft aria-hidden weight="bold" className="size-4" />
          </PageButton>
          {pageNumbers.map((number) => (
            <PageButton
              key={number}
              label={`Page ${number}`}
              current={number === currentPage}
              onClick={() => setPage(number)}
            >
              {number}
            </PageButton>
          ))}
          <PageButton
            label="Next page"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
          >
            <CaretRight aria-hidden weight="bold" className="size-4" />
          </PageButton>
        </nav>
      </footer>

      {toast ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-40 flex max-w-sm items-center gap-3 rounded-card border border-divider bg-surface px-4 py-3 text-sm text-heading shadow-lg"
        >
          {toast.error ? (
            <WarningCircle aria-hidden weight="fill" className="size-5 shrink-0 text-danger" />
          ) : (
            <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-success" />
          )}
          <span>{toast.message}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setToast(null)}
            className="ml-auto text-muted hover:text-heading"
          >
            <X aria-hidden weight="bold" className="size-4" />
          </button>
        </div>
      ) : null}

      <Drawer
        open={detail !== null}
        title={detail?.title ?? 'Notification details'}
        subtitle={
          detail
            ? `${categoryLabels[detail.category]} · ${formatDate(detail.occurredAt)} at ${formatTime(detail.occurredAt)}`
            : undefined
        }
        onClose={() => setDetail(null)}
        footer={
          detail ? (
            <Button variant="secondary" onClick={() => setDetail(null)}>
              Close
            </Button>
          ) : undefined
        }
      >
        {detail ? (
          <div className="flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <NotificationIcon item={detail} />
              <div>
                <p className="text-sm leading-6 text-text">{detail.body}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <PriorityBadge priority={detail.priority} />
                  <StatusBadge item={detail} />
                </div>
              </div>
            </div>
            <dl className="grid gap-3 rounded-card border border-divider bg-canvas p-4 text-sm">
              <div>
                <dt className="text-xs text-muted">Related to</dt>
                <dd className="mt-1 font-medium text-heading">{relatedName(detail)}</dd>
                <dd className="text-muted">{relatedType(detail)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Category</dt>
                <dd className="mt-1">
                  <CategoryBadge category={detail.category} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Date &amp; time</dt>
                <dd className="mt-1 font-medium text-heading">
                  {formatDate(detail.occurredAt)} · {formatTime(detail.occurredAt)}
                </dd>
              </div>
            </dl>
            {detail.attention === 'ACTION_REQUIRED' ? (
              <Button
                onClick={() => {
                  setAttention([detail.id], 'RESOLVED', 'Notification resolved.');
                  setDetail(null);
                }}
              >
                <Check aria-hidden weight="bold" className="size-4" />
                Resolve notification
              </Button>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </main>
  );
}

function SummaryCard({
  icon: Glyph,
  tone,
  value,
  label,
  onClick,
}: {
  icon: Icon;
  tone: 'blue' | 'green' | 'amber' | 'red';
  value: number | string;
  label: string;
  onClick: () => void;
}) {
  const toneClass = {
    blue: 'bg-info-soft text-info',
    green: 'bg-success-soft text-success',
    amber: 'bg-amber-surface text-gold',
    red: 'bg-danger-soft text-danger',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 items-center gap-2 rounded-card border border-divider px-3 py-3 text-left transition-colors hover:opacity-90 sm:gap-4 sm:px-4 ${toneClass}`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface/60 sm:size-12 xl:size-14">
        <Glyph aria-hidden weight="fill" className="size-6 sm:size-7" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold leading-none text-heading sm:text-2xl xl:text-3xl">
          {value}
        </span>
        <span className="mt-1 block truncate text-xs text-text sm:text-sm xl:text-base">
          {label}
        </span>
      </span>
    </button>
  );
}

function NotificationDescription({
  item,
  onOpen,
}: {
  item: AdminNotification;
  onOpen: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <NotificationIcon item={item} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className={`block max-w-full truncate text-left text-sm text-heading hover:text-action ${isRead(item) ? 'font-medium' : 'font-semibold'}`}
        >
          {item.title}
        </button>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">{item.body}</p>
      </div>
    </div>
  );
}

const SUCCESS_EVENT = /(renewed|paid|succeeded|activated|approved|completed|restored)/;
const FAILURE_EVENT = /(failed|error|declined|overdue|expired)/;

function NotificationIcon({ item }: { item: AdminNotification }) {
  const success = SUCCESS_EVENT.test(item.type);
  const failure = !success && FAILURE_EVENT.test(item.type) && item.category !== 'SECURITY';
  // Status events are a solid circle glyph (the design); the rest a glyph on a soft circle.
  const solid: { glyph: Icon; tone: string } | null = success
    ? { glyph: CheckCircle, tone: 'text-success' }
    : failure
      ? { glyph: WarningCircle, tone: 'text-danger' }
      : item.category === 'FIRM_APPLICATIONS'
        ? { glyph: WarningCircle, tone: 'text-gold' }
        : item.category === 'INTEGRATIONS' || item.category === 'SUPPORT'
          ? { glyph: Info, tone: 'text-info' }
          : null;
  if (solid) {
    const Solid = solid.glyph;
    return (
      <span className={`flex size-9 shrink-0 items-center justify-center ${solid.tone}`}>
        <Solid aria-hidden weight="fill" className="size-9" />
      </span>
    );
  }
  const Glyph = rowIcon[item.category];
  return (
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconStyle[item.category]}`}
    >
      <Glyph aria-hidden weight="fill" className="size-5" />
    </span>
  );
}

function CategoryBadge({ category }: { category: PlatformNotificationCategory }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-control px-2.5 py-1 text-xs font-medium ${categoryStyle[category]}`}
    >
      {categoryLabels[category]}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: PlatformNotificationPriority }) {
  return (
    <span
      className={`inline-flex min-w-16 justify-center rounded-control px-2.5 py-1 text-xs font-semibold ${priorityStyle[priority]}`}
    >
      {priorityLabels[priority]}
    </span>
  );
}

function StatusBadge({ item }: { item: AdminNotification }) {
  const resolved = item.attention === 'RESOLVED';
  const dismissed = item.attention === 'DISMISSED';
  const label = resolved ? 'Resolved' : dismissed ? 'Dismissed' : isRead(item) ? 'Read' : 'Unread';
  const tone =
    resolved || isRead(item)
      ? 'bg-success-soft text-success'
      : dismissed
        ? 'bg-disabled text-muted'
        : 'bg-danger-soft text-danger';
  return (
    <span
      className={`inline-flex min-w-16 justify-center rounded-control px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

function DropdownMenu({
  label,
  trigger,
  items,
  compact = false,
  disabled = false,
}: {
  label: string;
  trigger: ReactNode;
  items: { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }[];
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) =>
      root && !root.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, root]);

  return (
    <div ref={setRoot} className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={
          compact
            ? 'inline-flex size-9 items-center justify-center rounded-control border border-divider bg-surface text-heading hover:bg-canvas'
            : 'inline-flex min-h-10 items-center gap-2 rounded-control border border-divider bg-surface px-3 text-sm font-medium text-heading hover:bg-canvas disabled:cursor-not-allowed'
        }
      >
        {trigger}
        {!compact ? <CaretDown aria-hidden weight="bold" className="size-3.5" /> : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1 w-48 rounded-xl border border-divider bg-surface p-1.5 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                setOpen(false);
              }}
              className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50 ${item.danger ? 'text-danger' : 'text-text'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NotificationRowMenu({
  item,
  onRead,
  onUnread,
  onResolve,
  onDismiss,
}: {
  item: AdminNotification;
  onRead: () => void;
  onUnread: () => void;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const items = [
    {
      label: isRead(item) ? 'Mark as Unread' : 'Mark as Read',
      onSelect: isRead(item) ? onUnread : onRead,
    },
    ...(item.attention === 'ACTION_REQUIRED' ? [{ label: 'Resolve', onSelect: onResolve }] : []),
    { label: 'Dismiss', onSelect: onDismiss, danger: true },
  ];
  return (
    <DropdownMenu
      label={`More actions for ${item.title}`}
      trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
      items={items}
      compact
    />
  );
}

function PageButton({
  label,
  current,
  disabled,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-9 items-center justify-center rounded-control border text-sm ${current ? 'border-action bg-action font-semibold text-on-action' : 'border-divider bg-surface text-text hover:bg-canvas'} disabled:cursor-not-allowed disabled:text-muted`}
    >
      {children}
    </button>
  );
}

function toggleOneSelection(
  id: string,
  selected: string[],
  setSelected: (ids: string[]) => void,
  checked: boolean,
) {
  setSelected(checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id));
}

function togglePageSelection(
  rows: AdminNotification[],
  selected: string[],
  setSelected: (ids: string[]) => void,
  checked: boolean,
) {
  const pageIds = rows.map((item) => item.id);
  setSelected(
    checked
      ? [...new Set([...selected, ...pageIds])]
      : selected.filter((id) => !pageIds.includes(id)),
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  }).format(new Date(value));
}
