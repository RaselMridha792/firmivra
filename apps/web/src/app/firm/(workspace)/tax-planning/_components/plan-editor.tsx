'use client';

import type { PlanStrategy, PlanningClientRow, TaxPlanDetail } from '@firmivra/types';
import { Avatar, Button, Checkbox, Input, Modal, Select, Textarea, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  FileText,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { Disclaimer } from './tp-shell';
import {
  CATEGORY_LABEL,
  FILING,
  GOALS,
  PLAN_STATUS,
  PRIORITY_LABEL,
  PlanPill,
  PriorityPill,
  TP_ERRORS,
  TP_KEY,
  card,
  dateTimeText,
  dollars,
  linkBtn,
  money,
  outlined,
  primary,
  quiet,
  subtle,
  toDollars,
} from './tp-shared';

type Step = 1 | 2 | 3 | 4 | 5;
const STEPS = [
  'Client & Plan Details',
  'Financial Overview',
  'Goals & Strategies',
  'Implementation Plan',
  'Review & Save',
];
const PATHS = ['', '/financials', '/goals', '/implementation', '/review'];

/** Create / Edit Planning Plan: five steps on one plan. `id` is missing while the plan has not been saved. */
export function PlanEditor({ id, step }: { id?: string; step: Step }) {
  const router = useRouter();
  const qc = useQueryClient();
  const params = useSearchParams();
  const plan = useApiQuery([...TP_KEY, 'plan', id ?? 'new'], () =>
    id ? api.taxPlanning.plan(id) : Promise.resolve(null),
  );
  const p = plan.data ?? undefined;
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const refresh = () => qc.invalidateQueries({ queryKey: [...TP_KEY] });
  const go = (n: number, pid = id) => router.push(`/tax-planning/plans/${pid}/edit${PATHS[n - 1]}`);

  if (plan.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="plan-error">
        <Link href="/tax-planning" className="text-sm font-medium text-link">
          ← Back to Tax Planning &amp; Strategy
        </Link>
        <p role="alert" className={quiet}>
          This plan is not available. It may have been removed, you may not have access to it, or we
          could not load it.
        </p>
      </div>
    );
  if (id && !p) return <p className={quiet}>Loading…</p>;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="plan-editor">
      <Link href="/tax-planning" className="flex items-center gap-2 text-sm font-medium text-link">
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Tax Planning &amp;
        Strategy
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <FileText weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              {id ? 'Edit Planning Plan' : 'Create Planning Plan'}
            </h1>
            <p className="text-base text-muted">
              Build a customized tax strategy plan for your client. Identify opportunities, estimate
              tax savings, and create an action plan.
            </p>
          </div>
        </div>
        {p ? <PlanPill status={p.status} /> : null}
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {p?.archived ? (
        <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          This plan is archived. Restore it to change it.
        </p>
      ) : null}
      <nav
        aria-label="Plan steps"
        data-testid="stepper"
        className="flex flex-wrap gap-2 overflow-x-auto"
      >
        {STEPS.map((s, i) => {
          const n = i + 1;
          const href = id ? `/tax-planning/plans/${id}/edit${PATHS[i]}` : undefined;
          const cls = `flex min-h-10 items-center gap-2 rounded-pill px-3 text-sm whitespace-nowrap ${step === n ? 'bg-action font-semibold text-on-action' : 'bg-canvas text-heading hover:bg-accent-soft'}`;
          return href ? (
            <Link
              key={s}
              href={href}
              aria-current={step === n ? 'step' : undefined}
              className={cls}
            >
              <span aria-hidden className="font-bold">
                {n}
              </span>{' '}
              {s}
            </Link>
          ) : (
            <span
              key={s}
              aria-current={step === n ? 'step' : undefined}
              className={`${cls} ${step === n ? '' : 'opacity-60'}`}
            >
              <span aria-hidden className="font-bold">
                {n}
              </span>{' '}
              {s}
            </span>
          );
        })}
      </nav>
      {step === 1 ? (
        <StepOne
          key={p?.etag ?? 'new'}
          plan={p}
          presetClient={params.get('clientId') ?? ''}
          onNotice={notice}
          onSaved={async (pid, next) => {
            await refresh();
            if (next) go(2, pid);
            else if (!id) router.replace(`/tax-planning/plans/${pid}/edit`);
          }}
        />
      ) : null}
      {p && step === 2 ? (
        <StepFinancial
          key={p.etag}
          plan={p}
          onNotice={notice}
          onSaved={refresh}
          onNext={() => go(3)}
          onBack={() => go(1)}
        />
      ) : null}
      {p && step === 3 ? (
        <StepStrategies
          key={p.etag}
          plan={p}
          onNotice={notice}
          onSaved={refresh}
          onNext={() => go(4)}
          onBack={() => go(2)}
        />
      ) : null}
      {p && step === 4 ? (
        <StepImplementation
          key={p.etag}
          plan={p}
          onNotice={notice}
          onSaved={refresh}
          onNext={() => go(5)}
          onBack={() => go(3)}
        />
      ) : null}
      {p && step === 5 ? (
        <StepReview
          key={p.etag}
          plan={p}
          onNotice={notice}
          onSaved={refresh}
          onBack={() => go(4)}
          onDone={() => router.push('/tax-planning')}
        />
      ) : null}
      {p ? <Disclaimer text={p.disclaimer} /> : null}
    </div>
  );
}

type StepProps = {
  plan: TaxPlanDetail;
  onNotice: (t: string, tone: 'success' | 'error') => void;
  onSaved: () => Promise<unknown>;
  onNext?: () => void;
  onBack: () => void;
};

function StepOne({
  plan,
  presetClient,
  onNotice,
  onSaved,
}: {
  plan: TaxPlanDetail | undefined;
  presetClient: string;
  onNotice: (t: string, tone: 'success' | 'error') => void;
  onSaved: (id: string, next: boolean) => Promise<void>;
}) {
  const clients = useApiQuery([...TP_KEY, 'pick-clients'], () =>
    api.taxPlanning.clients({ pageSize: 100 }),
  );
  const library = useApiQuery([...TP_KEY, 'library-pick'], () =>
    api.taxPlanning.strategies({ pageSize: 100 }),
  );
  const team = useApiQuery([...TP_KEY, 'team'], () => api.team.list());
  const year = new Date().getFullYear();
  const [clientId, setClientId] = useState(plan?.client.id ?? presetClient);
  const [planYear, setPlanYear] = useState(String(plan?.planYear ?? year));
  const [filing, setFiling] = useState(plan?.filingStatus ?? '');
  const [entity, setEntity] = useState(plan?.entityType ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [type, setType] = useState(plan?.planType ?? 'COMPREHENSIVE');
  const [goals, setGoals] = useState<string[]>(plan?.goals ?? []);
  const [other, setOther] = useState(plan?.otherGoal ?? '');
  const [notes, setNotes] = useState(plan?.notes ?? '');
  const [assigned, setAssigned] = useState(plan?.assignedTo?.userId ?? '');
  const [target, setTarget] = useState(plan?.targetCompletionOn ?? '');
  const [discuss, setDiscuss] = useState(plan?.nextDiscussionOn ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const client: PlanningClientRow['client'] | undefined =
    clients.data?.items.find((c) => c.client.id === clientId)?.client ?? plan?.client;
  const editable = !plan || plan.canEdit;
  const lib = library.data?.items.filter((s) => s.active && !s.archived) ?? [];

  const save = async (next: boolean) => {
    setBusy(true);
    try {
      if (plan) {
        await api.taxPlanning.updatePlan(plan.id, {
          name: name.trim(),
          planYear: Number(planYear),
          planType: type,
          filingStatus: (filing || null) as never,
          entityType: entity || null,
          goals: goals as never,
          otherGoal: other.trim() || null,
          notes: notes.trim() || null,
          assignedUserId: assigned || null,
          targetCompletionOn: target || null,
          nextDiscussionOn: discuss || null,
          etag: plan.etag,
        });
        onNotice('Plan saved.', 'success');
        await onSaved(plan.id, next);
      } else {
        const created = await api.taxPlanning.createPlan({
          clientId,
          planYear: Number(planYear),
          name: name.trim(),
          planType: type,
          filingStatus: (filing || null) as never,
          entityType: entity || null,
          goals: goals as never,
          otherGoal: other.trim() || null,
          assignedUserId: assigned || null,
          targetCompletionOn: target || null,
          nextDiscussionOn: discuss || null,
        });
        for (const sid of picked)
          await api.taxPlanning.addStrategy(created.id, { kind: 'LIBRARY', strategyId: sid });
        onNotice('Plan saved as a draft.', 'success');
        await onSaved(created.id, next);
      }
    } catch (e) {
      onNotice(errorMessage(e, TP_ERRORS), 'error');
    }
    setBusy(false);
  };
  const ready = !!clientId && !!name.trim() && !!planYear;
  const actions = (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={outlined}
        disabled={busy || !ready || !editable}
        onClick={() => void save(false)}
      >
        Save as Draft
      </button>
      <button
        type="button"
        className={primary}
        disabled={busy || !ready || !editable}
        onClick={() => void save(true)}
      >
        Next <ArrowRight aria-hidden weight="bold" className="size-4" />
      </button>
    </div>
  );
  return (
    <>
      <div className="flex justify-end">{actions}</div>
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <section
            className={`${card} flex flex-col gap-3`}
            aria-label="Client and plan details"
            data-testid="step-client"
          >
            <h2 className="font-display text-xl font-bold text-heading">
              Client &amp; Plan Details
            </h2>
            <p className="-mt-2 text-sm text-muted">
              Select the client and basic information for this planning plan.
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Select
                label="Client"
                value={clientId}
                disabled={!!plan}
                onChange={(e) => {
                  setClientId(e.target.value);
                  const c = clients.data?.items.find((x) => x.client.id === e.target.value);
                  if (c && !name) setName(`${year} Tax Strategy Plan - ${c.client.name}`);
                  if (c?.entityLabel) setEntity(c.entityLabel);
                }}
                options={[
                  {
                    value: '',
                    label: clients.isError ? 'Clients are not available' : 'Choose a client…',
                  },
                  ...(clients.data?.items ?? []).map((c) => ({
                    value: c.client.id,
                    label: c.client.name,
                  })),
                ]}
              />
              {client ? (
                <div
                  className="flex items-center gap-3 rounded-lg border border-divider p-2 text-sm"
                  data-testid="client-card"
                >
                  <Avatar name={client.name} size="lg" />
                  <span>
                    <span className="block font-semibold text-heading">{client.name}</span>
                    <span className="block text-xs text-muted">
                      {client.accountType === 'BUSINESS' ? 'Business' : 'Individual'} ·{' '}
                      {client.email}
                    </span>
                    <span className="block text-xs text-muted">{client.phone}</span>
                  </span>
                </div>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Planning Year"
                value={planYear}
                onChange={(e) => setPlanYear(e.target.value)}
                options={[year - 1, year, year + 1].map((y) => ({
                  value: String(y),
                  label: String(y),
                }))}
              />
              <Select
                label="Filing Status"
                value={filing}
                onChange={(e) => setFiling(e.target.value as never)}
                options={[
                  { value: '', label: 'Not applicable' },
                  ...Object.entries(FILING).map(([value, label]) => ({ value, label })),
                ]}
              />
              <Input
                label="Entity Type"
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input label="Plan Name" value={name} onChange={(e) => setName(e.target.value)} />
              <fieldset className="flex flex-col">
                <legend className="mb-1 text-sm font-medium text-heading">Plan Type</legend>
                {[
                  ['COMPREHENSIVE', 'Comprehensive Plan'],
                  ['FOCUSED', 'Focused Plan'],
                ].map(([v, l]) => (
                  <label key={v} className="flex min-h-8 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="plan-type"
                      checked={type === v}
                      onChange={() => setType(v as never)}
                    />{' '}
                    {l}
                  </label>
                ))}
              </fieldset>
            </div>
          </section>
          <section
            className={`${card} flex flex-col gap-2`}
            aria-label="Planning goals"
            data-testid="step-goals-box"
          >
            <h2 className="font-display text-xl font-bold text-heading">Planning Goals</h2>
            <p className="-mt-1 text-sm text-muted">
              Select the client&apos;s goals for this planning plan.
            </p>
            <div className="grid gap-x-4 sm:grid-cols-2">
              {Object.entries(GOALS).map(([g, label]) => (
                <Checkbox
                  key={g}
                  label={label}
                  checked={goals.includes(g)}
                  onChange={(e) =>
                    setGoals(e.target.checked ? [...goals, g] : goals.filter((x) => x !== g))
                  }
                />
              ))}
            </div>
            {goals.includes('OTHER') ? (
              <Input label="Other goal" value={other} onChange={(e) => setOther(e.target.value)} />
            ) : null}
          </section>
          <section className={card} aria-label="Plan notes">
            <h2 className="mb-2 font-display text-xl font-bold text-heading">Plan Notes</h2>
            <Textarea
              label="Internal notes (staff only)"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Enter notes here..."
            />
          </section>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <section
            className={`${card} flex flex-col gap-2`}
            aria-label="Planning strategies"
            data-testid="step-strategies-box"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-xl font-bold text-heading">Planning Strategies</h2>
                <p className="text-sm text-muted">Select the strategies to include in this plan.</p>
              </div>
              <Link href="/tax-planning/strategies" className={linkBtn}>
                View All Strategies <ArrowRight aria-hidden weight="bold" className="size-3" />
              </Link>
            </div>
            {plan ? (
              <ul>
                {plan.strategies.map((s) => (
                  <li
                    key={s.id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-t border-divider py-1.5 text-sm first:border-t-0"
                  >
                    <span className="font-medium text-heading">{s.name}</span>
                    <span className="text-muted">
                      {s.estimate.cents === null ? 'N/A' : money(s.estimate.cents)}
                    </span>
                    <PriorityPill priority={s.priority} />
                  </li>
                ))}
                {plan.strategies.length === 0 ? (
                  <li className={quiet}>No strategies yet. Add them in Goals &amp; Strategies.</li>
                ) : null}
              </ul>
            ) : (
              <ul className="max-h-72 overflow-auto">
                {lib.map((s) => (
                  <li
                    key={s.id}
                    className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 border-t border-divider py-1.5 text-sm first:border-t-0"
                  >
                    <input
                      type="checkbox"
                      aria-label={s.name}
                      className="size-4"
                      checked={picked.includes(s.id)}
                      onChange={(e) =>
                        setPicked(
                          e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id),
                        )
                      }
                    />
                    <span className="font-medium text-heading">{s.name}</span>
                    <span className="text-muted">{CATEGORY_LABEL[s.category]}</span>
                    <PriorityPill priority={s.defaultPriority} />
                  </li>
                ))}
                {library.isPending ? <li className={quiet}>Loading…</li> : null}
              </ul>
            )}
            <p className="text-xs text-muted">
              {plan
                ? 'Estimates come from the client’s figures.'
                : 'Estimates appear once the plan is saved and its figures are entered.'}
            </p>
          </section>
          <section
            className={`${card} flex flex-col gap-3`}
            aria-label="Assign and schedule"
            data-testid="step-assign"
          >
            <h2 className="font-display text-xl font-bold text-heading">Assign &amp; Schedule</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Assigned To"
                value={assigned}
                onChange={(e) => setAssigned(e.target.value)}
                options={[
                  { value: '', label: 'Select team member' },
                  ...(team.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
                ]}
              />
              <Input
                label="Target Completion Date"
                type="date"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <Input
                label="Next Client Discussion Date"
                type="date"
                value={discuss}
                onChange={(e) => setDiscuss(e.target.value)}
              />
            </div>
          </section>
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/tax-planning" className={outlined}>
          Cancel
        </Link>
        {actions}
      </footer>
    </>
  );
}

function StepFinancial({ plan, onNotice, onSaved, onNext, onBack }: StepProps) {
  const catalog = useApiQuery([...TP_KEY, 'input-catalog'], () => api.taxPlanning.inputCatalog());
  const year = plan.planYear;
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (plan.inputs ?? []).map((i) => [
        `${i.key}|${i.kind}`,
        i.amountCents !== null ? toDollars(i.amountCents) : (i.textValue ?? ''),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  if (plan.inputs === null)
    return (
      <section className={card}>
        <p className={quiet}>The financial figures are restricted for your role.</p>
        <div className="mt-3">
          <button type="button" className={outlined} onClick={onBack}>
            Back
          </button>
        </div>
      </section>
    );
  const rows = catalog.data ?? [];
  const save = async (go: boolean) => {
    setBusy(true);
    try {
      const inputs = rows.flatMap((c) =>
        (['HISTORICAL', 'PROJECTED'] as const).flatMap((kind) => {
          const v = (vals[`${c.key}|${kind}`] ?? '').trim();
          if (!v) return [];
          const base = {
            key: c.key,
            kind,
            taxYear: kind === 'HISTORICAL' ? year - 1 : year,
            source: 'Manual entry',
          };
          return [
            c.type === 'MONEY' ? { ...base, amountCents: dollars(v) } : { ...base, textValue: v },
          ];
        }),
      );
      if (inputs.length === 0) {
        onNotice('Enter at least one figure.', 'error');
        setBusy(false);
        return;
      }
      await api.taxPlanning.saveInputs(plan.id, { inputs: inputs as never, etag: plan.etag });
      onNotice('Figures saved.', 'success');
      await onSaved();
      if (go) onNext?.();
    } catch (e) {
      onNotice(errorMessage(e, TP_ERRORS), 'error');
    }
    setBusy(false);
  };
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Financial overview"
        data-testid="step-financial"
      >
        <h2 className="font-display text-xl font-bold text-heading">Financial Overview</h2>
        <p className="-mt-2 text-sm text-muted">
          Enter what you know. A missing figure stays empty: nothing is estimated for you.
        </p>
        {plan.staleData ? (
          <p role="status" className="rounded-lg bg-warning-soft p-2 text-sm text-warning">
            The client&apos;s figures are old. Review them.
          </p>
        ) : null}
        {groups.map((g) => (
          <div key={g}>
            <h3 className="mb-1 text-sm font-semibold text-heading">{g}</h3>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr]">
              <span className="hidden text-xs font-semibold text-muted sm:block">Figure</span>
              <span className="hidden text-xs font-semibold text-muted sm:block">
                {year - 1} (prior year)
              </span>
              <span className="hidden text-xs font-semibold text-muted sm:block">
                {year} (projected)
              </span>
              {rows
                .filter((r) => r.group === g)
                .map((r) => (
                  <div key={r.key} className="contents">
                    <span className="self-center text-sm text-heading">{r.label}</span>
                    <Input
                      label={`${r.label} ${year - 1}`}
                      hideLabel
                      value={vals[`${r.key}|HISTORICAL`] ?? ''}
                      onChange={(e) =>
                        setVals({ ...vals, [`${r.key}|HISTORICAL`]: e.target.value })
                      }
                    />
                    <Input
                      label={`${r.label} ${year}`}
                      hideLabel
                      value={vals[`${r.key}|PROJECTED`] ?? ''}
                      onChange={(e) => setVals({ ...vals, [`${r.key}|PROJECTED`]: e.target.value })}
                    />
                  </div>
                ))}
            </div>
          </div>
        ))}
        {(plan.inputs ?? []).length ? (
          <p className="text-xs text-muted">
            Saved figures: {(plan.inputs ?? []).map((i) => `${i.label} (${i.source})`).join(', ')}
          </p>
        ) : null}
      </section>
      <footer className="flex flex-wrap justify-between gap-3">
        <button type="button" className={outlined} onClick={onBack}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
        </button>
        <span className="flex gap-2">
          <button
            type="button"
            className={outlined}
            disabled={busy || !plan.canEdit}
            onClick={() => void save(false)}
          >
            Save as Draft
          </button>
          <button
            type="button"
            className={primary}
            disabled={busy || !plan.canEdit}
            onClick={() => void save(true)}
          >
            Next <ArrowRight aria-hidden weight="bold" className="size-4" />
          </button>
        </span>
      </footer>
    </>
  );
}

function StepStrategies({ plan, onNotice, onSaved, onNext, onBack }: StepProps) {
  const library = useApiQuery([...TP_KEY, 'library-pick'], () =>
    api.taxPlanning.strategies({ pageSize: 100 }),
  );
  const [adding, setAdding] = useState(false);
  const [override, setOverride] = useState<PlanStrategy>();
  const run = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (done) onNotice(done, 'success');
      await onSaved();
    } catch (e) {
      onNotice(errorMessage(e, TP_ERRORS), 'error');
    }
  };
  const move = (i: number, by: number) => {
    const ids = plan.strategies.map((s) => s.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => api.taxPlanning.reorderStrategies(plan.id, { ids, etag: plan.etag }));
  };
  const free = (library.data?.items ?? []).filter(
    (l) => l.active && !l.archived && !plan.strategies.some((s) => s.strategyId === l.id),
  );
  return (
    <>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Goals and strategies"
        data-testid="step-strategies"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-xl font-bold text-heading">Goals &amp; Strategies</h2>
          <button
            type="button"
            className={outlined}
            disabled={!plan.canEdit}
            onClick={() => setAdding(true)}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Strategy
          </button>
        </div>
        {plan.goals.length ? (
          <p className="text-sm text-muted">Goals: {plan.goals.map((g) => GOALS[g]).join(', ')}</p>
        ) : null}
        {plan.strategies.length === 0 ? (
          <p className={quiet}>No strategies yet. Add one from the library or write your own.</p>
        ) : null}
        <ul className="flex flex-col">
          {plan.strategies.map((s, i) => (
            <li
              key={s.id}
              className="grid grid-cols-[auto_1fr] items-center gap-3 border-t border-divider py-2 text-sm first:border-t-0 lg:grid-cols-[auto_1fr_8rem_8rem_9rem_auto]"
              data-testid="plan-strategy"
            >
              <input
                type="checkbox"
                aria-label={`Include ${s.name}`}
                className="size-4"
                checked={s.selected}
                disabled={!plan.canEdit}
                onChange={(e) =>
                  void run(() =>
                    api.taxPlanning.updateStrategy(plan.id, s.id, {
                      selected: e.target.checked,
                      etag: plan.etag,
                    }),
                  )
                }
              />
              <span className="min-w-0">
                <span className="block font-semibold text-heading">
                  {s.name}
                  {s.custom ? ' (custom)' : ''}
                </span>
                <span className="block text-xs text-muted">
                  {CATEGORY_LABEL[s.category]}
                  {s.estimate.cents === null
                    ? ` · ${s.estimate.unavailableReason ?? 'No estimate'}`
                    : s.estimate.basis
                      ? ` · ${s.estimate.basis}`
                      : ''}
                </span>
              </span>
              <span className="font-medium text-heading">
                {s.estimate.cents === null ? 'N/A' : money(s.estimate.cents)}
                {s.estimate.overridden ? (
                  <span className="block text-xs font-normal text-warning">overridden</span>
                ) : null}
              </span>
              <Select
                label={`Priority of ${s.name}`}
                hideLabel
                value={s.priority}
                disabled={!plan.canEdit}
                onChange={(e) =>
                  void run(() =>
                    api.taxPlanning.updateStrategy(plan.id, s.id, {
                      priority: e.target.value as never,
                      etag: plan.etag,
                    }),
                  )
                }
                options={Object.entries(PRIORITY_LABEL).map(([value, label]) => ({ value, label }))}
              />
              <button
                type="button"
                className={`${subtle} min-h-9`}
                disabled={!plan.canOverride || !plan.canEdit}
                onClick={() => setOverride(s)}
              >
                Override estimate
              </button>
              <span className="flex gap-1">
                <button
                  type="button"
                  aria-label={`Move ${s.name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="flex size-8 items-center justify-center rounded text-muted hover:bg-canvas disabled:opacity-40"
                >
                  <ArrowUp aria-hidden weight="bold" className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${s.name} down`}
                  disabled={i === plan.strategies.length - 1}
                  onClick={() => move(i, 1)}
                  className="flex size-8 items-center justify-center rounded text-muted hover:bg-canvas disabled:opacity-40"
                >
                  <ArrowDown aria-hidden weight="bold" className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-sm font-semibold text-heading" data-testid="projected">
          Projected savings:{' '}
          {plan.projectedSavingsCents === null
            ? 'N/A'
            : `${money(plan.projectedSavingsCents)} (estimated)`}
        </p>
        {plan.overlapNotes.map((n) => (
          <p key={n} className="text-xs text-muted">
            {n}
          </p>
        ))}
      </section>
      <footer className="flex flex-wrap justify-between gap-3">
        <button type="button" className={outlined} onClick={onBack}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
        </button>
        <button type="button" className={primary} onClick={onNext}>
          Next <ArrowRight aria-hidden weight="bold" className="size-4" />
        </button>
      </footer>
      {adding ? (
        <AddStrategy
          free={free.map((l) => ({ id: l.id, name: l.name }))}
          onClose={() => setAdding(false)}
          onAdd={async (body) => {
            setAdding(false);
            await run(() => api.taxPlanning.addStrategy(plan.id, body as never), 'Strategy added.');
          }}
        />
      ) : null}
      {override ? (
        <OverrideDialog
          strategy={override}
          onClose={() => setOverride(undefined)}
          onSave={async (cents, reason) => {
            const s = override;
            setOverride(undefined);
            await run(
              () =>
                api.taxPlanning.updateStrategy(
                  plan.id,
                  s.id,
                  cents === null
                    ? { overrideSavingsCents: null, etag: plan.etag }
                    : { overrideSavingsCents: cents, overrideReason: reason, etag: plan.etag },
                ),
              'Estimate updated.',
            );
          }}
        />
      ) : null}
    </>
  );
}

function AddStrategy({
  free,
  onClose,
  onAdd,
}: {
  free: { id: string; name: string }[];
  onClose: () => void;
  onAdd: (b: unknown) => Promise<void>;
}) {
  const [mode, setMode] = useState<'LIBRARY' | 'CUSTOM'>('LIBRARY');
  const [sid, setSid] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('DEDUCTIONS');
  const [assumptions, setAssumptions] = useState('');
  return (
    <Modal
      open
      title="Add Strategy"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={mode === 'LIBRARY' ? !sid : !name.trim()}
            onClick={() =>
              void onAdd(
                mode === 'LIBRARY'
                  ? { kind: 'LIBRARY', strategyId: sid }
                  : {
                      kind: 'CUSTOM',
                      name: name.trim(),
                      category,
                      assumptions: assumptions.trim() || null,
                    },
              )
            }
          >
            Add Strategy
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-strategy">
        <Select
          label="From"
          value={mode}
          onChange={(e) => setMode(e.target.value as never)}
          options={[
            { value: 'LIBRARY', label: 'The strategy library' },
            { value: 'CUSTOM', label: 'A custom strategy for this client' },
          ]}
        />
        {mode === 'LIBRARY' ? (
          <Select
            label="Strategy"
            value={sid}
            onChange={(e) => setSid(e.target.value)}
            options={[
              {
                value: '',
                label: free.length ? 'Choose a strategy…' : 'Every strategy is already in the plan',
              },
              ...free.map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
        ) : (
          <>
            <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <Select
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
            />
            <Textarea
              label="Assumptions"
              rows={3}
              value={assumptions}
              onChange={(e) => setAssumptions(e.target.value)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

function OverrideDialog({
  strategy,
  onClose,
  onSave,
}: {
  strategy: PlanStrategy;
  onClose: () => void;
  onSave: (cents: number | null, reason: string) => Promise<void>;
}) {
  const [v, setV] = useState(
    strategy.estimate.cents === null ? '' : toDollars(strategy.estimate.cents),
  );
  const [reason, setReason] = useState(strategy.overrideReason ?? '');
  return (
    <Modal
      open
      title="Override estimate"
      subtitle={strategy.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {strategy.estimate.overridden ? (
            <Button variant="secondary" onClick={() => void onSave(null, '')}>
              Use the model&apos;s figure
            </Button>
          ) : null}
          <Button
            disabled={!v.trim() || !reason.trim()}
            onClick={() => void onSave(dollars(v), reason.trim())}
          >
            Save Override
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="override-dialog">
        <p className="text-sm text-muted">
          The model says{' '}
          {strategy.estimate.modelCents === null
            ? 'nothing yet'
            : money(strategy.estimate.modelCents)}
          . An override needs a reason and is recorded.
        </p>
        <Input label="Estimated savings ($)" value={v} onChange={(e) => setV(e.target.value)} />
        <Textarea
          label="Reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function StepImplementation({ plan, onNotice, onSaved, onNext, onBack }: StepProps) {
  const docs = useApiQuery([...TP_KEY, 'client-docs', plan.client.id], () =>
    api.documents.list(plan.client.id, { limit: 50 }),
  );
  const [docId, setDocId] = useState('');
  const run = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (done) onNotice(done, 'success');
      await onSaved();
    } catch (e) {
      onNotice(errorMessage(e, TP_ERRORS), 'error');
    }
  };
  const chosen = plan.strategies.filter((s) => s.selected);
  return (
    <>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Implementation plan"
        data-testid="step-implementation"
      >
        <h2 className="font-display text-xl font-bold text-heading">Implementation Plan</h2>
        {chosen.length === 0 ? (
          <p className={quiet}>Select a strategy in Goals &amp; Strategies first.</p>
        ) : null}
        <ul>
          {chosen.map((s) => (
            <li
              key={s.id}
              className="grid gap-3 border-t border-divider py-3 first:border-t-0 sm:grid-cols-[1fr_10rem_10rem]"
              data-testid="impl-row"
            >
              <span>
                <span className="block font-semibold text-heading">{s.name}</span>
                <Textarea
                  label="Assumptions"
                  rows={2}
                  defaultValue={s.assumptions ?? ''}
                  placeholder="Assumptions"
                  disabled={!plan.canEdit}
                  onBlur={(e) => {
                    if ((e.target.value || null) !== s.assumptions)
                      void run(
                        () =>
                          api.taxPlanning.updateStrategy(plan.id, s.id, {
                            assumptions: e.target.value || null,
                            etag: plan.etag,
                          }),
                        'Saved.',
                      );
                  }}
                />
              </span>
              <Select
                label={`Status of ${s.name}`}
                value={s.status}
                disabled={!plan.canEdit}
                onChange={(e) =>
                  void run(
                    () =>
                      api.taxPlanning.updateStrategy(plan.id, s.id, {
                        status: e.target.value as never,
                        etag: plan.etag,
                      }),
                    'Status saved.',
                  )
                }
                options={[
                  ['PROPOSED', 'Proposed'],
                  ['ACCEPTED', 'Accepted'],
                  ['IN_PROGRESS', 'In progress'],
                  ['IMPLEMENTED', 'Implemented'],
                  ['DECLINED', 'Declined'],
                ].map(([value, label]) => ({ value: value!, label: label! }))}
              />
              <Input
                label="Implemented on"
                type="date"
                defaultValue={s.implementedOn ?? ''}
                disabled={!plan.canEdit}
                onBlur={(e) => {
                  if ((e.target.value || null) !== s.implementedOn)
                    void run(
                      () =>
                        api.taxPlanning.updateStrategy(plan.id, s.id, {
                          implementedOn: e.target.value || null,
                          etag: plan.etag,
                        }),
                      'Saved.',
                    );
                }}
              />
            </li>
          ))}
        </ul>
      </section>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Documents"
        data-testid="step-docs"
      >
        <h2 className="font-display text-xl font-bold text-heading">Documents</h2>
        <p className="-mt-2 text-sm text-muted">
          Attach documents of this client. Upload new ones in Documents first.
        </p>
        {plan.documents.length === 0 ? <p className={quiet}>No documents attached.</p> : null}
        <ul>
          {plan.documents.map((d) => (
            <li
              key={d.documentId}
              className="flex items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
            >
              <span className="text-heading">{d.fileName}</span>
              <button
                type="button"
                aria-label={`Remove ${d.fileName}`}
                onClick={() =>
                  void run(() => api.taxPlanning.detachDocument(plan.id, d.documentId), 'Removed.')
                }
                className="flex size-8 items-center justify-center rounded text-danger hover:bg-danger-soft"
              >
                <Trash aria-hidden weight="bold" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Select
              label="Client document"
              value={docId}
              onChange={(e) => setDocId(e.target.value)}
              options={[
                {
                  value: '',
                  label:
                    (docs.data?.items.length ?? 0)
                      ? 'Choose a document…'
                      : 'This client has no documents',
                },
                ...(docs.data?.items ?? []).map((d) => ({ value: d.id, label: d.fileName })),
              ]}
            />
          </div>
          <button
            type="button"
            className={outlined}
            disabled={!docId || !plan.canEdit}
            onClick={() =>
              void run(
                () => api.taxPlanning.attachDocument(plan.id, { documentId: docId }),
                'Document attached.',
              )
            }
          >
            Attach
          </button>
        </div>
      </section>
      <footer className="flex flex-wrap justify-between gap-3">
        <button type="button" className={outlined} onClick={onBack}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
        </button>
        <button type="button" className={primary} onClick={onNext}>
          Next <ArrowRight aria-hidden weight="bold" className="size-4" />
        </button>
      </footer>
    </>
  );
}

function StepReview({
  plan,
  onNotice,
  onSaved,
  onBack,
  onDone,
}: StepProps & { onDone: () => void }) {
  const versions = useApiQuery([...TP_KEY, 'versions', plan.id, plan.version, plan.etag], () =>
    api.taxPlanning.versions(plan.id),
  );
  const [sending, setSending] = useState(false);
  const [channel, setChannel] = useState<'PORTAL_MESSAGE' | 'EMAIL'>('PORTAL_MESSAGE');
  const [msg, setMsg] = useState('');
  const run = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      onNotice(done, 'success');
      await onSaved();
      return true;
    } catch (e) {
      onNotice(errorMessage(e, TP_ERRORS), 'error');
      return false;
    }
  };
  const chosen = plan.strategies.filter((s) => s.selected);
  return (
    <>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Review and save"
        data-testid="step-review"
      >
        <h2 className="font-display text-xl font-bold text-heading">Review &amp; Save</h2>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted">Client</dt>
          <dd className="text-heading">{plan.client.name}</dd>
          <dt className="text-muted">Plan</dt>
          <dd className="text-heading">
            {plan.name} ({plan.planYear})
          </dd>
          <dt className="text-muted">Status</dt>
          <dd>
            <Select
              label="Plan status"
              hideLabel
              value={plan.status}
              disabled={!plan.canEdit}
              onChange={(e) =>
                void run(
                  () =>
                    api.taxPlanning.setStatus(plan.id, {
                      status: e.target.value as never,
                      etag: plan.etag,
                    }),
                  'Status saved.',
                )
              }
              options={Object.entries(PLAN_STATUS).map(([value, label]) => ({ value, label }))}
            />
          </dd>
          <dt className="text-muted">Strategies</dt>
          <dd className="text-heading">
            {chosen.length
              ? chosen
                  .map(
                    (s) =>
                      `${s.name} (${s.estimate.cents === null ? 'N/A' : money(s.estimate.cents)})`,
                  )
                  .join(', ')
              : 'None selected'}
          </dd>
          <dt className="text-muted">Projected savings</dt>
          <dd className="font-semibold text-heading" data-testid="review-total">
            {plan.projectedSavingsCents === null
              ? 'N/A'
              : `${money(plan.projectedSavingsCents)} (estimated)`}
          </dd>
          <dt className="text-muted">Version</dt>
          <dd className="text-heading">{plan.version}</dd>
        </dl>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-heading">Versions</h3>
          {versions.data?.length === 0 ? (
            <p className={quiet}>No version has been kept yet. Finalizing keeps one.</p>
          ) : null}
          <ul>
            {(versions.data ?? []).map((v) => (
              <li
                key={`${v.version}${v.event}${v.createdAt}`}
                className="flex justify-between gap-2 border-t border-divider py-1 text-sm first:border-t-0"
              >
                <span className="text-heading">
                  Version {v.version} · {v.event.toLowerCase()}
                </span>
                <span className="text-muted">
                  {v.createdBy?.name} · {dateTimeText(v.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <footer className="flex flex-wrap justify-between gap-3">
        <button type="button" className={outlined} onClick={onBack}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
        </button>
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            className={subtle}
            disabled={!plan.canEdit}
            onClick={() =>
              void run(
                () =>
                  plan.archived
                    ? api.taxPlanning.restorePlan(plan.id)
                    : api.taxPlanning.archivePlan(plan.id),
                plan.archived ? 'Restored.' : 'Archived.',
              )
            }
          >
            {plan.archived ? 'Restore Plan' : 'Archive Plan'}
          </button>
          <button
            type="button"
            className={outlined}
            disabled={!plan.canEdit}
            onClick={() =>
              void run(
                () => api.taxPlanning.finalize(plan.id, { etag: plan.etag }),
                'Plan finalized.',
              )
            }
          >
            Finalize Plan
          </button>
          <button
            type="button"
            className={outlined}
            disabled={!plan.canSend}
            onClick={() => setSending(true)}
          >
            Send to Client
          </button>
          <button type="button" className={primary} onClick={onDone}>
            Save &amp; Close
          </button>
        </span>
      </footer>
      {sending ? (
        <Modal
          open
          title="Send Plan to Client"
          subtitle="Only the client notes are sent, never the internal ones."
          onClose={() => setSending(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setSending(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  const ok = await run(
                    () =>
                      api.taxPlanning.send(plan.id, {
                        channel,
                        ...(msg.trim() ? { message: msg.trim() } : {}),
                      }),
                    'Plan sent.',
                  );
                  if (ok) setSending(false);
                  else setSending(false);
                }}
              >
                Send
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3" data-testid="send-plan">
            <Select
              label="Send by"
              value={channel}
              onChange={(e) => setChannel(e.target.value as never)}
              options={[
                { value: 'PORTAL_MESSAGE', label: 'Portal message' },
                { value: 'EMAIL', label: 'Email' },
              ]}
            />
            <Textarea
              label="Message (optional)"
              rows={3}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
            />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
