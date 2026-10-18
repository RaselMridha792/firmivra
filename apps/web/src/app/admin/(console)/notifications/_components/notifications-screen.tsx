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
import type {
  PlatformNotificationAttention,
  PlatformNotificationCategory,
  PlatformNotificationPriority,
} from '@firmivra/types';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  listAdminNotifications,
  type AdminNotificationFixture,
} from '../../../../../mocks/admin-notifications';

type CategoryFilter = 'ALL' | PlatformNotificationCategory;
type PriorityFilter = 'ALL' | PlatformNotificationPriority;
type StatusFilter = 'ALL' | 'UNREAD' | 'READ' | PlatformNotificationAttention;
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

export function NotificationsScreen() {
  const [notifications, setNotifications] = useState<AdminNotificationFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [category, setCategory] = useState<CategoryFilter>('ALL');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('LAST_30_DAYS');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AdminNotificationFixture | null>(null);
  const [toast, setToast] = useState('');

  const filtered = useMemo(
    () =>
      notifications.filter((item) => {
        const text =
          `${item.title} ${item.description} ${item.relatedName} ${item.relatedType}`.toLowerCase();
        if (category !== 'ALL' && item.category !== category) return false;
        if (search.trim() && !text.includes(search.trim().toLowerCase())) return false;
        if (priorityFilter !== 'ALL' && item.priority !== priorityFilter) return false;
        if (statusFilter === 'UNREAD' && item.isRead) return false;
        if (statusFilter === 'READ' && !item.isRead) return false;
        if (
          statusFilter !== 'ALL' &&
          statusFilter !== 'UNREAD' &&
          statusFilter !== 'READ' &&
          item.attention !== statusFilter
        ) {
          return false;
        }
        const date = new Date(item.occurredAt);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const cutoff = new Date(today);
        if (dateFilter === 'TODAY' && date < today) return false;
        if (dateFilter === 'LAST_7_DAYS') {
          cutoff.setDate(cutoff.getDate() - 7);
          if (date < cutoff) return false;
        }
        if (dateFilter === 'LAST_30_DAYS') {
          cutoff.setDate(cutoff.getDate() - 30);
          if (date < cutoff) return false;
        }
        if (dateFilter === 'CUSTOM') {
          if (customFrom && date < new Date(`${customFrom}T00:00:00`)) return false;
          if (customTo && date > new Date(`${customTo}T23:59:59`)) return false;
        }
        return true;
      }),
    [
      category,
      customFrom,
      customTo,
      dateFilter,
      notifications,
      priorityFilter,
      search,
      statusFilter,
    ],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const unreadCount = notifications.filter((item) => !item.isRead).length;
  const actionCount = notifications.filter((item) => item.attention === 'ACTION_REQUIRED').length;
  const criticalCount = notifications.filter(
    (item) =>
      item.priority === 'CRITICAL' &&
      item.attention !== 'RESOLVED' &&
      item.attention !== 'DISMISSED',
  ).length;
  const selectedItems = notifications.filter((item) => selected.includes(item.id));
  const hasActionRequired = selectedItems.some((item) => item.attention === 'ACTION_REQUIRED');

  useEffect(() => {
    let active = true;
    void listAdminNotifications()
      .then((items) => {
        if (!active) return;
        setNotifications(items);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setNotifications([]);
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadCount]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function applyTo(
    ids: string[],
    change: (item: AdminNotificationFixture) => AdminNotificationFixture,
  ) {
    const idSet = new Set(ids);
    setNotifications((items) => items.map((item) => (idSet.has(item.id) ? change(item) : item)));
    setSelected((items) => items.filter((id) => !idSet.has(id)));
  }

  function markRead(ids: string[]) {
    applyTo(ids, (item) => ({ ...item, isRead: true }));
    setToast(ids.length === 1 ? 'Notification marked as read.' : 'Notifications marked as read.');
  }

  function markUnread(ids: string[]) {
    applyTo(ids, (item) => ({ ...item, isRead: false }));
    setToast(
      ids.length === 1 ? 'Notification marked as unread.' : 'Notifications marked as unread.',
    );
  }

  function setAttention(ids: string[], attention: PlatformNotificationAttention, message: string) {
    applyTo(ids, (item) => ({ ...item, attention }));
    setToast(message);
  }

  function openDetails(item: AdminNotificationFixture) {
    setDetail(item);
    if (!item.isRead) {
      setNotifications((items) =>
        items.map((current) => (current.id === item.id ? { ...current, isRead: true } : current)),
      );
    }
  }

  function markAllFilteredRead() {
    const ids = filtered.filter((item) => !item.isRead).map((item) => item.id);
    if (ids.length) markRead(ids);
    else setToast('All notifications in this view are already read.');
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
      : notifications.length
        ? 'No notifications match your filters'
        : 'No notifications yet';
  const emptyDescription = loadError
    ? 'We could not reach notifications. Try again in a moment.'
    : loading
      ? 'Fetching the latest platform activity.'
      : notifications.length
        ? 'Try changing or clearing the filters above.'
        : 'New platform activity will appear here.';
  const emptyAction = loadError ? (
    <Button
      variant="secondary"
      onClick={() => {
        setLoading(true);
        setLoadError(false);
        setReloadCount((count) => count + 1);
      }}
    >
      Try Again
    </Button>
  ) : notifications.length && !loading ? (
    <Button variant="secondary" onClick={clearFilters}>
      Clear Filters
    </Button>
  ) : undefined;

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
          disabled={loading || loadError || notifications.length === 0}
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
          value={loading || loadError ? '—' : notifications.length}
          label="All Notifications"
          onClick={() => setSummaryFilter('ALL')}
        />
        <SummaryCard
          icon={EnvelopeSimple}
          tone="green"
          value={loading || loadError ? '—' : unreadCount}
          label="Unread"
          onClick={() => setSummaryFilter('UNREAD')}
        />
        <SummaryCard
          icon={Warning}
          tone="amber"
          value={loading || loadError ? '—' : actionCount}
          label="Action Required"
          onClick={() => setSummaryFilter('ACTION_REQUIRED')}
        />
        <SummaryCard
          icon={Warning}
          tone="red"
          value={loading || loadError ? '—' : criticalCount}
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
            disabled={selected.length === 0}
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
                    !item.isRead && item.priority === 'CRITICAL' ? 'bg-danger-soft/50' : ''
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
                    <NotificationDescription item={item} onOpen={() => openDetails(item)} />
                  </td>
                  <td className="px-3 py-1.5">
                    <p className="truncate font-medium text-heading">{item.relatedName}</p>
                    <p className="mt-0.5 truncate text-sm text-muted">{item.relatedType}</p>
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
                        onClick={() => openDetails(item)}
                        className="min-h-9 whitespace-nowrap border-divider px-3 text-sm font-medium text-action"
                      >
                        {item.actionLabel}
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
              className={`min-w-0 rounded-card border border-divider p-4 ${!item.isRead && item.priority === 'CRITICAL' ? 'bg-danger-soft/50' : 'bg-surface'}`}
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
                    onClick={() => openDetails(item)}
                    className="block text-left text-sm font-semibold text-heading hover:text-action"
                  >
                    {item.title}
                  </button>
                  <p className="mt-1 text-sm leading-5 text-muted">{item.description}</p>
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
                  <dd className="mt-0.5 truncate font-medium text-heading">{item.relatedName}</dd>
                  <dd className="truncate text-xs text-muted">{item.relatedType}</dd>
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
                onClick={() => openDetails(item)}
                className="mt-4 min-h-9 w-full border-divider text-action"
              >
                {item.actionLabel}
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
          Showing {filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–
          {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} notifications
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
          <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-success" />
          <span>{toast}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setToast('')}
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
                <p className="text-sm leading-6 text-text">{detail.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <PriorityBadge priority={detail.priority} />
                  <StatusBadge item={detail} />
                </div>
              </div>
            </div>
            <dl className="grid gap-3 rounded-card border border-divider bg-canvas p-4 text-sm">
              <div>
                <dt className="text-xs text-muted">Related to</dt>
                <dd className="mt-1 font-medium text-heading">{detail.relatedName}</dd>
                <dd className="text-muted">{detail.relatedType}</dd>
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
  item: AdminNotificationFixture;
  onOpen: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <NotificationIcon item={item} />
      <div className="min-w-0">
        <button
          type="button"
          onClick={onOpen}
          className={`block max-w-full truncate text-left text-sm text-heading hover:text-action ${item.isRead ? 'font-medium' : 'font-semibold'}`}
        >
          {item.title}
        </button>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">{item.description}</p>
      </div>
    </div>
  );
}

function NotificationIcon({ item }: { item: AdminNotificationFixture }) {
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

function StatusBadge({ item }: { item: AdminNotificationFixture }) {
  const resolved = item.attention === 'RESOLVED';
  const dismissed = item.attention === 'DISMISSED';
  const label = resolved ? 'Resolved' : dismissed ? 'Dismissed' : item.isRead ? 'Read' : 'Unread';
  const tone =
    resolved || item.isRead
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
  item: AdminNotificationFixture;
  onRead: () => void;
  onUnread: () => void;
  onResolve: () => void;
  onDismiss: () => void;
}) {
  const items = [
    {
      label: item.isRead ? 'Mark as Unread' : 'Mark as Read',
      onSelect: item.isRead ? onUnread : onRead,
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
  rows: AdminNotificationFixture[],
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
