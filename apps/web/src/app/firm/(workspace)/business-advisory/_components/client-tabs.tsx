'use client';

import type { AdvisoryFinancialPage, AdvisoryPlanRow, AdvisoryVersionRow } from '@firmivra/types';
import { Badge, Callout, Checkbox, ChecklistCard, Table, type Column } from '@firmivra/ui';
import {
  ArrowRight,
  ChartBar,
  ChartLineUp,
  ClockCounterClockwise,
  FileText,
  Lock,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  SealCheck,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ActionItemsSection, RecommendationsSection } from './action-plans-screen';
import { useAct } from './ba-list-kit';
import {
  AREA_LABEL,
  BASE,
  BA_KEY,
  PlanStatusPill,
  SOURCE,
  SectionHead,
  card,
  dayText,
  money,
  outlined,
  primary,
  quiet,
} from './ba-shared';
import { HealthFactors } from './client-overview';
import { ClientShell, useAdvisoryClient } from './client-shell';
import { AddFiguresDialog, BudgetCell } from './financials-screen';
import { GoalsList } from './goals-screen';
import { STEPS, stepHref } from './plan-frame';
import { readiness } from './plan-steps';
import { SendPlanDialog } from './plans-screen';

const CHANNEL: Record<string, string> = {
  portal: 'Client portal',
  email: 'Email',
  download: 'Download',
};

// ---------- Business Plan ----------

/** /business-advisory/clients/[clientId]/plan: the current plan and its versions, and every plan of the client. */
export function ClientPlanTab({ advisoryClientId }: { advisoryClientId: string }) {
  const client = useAdvisoryClient(advisoryClientId);
  const c = client.data;
  const currentId = c?.currentPlan?.id;
  const { toast, say } = useAct();
  const [sending, setSending] = useState<AdvisoryPlanRow>();
  const plans = useApiQuery([...BA_KEY, 'client-plans', advisoryClientId], () =>
    api.advisory.plans({ advisoryClientId, includeArchived: true, pageSize: 50 }),
  );
  const plan = useApiQuery([...BA_KEY, 'plan', currentId], () =>
    currentId ? api.advisory.plan(currentId) : Promise.resolve(null),
  );
  const versions = useApiQuery([...BA_KEY, 'versions', currentId], () =>
    currentId ? api.advisory.versions(currentId) : Promise.resolve(null),
  );
  const p = plan.data;
  const checks = p ? readiness(p) : [];
  const failed = client.isError || plans.isError;

  const planCols: Column<AdvisoryPlanRow>[] = [
    {
      id: 'name',
      label: 'Plan',
      cell: (r) => (
        <Link
          href={`${BASE}/plans/${r.id}/edit`}
          className="font-semibold text-link hover:underline"
        >
          {r.name}
        </Link>
      ),
    },
    { id: 'year', label: 'Year', cell: (r) => r.targetYear },
    { id: 'type', label: 'Type', cell: (r) => r.planType ?? '—' },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <PlanStatusPill status={r.status} />,
    },
    {
      id: 'version',
      label: 'Version',
      cell: (r) => (r.currentVersion ? `v${r.currentVersion}` : '—'),
    },
    {
      id: 'updated',
      label: 'Last Updated',
      className: 'whitespace-nowrap',
      cell: (r) => dayText(r.updatedAt),
    },
  ];
  const versionCols: Column<AdvisoryVersionRow>[] = [
    {
      id: 'n',
      label: 'Version',
      cell: (v) => <span className="font-semibold text-heading">Version {v.versionNo}</span>,
    },
    {
      id: 'made',
      label: 'Finalized',
      className: 'whitespace-nowrap',
      cell: (v) => `${dayText(v.createdAt)}${v.createdBy ? ` by ${v.createdBy.name}` : ''}`,
    },
    {
      id: 'asof',
      label: 'Figures as of',
      className: 'whitespace-nowrap',
      cell: (v) => dayText(v.sourceDataAsOf),
    },
    {
      id: 'sent',
      label: 'Delivered',
      className: 'whitespace-nowrap',
      cell: (v) =>
        v.deliveredAt ? (
          <Badge tone="purple">
            {dayText(v.deliveredAt)} · {CHANNEL[v.deliveredChannel ?? ''] ?? v.deliveredChannel}
          </Badge>
        ) : (
          <Badge tone="neutral">Not sent</Badge>
        ),
    },
  ];

  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      {toast}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Current plan" data-testid="tab-current-plan">
          <SectionHead
            icon={FileText}
            title="Current Plan"
            subtitle="The plan the client is working on now."
          />
          {p ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href={stepHref(p.id, 1)}
                  className="font-display text-xl font-bold text-heading hover:underline"
                >
                  {p.name}
                </Link>
                <PlanStatusPill status={p.status} />
              </div>
              <dl className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted">Target year / type</dt>
                <dd className="text-heading">
                  {p.targetYear}
                  {p.planType ? ` · ${p.planType}` : ''}
                </dd>
                <dt className="text-muted">Where it stands</dt>
                <dd className="text-heading">
                  Step {p.step} of 5: {STEPS[p.step - 1]?.label}
                </dd>
                <dt className="text-muted">Strategy</dt>
                <dd className="text-heading">{p.strategy.summary ?? '—'}</dd>
                <dt className="text-muted">Focus areas</dt>
                <dd className="text-heading">
                  {(p.strategy.areas ?? []).map((a) => AREA_LABEL[a.area] ?? a.area).join(', ') ||
                    '—'}
                </dd>
                <dt className="text-muted">Last updated</dt>
                <dd className="text-heading">{dayText(p.updatedAt)}</dd>
              </dl>
              <ChecklistCard
                title={
                  checks.every((x) => x.done) ? 'Ready to finalize' : 'Before it can be finalized'
                }
                items={checks.map(({ id, label, done }) => ({ id, label, done }))}
                marker="check"
                surface={checks.every((x) => x.done) ? 'success' : 'plain'}
              />
              <div className="flex flex-wrap gap-2">
                <Link href={stepHref(p.id, p.step)} className={primary}>
                  <PencilSimple aria-hidden weight="fill" className="size-4" /> Continue Editing
                </Link>
                <Link href={stepHref(p.id, 5)} className={outlined}>
                  <SealCheck aria-hidden weight="fill" className="size-4 text-action" /> Review
                  &amp; Finalize
                </Link>
                {p.canSend && p.currentVersion > 0 ? (
                  <button type="button" className={outlined} onClick={() => setSending(p)}>
                    <PaperPlaneTilt aria-hidden weight="fill" className="size-4 text-action" /> Send
                    to Client
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className={quiet}>
              {failed || plan.isError ? (
                'The plan is not available right now.'
              ) : c && !currentId ? (
                <>
                  No business plan yet.{' '}
                  <Link
                    href={`${BASE}/plans/new?advisoryClientId=${advisoryClientId}`}
                    className="font-medium text-link hover:underline"
                  >
                    Create Business Plan
                  </Link>
                </>
              ) : (
                'Loading…'
              )}
            </p>
          )}
        </section>
        <section className={card} aria-label="Versions" data-testid="tab-versions">
          <SectionHead
            icon={ClockCounterClockwise}
            title="Version History"
            subtitle="A finalized version never changes; each delivery is kept."
          />
          <Table
            rows={versions.data ?? []}
            columns={versionCols}
            rowKey={(v) => String(v.versionNo)}
            caption="Plan versions"
            dense
            noun="versions"
            pageSize={20}
            showPagination={false}
            loading={Boolean(currentId) && versions.isPending}
            emptyTitle={
              versions.isError || failed
                ? 'Versions are not available'
                : 'No finalized versions yet'
            }
            emptyText={
              versions.isError || failed
                ? 'We could not load them.'
                : 'Finalize the plan to keep its first version.'
            }
          />
        </section>
      </div>
      <section className={card} aria-label="All plans" data-testid="tab-plans">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHead
            icon={FileText}
            title="All Business Plans"
            subtitle="Every plan of this client, archived ones too."
          />
          <Link href={`${BASE}/plans/new?advisoryClientId=${advisoryClientId}`} className={primary}>
            <Plus aria-hidden weight="bold" className="size-4" /> Create Business Plan
          </Link>
        </div>
        <Table
          rows={plans.data?.items ?? []}
          columns={planCols}
          rowKey={(r) => r.id}
          caption="Business plans"
          dense
          noun="plans"
          pageSize={50}
          showPagination={false}
          loading={plans.isPending}
          emptyTitle={plans.isError ? 'Plans are not available' : 'No business plans yet'}
          emptyText={
            plans.isError ? 'We could not load them.' : 'Create the first plan for this client.'
          }
        />
      </section>
      {sending ? (
        <SendPlanDialog
          plan={sending}
          onClose={() => setSending(undefined)}
          onSent={() => {
            setSending(undefined);
            say(`${sending.name} sent.`);
          }}
        />
      ) : null}
    </ClientShell>
  );
}

// ---------- Financials ----------

type Fin = AdvisoryFinancialPage['items'][number];

/** Revenue and expenses by period, oldest first, as bars on one scale. */
function TrendBars({ rows }: { rows: Fin[] }) {
  const current = [...rows].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const max = Math.max(1, ...current.flatMap((r) => [r.revenueCents ?? 0, r.expensesCents ?? 0]));
  const bar = (v: number | null, tone: string, label: string) => (
    <span className="flex items-center gap-2">
      <span
        className="h-3 rounded-pill"
        style={{ width: `${Math.max(1, ((v ?? 0) / max) * 100)}%` }}
      >
        <span className={`block h-full rounded-pill ${tone}`} aria-hidden />
      </span>
      <span className="text-xs whitespace-nowrap text-muted">
        {label} {money(v)}
      </span>
    </span>
  );
  return (
    <ul className="flex flex-col gap-3" data-testid="trend-bars">
      {current.map((r) => (
        <li key={r.id} className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-sm">
          <span className="font-semibold text-heading">{r.periodEnd.slice(0, 4)}</span>
          <span className="flex min-w-0 flex-col gap-1">
            {bar(r.revenueCents, 'bg-chart-blue', 'Revenue')}
            {bar(r.expensesCents, 'bg-chart-yellow', 'Expenses')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** /business-advisory/clients/[clientId]/financials: the trend, every period's figures and the health score. */
export function ClientFinancialsTab({ advisoryClientId }: { advisoryClientId: string }) {
  const client = useAdvisoryClient(advisoryClientId);
  const c = client.data;
  const { toast, say } = useAct();
  const [history, setHistory] = useState(false);
  const [adding, setAdding] = useState(false);
  const q = useApiQuery(
    [...BA_KEY, 'client-financials', advisoryClientId, history, c?.canViewFinancials],
    () =>
      c?.canViewFinancials
        ? api.advisory.financials({
            advisoryClientId,
            pageSize: 50,
            ...(history ? { includeSuperseded: true } : {}),
          })
        : Promise.resolve(null),
  );
  const rows = q.data?.items ?? [];
  const stale = rows.some((r) => r.stale);
  const restricted = c ? !c.canViewFinancials : false;
  const failed = client.isError || q.isError;
  const cols: Column<Fin>[] = [
    {
      id: 'period',
      label: 'Period',
      className: 'whitespace-nowrap',
      cell: (r) => `${dayText(r.periodStart)} – ${dayText(r.periodEnd)}`,
    },
    {
      id: 'rev',
      label: 'Revenue',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.revenueCents),
    },
    {
      id: 'exp',
      label: 'Expenses',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.expensesCents),
    },
    {
      id: 'net',
      label: 'Net Profit',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.netProfitCents),
    },
    {
      id: 'margin',
      label: 'Margin',
      cell: (r) => (r.marginPercent === null ? '—' : `${r.marginPercent}%`),
    },
    {
      id: 'cash',
      label: 'Cash Flow',
      className: 'whitespace-nowrap',
      cell: (r) => money(r.cashFlowCents),
    },
    { id: 'debt', label: 'Debt', className: 'whitespace-nowrap', cell: (r) => money(r.debtCents) },
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
          {r.overridden ? <Badge tone="warning">Overridden</Badge> : null}
        </span>
      ),
    },
    {
      id: 'asof',
      label: 'As of',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          {dayText(r.asOf)}
          {r.stale ? <Badge tone="danger">Stale</Badge> : null}
        </span>
      ),
    },
  ];
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      {toast}
      {restricted ? (
        <Callout icon={Lock} title="Financial figures are restricted" surface="plain">
          Your role does not include &quot;View financial analysis&quot;. The health score below
          still shows its factors.
        </Callout>
      ) : null}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Financial trend" data-testid="tab-trend">
          <SectionHead
            icon={ChartLineUp}
            title="Financial Trend"
            subtitle="Revenue and expenses by period, from the current figures."
          />
          {rows.length && !history ? (
            <TrendBars rows={rows} />
          ) : (
            <p className={quiet}>
              {failed
                ? 'The trend is not available right now.'
                : restricted
                  ? 'Restricted.'
                  : history
                    ? 'Hide corrections to see the trend.'
                    : q.isPending && c
                      ? 'Loading…'
                      : 'No figures yet.'}
            </p>
          )}
        </section>
        <section className={card} aria-label="Business health score" data-testid="tab-health">
          <SectionHead
            icon={ChartBar}
            title="Business Health Score"
            subtitle="Worked out from the firm's formula; its factors and data age."
          />
          {c ? (
            <HealthFactors client={c} />
          ) : (
            <p className={quiet}>{failed ? 'Not available right now.' : 'Loading…'}</p>
          )}
        </section>
      </div>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Financial figures"
        data-testid="tab-figures"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHead
            icon={FileText}
            title="Financial Figures"
            subtitle="Each period with its source and date; a correction keeps the earlier row."
          />
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox
              label="Show corrections"
              checked={history}
              disabled={restricted}
              onChange={(e) => setHistory(e.target.checked)}
            />
            <button
              type="button"
              className={primary}
              disabled={restricted || failed}
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Add Figures
            </button>
          </div>
        </div>
        {stale ? (
          <Callout
            icon={Warning}
            title="Some figures are out of date"
            surface="warning"
            size="compact"
          >
            Review them and add current figures before the plan is finalized.
          </Callout>
        ) : null}
        <Table
          rows={rows}
          columns={cols}
          rowKey={(r) => r.id}
          caption="Financial figures"
          dense
          noun="periods"
          pageSize={50}
          showPagination={false}
          loading={Boolean(c?.canViewFinancials) && q.isPending}
          emptyTitle={
            failed
              ? 'Figures are not available'
              : restricted
                ? 'Figures are restricted'
                : 'No figures yet'
          }
          emptyText={
            failed
              ? 'We could not load them.'
              : restricted
                ? 'Your role cannot view them.'
                : 'Add figures, or connect bookkeeping, payroll or a bank.'
          }
        />
        <Link
          href={`${BASE}/financial-analysis`}
          className="inline-flex items-center gap-1 self-start text-sm font-medium text-link hover:underline"
        >
          Compare with other clients in Financial Analysis{' '}
          <ArrowRight aria-hidden weight="bold" className="size-4" />
        </Link>
      </section>
      {adding ? (
        <AddFiguresDialog
          advisoryClientId={advisoryClientId}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            say('Figures added.');
          }}
        />
      ) : null}
    </ClientShell>
  );
}

// ---------- Goals, recommendations, tasks: the module's lists for this client ----------

export function ClientGoalsTab({ advisoryClientId }: { advisoryClientId: string }) {
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <GoalsList advisoryClientId={advisoryClientId} />
    </ClientShell>
  );
}

export function ClientRecommendationsTab({ advisoryClientId }: { advisoryClientId: string }) {
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <RecommendationsSection advisoryClientId={advisoryClientId} />
    </ClientShell>
  );
}

export function ClientTasksTab({ advisoryClientId }: { advisoryClientId: string }) {
  return (
    <ClientShell advisoryClientId={advisoryClientId}>
      <ActionItemsSection advisoryClientId={advisoryClientId} />
    </ClientShell>
  );
}
