'use client';

import { BulkBar, Button, Callout, Card, PageHeader, Toast, type DateRange } from '@firmivra/ui';
import { CaretRight, DownloadSimple, UserSwitch, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  adminSubscriptions,
  type StatusFilter,
  type SubscriptionListItem,
} from '../../../../../mocks/admin-subscriptions';
import { AddMenu } from './add-menu';
import { autoRenewEditable, clockText, loadErrorText } from './format';
import { KEY, useAct } from './parts';
import { SubscriptionDialog, type DialogKind, type DialogState } from './subscription-dialogs';
import { NO_FILTERS, SubscriptionFilters, type Filters } from './subscription-filters';
import { SubscriptionKpis } from './subscription-kpis';
import { SubscriptionPanel, type PanelActions, type PanelTab } from './subscription-panel';
import { SubscriptionTable } from './subscription-table';

/** The design's side-by-side panel needs the 1536 px layout; narrower, it slides in. */
const WIDE = '(min-width: 1536px)';
const subscribeWide = (callback: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const wideNow = () => window.matchMedia(WIDE).matches;
const subscribeNothing = () => () => {};
/** This month (UTC, as the billing dates) as "YYYY-MM-01|YYYY-MM-30"; '' on the server. */
const monthKey = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const last = new Date(Date.UTC(year, now.getUTCMonth() + 1, 0)).getUTCDate();
  return `${year}-${month}-01|${year}-${month}-${String(last).padStart(2, '0')}`;
};
const toRange = (key: string): DateRange => {
  const [from = '', to = ''] = key.split('|');
  return { from, to };
};

type Subject = Pick<SubscriptionListItem, 'id' | 'autoRenew' | 'status'> & {
  firm: { name: string };
};

/** The Super Admin Subscriptions page (S03): docx §2 to §5, every action a dialog on the page. */
export function SubscriptionsScreen() {
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<Filters>(NO_FILTERS);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [panel, setPanel] = useState<{
    id: string;
    tab: PanelTab;
    name: string;
    domain: string;
  } | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(8);
  const thisMonth = toRange(useSyncExternalStore(subscribeNothing, monthKey, () => ''));
  const wide = useSyncExternalStore(subscribeWide, wideNow, () => false);

  // An empty period is this month for the mock (and the API to come).
  const from = applied.period?.from ?? '';
  const to = applied.period?.to ?? '';
  const list = useApiQuery(
    [KEY, 'list', applied.search, applied.plan, applied.status, applied.cycle, from, to],
    () =>
      adminSubscriptions.subscriptions({
        search: applied.search,
        plan: applied.plan,
        status: applied.status,
        cycle: applied.cycle,
        from,
        to,
      }),
  );
  const stats = useApiQuery([KEY, 'stats', from, to], () => adminSubscriptions.stats({ from, to }));
  const endSupport = useAct((id: string) => adminSubscriptions.endSupportView({ id }));

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  const rows = list.data?.items ?? [];
  const support = rows.find((row) => row.supportViewUntil);

  function apply() {
    const period = draft.period;
    if (period && (!period.from || !period.to || period.from > period.to)) {
      setPeriodError('Choose a start date on or before the end date.');
      return;
    }
    setPeriodError(null);
    setApplied(draft);
  }
  function clear() {
    setPeriodError(null);
    setDraft(NO_FILTERS);
    setApplied(NO_FILTERS);
  }
  function filterStatus(status: StatusFilter | '') {
    setDraft({ ...draft, status });
    setApplied({ ...applied, status });
  }
  function open(id: string, tab: PanelTab = 'overview') {
    const row = rows.find((candidate) => candidate.id === id);
    setPanel({
      id,
      tab,
      name: row?.firm.name ?? panel?.name ?? '',
      domain: row?.firm.domain ?? panel?.domain ?? '',
    });
  }
  function act(kind: DialogKind, subject: Subject, invoiceId?: string) {
    setDialog({ kind, id: subject.id, firm: subject.firm.name, invoiceId });
  }
  /** The switch never flips by itself: off is the §6 workflow, back on is a reversal. */
  function autoRenew(subject: Subject) {
    if (!autoRenewEditable(subject)) return;
    act(subject.autoRenew ? 'autoRenewOff' : 'reverse', subject);
  }
  function done(message: string) {
    setDialog(null);
    setToast(message);
  }
  const panelActions: PanelActions = {
    onAction: act,
    onAutoRenew: autoRenew,
    onExport: (sub) => setDialog({ kind: 'export', ids: [sub.id], scope: sub.firm.name }),
    onToast: setToast,
    notice: toast,
    onDismissNotice: () => setToast(null),
  };
  // The slide-in panel is a modal dialog: its own copy of the result shows inside it.
  const drawerOpen = !!panel && !wide;

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <PageHeader
        above={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2 text-sm text-muted">
              <li>
                <Link href="/" className="hover:text-action hover:underline">
                  Dashboard
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight weight="bold" className="size-3" />
              </li>
              <li>
                <span aria-current="page" className="text-heading">
                  Subscriptions
                </span>
              </li>
            </ol>
          </nav>
        }
        title="Subscriptions"
        subtitle="Manage Firmivra subscriptions, plans, and renewals. Track revenue, usage and growth."
        actions={
          <AddMenu
            onAdd={() => setDialog({ kind: 'add', trial: false })}
            onTrial={() => setDialog({ kind: 'add', trial: true })}
            onExport={() =>
              setDialog({
                kind: 'export',
                ids: rows.map((row) => row.id),
                scope: 'Subscriptions matching the current filters',
              })
            }
          />
        }
      />

      {support?.supportViewUntil ? (
        <div data-testid="support-banner">
          <Callout
            icon={UserSwitch}
            surface="warning"
            tone="amber"
            size="compact"
            title={`Support view of ${support.firm.name} is active`}
          >
            <span>
              It ends at {clockText(support.supportViewUntil)}. Every step is logged.{' '}
              <button
                type="button"
                disabled={endSupport.isPending}
                onClick={() =>
                  endSupport.mutate(support.id, { onSuccess: (result) => setToast(result.message) })
                }
                className="font-medium text-link hover:underline"
              >
                End support view
              </button>
            </span>
            {endSupport.error ? (
              <span className="text-danger">{errorMessage(endSupport.error)}</span>
            ) : null}
          </Callout>
        </div>
      ) : null}

      <SubscriptionKpis stats={stats} status={applied.status} onFilter={filterStatus} />

      <div className="flex flex-col gap-2">
        <SubscriptionFilters
          draft={draft}
          thisMonth={thisMonth}
          onDraft={setDraft}
          onApply={apply}
          onClear={clear}
        />
        {periodError ? (
          <p role="alert" className="text-sm text-danger">
            {periodError}
          </p>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-col gap-4 2xl:flex-row 2xl:items-start">
        <Card variant="elevated" data-testid="subscriptions-card" className="min-w-0 flex-1 p-4!">
          {selected.length ? (
            <div className="mb-3">
              <BulkBar
                count={selected.length}
                noun={selected.length === 1 ? 'subscription' : 'subscriptions'}
                actions={[
                  {
                    label: 'Export selected',
                    icon: DownloadSimple,
                    onClick: () =>
                      setDialog({ kind: 'export', ids: selected, scope: 'Selected subscriptions' }),
                  },
                  { label: 'Clear selection', icon: X, onClick: () => setSelected([]) },
                ]}
              />
            </div>
          ) : null}
          {list.isError && !list.data ? (
            <div
              data-testid="subscriptions-error"
              className="flex flex-col items-center gap-2 py-10"
            >
              <p className="text-sm text-muted">{loadErrorText(list.error)}</p>
              <Button variant="ghost" onClick={() => void list.refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <SubscriptionTable
              key={JSON.stringify(applied)}
              rows={rows}
              loading={list.isPending}
              compact={!!panel && wide}
              emptyAll={list.data?.all === 0}
              pageSize={pageSize}
              onPageSize={setPageSize}
              selected={selected}
              onSelect={setSelected}
              onOpen={open}
              onAction={act}
              onAutoRenew={autoRenew}
              onClear={clear}
            />
          )}
        </Card>
        {panel ? (
          <SubscriptionPanel
            key={panel.id}
            id={panel.id}
            name={panel.name}
            domain={panel.domain}
            wide={wide}
            tab={panel.tab}
            onTab={(tab) => setPanel({ ...panel, tab })}
            onClose={() => setPanel(null)}
            actions={panelActions}
          />
        ) : null}
      </div>

      <SubscriptionDialog
        key={dialog ? JSON.stringify(dialog) : 'none'}
        dialog={dialog}
        onClose={() => setDialog(null)}
        onDone={done}
      />
      {toast && !drawerOpen ? (
        <div data-testid="subscription-toast" className="fixed right-4 bottom-4 z-50 max-w-sm">
          <Toast message={toast} onDismiss={() => setToast(null)} />
        </div>
      ) : null}
    </div>
  );
}
