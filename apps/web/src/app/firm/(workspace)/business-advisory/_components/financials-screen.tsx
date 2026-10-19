'use client';

import type { AdvisoryFinancialPage } from '@firmivra/types';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  type Column,
} from '@firmivra/ui';
import { Lock, Plus, Warning } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { ErrorLine } from './ba-dialogs';
import { FilterSelect, serverPaging, useAct } from './ba-list-kit';
import { BaShell, Disclaimer } from './ba-shell';
import {
  BASE,
  BA_KEY,
  SOURCE,
  card,
  centsOf,
  dayText,
  errorText,
  money,
  primary,
  today,
} from './ba-shared';

const SIZE = 10;
type Row = AdvisoryFinancialPage['items'][number];

/** One summary figure over the filtered rows; "—" when no row has it. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-canvas px-4 py-3">
      <span className="text-xs font-medium tracking-wide text-muted uppercase">{label}</span>
      <span
        className={`text-xl font-bold ${tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-heading'}`}
      >
        {value}
      </span>
    </div>
  );
}

/** Revenue against its budget: the difference and the share of budget reached. */
function BudgetCell({ r }: { r: Row }) {
  if (r.revenueCents === null || !r.budgetRevenueCents)
    return <span className="text-muted">—</span>;
  const diff = r.revenueCents - r.budgetRevenueCents;
  const pct = Math.round((r.revenueCents / r.budgetRevenueCents) * 100);
  return (
    <span className={`flex flex-col leading-snug ${diff >= 0 ? 'text-success' : 'text-danger'}`}>
      <span>
        {diff >= 0 ? '+' : ''}
        {money(diff)}
      </span>
      <span className="text-xs">{pct}% of budget</span>
    </span>
  );
}

/** /business-advisory/financial-analysis: revenue, expenses, profit, margin, cash flow and budget vs actual. */
export function FinancialAnalysis() {
  const { toast, say } = useAct();
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const [clientId, setClientId] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [history, setHistory] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const q = useApiQuery([...BA_KEY, 'financials', clientId, source, from, to, history, page], () =>
    api.advisory.financials({
      ...(clientId ? { advisoryClientId: clientId } : {}),
      ...(source ? { source: source as never } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(history ? { includeSuperseded: true } : {}),
      page,
      pageSize: SIZE,
    }),
  );
  const restricted = errorCode(q.error) === 'FINANCIALS_RESTRICTED';
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };
  const s = q.data?.summary;
  const stale = (q.data?.items ?? []).filter((r) => r.stale).length;

  const cols: Column<Row>[] = [
    {
      id: 'client',
      label: 'Client',
      cell: (r) => (
        <Link
          href={`${BASE}/clients/${r.advisoryClientId}/financials`}
          className="font-semibold text-heading hover:underline"
        >
          {r.client.name}
        </Link>
      ),
    },
    {
      id: 'period',
      label: 'Period',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <span className="flex flex-col leading-snug">
          <span>{dayText(r.periodStart)}</span>
          <span className="text-muted">to {dayText(r.periodEnd)}</span>
        </span>
      ),
    },
    {
      id: 'revenue',
      label: 'Revenue',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.revenueCents),
    },
    {
      id: 'expenses',
      label: 'Expenses',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.expensesCents),
    },
    {
      id: 'profit',
      label: 'Net Profit',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.netProfitCents),
    },
    {
      id: 'margin',
      label: 'Margin',
      className: 'whitespace-nowrap',
      cell: (r) => (r.marginPercent === null ? '—' : `${r.marginPercent}%`),
    },
    {
      id: 'cash',
      label: 'Cash Flow',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.cashFlowCents),
    },
    {
      id: 'budget',
      label: 'Budget vs Actual',
      className: 'whitespace-nowrap',
      cell: (r) => <BudgetCell r={r} />,
    },
    {
      id: 'source',
      label: 'Source',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone="info">{SOURCE[r.source] ?? r.source}</Badge>
          {r.overridden ? (
            <span title={r.overrideReason ?? undefined}>
              <Badge tone="warning">Overridden</Badge>
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'asof',
      label: 'Last Updated',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <span>{dayText(r.asOf)}</span>
          {r.stale ? <Badge tone="danger">Stale</Badge> : null}
        </span>
      ),
    },
  ];

  return (
    <BaShell>
      {toast}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Financial analysis"
        data-testid="ba-financials"
      >
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label="Client"
            all="All Clients"
            value={clientId}
            onChange={filter(setClientId)}
            options={(clients.data?.items ?? []).map((c) => ({
              value: c.id,
              label: c.client.name,
            }))}
          />
          <FilterSelect
            label="Source"
            all="All Sources"
            value={source}
            onChange={filter(setSource)}
            options={Object.entries(SOURCE).map(([value, label]) => ({ value, label }))}
          />
          <span className="flex items-center gap-2">
            <span aria-hidden className="text-sm text-muted">
              From
            </span>
            <Input
              label="Period from"
              hideLabel
              type="date"
              value={from}
              onChange={(e) => filter(setFrom)(e.target.value)}
            />
            <span aria-hidden className="text-sm text-muted">
              to
            </span>
            <Input
              label="Period to"
              hideLabel
              type="date"
              value={to}
              onChange={(e) => filter(setTo)(e.target.value)}
            />
          </span>
          <Checkbox
            label="Show corrections"
            checked={history}
            onChange={(e) => {
              setHistory(e.target.checked);
              setPage(1);
            }}
          />
          <button
            type="button"
            className={`${primary} ml-auto`}
            disabled={q.isError}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Figures
          </button>
        </div>

        {restricted ? (
          <Callout icon={Lock} title="Financial figures are restricted" surface="plain">
            Your role does not include &quot;View financial analysis&quot;. Ask an Owner or Admin
            for access.
          </Callout>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="financial-summary">
              <Stat label="Revenue" value={money(s?.revenueCents)} />
              <Stat label="Expenses" value={money(s?.expensesCents)} />
              <Stat
                label="Net Profit"
                value={money(s?.netProfitCents)}
                {...(s?.netProfitCents != null
                  ? { tone: s.netProfitCents >= 0 ? ('good' as const) : ('bad' as const) }
                  : {})}
              />
              <Stat
                label="Revenue vs Budget"
                value={
                  s?.budgetVarianceCents == null
                    ? '—'
                    : `${s.budgetVarianceCents >= 0 ? '+' : ''}${money(s.budgetVarianceCents)}`
                }
                {...(s?.budgetVarianceCents != null
                  ? { tone: s.budgetVarianceCents >= 0 ? ('good' as const) : ('bad' as const) }
                  : {})}
              />
            </div>
            {stale ? (
              <Callout
                icon={Warning}
                title="Some figures are out of date"
                surface="warning"
                size="compact"
              >
                {stale === 1 ? '1 row on this page is' : `${stale} rows on this page are`} older
                than the firm&apos;s freshness setting. Review them and add current figures.
              </Callout>
            ) : null}
            <Table
              rows={q.data?.items ?? []}
              columns={cols}
              rowKey={(r) => r.id}
              caption="Financial snapshots"
              dense
              noun="snapshots"
              pageSize={SIZE}
              loading={q.isPending}
              emptyTitle={
                q.isError ? 'Financial figures are not available' : 'No financial figures'
              }
              emptyText={
                q.isError
                  ? 'We could not load them. Try again in a moment.'
                  : clientId || source || from || to
                    ? 'Try another filter.'
                    : 'Add figures for an advisory client, or connect a source.'
              }
              server={serverPaging(q.data, SIZE, page, setPage)}
            />
          </>
        )}
        {q.data?.items.length ? (
          <Disclaimer text="Figures come from the source named on each row. Projections and health scores are advisory tools, not guarantees." />
        ) : null}
      </section>
      {adding ? (
        <AddFiguresDialog
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false);
            say(`Figures added for ${name}.`);
          }}
        />
      ) : null}
    </BaShell>
  );
}

const MONEY_FIELDS = [
  ['revenue', 'Revenue ($)'],
  ['expenses', 'Expenses ($)'],
  ['netProfit', 'Net profit ($, optional: revenue minus expenses)'],
  ['cashFlow', 'Cash flow ($)'],
  ['debt', 'Debt / liabilities ($)'],
  ['budgetRevenue', 'Budget revenue ($)'],
  ['budgetExpenses', 'Budget expenses ($)'],
] as const;
type MoneyKey = (typeof MONEY_FIELDS)[number][0];

/** Add a period's figures for an advisory client; replacing a source's figures needs a reason. */
export function AddFiguresDialog({
  advisoryClientId: preset,
  onClose,
  onAdded,
}: {
  advisoryClientId?: string;
  onClose: () => void;
  onAdded: (clientName: string) => void;
}) {
  const qc = useQueryClient();
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const [clientId, setClientId] = useState(preset ?? '');
  const [start, setStart] = useState(() => `${new Date().getFullYear() - 1}-01-01`);
  const [end, setEnd] = useState(() => `${new Date().getFullYear() - 1}-12-31`);
  const [amounts, setAmounts] = useState<Record<MoneyKey, string>>({
    revenue: '',
    expenses: '',
    netProfit: '',
    cashFlow: '',
    debt: '',
    budgetRevenue: '',
    budgetExpenses: '',
  });
  const [headcount, setHeadcount] = useState('');
  const [source, setSource] = useState('MANUAL');
  const [asOf, setAsOf] = useState(today);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const cents = Object.fromEntries(MONEY_FIELDS.map(([k]) => [k, centsOf(amounts[k])])) as Record<
      MoneyKey,
      number | undefined
    >;
    if (Object.values(cents).some((v) => v !== undefined && Number.isNaN(v))) {
      setError('Enter amounts as numbers, for example 125000.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      const put = (key: string, v: number | undefined) => (v === undefined ? {} : { [key]: v });
      await api.advisory.addFinancial(clientId, {
        periodStart: start,
        periodEnd: end,
        asOf,
        source: source as never,
        ...put('revenueCents', cents.revenue),
        ...put('expensesCents', cents.expenses),
        ...put('netProfitCents', cents.netProfit),
        ...put('cashFlowCents', cents.cashFlow),
        ...put('debtCents', cents.debt),
        ...put('budgetRevenueCents', cents.budgetRevenue),
        ...put('budgetExpensesCents', cents.budgetExpenses),
        ...(headcount.trim() ? { headcount: Math.round(Number(headcount)) } : {}),
        ...(reason.trim() ? { override: { reason: reason.trim() } } : {}),
      });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onAdded(clients.data?.items.find((c) => c.id === clientId)?.client.name ?? 'the client');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Add Financial Figures"
      subtitle="One period for one client. Later figures for the same period replace these; both are kept."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!clientId || !start || !end || !asOf || saving}
            onClick={() => void save()}
          >
            Add Figures
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-figures">
        <ErrorLine text={error} />
        <Select
          label="Advisory client"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[
            {
              value: '',
              label: clients.isError ? 'Advisory clients could not be loaded' : 'Choose a client…',
            },
            ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.client.name })),
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Period start"
            type="date"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Input
            label="Period end"
            type="date"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          {MONEY_FIELDS.map(([key, label]) => (
            <Input
              key={key}
              label={label}
              inputMode="decimal"
              value={amounts[key]}
              onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
            />
          ))}
          <Input
            label="Employees"
            inputMode="numeric"
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
          />
          <Select
            label="Source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            options={Object.entries(SOURCE).map(([value, label]) => ({ value, label }))}
          />
          <Input
            label="As of"
            type="date"
            required
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        <Textarea
          label="Override reason (only when replacing figures from a source)"
          rows={2}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-xs text-muted">
          A manual change to figures from bookkeeping, payroll or a bank is kept with its reason and
          who made it.
        </p>
      </div>
    </Modal>
  );
}
