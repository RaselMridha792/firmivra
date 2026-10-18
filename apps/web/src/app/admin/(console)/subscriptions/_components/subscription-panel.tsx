'use client';

import {
  ActionMenu,
  Avatar,
  Drawer,
  Skeleton,
  Tabs,
  Toast,
  type ActionMenuItem,
} from '@firmivra/ui';
import {
  Buildings,
  CalendarCheck,
  ClockCounterClockwise,
  CreditCard,
  DotsThreeVertical,
  DownloadSimple,
  LinkSimple,
  ListChecks,
  Notepad,
  PaperPlaneTilt,
  Receipt,
  Tag,
  Trash,
  UserSwitch,
  X,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef } from 'react';
import type { SubscriptionDetail } from '../../../../../mocks/admin-subscriptions';
import { loadErrorText } from './format';
import { StatusBadge, useDetail } from './parts';
import { BillingTab, HistoryTab, NotesTab, OverviewTab, UsageTab } from './panel-tabs';
import type { DialogKind } from './subscription-dialogs';

export type PanelTab = 'overview' | 'usage' | 'billing' | 'history' | 'notes';
const TABS: readonly PanelTab[] = ['overview', 'usage', 'billing', 'history', 'notes'];

export interface PanelActions {
  /** Opens a dialog for this subscription. */
  onAction: (kind: DialogKind, sub: SubscriptionDetail, invoiceId?: string) => void;
  /** Auto-Renew switch: the controlled workflow, never a direct change. */
  onAutoRenew: (sub: SubscriptionDetail) => void;
  onExport: (sub: SubscriptionDetail) => void;
  onToast: (message: string) => void;
  /** The last result, shown inside the slide-in panel (the page's toast sits behind it). */
  notice: string | null;
  onDismissNotice: () => void;
}

/** More Actions (the design's list): deeper actions for the selected firm. */
function moreActions(
  sub: SubscriptionDetail,
  actions: PanelActions,
  onTab: (tab: PanelTab) => void,
  openFirm: () => void,
): ActionMenuItem[] {
  const act = (kind: DialogKind) => () => actions.onAction(kind, sub);
  return [
    { label: 'View Full Account', icon: Buildings, onSelect: openFirm },
    { label: 'Billing History', icon: Receipt, onSelect: () => onTab('billing') },
    {
      label: 'Subscription History',
      icon: ClockCounterClockwise,
      onSelect: () => onTab('history'),
    },
    { label: 'Activity Log', icon: ListChecks, onSelect: act('activity') },
    { label: 'Internal Notes', icon: Notepad, onSelect: () => onTab('notes') },
    { label: 'Apply Credit / Discount', icon: Tag, onSelect: act('discount') },
    { label: 'Send Payment Link', icon: LinkSimple, onSelect: act('paymentLink') },
    { label: 'Resend Invoice', icon: PaperPlaneTilt, onSelect: act('resendInvoice') },
    { label: 'Change Billing Date', icon: CalendarCheck, onSelect: act('billingDate') },
    {
      label: 'Export Subscription Data',
      icon: DownloadSimple,
      onSelect: () => actions.onExport(sub),
    },
    ...(sub.status === 'TRIAL'
      ? [{ label: 'Convert to Paid', icon: CreditCard, onSelect: act('convert') }]
      : []),
    { label: 'Impersonate as Firm Admin', icon: UserSwitch, onSelect: act('supportView') },
    { label: 'Close Account', icon: Trash, danger: true, onSelect: act('close') },
  ];
}

function PanelBody({
  sub,
  tab,
  onTab,
  actions,
}: {
  sub: SubscriptionDetail;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  actions: PanelActions;
}) {
  const router = useRouter();
  const more = (
    <ActionMenu
      label="More Actions"
      trigger={
        <>
          <DotsThreeVertical aria-hidden weight="bold" className="size-4 text-action" />
          <span className="text-action">More Actions</span>
        </>
      }
      sections={[
        { items: moreActions(sub, actions, onTab, () => router.push(`/firms/${sub.firm.id}`)) },
      ]}
    />
  );
  return (
    <Tabs
      variant="underline"
      label="Subscription details"
      value={tab}
      onChange={(id) => onTab(TABS.find((candidate) => candidate === id) ?? 'overview')}
      items={[
        {
          id: 'overview',
          label: 'Overview',
          content: <OverviewTab sub={sub} actions={actions} more={more} />,
        },
        { id: 'usage', label: 'Usage', content: <UsageTab sub={sub} actions={actions} /> },
        { id: 'billing', label: 'Billing', content: <BillingTab sub={sub} actions={actions} /> },
        { id: 'history', label: 'History', content: <HistoryTab sub={sub} actions={actions} /> },
        { id: 'notes', label: 'Notes', content: <NotesTab sub={sub} actions={actions} /> },
      ]}
    />
  );
}

function PanelState({ query }: { query: ReturnType<typeof useDetail> }) {
  if (query.isError)
    return (
      <p data-testid="panel-error" className="py-6 text-sm text-muted">
        {loadErrorText(query.error)}
      </p>
    );
  return (
    <div role="status" aria-label="Loading the subscription" className="flex flex-col gap-3 py-6">
      <Skeleton className="h-6 w-1/2" />
      <Skeleton />
      <Skeleton />
      <Skeleton className="w-2/3" />
    </div>
  );
}

/**
 * The subscription detail panel (docx §4). From 1536 px it sits beside the table as in the
 * design; on narrower screens it slides in from the right (kit Drawer) so the table keeps its
 * width.
 */
export function SubscriptionPanel({
  id,
  name,
  domain,
  wide,
  tab,
  onTab,
  onClose,
  actions,
}: {
  id: string;
  /** From the table row, so the heading shows before the record loads. */
  name: string;
  domain: string;
  wide: boolean;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
  actions: PanelActions;
}) {
  const query = useDetail(id);
  const sub = query.data;
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Opening another firm moves the reader to the panel (and scrolls it into view).
  useEffect(() => {
    if (wide) headingRef.current?.focus();
  }, [id, wide]);

  if (!wide) {
    return (
      <Drawer
        open
        title={sub?.firm.name ?? name}
        subtitle={sub?.firm.domain ?? domain}
        onClose={onClose}
      >
        <div data-testid="subscription-panel" className="flex flex-col gap-3">
          {actions.notice ? (
            <div data-testid="subscription-toast">
              <Toast message={actions.notice} onDismiss={actions.onDismissNotice} />
            </div>
          ) : null}
          {sub ? (
            <>
              <div>
                <StatusBadge status={sub.status} />
              </div>
              <PanelBody sub={sub} tab={tab} onTab={onTab} actions={actions} />
            </>
          ) : (
            <PanelState query={query} />
          )}
        </div>
      </Drawer>
    );
  }

  return (
    <aside
      aria-labelledby={headingId}
      data-testid="subscription-panel"
      className="w-88 shrink-0 self-start rounded-xl bg-surface p-5 shadow-md"
    >
      <header className="flex items-start gap-3">
        <span aria-hidden>
          <Avatar name={sub?.firm.name ?? name} size="xl" />
        </span>
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-bold text-heading outline-none"
          >
            {sub?.firm.name ?? name}
          </h2>
          <p className="text-sm text-muted wrap-anywhere">{sub?.firm.domain ?? domain}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            aria-label="Close subscription details"
            onClick={onClose}
            className="rounded-control p-1 text-muted hover:bg-canvas hover:text-heading focus-visible:outline-2 focus-visible:outline-focus"
          >
            <X aria-hidden weight="bold" className="size-5" />
          </button>
          {sub ? <StatusBadge status={sub.status} /> : null}
        </div>
      </header>
      <div className="mt-3">
        {sub ? (
          <PanelBody sub={sub} tab={tab} onTab={onTab} actions={actions} />
        ) : (
          <PanelState query={query} />
        )}
      </div>
    </aside>
  );
}
