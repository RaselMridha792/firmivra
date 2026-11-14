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
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../lib/unsaved';
import { Disclaimer } from './tp-shell';
import {
  CATEGORY_LABEL,
  ENTITY_PRESETS,
  FIGURE_SOURCES,
  FILING,
  GOALS,
  PLAN_STATUS,
  PRIORITY_LABEL,
  PlanPill,
  PriorityPill,
  TP_KEY,
  card,
  dateTimeText,
  dollars,
  linkBtn,
  money,
  outlined,
  primary,
  planError,
  quiet,
  subtle,
  toDollars,
  customKey,
  dayText,
  scheduleHref,
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
      {p && p.status === 'CLOSED' && !p.archived ? (
        <p role="status" className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          This plan is closed and read-only. Reopen it in Review &amp; Save, with the reason, to
          change it.
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
  // C05 (Review 2): the required fields, named, once Next is tried.
  const [tried, setTried] = useState(false);
  const [initial] = useState(() =>
    JSON.stringify([
      plan?.client.id ?? presetClient,
      String(plan?.planYear ?? year),
      plan?.filingStatus ?? '',
      plan?.entityType ?? '',
      plan?.name ?? '',
      plan?.planType ?? 'COMPREHENSIVE',
      plan?.goals ?? [],
      plan?.otherGoal ?? '',
      plan?.notes ?? '',
      plan?.assignedTo?.userId ?? '',
      plan?.targetCompletionOn ?? '',
      plan?.nextDiscussionOn ?? '',
      [],
    ]),
  );
  const dirty =
    JSON.stringify([
      clientId,
      planYear,
      filing,
      entity,
      name,
      type,
      goals,
      other,
      notes,
      assigned,
      target,
      discuss,
      picked,
    ]) !== initial;
  const problems: Record<string, string> = {
    ...(clientId ? {} : { client: 'Choose the client' }),
    ...(planYear ? {} : { year: 'Choose the planning year' }),
    ...(filing ? {} : { filing: 'Choose the filing status' }),
    ...(entity.trim() ? {} : { entity: 'Choose or type the entity type' }),
    ...(name.trim() ? {} : { name: 'Enter the plan name' }),
    ...(goals.length ? {} : { goals: 'Choose at least one planning goal' }),
    ...(goals.includes('OTHER') && !other.trim() ? { other: 'Describe the other goal' } : {}),
    ...(assigned ? {} : { assigned: 'Assign a team member' }),
    ...(target ? {} : { target: 'Choose the target completion date' }),
  };
  const shown = (k: string) => (tried ? problems[k] : undefined);
  const client: PlanningClientRow['client'] | undefined =
    clients.data?.items.find((c) => c.client.id === clientId)?.client ?? plan?.client;
  const editable = !plan || plan.canEdit;
  const lib = library.data?.items.filter((s) => s.active && !s.archived) ?? [];

  const save = async (next: boolean): Promise<boolean> => {
    if (next && Object.keys(problems).length > 0) {
      setTried(true);
      onNotice(`Complete the required fields: ${Object.values(problems).join('; ')}.`, 'error');
      return false;
    }
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
      setBusy(false);
      return true;
    } catch (e) {
      onNotice(planError(e), 'error');
      setBusy(false);
      return false;
    }
  };
  // A draft keeps unfinished work: only the client, year and name are needed to save one.
  const ready = !!clientId && !!name.trim() && !!planYear;
  const leave = useLeave(dirty && editable, () => save(false));
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
        disabled={busy || !clientId || !editable}
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
                label="Client *"
                value={clientId}
                error={shown('client')}
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
                label="Planning Year *"
                value={planYear}
                error={shown('year')}
                onChange={(e) => setPlanYear(e.target.value)}
                options={[year - 1, year, year + 1].map((y) => ({
                  value: String(y),
                  label: String(y),
                }))}
              />
              <Select
                label="Filing Status *"
                value={filing}
                error={shown('filing')}
                onChange={(e) => setFiling(e.target.value as never)}
                options={[
                  { value: '', label: 'Choose a filing status…' },
                  ...Object.entries(FILING).map(([value, label]) => ({ value, label })),
                ]}
              />
              <EntityField value={entity} onChange={setEntity} error={shown('entity')} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input
                label="Plan Name *"
                value={name}
                error={shown('name')}
                onChange={(e) => setName(e.target.value)}
              />
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
            <h2 className="font-display text-xl font-bold text-heading">
              Planning Goals <span className="text-danger">*</span>
            </h2>
            <p className="-mt-1 text-sm text-muted">
              Select the client&apos;s goals for this planning plan: at least one.
            </p>
            {shown('goals') ? (
              <p role="alert" className="text-sm text-danger">
                {shown('goals')}
              </p>
            ) : null}
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
              <Input
                label="Other goal *"
                value={other}
                error={shown('other')}
                onChange={(e) => setOther(e.target.value)}
              />
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
                label="Assigned To *"
                value={assigned}
                error={shown('assigned')}
                onChange={(e) => setAssigned(e.target.value)}
                options={[
                  { value: '', label: 'Select team member' },
                  ...(team.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
                ]}
              />
              <Input
                label="Target Completion Date *"
                type="date"
                value={target}
                error={shown('target')}
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
      <p className="text-xs text-muted">
        <span className="text-danger">*</span> Required. Notes and planning strategies are optional.
      </p>
      <footer className="flex flex-wrap items-center justify-between gap-3">
        <CancelButton leave={leave} />
        {actions}
      </footer>
      {leave.prompt}
    </>
  );
}

/**
 * C24 (Review 2): the entity presets, and Other to type a custom one (kept as typed). A value
 * that is not a preset (a custom one saved earlier) opens on Other with its text.
 */
function EntityField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | undefined;
}) {
  const preset = (ENTITY_PRESETS as readonly string[]).includes(value);
  // Typing a custom one, or a value from elsewhere (the client's record) that is no preset.
  const [typing, setTyping] = useState(false);
  const custom = typing || (!!value && !preset);
  return (
    <div className="flex flex-col gap-2">
      <Select
        label="Entity Type *"
        value={custom ? 'OTHER' : value}
        error={custom ? undefined : error}
        onChange={(e) => {
          if (e.target.value === 'OTHER') {
            setTyping(true);
            onChange('');
          } else {
            setTyping(false);
            onChange(e.target.value);
          }
        }}
        options={[
          { value: '', label: 'Choose an entity type…' },
          ...ENTITY_PRESETS.map((v) => ({ value: v, label: v })),
          { value: 'OTHER', label: 'Other (type it)' },
        ]}
      />
      {custom ? (
        <Input
          label="Custom entity type *"
          value={value}
          error={error}
          maxLength={60}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}

type Leave = { go: (to: () => void) => void; prompt: ReactNode };

/**
 * C07 (Review 2): leaving a step with unsaved changes asks first: Save Draft, Discard or Keep
 * Editing. `save` answers whether it saved. A Back out of the page (the origin bar) asks too.
 */
function useLeave(dirty: boolean, save: () => Promise<boolean>): Leave {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  useUnsavedChanges(dirty);
  const go = (to: () => void) => (dirty ? setPending(() => to) : to());
  const prompt = pending ? (
    <Modal
      open
      title="Leave without saving?"
      onClose={() => setPending(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setPending(null)}>
            Keep Editing
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              const to = pending;
              setPending(null);
              to();
            }}
          >
            Discard
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              const saved = await save();
              setSaving(false);
              if (!saved) return;
              const to = pending;
              setPending(null);
              to();
            }}
          >
            Save Draft
          </Button>
        </>
      }
    >
      <p className="text-sm text-text" data-testid="leave-prompt">
        This step has changes that are not saved. Save them as a draft, discard them, or keep
        editing.
      </p>
    </Modal>
  ) : null;
  return { go, prompt };
}

/** C07 (Review 2): Cancel on every step, back to Tax Planning, asking first when work is unsaved. */
function CancelButton({ leave }: { leave: Leave }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={outlined}
      data-testid="plan-cancel"
      onClick={() => leave.go(() => router.push('/tax-planning'))}
    >
      Cancel
    </button>
  );
}

type Meta = { source: string; asOf: string };

/**
 * Financial Overview. C06 (Review 2): each figure keeps where it came from and its as-of date,
 * and Add takes the firm's own additional items (an amount each), shown and kept with the rest.
 */
function StepFinancial({ plan, onNotice, onSaved, onNext, onBack }: StepProps) {
  const router = useRouter();
  const catalog = useApiQuery([...TP_KEY, 'input-catalog'], () => api.taxPlanning.inputCatalog());
  const year = plan.planYear;
  const saved = plan.inputs ?? [];
  const startVals = () =>
    Object.fromEntries(
      saved.map((i) => [
        `${i.key}|${i.kind}`,
        i.amountCents !== null ? toDollars(i.amountCents) : (i.textValue ?? ''),
      ]),
    );
  const startMeta = () => {
    const out: Record<string, Meta> = {};
    for (const i of saved) {
      if (out[i.key] && i.kind !== 'PROJECTED') continue;
      out[i.key] = { source: i.source, asOf: i.asOf ? i.asOf.slice(0, 10) : '' };
    }
    return out;
  };
  const startCustom = () => [
    ...new Map(
      saved.filter((i) => i.key.startsWith('custom_')).map((i) => [i.key, i.label]),
    ).entries(),
  ];
  const [vals, setVals] = useState<Record<string, string>>(startVals);
  const [meta, setMeta] = useState<Record<string, Meta>>(startMeta);
  const [custom, setCustom] = useState<[string, string][]>(startCustom);
  const [initial] = useState(() => JSON.stringify([startVals(), startMeta(), startCustom()]));
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify([vals, meta, custom]) !== initial;
  const rows = [
    ...(catalog.data ?? []).map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      group: c.group,
    })),
    ...custom.map(([key, label]) => ({
      key,
      label,
      type: 'MONEY' as const,
      group: 'Additional items',
    })),
  ];
  const save = async (go: boolean): Promise<boolean> => {
    setBusy(true);
    try {
      const inputs = rows.flatMap((c) =>
        (['HISTORICAL', 'PROJECTED'] as const).flatMap((kind) => {
          const v = (vals[`${c.key}|${kind}`] ?? '').trim();
          if (!v) return [];
          const m = meta[c.key];
          const base = {
            key: c.key,
            kind,
            taxYear: kind === 'HISTORICAL' ? year - 1 : year,
            source: m?.source || 'Manual entry',
            asOf: m?.asOf ? `${m.asOf}T12:00:00.000Z` : null,
          };
          return [
            c.type === 'MONEY' ? { ...base, amountCents: dollars(v) } : { ...base, textValue: v },
          ];
        }),
      );
      if (inputs.length === 0) {
        onNotice('Enter at least one figure.', 'error');
        setBusy(false);
        return false;
      }
      await api.taxPlanning.saveInputs(plan.id, { inputs: inputs as never, etag: plan.etag });
      onNotice('Figures saved.', 'success');
      await onSaved();
      setBusy(false);
      if (go) onNext?.();
      return true;
    } catch (e) {
      onNotice(planError(e), 'error');
      setBusy(false);
      return false;
    }
  };
  const leave = useLeave(dirty && plan.canEdit, () => save(false));
  if (plan.inputs === null)
    return (
      <section className={card}>
        <p className={quiet}>The financial figures are restricted for your role.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className={outlined} onClick={onBack}>
            Back
          </button>
          <button type="button" className={outlined} onClick={() => router.push('/tax-planning')}>
            Cancel
          </button>
        </div>
      </section>
    );
  const groups = [...new Set(rows.map((r) => r.group))];
  const addItem = () => {
    const key = customKey(newName);
    if (!key) return onNotice('Name the item first.', 'error');
    if (rows.some((r) => r.key === key)) return onNotice('That item is already listed.', 'error');
    setCustom([...custom, [key, newName.trim()]]);
    setNewName('');
  };
  return (
    <>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Financial overview"
        data-testid="step-financial"
      >
        <h2 className="font-display text-xl font-bold text-heading">Financial Overview</h2>
        <p className="-mt-2 text-sm text-muted">
          Enter what you know for {year - 1} (prior year) and {year} (projected), with where each
          figure came from and its as-of date. A missing figure stays empty: nothing is estimated
          for you.
        </p>
        {plan.staleData ? (
          <p role="status" className="rounded-lg bg-warning-soft p-2 text-sm text-warning">
            Some of the client&apos;s figures are more than a year old. Update them.
          </p>
        ) : null}
        {groups.map((g) => (
          <div key={g} className="overflow-x-auto">
            <h3 className="mb-1 text-sm font-semibold text-action">{g}</h3>
            <div className="grid min-w-[44rem] grid-cols-[1.4fr_1fr_1fr_1.2fr_1fr] gap-x-3 gap-y-2">
              <span className="text-xs font-semibold text-muted">Figure</span>
              <span className="text-xs font-semibold text-muted">{year - 1} (prior year, $)</span>
              <span className="text-xs font-semibold text-muted">{year} (projected, $)</span>
              <span className="text-xs font-semibold text-muted">Source</span>
              <span className="text-xs font-semibold text-muted">As of</span>
              {rows
                .filter((r) => r.group === g)
                .map((r) => (
                  <div key={r.key} className="contents" data-testid={`figure-${r.key}`}>
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
                    <Select
                      label={`${r.label} source`}
                      hideLabel
                      value={meta[r.key]?.source ?? ''}
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          [r.key]: { source: e.target.value, asOf: meta[r.key]?.asOf ?? '' },
                        })
                      }
                      options={[
                        { value: '', label: 'Choose a source…' },
                        ...[
                          ...FIGURE_SOURCES,
                          ...(meta[r.key]?.source &&
                          !(FIGURE_SOURCES as readonly string[]).includes(meta[r.key]!.source)
                            ? [meta[r.key]!.source]
                            : []),
                        ].map((v) => ({ value: v, label: v })),
                      ]}
                    />
                    <Input
                      label={`${r.label} as of`}
                      hideLabel
                      type="date"
                      value={meta[r.key]?.asOf ?? ''}
                      onChange={(e) =>
                        setMeta({
                          ...meta,
                          [r.key]: { source: meta[r.key]?.source ?? '', asOf: e.target.value },
                        })
                      }
                    />
                  </div>
                ))}
            </div>
          </div>
        ))}
        {plan.canEdit ? (
          <div className="flex flex-wrap items-end gap-2" data-testid="add-figure">
            <div className="w-72 max-w-full">
              <Input
                label="Additional item"
                value={newName}
                maxLength={60}
                placeholder="Home office costs"
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <button type="button" className={subtle} onClick={addItem}>
              <Plus aria-hidden weight="bold" className="size-4" /> Add Item
            </button>
          </div>
        ) : null}
      </section>
      <footer className="flex flex-wrap justify-between gap-3">
        <span className="flex gap-2">
          <button type="button" className={outlined} onClick={() => leave.go(onBack)}>
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
          </button>
          <CancelButton leave={leave} />
        </span>
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
      {leave.prompt}
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
      onNotice(planError(e), 'error');
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
      <PlanScenarios plan={plan} onNotice={onNotice} onSaved={onSaved} />
      <footer className="flex flex-wrap justify-between gap-3">
        <span className="flex gap-2">
          <button type="button" className={outlined} onClick={onBack}>
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
          </button>
          {/* C07 (Review 2): Cancel on every step; this step saves each change as it is made. */}
          <Link href="/tax-planning" className={outlined} data-testid="plan-cancel">
            Cancel
          </Link>
        </span>
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

/**
 * C20 (Review 2): the client's Tax Savings Calculator scenarios, where the plan is worked on: each
 * opens in the calculator, and one not yet in this plan is added to it as a snapshot that never
 * changes (the kept inputs, worked out again now and saved with the plan).
 */
function PlanScenarios({
  plan,
  onNotice,
  onSaved,
}: {
  plan: TaxPlanDetail;
  onNotice: (t: string, tone: 'success' | 'error') => void;
  onSaved: () => Promise<unknown>;
}) {
  const scenarios = useApiQuery([...TP_KEY, 'scenarios', 'client', plan.client.id], () =>
    api.taxPlanning.scenarios({ clientId: plan.client.id, pageSize: 25 }),
  );
  if (plan.inputs === null) return null;
  const rows = scenarios.data?.items ?? [];
  return (
    <section
      className={`${card} flex flex-col gap-2`}
      aria-label="Scenarios"
      data-testid="plan-scenarios"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-heading">Scenarios</h2>
        <Link href="/tax-planning/calculator" className={linkBtn}>
          New Scenario <ArrowRight aria-hidden weight="bold" className="size-3" />
        </Link>
      </div>
      {scenarios.isError ? <p className={quiet}>The scenarios could not be loaded.</p> : null}
      {scenarios.data && rows.length === 0 ? (
        <p className={quiet}>No saved scenarios for {plan.client.name} yet.</p>
      ) : null}
      <ul>
        {rows.map((sc) => (
          <li
            key={sc.id}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
          >
            <Link
              href={`/tax-planning/calculator?scenario=${sc.id}`}
              className="font-medium text-link"
              data-testid="scenario-link"
            >
              {sc.name ?? 'Scenario'} · {sc.taxYear}
            </Link>
            <span className="flex items-center gap-3 text-muted">
              {sc.result.differenceCents === null
                ? 'N/A'
                : `${money(sc.result.differenceCents)} (est.)`}
              {sc.plan?.id === plan.id ? (
                <span className="text-success">In this plan</span>
              ) : (
                <button
                  type="button"
                  className="font-medium text-link"
                  disabled={!plan.canEdit}
                  onClick={async () => {
                    try {
                      await api.taxPlanning.saveScenario({
                        ...(sc.name ? { name: sc.name } : {}),
                        planId: plan.id,
                        calculation: {
                          clientId: plan.client.id,
                          taxYear: sc.taxYear,
                          ...(sc.filingStatus ? { filingStatus: sc.filingStatus } : {}),
                          baseline: sc.baseline,
                          strategy: sc.strategy,
                        },
                      });
                      onNotice('Scenario added to the plan.', 'success');
                      await onSaved();
                    } catch (e) {
                      onNotice(planError(e), 'error');
                    }
                  }}
                >
                  Add to this plan
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
      onNotice(planError(e), 'error');
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
      <PlanDiscussions plan={plan} />
      <PlanTasks plan={plan} onNotice={onNotice} onSaved={onSaved} />
      <footer className="flex flex-wrap justify-between gap-3">
        <span className="flex gap-2">
          <button type="button" className={outlined} onClick={onBack}>
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
          </button>
          {/* C07 (Review 2): Cancel on every step; this step saves each change as it is made. */}
          <Link href="/tax-planning" className={outlined} data-testid="plan-cancel">
            Cancel
          </Link>
        </span>
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
      onNotice(planError(e), 'error');
      return false;
    }
  };
  const chosen = plan.strategies.filter((s) => s.selected);
  const [viewing, setViewing] = useState<number>();
  // C27 (Review 2): Reopen (a Closed plan) or Revise (a Finalized, sent or Implemented one).
  const [reasoning, setReasoning] = useState<'REOPEN' | 'REVISE'>();
  const history = useApiQuery([...TP_KEY, 'plan-events', plan.id, plan.etag], () =>
    api.taxPlanning.planEvents(plan.id),
  );
  const revisable = ['FINALIZED', 'AWAITING_CLIENT', 'IMPLEMENTED'].includes(plan.status);
  // C08 (Review 2): what the plan still needs, each with where to fix it. Finalizing checks the
  // strategies and the figures' age again on the server.
  const checks: { done: boolean; text: string; fix: string; step: number }[] = [
    {
      done: !!plan.filingStatus && !!plan.entityType && plan.goals.length > 0,
      text: 'Filing status, entity type and at least one planning goal',
      fix: 'Client & Plan Details',
      step: 1,
    },
    {
      done: !!plan.assignedTo && !!plan.targetCompletionOn,
      text: 'An assigned team member and a target completion date',
      fix: 'Client & Plan Details',
      step: 1,
    },
    {
      done: !plan.staleData,
      text: 'Figures less than a year old',
      fix: 'Financial Overview',
      step: 2,
    },
    {
      done: chosen.some((s) => s.status !== 'DECLINED'),
      text: 'At least one selected strategy that is not declined',
      fix: 'Goals & Strategies',
      step: 3,
    },
  ];
  return (
    <>
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Review and save"
        data-testid="step-review"
      >
        <h2 className="font-display text-xl font-bold text-heading">Review &amp; Save</h2>
        <div data-testid="readiness">
          <h3 className="mb-1 text-sm font-semibold text-heading">Ready to finalize?</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {checks.map((c) => (
              <li key={c.text} className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-pill px-2 py-0.5 text-xs font-medium ${c.done ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}
                >
                  {c.done ? 'Complete' : 'Missing'}
                </span>
                <span className="text-heading">{c.text}</span>
                {c.done ? null : (
                  <Link
                    href={`/tax-planning/plans/${plan.id}/edit${PATHS[c.step - 1]}`}
                    className="font-medium text-link"
                  >
                    Fix in {c.fix}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
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
              options={Object.entries(PLAN_STATUS)
                .filter(([value]) => value !== 'FINALIZED' || value === plan.status)
                .map(([value, label]) => ({ value, label }))}
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
                <span className="flex items-center gap-3 text-muted">
                  {v.createdBy?.name} · {dateTimeText(v.createdAt)}
                  <button
                    type="button"
                    className="font-medium text-link"
                    data-testid="view-version"
                    onClick={() => setViewing(v.version)}
                  >
                    View
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div data-testid="plan-history">
          <h3 className="mb-1 text-sm font-semibold text-heading">History</h3>
          {history.data?.length === 0 ? (
            <p className={quiet}>No status change has been recorded yet.</p>
          ) : null}
          <ul>
            {(history.data ?? []).map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap justify-between gap-2 border-t border-divider py-1 text-sm first:border-t-0"
              >
                <span className="text-heading">
                  {EVENT_LABEL[e.kind] ?? e.kind}
                  {e.toStatus ? ` · ${PLAN_STATUS[e.toStatus] ?? e.toStatus}` : ''}
                  {e.version ? ` · version ${e.version}` : ''}
                  {e.reason ? (
                    <span className="block text-xs text-muted">Reason: {e.reason}</span>
                  ) : null}
                </span>
                <span className="text-muted">
                  {e.actor?.name ?? 'Former staff'} · {dateTimeText(e.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <footer className="flex flex-wrap justify-between gap-3">
        <span className="flex gap-2">
          <button type="button" className={outlined} onClick={onBack}>
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back
          </button>
          {/* C07 (Review 2): Cancel on every step; this step saves each change as it is made. */}
          <Link href="/tax-planning" className={outlined} data-testid="plan-cancel">
            Cancel
          </Link>
        </span>
        <span className="flex flex-wrap gap-2">
          {plan.status === 'CLOSED' && plan.canChangeStatus && !plan.archived ? (
            <button
              type="button"
              className={outlined}
              data-testid="reopen-plan"
              onClick={() => setReasoning('REOPEN')}
            >
              Reopen Plan
            </button>
          ) : null}
          {revisable && plan.canChangeStatus && !plan.archived ? (
            <button
              type="button"
              className={outlined}
              data-testid="revise-plan"
              onClick={() => setReasoning('REVISE')}
            >
              Revise Plan
            </button>
          ) : null}
          <button
            type="button"
            className={subtle}
            disabled={!plan.canChangeStatus}
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
                  // C09 (Review 2): a send that is refused stays open; the notice names why.
                  if (ok) setSending(false);
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
      {reasoning ? (
        <ReasonDialog
          kind={reasoning}
          onClose={() => setReasoning(undefined)}
          onSubmit={async (reason) => {
            const ok = await run(
              () =>
                reasoning === 'REOPEN'
                  ? api.taxPlanning.reopenPlan(plan.id, { reason, etag: plan.etag })
                  : api.taxPlanning.revisePlan(plan.id, { reason, etag: plan.etag }),
              reasoning === 'REOPEN' ? 'Plan reopened.' : 'Plan back in progress for revision.',
            );
            if (ok) setReasoning(undefined);
          }}
        />
      ) : null}
      {viewing ? (
        <VersionView
          planId={plan.id}
          version={viewing}
          history={versions.data ?? []}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
    </>
  );
}

const EVENT_LABEL: Record<string, string> = {
  STATUS: 'Status changed',
  REOPEN: 'Reopened',
  REVISE: 'Revised',
  FINALIZE: 'Finalized',
  SEND: 'Sent to the client',
  ARCHIVE: 'Archived',
  RESTORE: 'Restored',
};

/**
 * C27 (Review 2): the reason for Reopen or Revise, kept in the plan's history. A revised plan is
 * finalized again as a new version; the versions already kept never change.
 */
function ReasonDialog({
  kind,
  onClose,
  onSubmit,
}: {
  kind: 'REOPEN' | 'REVISE';
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={kind === 'REOPEN' ? 'Reopen this plan?' : 'Revise this plan?'}
      subtitle={
        kind === 'REOPEN'
          ? 'It goes back to In Progress and can be changed again.'
          : 'It goes back to In Progress; finalize it again to keep a new version.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              await onSubmit(reason.trim());
              setBusy(false);
            }}
          >
            {kind === 'REOPEN' ? 'Reopen Plan' : 'Revise Plan'}
          </Button>
        </>
      }
    >
      <div data-testid="reason-dialog">
        <Textarea
          label="Reason *"
          rows={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/**
 * C12 (Review 2): the plan's client discussions: appointments made for this plan, with their
 * date, time and time zone, each opening in Appointments; Schedule Client Discussion opens New
 * Appointment on the client and Tax Planning, linked to this plan, with Back to the plan.
 */
function PlanDiscussions({ plan }: { plan: TaxPlanDetail }) {
  const overview = useApiQuery([...TP_KEY, 'overview'], () => api.taxPlanning.overview());
  const from = `/tax-planning/plans/${plan.id}/edit/implementation`;
  const when = (d: TaxPlanDetail['discussions'][number]) =>
    new Date(d.startsAt).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...(d.timeZone ? { timeZone: d.timeZone, timeZoneName: 'short' } : {}),
    });
  return (
    <section
      className={`${card} flex flex-col gap-2`}
      aria-label="Client discussions"
      data-testid="plan-discussions"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-heading">Client Discussions</h2>
        {plan.canEdit ? (
          <Link
            href={scheduleHref(overview.data?.planningServiceId, from, plan.client.id, plan.id)}
            className={subtle}
            data-testid="schedule-discussion"
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Schedule Client Discussion
          </Link>
        ) : null}
      </div>
      {plan.discussions.length === 0 ? (
        <p className={quiet}>No discussion is scheduled for this plan yet.</p>
      ) : (
        <ul>
          {plan.discussions.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
            >
              <Link
                href={`/calendar/${d.id}?from=${encodeURIComponent(from)}`}
                className="font-medium text-link"
              >
                {when(d)}
              </Link>
              <span className="text-muted">
                {d.staff?.name ?? 'Unassigned'} · {d.status.toLowerCase().replace(/_/g, ' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * C15 (Review 2): the plan's implementation tasks, each with its owner, due date and status and
 * opening in Tasks; Add Task makes one in Tasks, linked to this plan and its client.
 */
function PlanTasks({
  plan,
  onNotice,
  onSaved,
}: {
  plan: TaxPlanDetail;
  onNotice: (t: string, tone: 'success' | 'error') => void;
  onSaved: () => Promise<unknown>;
}) {
  const team = useApiQuery([...TP_KEY, 'team'], () => api.team.list());
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const from = `/tax-planning/plans/${plan.id}/edit/implementation`;
  return (
    <section
      className={`${card} flex flex-col gap-2`}
      aria-label="Implementation tasks"
      data-testid="plan-tasks"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold text-heading">Implementation Tasks</h2>
        <span className="flex gap-3">
          <Link href="/tasks" className={linkBtn}>
            Open Tasks <ArrowRight aria-hidden weight="bold" className="size-3" />
          </Link>
          {plan.canEdit ? (
            <button
              type="button"
              className={subtle}
              data-testid="add-plan-task"
              onClick={() => setAdding(true)}
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Add Task
            </button>
          ) : null}
        </span>
      </div>
      {plan.tasks.length === 0 ? (
        <p className={quiet}>
          No implementation task yet. Add the steps that put the plan into action.
        </p>
      ) : (
        <ul>
          {plan.tasks.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
            >
              <Link
                href={`/tasks/${t.id}?from=${encodeURIComponent(from)}`}
                className="font-medium text-link"
              >
                {t.title}
              </Link>
              <span className="text-muted">
                {t.assignedTo?.name ?? 'Unassigned'} ·{' '}
                {t.dueOn ? `due ${dayText(t.dueOn)}` : 'no due date'} ·{' '}
                {t.status.toLowerCase().replace(/_/g, ' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <Modal
          open
          title="Add Implementation Task"
          subtitle={`${plan.name} · ${plan.client.name}`}
          onClose={() => setAdding(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button
                disabled={busy || !title.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.taskWork.create({
                      clientId: plan.client.id,
                      taxPlanId: plan.id,
                      title: title.trim(),
                      ...(owner ? { assignedUserId: owner } : {}),
                      ...(due ? { dueOn: due } : {}),
                    });
                    onNotice('Task added.', 'success');
                    setAdding(false);
                    setTitle('');
                    setOwner('');
                    setDue('');
                    await onSaved();
                  } catch (e) {
                    onNotice(planError(e), 'error');
                  }
                  setBusy(false);
                }}
              >
                Add Task
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3" data-testid="plan-task-form">
            <Input
              label="Task *"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Select
              label="Owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              options={[
                { value: '', label: 'Unassigned' },
                ...(team.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
              ]}
            />
            <Input
              label="Due date"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

/**
 * C25 (Review 2): a kept version, read-only, as it was: who kept it and when, its tax year and how
 * fresh its figures were, the strategies and figures, and what happened to the plan's versions
 * after it (finalized, generated, sent).
 */
function VersionView({
  planId,
  version,
  history,
  onClose,
}: {
  planId: string;
  version: number;
  history: {
    version: number;
    event: string;
    createdAt: string;
    createdBy: { name: string } | null;
  }[];
  onClose: () => void;
}) {
  const v = useApiQuery([...TP_KEY, 'version', planId, version], () =>
    api.taxPlanning.version(planId, version),
  );
  const d = v.data;
  return (
    <Modal
      open
      title={`Version ${version}`}
      subtitle={d ? `${d.planName}: ${d.event.toLowerCase()}, read-only` : undefined}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {v.isError ? <p className={quiet}>This version could not be loaded.</p> : null}
      {d ? (
        <div className="flex flex-col gap-3 text-sm" data-testid="version-view">
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted">Kept by</dt>
            <dd className="text-heading">
              {d.createdBy?.name ?? 'Former staff'} · {dateTimeText(d.createdAt)}
            </dd>
            <dt className="text-muted">Tax year</dt>
            <dd className="text-heading">{d.taxYear}</dd>
            <dt className="text-muted">Figures as of</dt>
            <dd className="text-heading">
              {d.sourceDataAsOf ? dateTimeText(d.sourceDataAsOf) : 'No dated figures'}
            </dd>
            <dt className="text-muted">Projected savings</dt>
            <dd className="text-heading">
              {d.projectedSavingsCents === null
                ? 'N/A'
                : `${money(d.projectedSavingsCents)} (estimated)`}
            </dd>
          </dl>
          <div>
            <h3 className="mb-1 font-semibold text-heading">Strategies</h3>
            <ul>
              {d.strategies.map((s) => (
                <li key={s.name} className="border-t border-divider py-1 first:border-t-0">
                  <span className="text-heading">{s.name}</span>{' '}
                  <span className="text-muted">
                    · {PRIORITY_LABEL[s.priority] ?? s.priority} ·{' '}
                    {s.estimate.cents === null ? 'N/A' : money(s.estimate.cents)}
                  </span>
                  {s.assumptions ? (
                    <span className="block text-xs text-muted">{s.assumptions}</span>
                  ) : null}
                </li>
              ))}
              {d.strategies.length === 0 ? <li className="text-muted">None</li> : null}
            </ul>
          </div>
          {d.inputs ? (
            <div>
              <h3 className="mb-1 font-semibold text-heading">Figures</h3>
              <ul>
                {d.inputs.map((i) => (
                  <li
                    key={`${i.key}${i.kind}${i.taxYear}`}
                    className="border-t border-divider py-1 first:border-t-0"
                  >
                    <span className="text-heading">
                      {i.label} ({i.taxYear})
                    </span>{' '}
                    <span className="text-muted">
                      · {i.amountCents !== null ? money(i.amountCents) : (i.textValue ?? '—')} ·{' '}
                      {i.source}
                      {i.asOf ? `, as of ${dateTimeText(i.asOf)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h3 className="mb-1 font-semibold text-heading">Send and approval history</h3>
            <ul>
              {history
                .filter((h) => h.version >= version)
                .sort((a, b) => a.version - b.version)
                .map((h) => (
                  <li key={h.version} className="text-muted">
                    Version {h.version} {h.event.toLowerCase()} by{' '}
                    {h.createdBy?.name ?? 'Former staff'}, {dateTimeText(h.createdAt)}
                  </li>
                ))}
            </ul>
            <p className="mt-1 text-xs text-muted">
              Client approval is recorded with each version once the approval step is in place.
            </p>
          </div>
          <Disclaimer text={d.disclaimer} />
        </div>
      ) : null}
    </Modal>
  );
}
