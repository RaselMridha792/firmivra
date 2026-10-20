'use client';

import type { AdvisoryPlanDetail } from '@firmivra/types';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  ChecklistCard,
  Input,
  Select,
  Table,
  Textarea,
  Toast,
  type Column,
} from '@firmivra/ui';
import {
  ArrowRight,
  Briefcase,
  ChartLineUp,
  ClockCounterClockwise,
  Coins,
  FileText,
  Flag,
  Gear,
  ListChecks,
  Lock,
  PaperPlaneTilt,
  Plus,
  SealCheck,
  Storefront,
  Target,
  Warning,
  X,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { AddActionItemDialog, AddRecommendationDialog } from './action-plans-screen';
import { AddGoalDialog } from './ba-dialogs';
import { Disclaimer } from './ba-shell';
import {
  ASSIGNEE_KIND,
  AREA_LABEL,
  ActionStatusPill,
  BASE,
  BA_KEY,
  GoalStatusPill,
  PlanStatusPill,
  PriorityPill,
  ProgressBar,
  RecStatusPill,
  SOURCE,
  SectionHead,
  card,
  centsOf,
  dayText,
  errorText,
  money,
  outlined,
  quiet,
} from './ba-shared';
import { AddFiguresDialog } from './financials-screen';
import { EditGoalDialog } from './goals-screen';
import { WizardFrame, stepHref, useStepSave } from './plan-frame';
import { SendPlanDialog, VersionsDialog } from './plans-screen';

type Plan = AdvisoryPlanDetail;
const orNull = (v: string) => v.trim() || null;

/** Steps without fields of their own still record where the author is. */
function useMove(plan: Plan) {
  const router = useRouter();
  const s = useStepSave(plan);
  const to = async (n: number) => {
    if (await s.save({ step: Math.max(plan.step, n) })) router.push(stepHref(plan.id, n));
  };
  return { ...s, to };
}

// ---------- Step 2: Financial & Business Assessment ----------

/** A list of short lines (strengths, challenges): type one, add it, remove any. */
function LineList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [text, setText] = useState('');
  const add = () => {
    const t = text.trim();
    if (t && !items.includes(t) && items.length < 30) onChange([...items, t]);
    setText('');
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-text">{label}</legend>
      <ul className="flex flex-wrap gap-2">
        {items.map((it) => (
          <li
            key={it}
            className="inline-flex items-center gap-1 rounded-pill bg-info-soft px-3 py-1 text-sm text-heading"
          >
            {it}
            <button
              type="button"
              aria-label={`Remove ${it}`}
              onClick={() => onChange(items.filter((x) => x !== it))}
              className="text-muted hover:text-danger"
            >
              <X aria-hidden weight="bold" className="size-3.5" />
            </button>
          </li>
        ))}
        {items.length === 0 ? <li className="text-sm text-muted">None yet.</li> : null}
      </ul>
      <div className="flex items-end gap-2">
        <Input
          label={`Add to ${label.toLowerCase()}`}
          hideLabel
          value={text}
          maxLength={300}
          placeholder={`Add one…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          variant="secondary"
          onClick={add}
          disabled={!text.trim()}
          aria-label={`Add to ${label.toLowerCase()}`}
        >
          <Plus aria-hidden weight="bold" className="size-4" />
        </Button>
      </div>
    </fieldset>
  );
}

export function AssessmentStep({ plan }: { plan: Plan }) {
  const router = useRouter();
  const { save, saving, error, setError, reload } = useStepSave(plan);
  const a = plan.assessment;
  const start = () => ({
    amount: a.funding?.amountNeededCents == null ? '' : String(a.funding.amountNeededCents / 100),
    purpose: a.funding?.purpose ?? '',
    timing: a.funding?.timing ?? '',
    readiness: a.funding?.readiness ?? '',
    customers: a.sales?.customers ?? '',
    salesTrend: a.sales?.salesTrend ?? '',
    targetMarket: a.sales?.targetMarket ?? '',
    competitors: a.sales?.competitors ?? '',
    differentiation: a.sales?.differentiation ?? '',
    systems: a.operations?.systemsChallenges ?? '',
    staffing: a.operations?.staffing ?? '',
    efficiency: a.operations?.efficiencyOpportunities ?? '',
    strengths: a.strengths ?? [],
    challenges: a.challenges ?? [],
    dataSource: a.dataSource ?? '',
  });
  const [form, setForm] = useState(start);
  const [initial] = useState(() => JSON.stringify(start()));
  const [adding, setAdding] = useState(false);
  const set = (k: keyof ReturnType<typeof start>) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const persist = async (n: number) => {
    const amount = centsOf(form.amount);
    if (amount !== undefined && Number.isNaN(amount)) {
      setError('Enter the funding amount as a number, for example 250000.');
      return false;
    }
    return save({
      step: Math.max(plan.step, n),
      assessment: {
        funding: {
          amountNeededCents: amount ?? null,
          purpose: orNull(form.purpose),
          timing: orNull(form.timing),
          readiness: orNull(form.readiness),
        },
        sales: {
          customers: orNull(form.customers),
          salesTrend: orNull(form.salesTrend),
          targetMarket: orNull(form.targetMarket),
          competitors: orNull(form.competitors),
          differentiation: orNull(form.differentiation),
        },
        operations: {
          systemsChallenges: orNull(form.systems),
          staffing: orNull(form.staffing),
          efficiencyOpportunities: orNull(form.efficiency),
        },
        strengths: form.strengths,
        challenges: form.challenges,
        ...(form.dataSource ? { dataSource: form.dataSource as never } : {}),
      },
    });
  };
  type Fin = NonNullable<Plan['financials']>[number];
  const cols: Column<Fin>[] = [
    {
      id: 'period',
      label: 'Period',
      className: 'whitespace-nowrap',
      cell: (r) => `${dayText(r.periodStart)} – ${dayText(r.periodEnd)}`,
    },
    { id: 'rev', label: 'Revenue', cell: (r) => money(r.revenueCents) },
    { id: 'exp', label: 'Expenses', cell: (r) => money(r.expensesCents) },
    { id: 'net', label: 'Net Profit', cell: (r) => money(r.netProfitCents) },
    {
      id: 'margin',
      label: 'Margin',
      cell: (r) => (r.marginPercent === null ? '—' : `${r.marginPercent}%`),
    },
    { id: 'cash', label: 'Cash Flow', cell: (r) => money(r.cashFlowCents) },
    { id: 'debt', label: 'Debt', cell: (r) => money(r.debtCents) },
    {
      id: 'source',
      label: 'Source / As of',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone="info">{SOURCE[r.source] ?? r.source}</Badge>
          <span>
            {dayText(r.asOf)} {r.stale ? <Badge tone="danger">Stale</Badge> : null}
          </span>
        </span>
      ),
    },
  ];
  return (
    <WizardFrame
      step={2}
      planId={plan.id}
      saving={saving}
      dirty={JSON.stringify(form) !== initial}
      error={error}
      onReload={reload}
      onSaveDraft={() => persist(2)}
      onNext={() => void persist(3).then((ok) => ok && router.push(stepHref(plan.id, 3)))}
    >
      <section className={card} aria-label="Financial snapshot" data-testid="step-financials">
        <SectionHead
          icon={ChartLineUp}
          title="Financial Snapshot"
          subtitle="Revenue, expenses, profit, cash flow and debt, with each figure's source and date."
        />
        {plan.financials === null ? (
          <Callout icon={Lock} title="Financial figures are restricted" surface="plain">
            Your role does not include &quot;View financial analysis&quot;.
          </Callout>
        ) : (
          <>
            {plan.staleFinancials ? (
              <div className="mb-3">
                <Callout
                  icon={Warning}
                  title="The figures are out of date"
                  surface="warning"
                  size="compact"
                >
                  The latest are as of {dayText(plan.sourceDataAsOf)}. Review them and add current
                  figures before you finalize.
                </Callout>
              </div>
            ) : null}
            <Table
              rows={plan.financials}
              columns={cols}
              rowKey={(r) => r.id}
              caption="Financial figures"
              dense
              noun="periods"
              pageSize={10}
              showPagination={false}
              emptyTitle="No figures yet"
              emptyText="Add figures, or connect bookkeeping, payroll or a bank."
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className={outlined} onClick={() => setAdding(true)}>
                <Plus aria-hidden weight="bold" className="size-4 text-action" /> Add Figures
              </button>
              <div className="w-60">
                <Select
                  label="Main data source"
                  value={form.dataSource}
                  onChange={(e) => set('dataSource')(e.target.value)}
                  options={[
                    { value: '', label: 'Not set' },
                    ...Object.entries(SOURCE).map(([value, label]) => ({ value, label })),
                  ]}
                />
              </div>
            </div>
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Funding" data-testid="step-funding">
          <SectionHead
            icon={Coins}
            title="Funding"
            subtitle="Amount needed, purpose, timing and readiness."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Amount needed ($)"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount')(e.target.value)}
            />
            <Input
              label="Timing"
              maxLength={200}
              value={form.timing}
              onChange={(e) => set('timing')(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="Purpose"
                rows={2}
                maxLength={1000}
                value={form.purpose}
                onChange={(e) => set('purpose')(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Textarea
                label="Readiness"
                rows={2}
                maxLength={1000}
                value={form.readiness}
                onChange={(e) => set('readiness')(e.target.value)}
              />
            </div>
          </div>
        </section>
        <section className={card} aria-label="Sales and market" data-testid="step-sales">
          <SectionHead
            icon={Storefront}
            title="Sales / Market"
            subtitle="Customers, sales trend, market, competitors and what sets the business apart."
          />
          <div className="grid gap-3">
            <Textarea
              label="Customers"
              rows={2}
              maxLength={1000}
              value={form.customers}
              onChange={(e) => set('customers')(e.target.value)}
            />
            <Textarea
              label="Sales trend"
              rows={2}
              maxLength={1000}
              value={form.salesTrend}
              onChange={(e) => set('salesTrend')(e.target.value)}
            />
            <Textarea
              label="Target market"
              rows={2}
              maxLength={1000}
              value={form.targetMarket}
              onChange={(e) => set('targetMarket')(e.target.value)}
            />
            <Textarea
              label="Competitors"
              rows={2}
              maxLength={1000}
              value={form.competitors}
              onChange={(e) => set('competitors')(e.target.value)}
            />
            <Textarea
              label="Differentiation"
              rows={2}
              maxLength={1000}
              value={form.differentiation}
              onChange={(e) => set('differentiation')(e.target.value)}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Operations" data-testid="step-operations">
          <SectionHead
            icon={Gear}
            title="Operations"
            subtitle="Systems and process challenges, staffing and efficiency."
          />
          <div className="grid gap-3">
            <Textarea
              label="Systems / process challenges"
              rows={2}
              maxLength={1000}
              value={form.systems}
              onChange={(e) => set('systems')(e.target.value)}
            />
            <Textarea
              label="Staffing"
              rows={2}
              maxLength={1000}
              value={form.staffing}
              onChange={(e) => set('staffing')(e.target.value)}
            />
            <Textarea
              label="Efficiency opportunities"
              rows={2}
              maxLength={1000}
              value={form.efficiency}
              onChange={(e) => set('efficiency')(e.target.value)}
            />
          </div>
        </section>
        <section className={card} aria-label="Strengths and challenges" data-testid="step-swot">
          <SectionHead icon={Flag} title="Strengths & Challenges" />
          <div className="grid gap-4">
            <LineList
              label="Strengths"
              items={form.strengths}
              onChange={(v) => setForm((f) => ({ ...f, strengths: v }))}
            />
            <LineList
              label="Challenges"
              items={form.challenges}
              onChange={(v) => setForm((f) => ({ ...f, challenges: v }))}
            />
          </div>
        </section>
      </div>
      {adding ? (
        <AddFiguresDialog
          advisoryClientId={plan.advisoryClientId}
          onClose={() => setAdding(false)}
          onAdded={() => setAdding(false)}
        />
      ) : null}
    </WizardFrame>
  );
}

// ---------- Step 3: Goals & Strategy ----------

export function StrategyStep({ plan }: { plan: Plan }) {
  const router = useRouter();
  const { save, saving, error, setError, reload } = useStepSave(plan);
  const start = () => ({
    summary: plan.strategy.summary ?? '',
    areas: Object.fromEntries(
      (plan.strategy.areas ?? []).map((x) => [
        x.area,
        { objective: x.objective, notes: x.notes ?? '' },
      ]),
    ) as Record<string, { objective: string; notes: string }>,
  });
  const [form, setForm] = useState(start);
  const [initial] = useState(() => JSON.stringify(start()));
  const [tried, setTried] = useState(false);
  const [dialog, setDialog] = useState<
    { kind: 'goal' | 'rec' } | { kind: 'edit'; goalId: string }
  >();
  const toggle = (area: string, on: boolean) =>
    setForm((f) => {
      const areas = { ...f.areas };
      if (on) areas[area] = { objective: '', notes: '' };
      else delete areas[area];
      return { ...f, areas };
    });
  const setArea = (area: string, k: 'objective' | 'notes', v: string) =>
    setForm((f) => ({ ...f, areas: { ...f.areas, [area]: { ...f.areas[area]!, [k]: v } } }));
  const persist = async (n: number) => {
    setTried(true);
    if (Object.values(form.areas).some((x) => !x.objective.trim())) {
      setError('Give each chosen area its objective.');
      return false;
    }
    return save({
      step: Math.max(plan.step, n),
      strategy: {
        summary: orNull(form.summary),
        areas: Object.entries(form.areas).map(([area, x]) => ({
          area: area as never,
          objective: x.objective.trim(),
          notes: orNull(x.notes),
        })),
      },
    });
  };
  return (
    <WizardFrame
      step={3}
      planId={plan.id}
      saving={saving}
      dirty={JSON.stringify(form) !== initial}
      error={error}
      onReload={reload}
      onSaveDraft={() => persist(3)}
      onNext={() => void persist(4).then((ok) => ok && router.push(stepHref(plan.id, 4)))}
    >
      <section className={card} aria-label="Strategy" data-testid="step-strategy">
        <SectionHead
          icon={Target}
          title="Strategy"
          subtitle="The desired outcomes, in a few sentences the client will read."
        />
        <Textarea
          label="Strategy summary"
          rows={4}
          maxLength={3000}
          value={form.summary}
          onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
        />
      </section>
      <section className={card} aria-label="Focus areas" data-testid="step-areas">
        <SectionHead
          icon={Flag}
          title="Focus Areas"
          subtitle="Choose the areas the plan works on, each with its objective."
        />
        <ul className="grid items-start gap-3 md:grid-cols-2">
          {Object.entries(AREA_LABEL).map(([area, label]) => {
            const on = area in form.areas;
            return (
              <li
                key={area}
                className={`rounded-lg border p-3 ${on ? 'border-action bg-accent-soft' : 'border-divider'}`}
              >
                <Checkbox
                  label={label}
                  checked={on}
                  onChange={(e) => toggle(area, e.target.checked)}
                />
                {on ? (
                  <div className="mt-2 grid gap-2">
                    <Input
                      label={`${label} objective`}
                      required
                      maxLength={500}
                      value={form.areas[area]!.objective}
                      onChange={(e) => setArea(area, 'objective', e.target.value)}
                      {...(tried && !form.areas[area]!.objective.trim()
                        ? { error: 'Required' }
                        : {})}
                    />
                    <Textarea
                      label={`${label} notes`}
                      rows={2}
                      maxLength={2000}
                      value={form.areas[area]!.notes}
                      onChange={(e) => setArea(area, 'notes', e.target.value)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Goals in this plan" data-testid="step-goals">
          <SectionHead
            icon={Target}
            title="Goals"
            subtitle="What the plan aims for, with target dates and progress."
          />
          {plan.goals.length ? (
            <ul className="divide-y divide-divider">
              {plan.goals.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-3 py-2">
                  <button
                    type="button"
                    className="min-w-40 flex-1 text-left text-sm font-semibold text-link hover:underline"
                    onClick={() => setDialog({ kind: 'edit', goalId: g.id })}
                  >
                    {g.title}
                  </button>
                  <span className="text-xs text-muted">{dayText(g.targetDate)}</span>
                  <GoalStatusPill status={g.status} />
                  <ProgressBar value={g.progressPercent} label={`Progress of ${g.title}`} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>
              No goals in this plan yet. A plan needs at least one to be finalized.
            </p>
          )}
          <button
            type="button"
            className={`${outlined} mt-3`}
            onClick={() => setDialog({ kind: 'goal' })}
          >
            <Plus aria-hidden weight="bold" className="size-4 text-action" /> Add Goal
          </button>
        </section>
        <section
          className={card}
          aria-label="Recommendations in this plan"
          data-testid="step-recommendations"
        >
          <SectionHead
            icon={Briefcase}
            title="Recommendations"
            subtitle="Rationale, potential impact and status."
          />
          {plan.recommendations.length ? (
            <ul className="divide-y divide-divider">
              {plan.recommendations.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-40 flex-1 text-sm font-semibold text-heading">
                    {r.title}
                  </span>
                  <span className="text-xs text-muted">
                    {r.impactLabel ?? (r.impactCents === null ? '' : money(r.impactCents))}
                  </span>
                  <RecStatusPill status={r.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>No recommendations in this plan yet.</p>
          )}
          <button
            type="button"
            className={`${outlined} mt-3`}
            onClick={() => setDialog({ kind: 'rec' })}
          >
            <Plus aria-hidden weight="bold" className="size-4 text-action" /> Add Recommendation
          </button>
        </section>
      </div>
      {dialog?.kind === 'goal' ? (
        <AddGoalDialog
          advisoryClientId={plan.advisoryClientId}
          planId={plan.id}
          onClose={() => setDialog(undefined)}
          onAdded={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'rec' ? (
        <AddRecommendationDialog
          advisoryClientId={plan.advisoryClientId}
          planId={plan.id}
          onClose={() => setDialog(undefined)}
          onAdded={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditGoalDialog
          goalId={dialog.goalId}
          onClose={() => setDialog(undefined)}
          onSaved={() => setDialog(undefined)}
        />
      ) : null}
    </WizardFrame>
  );
}

// ---------- Step 4: Action Plan ----------

export function ActionStep({ plan }: { plan: Plan }) {
  const { to, saving, error, reload } = useMove(plan);
  const [dialog, setDialog] = useState<{ kind: 'task' } | { kind: 'goal'; goalId: string }>();
  type Task = Plan['actionItems'][number];
  const cols: Column<Task>[] = [
    {
      id: 'title',
      label: 'Task',
      cell: (t) => <span className="font-semibold text-heading">{t.title}</span>,
    },
    {
      id: 'who',
      label: 'Assigned To',
      cell: (t) =>
        `${t.assignee?.name ?? (t.assigneeKind === 'CLIENT' ? t.client.name : 'Advisory team')} (${ASSIGNEE_KIND[t.assigneeKind]})`,
    },
    {
      id: 'due',
      label: 'Due Date',
      className: 'whitespace-nowrap',
      cell: (t) => (
        <span className="flex items-center gap-2">
          {dayText(t.dueOn)} {t.overdue ? <Badge tone="danger">Overdue</Badge> : null}
        </span>
      ),
    },
    { id: 'priority', label: 'Priority', cell: (t) => <PriorityPill priority={t.priority} /> },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (t) => <ActionStatusPill status={t.status} />,
    },
  ];
  return (
    <WizardFrame
      step={4}
      planId={plan.id}
      saving={saving}
      dirty={false}
      error={error}
      onReload={reload}
      onSaveDraft={async () => {
        await to(4);
        return true;
      }}
      onNext={() => void to(5)}
    >
      <section className={card} aria-label="Milestones" data-testid="step-milestones">
        <SectionHead
          icon={Flag}
          title="Milestones"
          subtitle="Each goal's milestones: owner, target date, status and progress."
        />
        {plan.goals.length ? (
          <ul className="divide-y divide-divider">
            {plan.goals.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-40 flex-1 text-sm font-semibold text-heading">
                  {g.title}
                </span>
                <span className="text-sm text-muted">
                  {g.milestoneCount
                    ? `${g.milestonesDone} of ${g.milestoneCount} milestones done`
                    : 'No milestones yet'}
                </span>
                <button
                  type="button"
                  className={`${outlined} min-h-9 px-3`}
                  onClick={() => setDialog({ kind: 'goal', goalId: g.id })}
                >
                  Manage Milestones
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={quiet}>
            Add goals in{' '}
            <Link href={stepHref(plan.id, 3)} className="font-medium text-link hover:underline">
              Goals &amp; Strategy
            </Link>{' '}
            first; their milestones show here.
          </p>
        )}
      </section>
      <section className={card} aria-label="Tasks" data-testid="step-tasks">
        <SectionHead
          icon={ListChecks}
          title="Tasks"
          subtitle="Who does what by when: staff, the client or the advisory team."
        />
        <Table
          rows={plan.actionItems}
          columns={cols}
          rowKey={(t) => t.id}
          caption="Tasks in this plan"
          dense
          noun="tasks"
          pageSize={10}
          showPagination={false}
          emptyTitle="No tasks yet"
          emptyText="Add the steps that carry out the plan."
        />
        <button
          type="button"
          className={`${outlined} mt-3`}
          onClick={() => setDialog({ kind: 'task' })}
        >
          <Plus aria-hidden weight="bold" className="size-4 text-action" /> Add Task
        </button>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Service workstreams" data-testid="step-workstreams">
          <SectionHead
            icon={Briefcase}
            title="Service Workstreams"
            subtitle="The client's services from Services & Pricing."
          />
          {plan.workstreams.length ? (
            <ul className="divide-y divide-divider">
              {plan.workstreams.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-40 flex-1 font-semibold text-heading">
                    {w.serviceName}
                  </span>
                  <Badge tone={w.role === 'PRIMARY' ? 'purple' : 'neutral'}>
                    {w.role === 'PRIMARY' ? 'Primary' : 'Additional'}
                  </Badge>
                  <Badge tone="info">
                    {w.status
                      .replace('_', ' ')
                      .toLowerCase()
                      .replace(/^\w/, (c) => c.toUpperCase())}
                  </Badge>
                  {w.openItems ? (
                    <span className="text-xs text-muted">{w.openItems} open</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className={quiet}>No services yet.</p>
          )}
          <Link
            href={`${BASE}/clients/${plan.advisoryClientId}`}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-link hover:underline"
          >
            Manage the client&apos;s services{' '}
            <ArrowRight aria-hidden weight="bold" className="size-4" />
          </Link>
        </section>
        <section className={card} aria-label="Resources and documents" data-testid="step-resources">
          <SectionHead
            icon={FileText}
            title="Resources & Documents"
            subtitle="Templates and checklists to send, and the client's documents."
          />
          <ul className="flex flex-col gap-2 text-sm">
            <li>
              <Link
                href={`${BASE}/resources`}
                className="inline-flex items-center gap-1 font-medium text-link hover:underline"
              >
                Send a resource from the library{' '}
                <ArrowRight aria-hidden weight="bold" className="size-4" />
              </Link>
            </li>
            <li>
              <Link
                href={`${BASE}/clients/${plan.advisoryClientId}/documents`}
                className="inline-flex items-center gap-1 font-medium text-link hover:underline"
              >
                The client&apos;s advisory documents{' '}
                <ArrowRight aria-hidden weight="bold" className="size-4" />
              </Link>
            </li>
          </ul>
        </section>
      </div>
      {dialog?.kind === 'task' ? (
        <AddActionItemDialog
          advisoryClientId={plan.advisoryClientId}
          planId={plan.id}
          onClose={() => setDialog(undefined)}
          onAdded={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'goal' ? (
        <EditGoalDialog
          goalId={dialog.goalId}
          onClose={() => setDialog(undefined)}
          onSaved={() => setDialog(undefined)}
        />
      ) : null}
    </WizardFrame>
  );
}

// ---------- Step 5: Review & Save ----------

/** The rules the API checks before finalizing (advisory-plans.service.ts), checked here first. */
export function readiness(plan: Plan) {
  return [
    {
      id: 'name',
      label: 'Business name (stage 1)',
      todo: 'Add the business name (stage 1)',
      done: Boolean(plan.profile.businessName),
    },
    {
      id: 'strategy',
      label: 'Strategy summary or a focus area (stage 3)',
      todo: 'Add the strategy summary or an area (stage 3)',
      done: Boolean(plan.strategy.summary) || Boolean(plan.strategy.areas?.length),
    },
    {
      id: 'goal',
      label: 'At least one goal in the plan',
      todo: 'Add at least one goal to the plan',
      done: plan.goals.length > 0,
    },
    {
      id: 'figures',
      label: 'Financial figures',
      todo: 'Add the financial figures',
      done: plan.sourceDataAsOf !== null,
    },
    {
      id: 'current',
      label: 'Current financial figures',
      todo: 'The financial figures are out of date; add current ones',
      done: plan.sourceDataAsOf !== null && !plan.staleFinancials,
    },
  ];
}

export function ReviewStep({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const { save, saving, setSaving, error, setError, reload } = useStepSave(plan);
  const [msg, setMsg] = useState<string>();
  const [dialog, setDialog] = useState<'versions' | 'send'>();
  const checks = readiness(plan);
  const missing = checks.filter((c) => !c.done);
  const p = plan.profile;
  const run = async (work: () => Promise<unknown>, done: string) => {
    setSaving(true);
    setError(undefined);
    try {
      await work();
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      setMsg(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const summary = (title: string, n: number, rows: [string, string][]) => (
    <section className={card} aria-label={`${title} summary`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
        <Link href={stepHref(plan.id, n)} className="text-sm font-medium text-link hover:underline">
          Edit
        </Link>
      </div>
      <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-all text-heading">{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
  return (
    <WizardFrame
      step={5}
      planId={plan.id}
      saving={saving}
      dirty={false}
      error={error}
      onReload={reload}
      onSaveDraft={() => save({ step: 5 })}
      nextLabel="Finalize Plan"
      nextDisabled={missing.length > 0 || !plan.canEdit}
      onNext={() =>
        void run(
          () => api.advisory.finalizePlan(plan.id, { etag: plan.etag }),
          `${plan.name} finalized.`,
        )
      }
    >
      {msg ? <Toast message={msg} tone="success" onDismiss={() => setMsg(undefined)} /> : null}
      <section className={card} aria-label="Readiness" data-testid="step-readiness">
        <ChecklistCard
          title={missing.length ? 'Before you finalize' : 'Ready to finalize'}
          items={checks.map(({ id, label, done }) => ({ id, label, done }))}
          marker="check"
          surface={missing.length ? 'plain' : 'success'}
        />
        {missing.length ? (
          <p className="mt-2 text-sm text-danger" data-testid="still-needed">
            Still needed: {missing.map((m) => m.todo).join('; ')}.
          </p>
        ) : null}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {summary('Business Profile', 1, [
          ['Plan', `${plan.name} (${plan.targetYear})`],
          ['Plan type', plan.planType ?? ''],
          ['Business', p.businessName ?? ''],
          ['Entity / industry', [p.entityType, p.industry].filter(Boolean).join(' · ')],
          [
            'Years / stage',
            [p.yearsInBusiness == null ? '' : `${p.yearsInBusiness} years`, p.businessStage]
              .filter(Boolean)
              .join(' · '),
          ],
          ['Location', [p.address?.city, p.address?.state].filter(Boolean).join(', ')],
          [
            'Contact',
            [p.primaryContact?.name, p.primaryContact?.email].filter(Boolean).join(' · '),
          ],
          ['Found us through', p.referralSource ?? ''],
          ['Notes', p.notes ?? ''],
        ])}
        {summary('Financial & Business Assessment', 2, [
          ['Figures as of', plan.sourceDataAsOf ? dayText(plan.sourceDataAsOf) : ''],
          [
            'Funding needed',
            plan.assessment.funding?.amountNeededCents == null
              ? ''
              : money(plan.assessment.funding.amountNeededCents),
          ],
          [
            'Data source',
            plan.assessment.dataSource ? (SOURCE[plan.assessment.dataSource] ?? '') : '',
          ],
          ['Strengths', (plan.assessment.strengths ?? []).join(', ')],
          ['Challenges', (plan.assessment.challenges ?? []).join(', ')],
        ])}
        {summary('Goals & Strategy', 3, [
          ['Summary', plan.strategy.summary ?? ''],
          [
            'Focus areas',
            (plan.strategy.areas ?? []).map((a) => AREA_LABEL[a.area] ?? a.area).join(', '),
          ],
          ['Goals', String(plan.goals.length)],
          ['Recommendations', String(plan.recommendations.length)],
        ])}
        {summary('Action Plan', 4, [
          ['Milestones', String(plan.goals.reduce((n, g) => n + g.milestoneCount, 0))],
          ['Tasks', String(plan.actionItems.length)],
          [
            'Open tasks',
            String(
              plan.actionItems.filter(
                (t) => t.status === 'NOT_STARTED' || t.status === 'IN_PROGRESS',
              ).length,
            ),
          ],
          ['Services', plan.workstreams.map((w) => w.serviceName).join(', ')],
        ])}
      </div>
      <section className={card} aria-label="Versions and delivery" data-testid="step-delivery">
        <SectionHead
          icon={SealCheck}
          title="Versions & Delivery"
          subtitle="A finalized version never changes; later edits make a new one."
        />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <PlanStatusPill status={plan.status} />
          <span className="text-muted">
            {plan.currentVersion ? `Version ${plan.currentVersion}` : 'Not finalized yet'}
            {plan.finalizedAt ? ` · finalized ${dayText(plan.finalizedAt)}` : ''}
            {plan.sentAt ? ` · sent ${dayText(plan.sentAt)}` : ''}
          </span>
          {plan.status === 'DRAFT' ? (
            <button
              type="button"
              className={`${outlined} min-h-9 px-3`}
              disabled={saving}
              onClick={() =>
                void run(
                  () =>
                    api.advisory.setPlanStatus(plan.id, { status: 'IN_REVIEW', etag: plan.etag }),
                  'Plan submitted for review.',
                )
              }
            >
              Submit for Review
            </button>
          ) : null}
          <button
            type="button"
            className={`${outlined} min-h-9 px-3`}
            onClick={() => setDialog('versions')}
          >
            <ClockCounterClockwise aria-hidden weight="bold" className="size-4 text-action" />{' '}
            Version History
          </button>
          {plan.canSend && plan.currentVersion > 0 ? (
            <button
              type="button"
              className={`${outlined} min-h-9 px-3`}
              onClick={() => setDialog('send')}
            >
              <PaperPlaneTilt aria-hidden weight="fill" className="size-4 text-action" /> Send to
              Client
            </button>
          ) : null}
        </div>
      </section>
      <Disclaimer text={plan.disclaimer} />
      {dialog === 'versions' ? (
        <VersionsDialog plan={plan} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'send' ? (
        <SendPlanDialog
          plan={plan}
          onClose={() => setDialog(undefined)}
          onSent={() => {
            setDialog(undefined);
            setMsg(`${plan.name} sent.`);
            void qc.invalidateQueries({ queryKey: [...BA_KEY] });
          }}
        />
      ) : null}
    </WizardFrame>
  );
}
