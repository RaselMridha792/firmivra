'use client';

import { Badge, Button, Callout, Modal, Select } from '@firmivra/ui';
import {
  type Icon,
  PencilSimple,
  Plus,
  Trash,
  TreeStructure,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import {
  CHOICE_TYPES,
  type DraftQuestion,
  type DraftSection,
  type FormDraft,
  LAYOUT_TYPES,
} from './builder-draft';
import type { BuilderState } from './builder-parts';

/** "Show this question only when <earlier question> equals <value>" (the contract's `showIf`). */
type Rule = NonNullable<DraftQuestion['showIf']>;

/** A question with its section and its place in the whole form (0 is the first question). */
interface Placed {
  question: DraftQuestion;
  section: DraftSection;
  at: number;
}

/** One answer a rule can wait for. `id` is the select's value: the choice, or "true" / "false". */
interface Answer {
  id: string;
  value: string | boolean;
  label: string;
}

const BROKEN = 'The trigger question changed; edit or remove this rule.';

/** Every question of the form in order, with its section. */
const placeAll = (d: FormDraft): Placed[] =>
  d.sections
    .flatMap((section) => section.questions.map((question) => ({ question, section })))
    .map((p, at) => ({ ...p, at }));

const takesAnswer = (p: Placed) => !LAYOUT_TYPES.includes(p.question.type);

/**
 * The fixed answers a rule can wait for: a Multiple Choice, Dropdown or Checkboxes question's
 * choices, or Yes and No. Other types have none, so they cannot start a rule.
 */
function answersOf(q: DraftQuestion): Answer[] {
  if (q.type === 'YES_NO') {
    return [
      { id: 'true', value: true, label: 'Yes' },
      { id: 'false', value: false, label: 'No' },
    ];
  }
  if (!CHOICE_TYPES.includes(q.type)) return [];
  return [...new Set(q.options.filter((o) => o.trim()))].map((o) => ({
    id: o,
    value: o,
    label: o,
  }));
}

/** The questions a rule on `target` can wait for: earlier ones with fixed answers. */
const triggersFor = (all: Placed[], target: Placed) =>
  all.filter((p) => p.at < target.at && answersOf(p.question).length > 0);

/** Questions that can take a new rule: answerable, no rule yet (or the one edited), a trigger before. */
const targetsFor = (all: Placed[], editing: string | null) =>
  all.filter(
    (p) =>
      takesAnswer(p) &&
      (!p.question.showIf || p.question.key === editing) &&
      triggersFor(all, p).length > 0,
  );

const named = (p: Placed) =>
  `${p.question.label || 'Untitled question'} (${p.section.title || 'Untitled section'})`;

const said = (v: Rule['equals']) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

const withoutRule = (q: DraftQuestion): DraftQuestion => {
  const { showIf: _rule, ...rest } = q;
  return rest;
};

/** A row's icon button (Edit, Remove), as the Form Builder tab draws them. */
function RuleAction({
  label,
  icon: Glyph,
  danger = false,
  onClick,
}: {
  label: string;
  icon: Icon;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex size-10 shrink-0 items-center justify-center rounded-control hover:bg-canvas ${danger ? 'text-danger' : 'text-heading'}`}
    >
      <Glyph aria-hidden weight="fill" className="size-5" />
    </button>
  );
}

/**
 * The Logic & Rules tab: conditional questions. Each rule shows a question only when an earlier
 * Multiple Choice, Dropdown, Checkboxes or Yes / No question has a set answer (guide Frame 1: only
 * "equals" until the condition editor is designed). A rule whose trigger was deleted, moved after
 * it, or lost the answer stays listed with a warning until it is edited or removed.
 */
export function LogicRules({ state }: { state: BuilderState }) {
  /** The question whose rule is open in the dialog; `{ key: null }` adds a new rule. */
  const [editing, setEditing] = useState<{ key: string | null } | null>(null);
  const all = placeAll(state.draft);
  const rules = all.filter((p) => p.question.showIf);
  const open = targetsFor(all, null);
  const canStart = all.some((p) => takesAnswer(p) && triggersFor(all, p).length > 0);

  /** Sets (or with `rule` null, removes) the rule on `target`; `before` loses its rule if moved. */
  const setRule = (target: string, rule: Rule | null, before: string | null = null) =>
    state.update((d) => ({
      ...d,
      sections: d.sections.map((s) => ({
        ...s,
        questions: s.questions.map((q) => {
          if (q.key === target) return rule ? { ...q, showIf: rule } : withoutRule(q);
          return q.key === before ? withoutRule(q) : q;
        }),
      })),
    }));

  const toBuilder = (
    <Link
      href={`/intake-forms/builder/${state.id}`}
      className="font-semibold text-action hover:underline"
    >
      Form Builder
    </Link>
  );
  let quiet: ReactNode = null;
  if (!all.some(takesAnswer)) {
    quiet = <>No questions yet. Add questions in {toBuilder}, then set rules here.</>;
  } else if (!canStart) {
    quiet = (
      <>
        A rule waits for an answer to a Multiple Choice, Checkboxes, Dropdown or Yes / No question.
        Add one in {toBuilder}, above the question it should show.
      </>
    );
  } else if (!open.length) {
    quiet = 'Every question that can take a rule has one.';
  } else if (!rules.length) {
    quiet = 'No rules yet. Every question is shown to every client.';
  }

  return (
    <div
      data-testid="logic-rules"
      className="flex flex-col gap-3 rounded-lg border border-divider bg-canvas p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-heading">Conditional Questions</h3>
          <p className="text-sm text-muted">
            Show a question only when the client gives a set answer to an earlier question.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!open.length}
          onClick={() => setEditing({ key: null })}
        >
          <Plus aria-hidden weight="fill" className="size-4" />
          Add Rule
        </Button>
      </div>

      {rules.length ? (
        <ul aria-label="Rules" className="flex flex-col gap-2">
          {rules.map((p) => {
            const rule = p.question.showIf;
            if (!rule) return null;
            const trigger = all.find((t) => t.question.key === rule.questionKey);
            const broken =
              !trigger ||
              trigger.at >= p.at ||
              !answersOf(trigger.question).some((a) => a.value === rule.equals);
            const label = p.question.label || 'Untitled question';
            return (
              <li
                key={p.question.key}
                data-testid="logic-rule"
                data-broken={broken ? 'true' : undefined}
                className="flex flex-col gap-2 rounded-lg border border-divider bg-surface p-3 shadow-sm"
              >
                <div className="flex items-start gap-2">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-action">
                    <TreeStructure aria-hidden weight="fill" className="size-5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="break-words font-semibold text-heading">{label}</p>
                    <p className="break-words text-xs text-muted">
                      {p.section.title || 'Untitled section'}
                    </p>
                    <p className="break-words text-sm text-muted">
                      when{' '}
                      <span className="font-medium text-heading">
                        {trigger
                          ? trigger.question.label || 'Untitled question'
                          : 'a deleted question'}
                      </span>{' '}
                      is <Badge tone="info">{said(rule.equals)}</Badge>
                    </p>
                  </div>
                  <RuleAction
                    label={`Edit rule for ${label}`}
                    icon={PencilSimple}
                    onClick={() => setEditing({ key: p.question.key })}
                  />
                  <RuleAction
                    label={`Remove rule for ${label}`}
                    icon={Trash}
                    danger
                    onClick={() => setRule(p.question.key, null)}
                  />
                </div>
                {broken ? (
                  <Callout icon={WarningCircle} tone="amber" surface="warning" size="compact">
                    {BROKEN}
                  </Callout>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {quiet ? (
        <p data-testid="logic-quiet" className="rounded-lg bg-surface p-3 text-sm text-muted">
          {quiet}
        </p>
      ) : null}

      {editing ? (
        <RuleEditor
          all={all}
          editing={editing.key}
          onClose={() => setEditing(null)}
          onSave={(target, rule) => {
            setRule(target, rule, editing.key);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

interface Choice {
  target: string;
  trigger: string;
  answer: string;
}

/** The dialog's choices for a question: the nearest earlier trigger and its first answer. */
function choose(all: Placed[], target: Placed | undefined, prefer?: Rule): Choice {
  if (!target) return { target: '', trigger: '', answer: '' };
  const triggers = triggersFor(all, target);
  const trigger = triggers.find((t) => t.question.key === prefer?.questionKey) ?? triggers.at(-1);
  const answers = trigger ? answersOf(trigger.question) : [];
  const answer = answers.find((a) => a.value === prefer?.equals) ?? answers[0];
  return {
    target: target.question.key,
    trigger: trigger?.question.key ?? '',
    answer: answer?.id ?? '',
  };
}

/**
 * Add Rule / Edit Rule: the question to show, the earlier question it waits on (only questions
 * with fixed answers that come before it, so a question never waits on itself or a later one), and
 * the answer.
 */
function RuleEditor({
  all,
  editing,
  onSave,
  onClose,
}: {
  all: Placed[];
  /** The question whose rule is edited; null for a new rule. */
  editing: string | null;
  onSave: (target: string, rule: Rule) => void;
  onClose: () => void;
}) {
  const targets = targetsFor(all, editing);
  const [pick, setPick] = useState<Choice>(() => {
    const start = editing ? targets.find((p) => p.question.key === editing) : targets[0];
    return choose(all, start, start?.question.showIf);
  });
  const target = targets.find((p) => p.question.key === pick.target);
  const triggers = target ? triggersFor(all, target) : [];
  const trigger = triggers.find((p) => p.question.key === pick.trigger);
  const answers = trigger ? answersOf(trigger.question) : [];
  const answer = answers.find((a) => a.id === pick.answer);

  return (
    <Modal
      open
      title={editing ? 'Edit Rule' : 'Add Rule'}
      subtitle="Show a question only after a set answer to an earlier question."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!target || !trigger || !answer}
            onClick={() => {
              if (target && trigger && answer) {
                onSave(target.question.key, {
                  questionKey: trigger.question.key,
                  equals: answer.value,
                });
              }
            }}
          >
            Save Rule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Show this question"
          options={[
            ...(target ? [] : [{ value: '', label: 'Choose a question…' }]),
            ...targets.map((p) => ({ value: p.question.key, label: named(p) })),
          ]}
          value={pick.target}
          onChange={(ev) =>
            setPick(
              choose(
                all,
                targets.find((p) => p.question.key === ev.target.value),
              ),
            )
          }
        />
        <div className="flex flex-col gap-1">
          <Select
            label="When the answer to"
            options={
              triggers.length
                ? triggers.map((p) => ({ value: p.question.key, label: named(p) }))
                : [{ value: '', label: 'Choose the question to show first' }]
            }
            value={pick.trigger}
            disabled={!triggers.length}
            onChange={(ev) => {
              const next = triggers.find((p) => p.question.key === ev.target.value);
              setPick({
                ...pick,
                trigger: ev.target.value,
                answer: next ? (answersOf(next.question)[0]?.id ?? '') : '',
              });
            }}
          />
          <p className="text-xs text-muted">
            Only earlier Multiple Choice, Checkboxes, Dropdown and Yes / No questions can be chosen.
          </p>
        </div>
        <Select
          label="Is"
          options={
            answers.length
              ? answers.map((a) => ({ value: a.id, label: a.label }))
              : [{ value: '', label: 'Choose the question first' }]
          }
          value={pick.answer}
          disabled={!answers.length}
          onChange={(ev) => setPick({ ...pick, answer: ev.target.value })}
        />
      </div>
    </Modal>
  );
}
