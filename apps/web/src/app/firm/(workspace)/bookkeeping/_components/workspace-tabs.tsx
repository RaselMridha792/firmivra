'use client';

import {
  BOOKKEEPING_PROVIDERS,
  type BookkeepingClientWorkspace,
  type BookkeepingPeriodSummary,
  type BookkeepingReportRow,
} from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select, Table, type Column } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { useAct, type Notice } from './bookkeeping-actions';
import {
  BK_ERRORS,
  BK_KEY,
  PeriodPill,
  ReportPill,
  card,
  dayText,
  moneyWhole,
  outlined,
  primary,
  quiet,
} from './bookkeeping-shared';
import { ReportMenu } from './report-actions';

const REPORT_TYPES = [
  ['PROFIT_LOSS', 'Profit & Loss'],
  ['BALANCE_SHEET', 'Balance Sheet'],
  ['CASH_FLOW', 'Cash Flow'],
  ['GENERAL_LEDGER', 'General Ledger'],
  ['TRIAL_BALANCE', 'Trial Balance'],
  ['TRANSACTION_DETAIL', 'Transaction Detail'],
  ['UNCATEGORIZED', 'Uncategorized Transactions'],
  ['RECONCILIATION', 'Reconciliation Report'],
  ['QUARTERLY_REVIEW', 'Quarterly Review'],
  ['YEAR_TO_DATE_SUMMARY', 'Year-to-Date Summary'],
  ['BOOKKEEPING_STATUS', 'Bookkeeping Status'],
  ['MISSING_DOCUMENTS', 'Missing Documents'],
  ['CUSTOM', 'Custom'],
] as const;

const monthEnd = (d: string) => {
  const t = new Date(`${d}T12:00:00Z`);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

function AddPeriodDialog({
  w,
  onClose,
  onNotice,
}: {
  w: BookkeepingClientWorkspace;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [kind, setKind] = useState<'MONTH' | 'QUARTER' | 'YEAR' | 'CUSTOM'>('MONTH');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Modal
      open
      title="Add Period"
      subtitle={w.client.displayName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!start || !(end || kind === 'MONTH')}
            onClick={async () => {
              try {
                await api.bookkeeping.createPeriod(w.id, {
                  kind,
                  periodStart: start,
                  periodEnd: end || monthEnd(start),
                  ...(label.trim() ? { label: label.trim() } : {}),
                });
                await act(async () => undefined, 'Period added.');
                onClose();
              } catch (e) {
                setError(errorMessage(e, BK_ERRORS));
              }
            }}
          >
            Add Period
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-period">
        <Select
          label="Kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          options={[
            { value: 'MONTH', label: 'Month' },
            { value: 'QUARTER', label: 'Quarter' },
            { value: 'YEAR', label: 'Year' },
            { value: 'CUSTOM', label: 'Custom' },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Starts"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Input label="Ends" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        {kind === 'CUSTOM' ? (
          <Input label="Name" value={label} onChange={(e) => setLabel(e.target.value)} />
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Reconciliation tab: the client's periods, each opening its close checklist and reconciliations. */
export function PeriodsTab({ w, onNotice }: { w: BookkeepingClientWorkspace; onNotice: Notice }) {
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const list = useApiQuery([...BK_KEY, 'periods', w.id, page], () =>
    api.bookkeeping.periods(w.id, { page, pageSize: 12 }),
  );
  const columns: Column<BookkeepingPeriodSummary>[] = [
    {
      id: 'label',
      label: 'Period',
      cell: (p) => (
        <Link
          href={`/bookkeeping/periods/${p.id}`}
          data-testid="period-link"
          className="font-semibold text-link hover:underline"
        >
          {p.label}
        </Link>
      ),
    },
    { id: 'status', label: 'Status', cell: (p) => <PeriodPill status={p.status} /> },
    {
      id: 'close',
      label: 'Close By',
      cell: (p) =>
        p.closeByOn ? (
          <span className={p.overdue ? 'font-medium text-danger' : ''}>{dayText(p.closeByOn)}</span>
        ) : (
          '—'
        ),
    },
    {
      id: 'progress',
      label: 'Checklist',
      cell: (p) => `${p.progress.done} of ${p.progress.total}`,
    },
    { id: 'income', label: 'Income', cell: (p) => moneyWhole(p.incomeCents) },
    { id: 'exp', label: 'Expenses', cell: (p) => moneyWhole(p.expensesCents) },
    { id: 'net', label: 'Net Profit', cell: (p) => moneyWhole(p.netProfitCents) },
  ];
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label="Periods"
      data-testid="periods-tab"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-heading">
          Periods &amp; Reconciliation
        </h2>
        <button type="button" className={outlined} onClick={() => setAdding(true)}>
          <Plus aria-hidden weight="bold" className="size-4" /> Add Period
        </button>
      </div>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(p) => p.id}
          caption="Periods"
          dense
          noun="periods"
          pageSize={12}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Periods are not available' : 'No periods yet'}
          emptyText={
            list.isError
              ? 'We could not load the periods. Try again in a moment.'
              : 'Add the first period to start the close.'
          }
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 12 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
        />
      </div>
      {adding ? (
        <AddPeriodDialog w={w} onClose={() => setAdding(false)} onNotice={onNotice} />
      ) : null}
    </section>
  );
}

function AddReportDialog({
  w,
  onClose,
  onNotice,
}: {
  w: BookkeepingClientWorkspace;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [type, setType] = useState<(typeof REPORT_TYPES)[number][0]>('PROFIT_LOSS');
  const [custom, setCustom] = useState('');
  const [period, setPeriod] = useState(w.currentPeriod?.label ?? '');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string>();
  return (
    <Modal
      open
      title="Generate Report"
      subtitle={w.client.displayName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!period.trim() || (type === 'CUSTOM' && !custom.trim())}
            onClick={async () => {
              try {
                await api.bookkeeping.addReport(w.id, {
                  reportType: type,
                  ...(type === 'CUSTOM' ? { customName: custom.trim() } : {}),
                  periodLabel: period.trim(),
                  ...(w.currentPeriod ? { periodId: w.currentPeriod.id } : {}),
                  ...(due ? { dueOn: due } : {}),
                });
                await act(async () => undefined, 'Report added.');
                onClose();
              } catch (e) {
                setError(errorMessage(e, BK_ERRORS));
              }
            }}
          >
            Add Report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-report">
        <Select
          label="Report"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          options={REPORT_TYPES.map(([value, label]) => ({ value, label }))}
        />
        {type === 'CUSTOM' ? (
          <Input label="Name" value={custom} onChange={(e) => setCustom(e.target.value)} />
        ) : null}
        <Input label="Period" value={period} onChange={(e) => setPeriod(e.target.value)} />
        <Input
          label="Due (optional)"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function reportColumns(withClient: boolean): Column<BookkeepingReportRow>[] {
  const client: Column<BookkeepingReportRow>[] = withClient
    ? [
        {
          id: 'client',
          label: 'Client',
          cell: (r) => (
            <Link
              href={'/bookkeeping/clients/' + r.bookkeepingClientId}
              className="font-medium text-link hover:underline"
            >
              {r.client.displayName}
            </Link>
          ),
        },
      ]
    : [];
  return [
    ...client,
    {
      id: 'name',
      label: 'Report',
      cell: (r) => <span className="font-medium text-heading">{r.name}</span>,
    },
    { id: 'period', label: 'Period', cell: (r) => r.periodLabel },
    {
      id: 'basis',
      label: 'Basis',
      cell: (r) => (r.basis ? (r.basis === 'CASH' ? 'Cash' : 'Accrual') : '—'),
    },
    {
      id: 'due',
      label: 'Due',
      cell: (r) =>
        r.dueOn ? (
          <span className={r.overdue ? 'font-medium text-danger' : ''}>{dayText(r.dueOn)}</span>
        ) : (
          '—'
        ),
    },
    { id: 'status', label: 'Status', cell: (r) => <ReportPill status={r.status} /> },
  ];
}

/** Reports tab: this client's reports and their review. */
export function ReportsTab({ w, onNotice }: { w: BookkeepingClientWorkspace; onNotice: Notice }) {
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const list = useApiQuery([...BK_KEY, 'client-reports', w.id, page], () =>
    api.bookkeeping.clientReports(w.id, { page, pageSize: 10 }),
  );
  const columns = reportColumns(false);
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label="Reports"
      data-testid="reports-tab"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-bold text-heading">Reports</h2>
        <button type="button" className={primary} onClick={() => setAdding(true)}>
          <Plus aria-hidden weight="bold" className="size-4" /> Generate Report
        </button>
      </div>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Reports"
          dense
          noun="reports"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Reports are not available' : 'No reports yet'}
          emptyText={
            list.isError
              ? 'We could not load the reports. Try again in a moment.'
              : 'Generate the first report for this client.'
          }
          rowActions={(r) => (
            <ReportMenu row={r} engagementId={w.engagementId} onNotice={onNotice} />
          )}
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
        />
      </div>
      {adding ? (
        <AddReportDialog w={w} onClose={() => setAdding(false)} onNotice={onNotice} />
      ) : null}
    </section>
  );
}

/** Settings tab: cadence, portal defaults, alerts, categorization rules and the client's accounts. */
export function SettingsTab({ w, onNotice }: { w: BookkeepingClientWorkspace; onNotice: Notice }) {
  const act = useAct(onNotice);
  const [cadence, setCadence] = useState(w.cadence);
  const [closeDay, setCloseDay] = useState(String(w.closeTargetDay));
  const [portal, setPortal] = useState(w.portalDefaults);
  const [alerts, setAlerts] = useState(w.alerts);
  const [rules, setRules] = useState(w.categorizationRules);
  const [acct, setAcct] = useState({
    name: '',
    type: 'BANK' as 'BANK' | 'CREDIT_CARD' | 'LOAN' | 'OTHER',
    mask: '',
  });
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2" data-testid="settings-tab">
      <section className={`${card} flex flex-col gap-3`} aria-label="Client bookkeeping settings">
        <h2 className="font-display text-lg font-bold text-heading">Bookkeeping Settings</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Report cadence"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as typeof cadence)}
            options={[
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'QUARTERLY', label: 'Quarterly' },
              { value: 'ANNUAL', label: 'Annual' },
              { value: 'CUSTOM', label: 'Custom' },
            ]}
          />
          <Input
            label="Close by day of month"
            type="number"
            value={closeDay}
            onChange={(e) => setCloseDay(e.target.value)}
          />
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-heading">
            Shown in the client portal
          </legend>
          {(['reports', 'tasks', 'documents', 'notes'] as const).map((k) => (
            <Checkbox
              key={k}
              label={k.charAt(0).toUpperCase() + k.slice(1)}
              checked={!!portal[k]}
              onChange={(e) => setPortal({ ...portal, [k]: e.target.checked })}
            />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-heading">Alerts</legend>
          {(
            [
              ['missingDocuments', 'Missing documents'],
              ['staleSync', 'Stale sync'],
              ['overdueClose', 'Overdue close'],
              ['failedIntegration', 'Failed integration'],
            ] as const
          ).map(([k, label]) => (
            <Checkbox
              key={k}
              label={label}
              checked={!!alerts[k]}
              onChange={(e) => setAlerts({ ...alerts, [k]: e.target.checked })}
            />
          ))}
        </fieldset>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-heading">Categorization rules</h3>
          {rules.length === 0 ? <p className={quiet}>No rules yet.</p> : null}
          {rules.map((r, i) => (
            <div
              key={`${r.match}-${i}`}
              className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
            >
              <Input
                label="Description contains"
                value={r.match}
                onChange={(e) =>
                  setRules(rules.map((x, j) => (j === i ? { ...x, match: e.target.value } : x)))
                }
              />
              <Input
                label="Category"
                value={r.category}
                onChange={(e) =>
                  setRules(rules.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))
                }
              />
              <button
                type="button"
                aria-label={`Remove rule ${i + 1}`}
                onClick={() => setRules(rules.filter((_, j) => j !== i))}
                className="flex size-10 items-center justify-center rounded-control text-danger hover:bg-danger-soft"
              >
                <Trash aria-hidden weight="bold" className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-link"
            onClick={() => setRules([...rules, { match: '', category: '' }])}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add rule
          </button>
        </div>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await act(
              () =>
                api.bookkeeping.updateClient(w.id, {
                  cadence,
                  closeTargetDay: Number(closeDay) || null,
                  portalDefaults: portal,
                  alerts,
                  categorizationRules: rules.filter((r) => r.match.trim() && r.category.trim()),
                }),
              'Settings saved.',
            );
            setBusy(false);
          }}
        >
          Save Settings
        </Button>
      </section>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Accounts"
        data-testid="manage-accounts"
      >
        <h2 className="font-display text-lg font-bold text-heading">Accounts</h2>
        {w.accounts.filter((a) => !a.archived).length === 0 ? (
          <p className={quiet}>No accounts yet.</p>
        ) : null}
        <ul>
          {w.accounts
            .filter((a) => !a.archived)
            .map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-heading">{a.name}</span>
                  <span className="block text-xs text-muted">
                    {a.institution ?? '—'}
                    {a.mask ? ` ••${a.mask}` : ''} ·{' '}
                    {a.reconcile ? 'Reconciled each period' : 'Not reconciled'}
                  </span>
                </span>
                <span className="flex gap-3">
                  <button
                    type="button"
                    className="text-sm font-medium text-link"
                    onClick={() =>
                      void act(
                        () => api.bookkeeping.updateAccount(a.id, { reconcile: !a.reconcile }),
                        a.reconcile ? 'Reconciliation turned off.' : 'Reconciliation turned on.',
                      )
                    }
                  >
                    {a.reconcile ? 'Skip reconcile' : 'Reconcile'}
                  </button>
                  <button
                    type="button"
                    className="text-sm font-medium text-danger"
                    onClick={() =>
                      void act(
                        () => api.bookkeeping.updateAccount(a.id, { archived: true }),
                        'Account archived.',
                      )
                    }
                  >
                    Archive
                  </button>
                </span>
              </li>
            ))}
        </ul>
        <div className="grid gap-3 border-t border-divider pt-3 sm:grid-cols-3">
          <Input
            label="Account name"
            value={acct.name}
            onChange={(e) => setAcct({ ...acct, name: e.target.value })}
          />
          <Select
            label="Type"
            value={acct.type}
            onChange={(e) => setAcct({ ...acct, type: e.target.value as typeof acct.type })}
            options={[
              { value: 'BANK', label: 'Bank' },
              { value: 'CREDIT_CARD', label: 'Credit Card' },
              { value: 'LOAN', label: 'Loan' },
              { value: 'OTHER', label: 'Other' },
            ]}
          />
          <Input
            label="Last 4 digits (optional)"
            value={acct.mask}
            onChange={(e) => setAcct({ ...acct, mask: e.target.value })}
          />
        </div>
        <Button
          variant="secondary"
          disabled={!acct.name.trim()}
          onClick={async () => {
            const ok = await act(
              () =>
                api.bookkeeping.addAccount(w.id, {
                  name: acct.name.trim(),
                  type: acct.type,
                  ...(acct.mask.trim() ? { mask: acct.mask.trim() } : {}),
                }),
              'Account added.',
            );
            if (ok) setAcct({ name: '', type: 'BANK', mask: '' });
          }}
        >
          Add Account
        </Button>
        <p className="text-xs text-muted">
          Connected software:{' '}
          {w.connections
            .map((k) => (BOOKKEEPING_PROVIDERS as Record<string, string>)[k.provider] ?? k.provider)
            .join(', ') || 'none'}
          . Use Client Actions › Manage Accounting Connection to change it.
        </p>
      </section>
    </div>
  );
}
