'use client';

import type { BookkeepingClientWorkspace } from '@firmivra/types';
import { KpiCard, Table, Toast, type Column } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  ArrowsClockwise,
  CalendarBlank,
  CheckCircle,
  ChartBar,
  CreditCard,
  CurrencyDollar,
  FileText,
  Plus,
  Plugs,
  Tag,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ClientMenu, ConnectDialog, useAct, type Notice } from './bookkeeping-actions';
import {
  BK_KEY,
  PeriodPill,
  REPORT_LABEL,
  SoftwareTile,
  StatusPill,
  card,
  dateTimeText,
  dayText,
  linkBtn,
  money,
  moneyWhole,
  outlined,
  primary,
  quiet,
  subtle,
} from './bookkeeping-shared';
import { PeriodsTab, ReportsTab, SettingsTab } from './workspace-tabs';

const TABS = [
  'Overview',
  'Transactions',
  'Reconciliation',
  'Reports',
  'Documents',
  'Tasks',
  'Notes',
  'Communications',
  'Settings',
] as const;
type TabId = (typeof TABS)[number];
const LINKS: Partial<Record<TabId, (w: BookkeepingClientWorkspace) => string>> = {
  Documents: (w) => `/documents?clientId=${w.client.id}`,
  Tasks: (w) => `/tasks?clientId=${w.client.id}`,
  Notes: (w) => `/clients/${w.client.id}`,
  Communications: () => '/communications',
};

/** /bookkeeping/clients/[id]: the client's bookkeeping workspace. */
export function ClientWorkspace({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const initial = (TABS.find((t) => t.toLowerCase() === params.get('tab')) ?? 'Overview') as TabId;
  const [tab, setTab] = useState<TabId>(initial);
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [connect, setConnect] = useState(false);
  const notice: Notice = (text, tone) => setMessage({ text, tone });
  const act = useAct(notice);
  const ws = useApiQuery([...BK_KEY, 'client', id], () => api.bookkeeping.getClient(id));
  const siblings = useApiQuery([...BK_KEY, 'siblings'], () =>
    api.bookkeeping.clients({ pageSize: 100 }),
  );
  const w = ws.data;

  if (ws.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="bk-client-error">
        <Link href="/bookkeeping" className="text-sm font-medium text-link">
          ← Back to Bookkeeping
        </Link>
        <p role="alert" className={quiet}>
          This bookkeeping client is not available. They may have been removed, or we could not load
          them.
        </p>
      </div>
    );
  if (!w) return <p className={quiet}>Loading…</p>;
  const list = siblings.data?.items ?? [];
  const at = list.findIndex((r) => r.id === id);
  const prev = at > 0 ? list[at - 1] : undefined;
  const nextC = at >= 0 && at < list.length - 1 ? list[at + 1] : undefined;
  const sw = w.connections.find((k) => k.status !== 'DISCONNECTED');
  const cur = w.currentPeriod;
  const row = {
    id: w.id,
    status: w.status,
    paused: w.paused,
    software: sw ? { key: sw.provider, label: sw.label, status: sw.status } : null,
    client: { id: w.client.id, displayName: w.client.displayName },
  };

  const accountCols: Column<BookkeepingClientWorkspace['accounts'][number]>[] = [
    {
      id: 'name',
      label: 'Account Name',
      cell: (a) => <span className="font-medium text-heading">{a.name}</span>,
    },
    {
      id: 'type',
      label: 'Type',
      cell: (a) =>
        ({ BANK: 'Bank', CREDIT_CARD: 'Credit Card', LOAN: 'Loan', OTHER: 'Other' })[a.type],
    },
    { id: 'mask', label: 'Account', cell: (a) => (a.mask ? `••${a.mask}` : '—') },
    { id: 'bal', label: 'Balance', cell: (a) => money(a.balanceCents) },
    {
      id: 'st',
      label: 'Status',
      cell: (a) => (a.status === 'CONNECTED' ? 'Connected' : 'Not connected'),
    },
  ];
  const monthMax = Math.max(1, ...w.trend.flatMap((t) => [t.incomeCents, t.expensesCents]));

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="bk-client">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm text-link">
        <Link href="/bookkeeping">Bookkeeping</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">{w.client.displayName}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action"
          >
            <ChartBar weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl font-bold break-words text-heading">
                {w.client.displayName}
              </h1>
              <StatusPill status={w.status} reason={w.statusReason} />
              {w.paused ? (
                <span className="rounded-pill bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">
                  Paused
                </span>
              ) : null}
            </div>
            <p className="flex flex-wrap gap-x-4 text-sm text-muted">
              <span>{w.client.accountType === 'BUSINESS' ? 'Business' : 'Individual'}</span>
              {w.plan ? <span>{w.plan} Plan</span> : null}
              <span>
                Client Since:{' '}
                {new Date(w.clientSince).toLocaleDateString('en-US', {
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ClientMenu row={row} onNotice={notice} triggerLabel="Client Actions" />
          <button
            type="button"
            aria-label="Previous client"
            disabled={!prev}
            onClick={() => prev && router.push(`/bookkeeping/clients/${prev.id}`)}
            className={`${subtle} min-w-10 px-2`}
          >
            <ArrowLeft aria-hidden weight="bold" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next client"
            disabled={!nextC}
            onClick={() => nextC && router.push(`/bookkeeping/clients/${nextC.id}`)}
            className={`${subtle} min-w-10 px-2`}
          >
            <ArrowRight aria-hidden weight="bold" className="size-4" />
          </button>
          <div className="text-sm" data-testid="next-report">
            <span className="block text-muted">Next Report Due</span>
            <span className="flex items-center gap-1 font-semibold text-heading">
              <CalendarBlank aria-hidden weight="fill" className="size-4 text-action" />{' '}
              {w.nextReportDueOn ? dayText(w.nextReportDueOn) : '—'}
            </span>
          </div>
          <Link href={`/documents?clientId=${w.client.id}`} className={primary}>
            <FileText aria-hidden weight="bold" className="size-4" /> Request Documents
          </Link>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div
        role="tablist"
        aria-label="Client views"
        className="relative flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) => {
          const href = LINKS[t]?.(w);
          const cls = `-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm whitespace-nowrap ${tab === t ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`;
          return href ? (
            <Link key={t} href={href} role="tab" aria-selected={false} className={cls}>
              {t}
            </Link>
          ) : (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cls}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === 'Overview' ? (
        <>
          <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-[1.1fr_1.1fr_1fr_1fr_1fr]">
            <section
              className={card}
              aria-label="Accounting software"
              data-testid="accounting-software"
            >
              <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
                <Plugs aria-hidden weight="fill" className="size-5 text-action" /> Accounting
                Software
              </h2>
              {sw ? (
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-3">
                    <SoftwareTile provider={sw.provider} label={sw.label} size="md" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-heading">{sw.label}</span>
                      <span
                        className={`text-xs font-medium ${sw.status === 'CONNECTED' ? 'text-success' : 'text-danger'}`}
                      >
                        {sw.status === 'CONNECTED'
                          ? 'Connected'
                          : (sw.lastErrorCode ?? 'Needs attention')}
                      </span>
                    </span>
                  </span>
                  <p className="text-xs text-muted">
                    Last Sync:{' '}
                    {sw.lastSuccessfulSyncAt ? dateTimeText(sw.lastSuccessfulSyncAt) : 'never'}
                  </p>
                  <button
                    type="button"
                    className={`${outlined} min-h-9 w-fit`}
                    onClick={() => void act(() => api.bookkeeping.sync(w.id), 'Sync requested.')}
                  >
                    <ArrowsClockwise aria-hidden weight="bold" className="size-4" /> Sync Now
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className={quiet}>No accounting software is connected.</p>
                  <button
                    type="button"
                    className={`${outlined} min-h-9 w-fit`}
                    onClick={() => setConnect(true)}
                  >
                    Connect Software
                  </button>
                </div>
              )}
            </section>
            <section className={card} aria-label="Current period" data-testid="current-period">
              <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
                <CalendarBlank aria-hidden weight="fill" className="size-5 text-action" /> Current
                Period
              </h2>
              {cur ? (
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/bookkeeping/periods/${cur.id}`}
                    className="font-semibold text-link hover:underline"
                  >
                    {cur.label}
                  </Link>
                  <p className="flex items-center gap-2 text-sm text-heading">
                    Status: <PeriodPill status={cur.status} />
                  </p>
                  <p className="text-sm text-muted">
                    Close by: {cur.closeByOn ? dayText(cur.closeByOn) : '—'}
                  </p>
                  <p className="text-xs text-muted">
                    Checklist {cur.progress.done} of {cur.progress.total}
                  </p>
                </div>
              ) : (
                <p className={quiet}>No period yet. Add one in Reconciliation.</p>
              )}
            </section>
            <KpiCard
              icon={CurrencyDollar}
              tone="green"
              value={moneyWhole(w.kpis.incomeCents)}
              label="Total Income"
              {...(w.kpis.incomeCents === null ? { note: 'No figures entered' } : {})}
            />
            <KpiCard
              icon={CreditCard}
              tone="red"
              value={moneyWhole(w.kpis.expensesCents)}
              label="Total Expenses"
              {...(w.kpis.expensesCents === null ? { note: 'No figures entered' } : {})}
            />
            <KpiCard
              icon={ChartBar}
              tone="blue"
              value={moneyWhole(w.kpis.netProfitCents)}
              label="Net Profit"
              {...(w.kpis.netProfitCents === null ? { note: 'No figures entered' } : {})}
            />
          </div>

          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Quick actions"
            data-testid="quick-actions"
          >
            <button type="button" className={subtle} onClick={() => setTab('Reconciliation')}>
              <Tag aria-hidden weight="fill" className="size-4 text-action" /> Categorize
              Transactions
            </button>
            <button type="button" className={subtle} onClick={() => setTab('Reconciliation')}>
              <CheckCircle aria-hidden weight="fill" className="size-4 text-success" /> Reconcile
              Accounts
            </button>
            <Link href={`/tasks?clientId=${w.client.id}`} className={subtle}>
              <Plus aria-hidden weight="bold" className="size-4 text-action" /> Create Task
            </Link>
            <button type="button" className={subtle} onClick={() => setTab('Reports')}>
              <FileText aria-hidden weight="fill" className="size-4 text-action" /> Generate Report
            </button>
            <button type="button" className={subtle} onClick={() => setTab('Reports')}>
              <ChartBar aria-hidden weight="fill" className="size-4 text-action" /> View Financial
              Statements
            </button>
          </div>

          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
            <section
              className={card}
              aria-label="Bank and credit card accounts"
              data-testid="accounts"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-heading">
                  Bank &amp; Credit Card Accounts
                </h2>
                <button type="button" className={linkBtn} onClick={() => setTab('Settings')}>
                  Manage Accounts
                </button>
              </div>
              <div className="relative">
                <Table
                  rows={w.accounts.filter((a) => !a.archived)}
                  columns={accountCols}
                  rowKey={(a) => a.id}
                  caption="Accounts"
                  dense
                  noun="accounts"
                  pageSize={10}
                  showPagination={false}
                  emptyTitle="No accounts yet"
                  emptyText="Connect software or add an account in Settings."
                />
              </div>
            </section>
            <section
              className={card}
              aria-label="Uncategorized transactions"
              data-testid="uncategorized"
            >
              <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
                Uncategorized Transactions
                {w.kpis.uncategorizedCount ? (
                  <span className="rounded-pill bg-danger px-2 py-0.5 text-xs font-semibold text-on-action">
                    {w.kpis.uncategorizedCount}
                  </span>
                ) : null}
              </h2>
              <p className={quiet}>
                {w.kpis.uncategorizedCount === null
                  ? 'The count has not been entered for this period. Transactions stay in the accounting software.'
                  : `${w.kpis.uncategorizedCount} to categorize in ${sw?.label ?? 'the accounting software'}. Firmivra keeps no ledger.`}
              </p>
            </section>
          </div>

          <div className="grid min-w-0 items-start gap-4 lg:grid-cols-3">
            <section className={card} aria-label="Bookkeeping tasks" data-testid="shared-tasks">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-heading">Bookkeeping Tasks</h2>
                <Link href={`/tasks?clientId=${w.client.id}`} className={linkBtn}>
                  View All
                </Link>
              </div>
              <p className="text-sm text-heading">
                {w.shared.openTasks} open
                {w.shared.overdueTasks ? `, ${w.shared.overdueTasks} overdue` : ''}
              </p>
              <Link href={`/tasks?clientId=${w.client.id}`} className={`${outlined} mt-3 min-h-9`}>
                <Plus aria-hidden weight="bold" className="size-4" /> Add Task
              </Link>
            </section>
            <section className={card} aria-label="Recent documents" data-testid="shared-documents">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-heading">Recent Documents</h2>
                <Link href={`/documents?clientId=${w.client.id}`} className={linkBtn}>
                  View All
                </Link>
              </div>
              <p className="text-sm text-heading">
                {w.shared.documents} documents
                {w.shared.outstandingDocumentRequests
                  ? `, ${w.shared.outstandingDocumentRequests} requested`
                  : ''}
              </p>
              <Link
                href={`/documents?clientId=${w.client.id}`}
                className={`${outlined} mt-3 min-h-9`}
              >
                Upload Document
              </Link>
            </section>
            <section className={card} aria-label="Client notes" data-testid="shared-notes">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-heading">Client Notes</h2>
                <Link href={`/clients/${w.client.id}`} className={linkBtn}>
                  View All
                </Link>
              </div>
              <p className="text-sm text-heading">{w.shared.notes} notes</p>
              <Link href={`/clients/${w.client.id}`} className={`${outlined} mt-3 min-h-9`}>
                <Plus aria-hidden weight="bold" className="size-4" /> Add Note
              </Link>
            </section>
          </div>

          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-3">
            <section className={card} aria-label="Income versus expenses" data-testid="trend">
              <h2 className="mb-3 font-display text-lg font-bold text-heading">
                Income vs. Expenses
              </h2>
              {w.trend.length > 0 ? (
                <>
                  <ul
                    className="flex h-36 items-end gap-1.5 border-b border-divider"
                    role="img"
                    aria-label="Income and expenses by month"
                  >
                    {w.trend.map((t) => (
                      <li
                        key={t.month}
                        className="flex h-full flex-1 items-end justify-center gap-0.5"
                      >
                        <span
                          className="w-2 rounded-t-sm bg-action"
                          style={{ height: `${(t.incomeCents / monthMax) * 100}%` }}
                        />
                        <span
                          className="w-2 rounded-t-sm bg-gold"
                          style={{ height: `${(t.expensesCents / monthMax) * 100}%` }}
                        />
                      </li>
                    ))}
                  </ul>
                  <ul className="mt-1 flex gap-1.5 text-[10px] text-muted">
                    {w.trend.map((t) => (
                      <li key={t.month} className="flex-1 text-center">
                        {t.label.slice(0, 3)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className={quiet}>No monthly figures have been entered yet.</p>
              )}
            </section>
            <section className={card} aria-label="Profit and loss year to date" data-testid="ytd">
              <h2 className="mb-3 font-display text-lg font-bold text-heading">
                Profit &amp; Loss (Year to Date)
              </h2>
              {w.yearToDate ? (
                <dl className="flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt>Total Income</dt>
                    <dd className="font-semibold text-heading">
                      {money(w.yearToDate.incomeCents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Total Expenses</dt>
                    <dd className="font-semibold text-heading">
                      {money(w.yearToDate.expensesCents)}
                    </dd>
                  </div>
                  <div className="flex justify-between rounded-md bg-success-soft px-2 py-1">
                    <dt className="font-semibold">Net Profit</dt>
                    <dd className="font-semibold text-success">
                      {money(w.yearToDate.netProfitCents)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Expense Ratio</dt>
                    <dd className="font-semibold text-heading">
                      {w.yearToDate.expenseRatioPercent === null
                        ? '—'
                        : `${w.yearToDate.expenseRatioPercent}%`}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className={quiet}>No figures have been entered for this year.</p>
              )}
            </section>
            <section className={card} aria-label="Upcoming reports" data-testid="upcoming-reports">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-display text-lg font-bold text-heading">Upcoming Reports</h2>
                <button type="button" className={linkBtn} onClick={() => setTab('Reports')}>
                  View All
                </button>
              </div>
              {w.upcomingReports.length > 0 ? (
                <ul>
                  {w.upcomingReports.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-heading">{r.name}</span>
                        <span className="block text-xs text-muted">
                          {r.periodLabel}
                          {r.dueOn ? ` · due ${dayText(r.dueOn)}` : ''}
                        </span>
                      </span>
                      <span className="text-xs text-muted">{REPORT_LABEL[r.status]}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={quiet}>No reports are coming up.</p>
              )}
            </section>
          </div>
        </>
      ) : tab === 'Transactions' ? (
        <section className={card} aria-label="Transactions" data-testid="transactions-tab">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Transactions</h2>
          <p className={quiet}>
            Transactions stay in {sw?.label ?? 'the accounting software'}; Firmivra keeps no ledger.
            Period figures are entered or imported under Reconciliation.
          </p>
        </section>
      ) : tab === 'Reconciliation' ? (
        <PeriodsTab w={w} onNotice={notice} />
      ) : tab === 'Reports' ? (
        <ReportsTab w={w} onNotice={notice} />
      ) : (
        <SettingsTab w={w} onNotice={notice} />
      )}
      {connect ? (
        <ConnectDialog
          clientId={w.id}
          name={w.client.displayName}
          onClose={() => setConnect(false)}
          onNotice={notice}
        />
      ) : null}
    </div>
  );
}
