'use client';

import {
  type AutomationActionField,
  type AutomationCatalog,
  type AutomationDefinition,
  type AutomationModule,
  type AutomationOperator,
  type AutomationRuleDetail,
} from '@firmivra/types';
import {
  Button,
  Checkbox,
  Input,
  Modal,
  Radio,
  Select,
  Stepper,
  Textarea,
  Toast,
} from '@firmivra/ui';
import { ArrowLeft, Flag, Gear, Info, Lightbulb, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { PreviewPanel, SaveTemplateDialog } from './automation-dialogs';
import {
  AUTOMATIONS_KEY,
  AUTOMATION_ERRORS,
  card,
  filled,
  outlined,
  quiet,
  subtle,
} from './automations-shared';

interface Cond {
  key: string;
  field: string;
  operator: AutomationOperator;
  value: string;
}
interface Act {
  id: string;
  type: string;
  config: Record<string, string | number | boolean | string[] | null>;
  delay: string;
  dependsOn: string;
}
interface Form {
  name: string;
  category: AutomationModule;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  module: AutomationModule;
  event: string;
  timing: 'IMMEDIATE' | 'BEFORE' | 'AFTER' | 'SCHEDULED';
  offsetValue: string;
  offsetUnit: 'MINUTE' | 'HOUR' | 'DAY';
  matchMode: 'ALL' | 'ANY';
  conditions: Cond[];
  actions: Act[];
  enabled: boolean;
  dedupe: boolean;
  dedupeDays: string;
  logAll: boolean;
  notifyMe: boolean;
  calendar: boolean;
  expires: boolean;
  expiresOn: string;
}
let counter = 0;
const key = () => `k${(counter += 1)}`;
const actionId = (acts: Act[]) => {
  let n = acts.length + 1;
  while (acts.some((a) => a.id === `a${n}`)) n += 1;
  return `a${n}`;
};
const blank = (): Form => ({
  name: '',
  category: 'COMPLIANCE_DEADLINES',
  priority: 'MEDIUM',
  module: 'COMPLIANCE_DEADLINES',
  event: '',
  timing: 'IMMEDIATE',
  offsetValue: '14',
  offsetUnit: 'DAY',
  matchMode: 'ALL',
  conditions: [],
  actions: [],
  enabled: false,
  dedupe: true,
  dedupeDays: '7',
  logAll: true,
  notifyMe: true,
  calendar: false,
  expires: false,
  expiresOn: '',
});
const fromDetail = (d: AutomationRuleDetail): Form => {
  const v = d.definition;
  return {
    ...blank(),
    name: d.name,
    category: d.category,
    priority: d.priority,
    enabled: d.status === 'ACTIVE',
    expires: d.expiresOn !== null,
    expiresOn: d.expiresOn ?? '',
    ...(v
      ? {
          module: v.trigger.module,
          event: v.trigger.event,
          timing: v.trigger.timing,
          offsetValue: String(v.trigger.offsetValue ?? 14),
          offsetUnit: v.trigger.offsetUnit ?? 'DAY',
          matchMode: v.matchMode,
          conditions: v.conditions.map((c) => ({
            key: key(),
            field: c.field,
            operator: c.operator,
            value: Array.isArray(c.value) ? c.value.join(',') : String(c.value ?? ''),
          })),
          actions: v.actions.map((a) => ({
            id: a.id,
            type: a.type,
            config: a.config,
            delay: String(a.delayMinutes),
            dependsOn: a.dependsOn ?? '',
          })),
          dedupe: v.settings.preventDuplicatesDays > 0,
          dedupeDays: String(v.settings.preventDuplicatesDays || 7),
          logAll: v.settings.logAll,
          notifyMe: v.settings.notifyOnFailureUserIds.length > 0,
          calendar: v.settings.addToCalendar,
        }
      : {}),
  };
};

const DELAYS = [
  { value: '0', label: 'Immediately' },
  { value: '60', label: '1 hour after' },
  { value: '1440', label: '1 day after' },
  { value: '4320', label: '3 days after' },
  { value: '10080', label: '7 days after' },
];

/** /automations/new and /automations/[id]/edit: the five-step rule builder. */
export function RuleBuilderScreen({ id }: { id?: string }) {
  const detail = useApiQuery([...AUTOMATIONS_KEY, 'rule', id ?? 'new'], async () =>
    id ? api.automations.rule(id) : null,
  );
  const catalog = useApiQuery([...AUTOMATIONS_KEY, 'catalog'], () => api.automations.catalog());
  if ((id && !detail.data) || !catalog.data) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/automations"
          className="flex w-fit items-center gap-2 text-sm font-medium text-link"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Automation
        </Link>
        <p className={`${card} ${quiet}`}>
          {detail.isError || catalog.isError ? 'This rule is not available right now.' : 'Loading…'}
        </p>
      </div>
    );
  }
  return (
    <Builder key={id ?? 'new'} id={id} initial={detail.data ?? undefined} catalog={catalog.data} />
  );
}

function Builder({
  id,
  initial,
  catalog,
}: {
  id: string | undefined;
  initial: AutomationRuleDetail | undefined;
  catalog: AutomationCatalog;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<AutomationRuleDetail | undefined>(initial);
  const [f, setF] = useState<Form>(() => (initial ? fromDetail(initial) : blank()));
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [errors, setErrors] = useState<Partial<Record<'name' | 'event' | 'actions', string>>>({});
  const [template, setTemplate] = useState(false);
  const [matching, setMatching] = useState(false);
  const set = (change: Partial<Form>) => setF((cur) => ({ ...cur, ...change }));
  const team = useApiQuery([...AUTOMATIONS_KEY, 'members'], () => api.team.list());
  const members = (team.data ?? []).filter((m) => m.status === 'ACTIVE');
  const events = catalog.events.filter((e) => e.module === f.module);
  const ev = catalog.events.find((e) => e.code === f.event);
  const offset = f.timing === 'BEFORE' || f.timing === 'AFTER';

  const definition = (): AutomationDefinition => ({
    trigger: {
      module: f.module,
      event: f.event,
      timing: f.timing,
      ...(offset ? { offsetValue: Number(f.offsetValue), offsetUnit: f.offsetUnit } : {}),
    },
    matchMode: f.matchMode,
    conditions: f.conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value })),
    actions: f.actions.map((a) => ({
      id: a.id,
      type: a.type,
      config: a.config,
      delayMinutes: Number(a.delay),
      ...(a.dependsOn ? { dependsOn: a.dependsOn } : {}),
    })),
    settings: {
      ...(f.dedupe
        ? { preventDuplicatesDays: Number(f.dedupeDays) }
        : { preventDuplicatesDays: 0 }),
      logAll: f.logAll,
      notifyOnFailureUserIds: f.notifyMe && members[0] ? [members[0].user.id] : [],
      addToCalendar: f.calendar,
    },
  });
  const ready = f.event !== '' && f.actions.length > 0 && (!offset || Number(f.offsetValue) >= 0);
  const defKey = JSON.stringify(ready ? definition() : null);
  const preview = useApiQuery([...AUTOMATIONS_KEY, 'preview', defKey], async () =>
    ready ? api.automations.validate({ definition: definition(), sample: 5 }) : null,
  );
  const p = preview.data ?? undefined;

  const options = { invalidate: [...AUTOMATIONS_KEY] };
  const save = useApiMutation(async (activate: boolean) => {
    const meta = {
      name: f.name.trim(),
      category: f.category,
      priority: f.priority,
      expiresOn: f.expires && f.expiresOn ? f.expiresOn : null,
    };
    let rule: AutomationRuleDetail;
    if (saved) {
      rule = await api.automations.updateRule(saved.id, { ...meta, etag: saved.etag });
      rule = await api.automations.saveDefinition(saved.id, {
        definition: definition(),
        etag: rule.etag,
      });
    } else {
      rule = await api.automations.createRule({
        ...meta,
        definition: definition(),
        activate: false,
      });
    }
    if (activate && rule.status !== 'ACTIVE')
      rule = await api.automations.activate(rule.id, { etag: rule.etag });
    if (!activate && !f.enabled && rule.status === 'ACTIVE')
      rule = await api.automations.pause(rule.id, { etag: rule.etag });
    return rule;
  }, options);
  const check = (): boolean => {
    const e: typeof errors = {};
    if (!f.name.trim()) e.name = 'Enter the rule name';
    if (!f.event) e.event = 'Choose what starts the automation';
    if (f.actions.length === 0) e.actions = 'Add at least one action';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const run = (activate: boolean, then?: (r: AutomationRuleDetail) => void) => {
    if (!check()) return;
    save.mutate(activate, {
      onSuccess: (r) => {
        setSaved(r);
        setMessage({
          text: activate ? `${r.name} is active.` : 'Rule saved as a draft.',
          tone: 'success',
        });
        if (then) then(r);
        else if (!id) router.replace(`/automations/${r.id}/edit`);
      },
      onError: (e) => setMessage({ text: errorMessage(e, AUTOMATION_ERRORS), tone: 'error' }),
    });
  };

  const step = !f.event ? '1' : f.actions.length === 0 ? '3' : !f.name.trim() ? '4' : '5';
  const setCond = (k: string, change: Partial<Cond>) =>
    set({ conditions: f.conditions.map((c) => (c.key === k ? { ...c, ...change } : c)) });
  const setAct = (aid: string, change: Partial<Act>) =>
    set({ actions: f.actions.map((a) => (a.id === aid ? { ...a, ...change } : a)) });
  const catalogModule = (m: string) => catalog.modules.find((x) => x.module === m)?.label ?? m;
  const section = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
  const head = (n: number, title: string, hint: string, aside?: React.ReactNode) => (
    <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
        >
          {n}
        </span>
        <div>
          <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
          <p className="text-sm text-muted">{hint}</p>
        </div>
      </div>
      {aside}
    </header>
  );

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="rule-builder">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/automations" aria-label="Back to Automation" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/automations" className="text-link">
          Automation
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">
          {id ? 'Edit Automation Rule' : 'Create Automation Rule'}
        </span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-navigation text-on-action">
            <Gear aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1
              className="font-display text-3xl font-bold text-heading sm:text-4xl"
              data-testid="builder-title"
            >
              {id ? 'Edit' : 'Create'} Automation Rule
            </h1>
            <p className="text-base text-muted">Set up a workflow that runs automatically.</p>
          </div>
        </div>
        <Link href="/automations" className={outlined}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Automation
        </Link>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      {saved?.status === 'ARCHIVED' ? (
        <p className="rounded-lg bg-info-soft p-3 text-sm text-info">
          This rule is archived. Restore it from the list to change it.
        </p>
      ) : null}

      <section className={section} aria-label="Steps">
        <Stepper
          variant="wizard"
          label="Rule steps"
          current={step}
          steps={[
            { id: '1', label: 'Trigger' },
            { id: '2', label: 'Conditions' },
            { id: '3', label: 'Actions' },
            { id: '4', label: 'Settings' },
            { id: '5', label: 'Review' },
          ]}
        />
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <section className={section} data-testid="step-trigger">
            {head(1, 'Trigger', 'Choose what starts this automation.')}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Select
                label="Trigger Category *"
                value={f.module}
                onChange={(e) =>
                  set({
                    module: e.target.value as AutomationModule,
                    event: '',
                    timing: 'IMMEDIATE',
                  })
                }
                options={catalog.modules.map((m) => ({ value: m.module, label: m.label }))}
              />
              <Select
                label="Trigger Type *"
                value={f.event}
                onChange={(e) => {
                  const next = catalog.events.find((x) => x.code === e.target.value);
                  set({
                    event: e.target.value,
                    timing: next?.timings.includes(f.timing)
                      ? f.timing
                      : (next?.timings[0] ?? 'IMMEDIATE'),
                  });
                }}
                options={[
                  {
                    value: '',
                    label: events.length ? 'Choose an event' : 'No events for this category',
                  },
                  ...events.map((e) => ({ value: e.code, label: e.label })),
                ]}
              />
              <Select
                label="When *"
                value={f.timing}
                disabled={!ev}
                onChange={(e) => set({ timing: e.target.value as Form['timing'] })}
                options={(ev?.timings ?? ['IMMEDIATE']).map((t) => ({
                  value: t,
                  label: {
                    IMMEDIATE: 'Immediately',
                    BEFORE: 'X days before',
                    AFTER: 'X days after',
                    SCHEDULED: 'On a schedule',
                  }[t],
                }))}
              />
              {offset ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    label={`${f.timing === 'BEFORE' ? 'Before' : 'After'} *`}
                    type="number"
                    min={0}
                    value={f.offsetValue}
                    onChange={(e) => set({ offsetValue: e.target.value })}
                  />
                  <Select
                    label="Unit"
                    value={f.offsetUnit}
                    onChange={(e) => set({ offsetUnit: e.target.value as Form['offsetUnit'] })}
                    options={[
                      { value: 'MINUTE', label: 'Minutes' },
                      { value: 'HOUR', label: 'Hours' },
                      { value: 'DAY', label: 'Days' },
                    ]}
                  />
                </div>
              ) : null}
            </div>
            {errors.event ? <p className="mt-1 text-xs text-danger">{errors.event}</p> : null}
            {p ? (
              <p
                className="mt-3 flex items-start gap-2 rounded-lg bg-info-soft p-3 text-sm text-info"
                data-testid="trigger-hint"
              >
                <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" /> This
                automation will run: {p.triggerPreview}.
              </p>
            ) : ev ? (
              <p className="mt-3 text-sm text-muted">{ev.example}</p>
            ) : null}
          </section>

          <section className={section} data-testid="step-conditions">
            {head(
              2,
              'Conditions (Optional)',
              'Add conditions to control who this rule applies to.',
              <fieldset className="flex items-center gap-4">
                <legend className="sr-only">Match</legend>
                <Radio
                  name="match"
                  label="Match All"
                  checked={f.matchMode === 'ALL'}
                  onChange={() => set({ matchMode: 'ALL' })}
                />
                <Radio
                  name="match"
                  label="Match Any"
                  checked={f.matchMode === 'ANY'}
                  onChange={() => set({ matchMode: 'ANY' })}
                />
              </fieldset>,
            )}
            <div className="flex flex-col gap-2">
              {f.conditions.map((c, i) => {
                const def = ev?.conditionFields.find((x) => x.field === c.field);
                return (
                  <div
                    key={c.key}
                    className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]"
                  >
                    <Select
                      label={`Condition ${i + 1} field`}
                      hideLabel
                      value={c.field}
                      onChange={(e) => {
                        const nd = ev?.conditionFields.find((x) => x.field === e.target.value);
                        setCond(c.key, {
                          field: e.target.value,
                          operator: nd?.operators[0] ?? 'IS',
                          value: '',
                        });
                      }}
                      options={(ev?.conditionFields ?? []).map((x) => ({
                        value: x.field,
                        label: x.label,
                      }))}
                    />
                    <Select
                      label={`Condition ${i + 1} operator`}
                      hideLabel
                      value={c.operator}
                      onChange={(e) =>
                        setCond(c.key, { operator: e.target.value as AutomationOperator })
                      }
                      options={(def?.operators ?? ['IS']).map((o) => ({
                        value: o,
                        label: o.toLowerCase().replace(/_/g, ' '),
                      }))}
                    />
                    {def && def.options.length > 0 ? (
                      <Select
                        label={`Condition ${i + 1} value`}
                        hideLabel
                        value={c.value}
                        onChange={(e) => setCond(c.key, { value: e.target.value })}
                        options={[{ value: '', label: 'Choose…' }, ...def.options]}
                      />
                    ) : (
                      <Input
                        label={`Condition ${i + 1} value`}
                        hideLabel
                        value={c.value}
                        onChange={(e) => setCond(c.key, { value: e.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      aria-label={`Delete condition ${i + 1}`}
                      onClick={() =>
                        set({ conditions: f.conditions.filter((x) => x.key !== c.key) })
                      }
                      className="inline-flex size-10 items-center justify-center rounded-lg text-danger hover:bg-canvas"
                    >
                      <Trash aria-hidden weight="fill" className="size-5" />
                    </button>
                  </div>
                );
              })}
              {f.conditions.length === 0 ? (
                <p className="text-sm text-muted">No conditions: it applies to all clients.</p>
              ) : null}
              <button
                type="button"
                className={`${outlined} w-fit`}
                disabled={!ev}
                onClick={() => {
                  const first = ev?.conditionFields[0];
                  if (first)
                    set({
                      conditions: [
                        ...f.conditions,
                        {
                          key: key(),
                          field: first.field,
                          operator: first.operators[0] ?? 'IS',
                          value: '',
                        },
                      ],
                    });
                }}
              >
                <Plus aria-hidden weight="bold" className="size-4" /> Add Condition
              </button>
            </div>
          </section>

          <section className={section} data-testid="step-actions">
            {head(3, 'Actions', 'Choose what happens when the trigger and conditions are met.')}
            <div className="flex flex-col gap-3">
              {f.actions.map((a, i) => {
                const info = catalog.actions.find((x) => x.type === a.type);
                return (
                  <div
                    key={a.id}
                    className="grid gap-2 rounded-lg border border-divider p-3 lg:grid-cols-[14rem_1fr_11rem_auto]"
                    data-testid="action-row"
                  >
                    <Select
                      label={`Action ${i + 1}`}
                      value={a.type}
                      onChange={(e) => setAct(a.id, { type: e.target.value, config: {} })}
                      options={catalog.actions.map((x) => ({ value: x.type, label: x.label }))}
                    />
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
                      {(info?.fields ?? []).map((fld) => (
                        <ActionField
                          key={fld.key}
                          field={fld}
                          actionLabel={`Action ${i + 1}`}
                          value={a.config[fld.key]}
                          members={members.map((m) => ({ value: m.user.id, label: m.user.name }))}
                          onChange={(v) => setAct(a.id, { config: { ...a.config, [fld.key]: v } })}
                        />
                      ))}
                      {i > 0 ? (
                        <Select
                          label={`Action ${i + 1} runs after`}
                          value={a.dependsOn}
                          onChange={(e) => setAct(a.id, { dependsOn: e.target.value })}
                          options={[
                            { value: '', label: 'Runs on its own' },
                            ...f.actions
                              .slice(0, i)
                              .map((x, j) => ({ value: x.id, label: `After action ${j + 1}` })),
                          ]}
                        />
                      ) : null}
                    </div>
                    <Select
                      label={`Action ${i + 1} timing`}
                      value={a.delay}
                      onChange={(e) => setAct(a.id, { delay: e.target.value })}
                      options={DELAYS}
                    />
                    <button
                      type="button"
                      aria-label={`Delete action ${i + 1}`}
                      onClick={() =>
                        set({
                          actions: f.actions
                            .filter((x) => x.id !== a.id)
                            .map((x) => (x.dependsOn === a.id ? { ...x, dependsOn: '' } : x)),
                        })
                      }
                      className="inline-flex size-10 items-center justify-center self-end rounded-lg text-danger hover:bg-canvas"
                    >
                      <Trash aria-hidden weight="fill" className="size-5" />
                    </button>
                  </div>
                );
              })}
              {errors.actions ? <p className="text-xs text-danger">{errors.actions}</p> : null}
              <button
                type="button"
                className={`${outlined} w-fit`}
                onClick={() =>
                  set({
                    actions: [
                      ...f.actions,
                      {
                        id: actionId(f.actions),
                        type: catalog.actions[0]?.type ?? 'CREATE_TASK',
                        config: {},
                        delay: '0',
                        dependsOn: '',
                      },
                    ],
                  })
                }
              >
                <Plus aria-hidden weight="bold" className="size-4" /> Add Action
              </button>
            </div>
          </section>

          <section className={section} data-testid="step-settings">
            {head(4, 'Settings', 'Configure additional options.')}
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Rule Name *"
                value={f.name}
                maxLength={120}
                onChange={(e) => set({ name: e.target.value })}
                {...(errors.name ? { error: errors.name } : {})}
              />
              <Select
                label="Rule Category *"
                value={f.category}
                onChange={(e) => set({ category: e.target.value as AutomationModule })}
                options={catalog.modules.map((m) => ({ value: m.module, label: m.label }))}
              />
              <Select
                label="Priority"
                value={f.priority}
                onChange={(e) => set({ priority: e.target.value as Form['priority'] })}
                options={[
                  { value: 'HIGH', label: 'High' },
                  { value: 'MEDIUM', label: 'Medium' },
                  { value: 'LOW', label: 'Low' },
                ]}
              />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Checkbox
                label="Enable rule (runs automatically when active)"
                checked={f.enabled}
                onChange={(e) => set({ enabled: e.target.checked })}
              />
              <Checkbox
                label="Notify me if rule fails"
                checked={f.notifyMe}
                onChange={(e) => set({ notifyMe: e.target.checked })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  label="Prevent duplicate actions (within"
                  checked={f.dedupe}
                  onChange={(e) => set({ dedupe: e.target.checked })}
                />
                <input
                  type="number"
                  min={1}
                  max={365}
                  aria-label="Duplicate window in days"
                  value={f.dedupeDays}
                  disabled={!f.dedupe}
                  onChange={(e) => set({ dedupeDays: e.target.value })}
                  className="min-h-9 w-16 rounded-control border border-border bg-surface px-2 text-sm disabled:bg-canvas"
                />
                <span className="text-sm text-text">days)</span>
              </div>
              <Checkbox
                label="Add to calendar"
                checked={f.calendar}
                onChange={(e) => set({ calendar: e.target.checked })}
              />
              <Checkbox
                label="Log all activity"
                checked={f.logAll}
                onChange={(e) => set({ logAll: e.target.checked })}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox
                  label="Set expiration date (optional)"
                  checked={f.expires}
                  onChange={(e) => set({ expires: e.target.checked })}
                />
                <input
                  type="date"
                  aria-label="Expiration date"
                  value={f.expiresOn}
                  disabled={!f.expires}
                  onChange={(e) => set({ expiresOn: e.target.value })}
                  className="min-h-9 rounded-control border border-border bg-surface px-2 text-sm disabled:bg-canvas"
                />
              </div>
            </div>
          </section>

          <section className={section} data-testid="step-review">
            {head(5, 'Review & Activate', 'Review your rule details before saving.')}
            {p ? (
              <PreviewPanel preview={p} />
            ) : (
              <p className={quiet}>
                {preview.isError
                  ? 'The review is not available right now.'
                  : 'Choose a trigger and add an action to see the review.'}
              </p>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Rule summary">
          <section className="rounded-xl bg-success-soft p-4" data-testid="rule-summary">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Rule Summary</h2>
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-text">Name:</dt>
              <dd className="break-words text-heading">{f.name || '—'}</dd>
              <dt className="text-text">Trigger:</dt>
              <dd className="text-heading">{p?.triggerPreview ?? ev?.label ?? '—'}</dd>
              <dt className="text-text">Conditions:</dt>
              <dd className="text-heading">
                {f.conditions.length === 0
                  ? 'None'
                  : f.conditions
                      .map(
                        (c) =>
                          `${ev?.conditionFields.find((x) => x.field === c.field)?.label ?? c.field}: ${ev?.conditionFields.find((x) => x.field === c.field)?.options.find((o) => o.value === c.value)?.label ?? (c.value || '…')}`,
                      )
                      .join('; ')}
              </dd>
              <dt className="text-text">Actions:</dt>
              <dd className="text-heading">
                {f.actions.length === 0 ? (
                  '—'
                ) : (
                  <ul className="list-disc pl-4">
                    {f.actions.map((a) => (
                      <li key={a.id}>
                        {catalog.actions
                          .find((x) => x.type === a.type)
                          ?.label.replace(' (optional)', '')}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
              <dt className="text-text">Category:</dt>
              <dd className="text-heading">{catalogModule(f.category)}</dd>
              <dt className="text-text">Priority:</dt>
              <dd className="flex items-center gap-1 text-heading">
                <Flag
                  aria-hidden
                  weight="fill"
                  className={`size-4 ${f.priority === 'HIGH' ? 'text-danger' : f.priority === 'MEDIUM' ? 'text-action' : 'text-success'}`}
                />
                {f.priority.charAt(0) + f.priority.slice(1).toLowerCase()}
              </dd>
              <dt className="text-text">Status:</dt>
              <dd className="text-heading">
                {saved
                  ? saved.status.charAt(0) + saved.status.slice(1).toLowerCase()
                  : f.enabled
                    ? 'Active when saved'
                    : 'Draft'}
              </dd>
            </dl>
          </section>
          <section className={card} data-testid="affects">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Affects</h2>
            {p ? (
              <>
                <p className="text-sm text-text">{appliesLine(f, ev)}</p>
                <button
                  type="button"
                  className={`${outlined} mt-3 w-full justify-between`}
                  onClick={() => setMatching(true)}
                >
                  View Matching Clients ({p.matchCount})
                </button>
              </>
            ) : (
              <p className={quiet}>Add a trigger and an action to see who it affects.</p>
            )}
          </section>
          <section className={card} data-testid="related">
            <h2 className="mb-2 font-display text-lg font-bold text-heading">Related Templates</h2>
            {p && p.templates.length > 0 ? (
              <ul className="flex flex-col text-sm">
                {p.templates.map((t) => (
                  <li key={t.id} className="border-t border-divider py-1.5 first:border-t-0">
                    <span className="font-semibold text-heading">{t.kind}:</span> {t.name}
                    {t.active ? '' : ' (not active)'}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={quiet}>No templates are used yet.</p>
            )}
            <Link href="/templates" className={`${outlined} mt-3 w-full`}>
              Edit Templates
            </Link>
          </section>
          <aside
            className="flex items-start gap-3 rounded-xl bg-success-soft p-4"
            aria-label="Pro Tip"
          >
            <Lightbulb aria-hidden weight="fill" className="size-6 shrink-0 text-success" />
            <div>
              <h2 className="text-sm font-bold text-heading">Pro Tip</h2>
              <p className="text-sm text-text">
                Use templates to save time and ensure consistency across your workflows.
              </p>
            </div>
          </aside>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/automations" className={subtle}>
          Cancel
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={outlined}
            disabled={save.isPending}
            onClick={() => {
              if (!check()) return;
              if (saved) setTemplate(true);
              else
                run(false, (r) => {
                  setSaved(r);
                  setTemplate(true);
                  router.replace(`/automations/${r.id}/edit`);
                });
            }}
          >
            Save as Template
          </button>
          <button
            type="button"
            className={outlined}
            disabled={save.isPending || saved?.status === 'ARCHIVED'}
            data-testid="save-draft"
            onClick={() => run(false)}
          >
            Save as Draft
          </button>
          <button
            type="button"
            className={filled}
            disabled={save.isPending || saved?.status === 'ARCHIVED'}
            data-testid="save-activate"
            onClick={() => {
              set({ enabled: true });
              run(true, (r) => {
                if (!id) router.replace(`/automations/${r.id}/edit`);
              });
            }}
          >
            Save &amp; Activate
          </button>
        </div>
      </footer>
      {template && saved ? (
        <SaveTemplateDialog
          id={saved.id}
          name={f.name || saved.name}
          onClose={() => setTemplate(false)}
          onDone={() => {
            setTemplate(false);
            setMessage({ text: 'Saved as a template.', tone: 'success' });
          }}
        />
      ) : null}
      {matching && p ? (
        <Modal
          open
          title="Matching records"
          subtitle={`${p.matchCount} match right now. This is a count, nothing runs.`}
          onClose={() => setMatching(false)}
          footer={
            <Button variant="secondary" onClick={() => setMatching(false)}>
              Close
            </Button>
          }
        >
          <ul className="rounded-lg border border-divider" data-testid="matching">
            {p.sample.length === 0 ? (
              <li className="p-3 text-sm text-muted">No record matches yet.</li>
            ) : (
              p.sample.map((s) => (
                <li
                  key={s.recordId}
                  className="border-t border-divider px-3 py-1.5 text-sm first:border-t-0"
                >
                  {s.label}
                </li>
              ))
            )}
          </ul>
        </Modal>
      ) : null}
    </div>
  );
}

const appliesLine = (f: Form, ev: AutomationCatalog['events'][number] | undefined) =>
  f.conditions.length === 0
    ? 'Applies to all clients that reach the trigger.'
    : `Applies to clients where ${f.conditions
        .map(
          (c) =>
            `${ev?.conditionFields.find((x) => x.field === c.field)?.label ?? c.field} ${c.operator.toLowerCase().replace(/_/g, ' ')} ${ev?.conditionFields.find((x) => x.field === c.field)?.options.find((o) => o.value === c.value)?.label ?? c.value}`,
        )
        .join(f.matchMode === 'ANY' ? ' or ' : ' and ')}.`;

/** One field of an action's settings, by its type. */
function ActionField({
  field,
  actionLabel,
  value,
  members,
  onChange,
}: {
  field: AutomationActionField;
  actionLabel: string;
  value: string | number | boolean | string[] | null | undefined;
  members: { value: string; label: string }[];
  onChange: (v: string | number | boolean | string[] | null) => void;
}) {
  const label = `${actionLabel}: ${field.label}${field.required ? ' *' : ''}`;
  const templates = useApiQuery(
    ['automations', 'template-choices', field.templateKind ?? ''],
    async () =>
      field.type === 'TEMPLATE' && field.templateKind
        ? api.templates.list({
            kind: field.templateKind as 'EMAIL',
            status: 'ACTIVE',
            automations: true,
            pageSize: 100,
          })
        : { items: [] },
  );
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (field.type === 'TEMPLATE') {
    const rows = templates.data?.items ?? [];
    return (
      <Select
        label={label}
        value={text}
        onChange={(e) => onChange(e.target.value || null)}
        options={[
          { value: '', label: rows.length ? 'Choose a template' : 'No templates available' },
          ...(text && !rows.some((t) => t.id === text)
            ? [{ value: text, label: 'Selected template' }]
            : []),
          ...rows.map((t) => ({ value: t.id, label: t.name })),
        ]}
      />
    );
  }
  if (field.type === 'MEMBER')
    return (
      <Select
        label={label}
        value={text}
        onChange={(e) => onChange(e.target.value || null)}
        options={[{ value: '', label: 'Unassigned' }, ...members]}
      />
    );
  if (field.type === 'SELECT' || field.type === 'DATE_RULE')
    return (
      <Select
        label={label}
        value={text}
        onChange={(e) => onChange(e.target.value || null)}
        options={[{ value: '', label: 'Choose…' }, ...field.choices]}
      />
    );
  if (field.type === 'TOGGLE')
    return (
      <Checkbox
        label={label}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (field.type === 'LONG_TEXT')
    return (
      <Textarea label={label} value={text} rows={3} onChange={(e) => onChange(e.target.value)} />
    );
  if (field.type === 'NUMBER')
    return (
      <Input
        label={label}
        type="number"
        value={text}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  return <Input label={label} value={text} onChange={(e) => onChange(e.target.value)} />;
}
