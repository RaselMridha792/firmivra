'use client';

import {
  ActionMenu,
  Avatar,
  Badge,
  Button,
  Table,
  Toggle,
  type ActionMenuItem,
  type Column,
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  ArrowsDownUp,
  CalendarPlus,
  CreditCard,
  DotsThreeVertical,
  Eye,
  ListChecks,
  NotePencil,
  Pause,
  Play,
  Prohibit,
  PuzzlePiece,
  Receipt,
  UsersThree,
} from '@phosphor-icons/react';
import { autoRenewEditable, autoRenewLock, dayText, LIVE, money } from './format';
import { StatusBadge, UsageBar, usageTone } from './parts';
import type { DialogKind } from './subscription-dialogs';
import type { PanelTab } from './subscription-panel';
import {
  ADDONS,
  CHANGEABLE,
  CYCLE_LABELS,
  planName,
  planRank,
  REACTIVATABLE,
  STATUS_ORDER,
  SUSPENDABLE,
  type Discount,
  type SubscriptionListItem,
} from './subscriptions-api';

/**
 * Slimmer cell padding, so every column fits the card at 1440 px. When the table still has to
 * scroll (a phone, or the detail panel beside it at 1536 px), the Actions column stays on the right
 * edge: the cells draw the row lines (separate borders, so the pinned cell keeps its own), the
 * pinned cell takes its row's background (plain, hovered or selected), and the cell whose menu is
 * open sits above the rows below it.
 */
const FIT_CLASSES = [
  '[&_td]:px-2 [&_th]:px-2',
  'border-separate border-spacing-0 [&_tbody_td]:border-b [&_tbody_td]:border-divider [&_tbody_tr]:bg-surface',
  '[&_td:last-child]:sticky [&_td:last-child]:right-0 [&_td:last-child]:z-1 [&_td:last-child]:bg-inherit',
  '[&_th:last-child]:sticky [&_th:last-child]:right-0 [&_th:last-child]:z-1 [&_th:last-child]:bg-table-head',
  '[&_td:last-child:has([aria-expanded=true])]:z-2',
].join(' ');

/** Next billing, or when a non-renewing subscription ends, or when an ended one ended. */
export function NextBilling({ row }: { row: SubscriptionListItem }) {
  if (row.nextBillingOn)
    return (
      <time dateTime={row.nextBillingOn} className="whitespace-nowrap">
        {dayText(row.nextBillingOn)}
      </time>
    );
  if (!row.endsOn) return <span className="text-muted">—</span>;
  const ended = row.status === 'CANCELLED' || row.status === 'CLOSED' || row.status === 'EXPIRED';
  return (
    <span className={ended ? 'text-muted' : 'text-heading'}>
      {ended ? 'Ended' : 'Ends'}{' '}
      <time dateTime={row.endsOn} className="whitespace-nowrap">
        {dayText(row.endsOn)}
      </time>
    </span>
  );
}

/** A firm's domain, free to break before its first dot ("coastaladvisory" / ".example.test"). */
function Domain({ domain }: { domain: string }) {
  const dot = domain.indexOf('.');
  if (dot <= 0) return <>{domain}</>;
  return (
    <>
      {domain.slice(0, dot)}
      <wbr />
      {domain.slice(dot)}
    </>
  );
}

/** "LAUNCH50 (50% off)", free to wrap before the bracket onto two lines, as in the design. */
function DiscountText({ discount: { code, label } }: { discount: Discount }) {
  const rest = code && label.startsWith(`${code} `) ? label.slice(code.length + 1) : null;
  if (rest === null) return <span className="whitespace-nowrap">{label}</span>;
  return (
    <span className="text-center">
      {code} <span className="whitespace-nowrap">{rest}</span>
    </span>
  );
}

/** The row's ⋮ menu: the design's actions, with the ones the status allows. */
function rowMenu(
  row: SubscriptionListItem,
  onOpen: (id: string, tab?: PanelTab) => void,
  onAction: (kind: DialogKind, row: SubscriptionListItem) => void,
  onAutoRenew: (row: SubscriptionListItem) => void,
): ActionMenuItem[] {
  const changeable = CHANGEABLE.includes(row.status);
  const items: (ActionMenuItem | false)[] = [
    { label: 'View Subscription', icon: Eye, onSelect: () => onOpen(row.id) },
    changeable && {
      label: 'Change Plan',
      icon: ArrowsDownUp,
      onSelect: () => onAction('changePlan', row),
    },
    changeable && {
      label: 'Manage Seats',
      icon: UsersThree,
      onSelect: () => onAction('seats', row),
    },
    changeable && {
      label: 'Manage Add-ons',
      icon: PuzzlePiece,
      onSelect: () => onAction('addons', row),
    },
    row.status === 'TRIAL' && {
      label: 'Extend Trial',
      icon: CalendarPlus,
      onSelect: () => onAction('extendTrial', row),
    },
    row.status === 'TRIAL' && {
      label: 'Convert to Paid',
      icon: CreditCard,
      onSelect: () => onAction('convert', row),
    },
    autoRenewEditable(row) && {
      label: 'Toggle Auto-Renew',
      icon: ArrowsClockwise,
      onSelect: () => onAutoRenew(row),
    },
    SUSPENDABLE.includes(row.status) && {
      label: 'Pause / Suspend',
      icon: Pause,
      onSelect: () => onAction('suspend', row),
    },
    REACTIVATABLE.includes(row.status) && {
      label: 'Reactivate',
      icon: Play,
      onSelect: () => onAction('reactivate', row),
    },
    row.status === 'ACTIVE' &&
      row.autoRenew && {
        label: 'Cancel at Period End',
        icon: Prohibit,
        danger: true,
        onSelect: () => onAction('cancel', row),
      },
    row.status === 'NON_RENEWING' && {
      label: 'Reverse Cancellation',
      icon: ArrowCounterClockwise,
      onSelect: () => onAction('reverse', row),
    },
    { label: 'View Billing', icon: Receipt, onSelect: () => onOpen(row.id, 'billing') },
    { label: 'Add Internal Note', icon: NotePencil, onSelect: () => onAction('note', row) },
    { label: 'View Activity Log', icon: ListChecks, onSelect: () => onAction('activity', row) },
  ];
  return items.filter((item): item is ActionMenuItem => item !== false);
}

/**
 * The subscriptions list (kit Table: sorting, row selection, pages and "Rows per page"). With the
 * detail panel open beside it, the Add-ons and Discount columns step aside, as in the design.
 */
export function SubscriptionTable({
  rows,
  loading,
  compact,
  emptyAll,
  pageSize,
  onPageSize,
  selected,
  onSelect,
  onOpen,
  onAction,
  onAutoRenew,
  onClear,
}: {
  rows: SubscriptionListItem[];
  loading: boolean;
  compact: boolean;
  /** No subscriptions at all (not just none matching). */
  emptyAll: boolean;
  pageSize: number;
  onPageSize: (size: number) => void;
  selected: string[];
  onSelect: (ids: string[]) => void;
  onOpen: (id: string, tab?: PanelTab) => void;
  onAction: (kind: DialogKind, row: SubscriptionListItem) => void;
  onAutoRenew: (row: SubscriptionListItem) => void;
  onClear: () => void;
}) {
  const columns: Column<SubscriptionListItem>[] = [
    {
      id: 'firm',
      label: 'Firm Name',
      sortValue: (row) => row.firm.name.toLowerCase(),
      cell: (row) => (
        <div className="flex min-w-32 items-center gap-2.5">
          <span aria-hidden>
            <Avatar name={row.firm.name} size="md" />
          </span>
          <span className="min-w-0">
            <button
              type="button"
              data-testid="open-subscription"
              onClick={() => onOpen(row.id)}
              className="block text-left font-semibold text-heading hover:text-action hover:underline"
            >
              {row.firm.name}
            </button>
            <span className="block text-muted">
              <Domain domain={row.firm.domain} />
            </span>
          </span>
        </div>
      ),
    },
    {
      id: 'plan',
      label: 'Plan',
      sortValue: (row) => planRank(row.plan),
      cell: (row) => (
        <>
          <span className="block font-medium whitespace-nowrap text-heading">
            {planName(row.plan)}
          </span>
          <span className="block text-muted">{CYCLE_LABELS[row.cycle]}</span>
        </>
      ),
    },
    {
      id: 'price',
      label: 'Price',
      sortValue: (row) => row.monthlyCents,
      cell: (row) => (
        <span className="whitespace-nowrap">
          {money(row.monthlyCents)}/mo
          {row.cycle === 'ANNUAL' ? (
            <span className="block text-muted">({money(row.monthlyCents * 12)}/yr)</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'seats',
      label: 'Seats',
      // Seats in use may not be counted yet (null): a dash, sorted first.
      sortValue: (row) => row.seatsUsed ?? -1,
      cell: (row) => (
        <span className="whitespace-nowrap">
          {row.seatsUsed ?? '—'} / {row.seats}
        </span>
      ),
    },
    {
      id: 'usage',
      label: 'Usage',
      sortValue: (row) => row.usagePercent ?? -1,
      cell: (row) =>
        row.usagePercent === null ? (
          <span className="text-muted">
            <span aria-hidden>—</span>
            <span className="sr-only">Not counted yet</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 whitespace-nowrap">
            <UsageBar
              percent={row.usagePercent}
              tone={usageTone(row.status, row.usagePercent)}
              label={`Seats used by ${row.firm.name}`}
              className="w-10"
            />
            {row.usagePercent}%
          </span>
        ),
    },
    {
      id: 'next',
      label: 'Next Billing',
      sortValue: (row) => row.nextBillingOn ?? row.endsOn ?? '9999-12-31',
      cell: (row) => <NextBilling row={row} />,
    },
    {
      id: 'status',
      label: 'Status',
      sortValue: (row) => STATUS_ORDER.indexOf(row.status),
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: 'autoRenew',
      label: 'Auto-Renew',
      cell: (row) =>
        LIVE.includes(row.status) ? (
          <Toggle
            checked={row.autoRenew}
            label={`Auto-Renew for ${row.firm.name}`}
            disabled={!autoRenewEditable(row)}
            title={autoRenewLock(row)}
            onChange={() => onAutoRenew(row)}
          />
        ) : (
          <span className="text-muted">
            <span aria-hidden>—</span>
            <span className="sr-only">Not renewing</span>
          </span>
        ),
    },
    ...(compact
      ? []
      : [
          {
            id: 'addons',
            label: 'Add-ons',
            cell: (row: SubscriptionListItem) =>
              row.addons.length ? (
                <ul>
                  {row.addons.map((id) => (
                    <li key={id}>{ADDONS[id].name}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
          {
            id: 'discount',
            label: 'Discount',
            cell: (row: SubscriptionListItem) =>
              row.discount ? (
                <Badge tone="success">
                  <DiscountText discount={row.discount} />
                </Badge>
              ) : row.creditCents > 0 ? (
                <Badge tone="info">{money(row.creditCents)} credit</Badge>
              ) : (
                <span className="text-muted">—</span>
              ),
          },
        ]),
  ];

  return (
    <Table
      dense
      tableClassName={FIT_CLASSES}
      caption="Subscriptions"
      noun="subscriptions"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      loading={loading}
      pageSize={pageSize}
      pageSizes={[8, 16, 24]}
      onPageSize={onPageSize}
      selection={{ selected, onChange: onSelect }}
      emptyTitle={emptyAll ? 'No subscriptions yet' : 'No subscriptions match these filters'}
      emptyText={
        emptyAll
          ? 'A subscription appears here when a firm starts a trial or a paid plan.'
          : 'Try another search, status or period.'
      }
      emptyAction={
        emptyAll ? undefined : (
          <Button variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        )
      }
      rowActions={(row) => (
        <ActionMenu
          label={`Actions for ${row.firm.name}`}
          trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
          sections={[{ items: rowMenu(row, onOpen, onAction, onAutoRenew) }]}
        />
      )}
    />
  );
}
