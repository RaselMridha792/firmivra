'use client';

import type {
  ComplianceApplicabilityRule,
  ComplianceRuleEvaluation,
  ComplianceSuggestion,
} from '@firmivra/types';
import { COMPLIANCE_STATES } from '@firmivra/types';
import {
  Badge,
  Button,
  Checkbox,
  type Column,
  Input,
  Modal,
  Table,
  Textarea,
  Toast,
  Toggle,
} from '@firmivra/ui';
import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  Label,
  Selectbox,
  dayText,
  quiet,
  subtle,
} from './compliance-shared';

const frame = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';
const ENTITY_TYPES = [
  'Individual',
  'Sole Proprietor',
  'Single-Member LLC',
  'LLC (Multi-Member)',
  'S Corporation',
  'C Corporation',
  'Partnership',
  'Nonprofit',
];
const SERVICES = [
  { value: 'ANNUAL_TAX', label: 'Annual Tax' },
  { value: 'QUARTERLY_TAX', label: 'Quarterly Tax' },
  { value: 'BOOKKEEPING', label: 'Bookkeeping' },
  { value: 'PAYROLL', label: 'Payroll' },
  { value: 'TAX_PLANNING', label: 'Tax Planning' },
] as const;

const summaryOf = (r: ComplianceApplicabilityRule) =>
  [
    r.entityTypes.length ? r.entityTypes.join(', ') : 'All entity types',
    r.states.length ? r.states.join(', ') : 'all states',
    r.services.length
      ? r.services.map((s) => SERVICES.find((x) => x.value === s)?.label ?? s).join(', ')
      : '',
    r.priorYearLiabilityOverCents
      ? `prior-year liability over $${(r.priorYearLiabilityOverCents / 100).toLocaleString('en-US')}`
      : '',
    r.excludeStatuses.length ? `excluding ${r.excludeStatuses.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** The "Applicability Rules" tab: who gets or is suggested each deadline, and the open suggestions. */
export function RulesTab() {
  const [page, setPage] = useState(1);
  const rules = useApiQuery([...COMPLIANCE_KEY, 'rules', page], () =>
    api.compliance.rules({ page, pageSize: 10 }),
  );
  const suggestions = useApiQuery([...COMPLIANCE_KEY, 'suggestions'], () =>
    api.compliance.suggestions({ pageSize: 25 }),
  );
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [creating, setCreating] = useState(false);
  const [checked, setChecked] = useState<ComplianceRuleEvaluation>();
  const [dismissing, setDismissing] = useState<ComplianceSuggestion>();
  const options = { invalidate: [...COMPLIANCE_KEY] };
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' });
  const toggle = useApiMutation(
    (v: { id: string; active: boolean }) => api.compliance.updateRule(v.id, { active: v.active }),
    options,
  );
  const evaluate = useApiMutation((id: string) => api.compliance.evaluateRule(id), {});
  const generate = useApiMutation(
    (id: string) => api.compliance.generateSuggestions({ ruleId: id }),
    options,
  );
  const confirm = useApiMutation((id: string) => api.compliance.confirmSuggestion(id), options);

  const columns: Column<ComplianceApplicabilityRule>[] = [
    {
      id: 'name',
      label: 'Rule',
      cell: (r) => <span className="font-medium text-heading">{r.name}</span>,
    },
    { id: 'target', label: 'Deadline', cell: (r) => r.target.name },
    { id: 'who', label: 'Applies to', cell: (r) => summaryOf(r) },
    {
      id: 'outcome',
      label: 'Then',
      cell: (r) => (
        <Badge tone={r.outcome === 'APPLY' ? 'info' : 'neutral'}>
          {r.outcome === 'APPLY' ? 'Apply' : 'Suggest'}
        </Badge>
      ),
    },
    {
      id: 'active',
      label: 'On',
      cell: (r) => (
        <Toggle
          label={`${r.name} is on`}
          checked={r.active}
          onChange={(active) => toggle.mutate({ id: r.id, active }, { onError: fail })}
        />
      ),
    },
  ];
  const sColumns: Column<ComplianceSuggestion>[] = [
    {
      id: 'client',
      label: 'Client',
      cell: (s) => <span className="font-medium text-heading">{s.client.displayName}</span>,
    },
    { id: 'name', label: 'Deadline', cell: (s) => s.name },
    { id: 'due', label: 'Due', cell: (s) => dayText(s.dueOn) },
    { id: 'why', label: 'Why', cell: (s) => s.reason },
    {
      id: 'state',
      label: 'State',
      cell: (s) => (
        <Badge tone={s.decision === 'NEEDS_REVIEW' ? 'warning' : 'info'}>
          {s.decision === 'NEEDS_REVIEW' ? 'Needs review' : 'Suggested'}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="rules-tab">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section className={frame} aria-label="Applicability Rules">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-heading">Applicability Rules</h2>
            <p className="text-sm text-muted">
              Imported government deadlines are only suggested until a rule says they apply.
            </p>
          </div>
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden weight="bold" className="mr-2 inline size-4" /> New Rule
          </Button>
        </header>
        <div className="relative">
          <Table
            rows={rules.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            caption="Applicability rules"
            dense
            noun="rules"
            pageSize={10}
            loading={rules.isPending}
            emptyTitle={rules.isError ? 'Rules are not available' : 'No rules yet'}
            emptyText={
              rules.isError
                ? 'We could not load the rules. Try again in a moment.'
                : 'Add a rule to say which clients a deadline applies to.'
            }
            rowActions={(r) => (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={subtle}
                  aria-label={`Check ${r.name}`}
                  onClick={() => evaluate.mutate(r.id, { onSuccess: setChecked, onError: fail })}
                >
                  Check
                </button>
                <button
                  type="button"
                  className={subtle}
                  aria-label={`Generate suggestions for ${r.name}`}
                  onClick={() =>
                    generate.mutate(r.id, {
                      onSuccess: (g) =>
                        setMessage({
                          text: `${g.suggested + g.needsReview} suggestion(s) made${g.alreadyDecided ? `, ${g.alreadyDecided} already decided` : ''}.`,
                          tone: 'success',
                        }),
                      onError: fail,
                    })
                  }
                >
                  Generate
                </button>
              </div>
            )}
            server={{
              page: rules.data?.page ?? 1,
              total: rules.data?.total ?? 0,
              hasNext: (rules.data?.page ?? 1) * 10 < (rules.data?.total ?? 0),
              hasPrevious: (rules.data?.page ?? 1) > 1,
              onNext: () => setPage(page + 1),
              onPrevious: () => setPage(Math.max(1, page - 1)),
              onPage: (next: number) => setPage(next),
              onSort: () => undefined,
            }}
          />
        </div>
        {checked ? (
          <div
            className="mt-3 rounded-lg bg-canvas p-3 text-sm text-heading"
            data-testid="rule-check"
          >
            <p className="font-semibold">
              {checked.matchingCount} client(s) match, {checked.needsReviewCount} need review,{' '}
              {checked.excludedCount} excluded.
            </p>
            {checked.matching.length ? (
              <p className="mt-1 text-text">
                Match: {checked.matching.map((c) => c.displayName).join(', ')}
              </p>
            ) : null}
            {checked.needsReview.length ? (
              <ul className="mt-1 text-text">
                {checked.needsReview.map((n) => (
                  <li key={n.client.id}>
                    {n.client.displayName}: {n.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={frame} aria-label="Suggested deadlines">
        <h2 className="mb-1 font-display text-lg font-bold text-heading">Suggested Deadlines</h2>
        <p className="mb-3 text-sm text-muted">
          Confirm a suggestion to add the deadline to the client, or dismiss it with a reason.
        </p>
        <div className="relative">
          <Table
            rows={suggestions.data?.items ?? []}
            columns={sColumns}
            rowKey={(s) => s.id}
            caption="Suggested deadlines"
            dense
            noun="suggestions"
            pageSize={25}
            loading={suggestions.isPending}
            emptyTitle={
              suggestions.isError ? 'Suggestions are not available' : 'No suggestions to review'
            }
            emptyText={
              suggestions.isError
                ? 'We could not load the suggestions. Try again in a moment.'
                : 'Generate suggestions from a rule to see them here.'
            }
            rowActions={(s) => (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={subtle}
                  aria-label={`Confirm ${s.name} for ${s.client.displayName}`}
                  onClick={() =>
                    confirm.mutate(s.id, {
                      onSuccess: () => setMessage({ text: 'Deadline added.', tone: 'success' }),
                      onError: fail,
                    })
                  }
                >
                  Confirm
                </button>
                <button
                  type="button"
                  className={`${subtle} text-danger`}
                  aria-label={`Dismiss ${s.name} for ${s.client.displayName}`}
                  onClick={() => setDismissing(s)}
                >
                  Dismiss
                </button>
              </div>
            )}
          />
        </div>
      </section>
      {creating ? (
        <RuleDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setMessage({ text: 'Rule saved.', tone: 'success' });
          }}
        />
      ) : null}
      {dismissing ? (
        <DismissDialog
          suggestion={dismissing}
          onClose={() => setDismissing(undefined)}
          onDone={() => {
            setDismissing(undefined);
            setMessage({ text: 'Suggestion dismissed.', tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}

function DismissDialog({
  suggestion,
  onClose,
  onDone,
}: {
  suggestion: ComplianceSuggestion;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const send = useApiMutation(
    () => api.compliance.dismissSuggestion(suggestion.id, { reason: reason.trim() }),
    { invalidate: [...COMPLIANCE_KEY] },
  );
  return (
    <Modal
      open
      title="Dismiss Suggestion"
      subtitle={`${suggestion.name} for ${suggestion.client.displayName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: onDone })}
          >
            Dismiss
          </Button>
        </>
      }
    >
      <Textarea
        label="Why does this not apply?"
        value={reason}
        maxLength={400}
        onChange={(e) => setReason(e.target.value)}
      />
      {send.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(send.error, COMPLIANCE_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

function RuleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'CALENDAR_ENTRY' | 'RECURRENCE'>('CALENDAR_ENTRY');
  const [calendarId, setCalendarId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [outcome, setOutcome] = useState<'APPLY' | 'SUGGEST'>('SUGGEST');
  const [entities, setEntities] = useState<string[]>([]);
  const [states, setStates] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [exclude, setExclude] = useState('');
  const [liability, setLiability] = useState('');
  const [error, setError] = useState<string>();
  const calendars = useApiQuery([...COMPLIANCE_KEY, 'calendars', 'rule-target'], () =>
    api.compliance.calendars({ pageSize: 50 }),
  );
  const calendar = useApiQuery([...COMPLIANCE_KEY, 'calendar', calendarId], async () =>
    calendarId ? api.compliance.getCalendar(calendarId) : undefined,
  );
  const recurrences = useApiQuery([...COMPLIANCE_KEY, 'recurrences', false, 'rule-target'], () =>
    api.compliance.recurrences({ templates: false, pageSize: 50 }),
  );
  const send = useApiMutation(
    () =>
      api.compliance.createRule({
        name: name.trim(),
        target: { kind, id: targetId },
        outcome,
        entityTypes: entities,
        states: states
          .split(/[,\s]+/)
          .map((x) => x.toUpperCase())
          .filter(Boolean) as (typeof COMPLIANCE_STATES)[number][],
        services: services as (
          'ANNUAL_TAX' | 'QUARTERLY_TAX' | 'BOOKKEEPING' | 'PAYROLL' | 'TAX_PLANNING'
        )[],
        excludeStatuses: exclude
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        priorYearLiabilityOverCents: liability ? Math.round(Number(liability) * 100) : null,
        active: true,
      }),
    { invalidate: [...COMPLIANCE_KEY] },
  );
  const flip = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  return (
    <Modal
      open
      title="New Applicability Rule"
      subtitle="Say which clients a deadline applies to."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={send.isPending}
            onClick={() => {
              if (!name.trim() || !targetId)
                return setError('Name the rule and choose its deadline');
              setError(undefined);
              send.mutate(undefined, {
                onSuccess: onDone,
                onError: (e) => setError(errorMessage(e, COMPLIANCE_ERRORS)),
              });
            }}
          >
            Save Rule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="rule-form">
        <Input
          label="Rule name"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
        <Selectbox
          label="Applies to a"
          value={kind}
          onChange={(v) => {
            setKind(v as typeof kind);
            setTargetId('');
          }}
          options={[
            { value: 'CALENDAR_ENTRY', label: 'Government calendar record' },
            { value: 'RECURRENCE', label: 'Recurring deadline' },
          ]}
        />
        {kind === 'CALENDAR_ENTRY' ? (
          <>
            <Selectbox
              label="Calendar"
              value={calendarId}
              onChange={(v) => {
                setCalendarId(v);
                setTargetId('');
              }}
              options={[
                { value: '', label: 'Select calendar' },
                ...(calendars.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Selectbox
              label="Record"
              value={targetId}
              disabled={!calendarId}
              onChange={setTargetId}
              options={[
                { value: '', label: 'Select record' },
                ...(calendar.data?.entries ?? []).map((e) => ({ value: e.id, label: e.name })),
              ]}
            />
          </>
        ) : (
          <Selectbox
            label="Recurring deadline"
            value={targetId}
            onChange={setTargetId}
            options={[
              { value: '', label: 'Select recurring deadline' },
              ...(recurrences.data?.items ?? []).map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
        )}
        <Selectbox
          label="When a client matches"
          value={outcome}
          onChange={(v) => setOutcome(v as typeof outcome)}
          options={[
            { value: 'SUGGEST', label: 'Suggest the deadline' },
            { value: 'APPLY', label: 'Add the deadline' },
          ]}
        />
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-text">
            Entity types (none means all)
          </legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {ENTITY_TYPES.map((t) => (
              <Checkbox
                key={t}
                label={t}
                checked={entities.includes(t)}
                onChange={() => setEntities(flip(entities, t))}
              />
            ))}
          </div>
        </fieldset>
        <Label text="States (two-letter codes, e.g. GA, NC)" htmlFor="rule-states">
          <input
            id="rule-states"
            value={states}
            onChange={(e) => setStates(e.target.value)}
            className="min-h-10 w-full rounded-control border border-border bg-surface px-3 text-sm"
          />
        </Label>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-text">Services</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {SERVICES.map((s) => (
              <Checkbox
                key={s.value}
                label={s.label}
                checked={services.includes(s.value)}
                onChange={() => setServices(flip(services, s.value))}
              />
            ))}
          </div>
        </fieldset>
        <Input
          label="Exclude client statuses (comma separated)"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
        />
        <Input
          label="Only if prior-year tax liability is over ($)"
          type="number"
          min={0}
          value={liability}
          onChange={(e) => setLiability(e.target.value)}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <p className={quiet}>
          The rule is saved with its version, so each deadline can say why it applies.
        </p>
      </div>
    </Modal>
  );
}
