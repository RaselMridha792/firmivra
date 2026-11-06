import { BadRequestException } from '@nestjs/common';
import type {
  AutomationCheck,
  AutomationCondition,
  AutomationDefinition,
  AutomationDefinitionView,
  AutomationEventSource,
  AutomationOperator,
} from '@firmivra/types';
import { actionOf, eventOf, OPERATORS, VARIABLE_KEYS } from './catalog.js';

// The pure parts of Automations: checking a definition against the catalog, putting it in words,
// testing a record against its conditions, finding loops and keeping a template free of secrets.

export type Def = ReturnType<(typeof AutomationDefinition)['parse']>;
type Detail = { path: string; message: string };

export const invalidDefinition = (details: Detail[]) =>
  new BadRequestException({
    code: 'INVALID_DEFINITION',
    message: 'The rule is not valid for the catalog',
    details,
  });

const TOKEN = /\{\{\s*([a-zA-Z.]+)\s*\}\}/g;
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------- Structure ----------

/** What the catalog refuses: an unknown event, field, operator or action type, a setting it does not have, a bad value. */
export function structureProblems(def: Def): Detail[] {
  const out: Detail[] = [];
  const add = (path: string, message: string) => out.push({ path, message });
  const event = eventOf(def.trigger.event);
  if (!event) add('trigger.event', 'This event is not in the catalog');
  else {
    if (event.module !== def.trigger.module)
      add('trigger.module', `This event belongs to ${event.module}`);
    if (!event.timings.includes(def.trigger.timing))
      add('trigger.timing', 'This event does not support this timing');
    if (def.trigger.source && !event.confirmation)
      add('trigger.source', 'Only a confirmed external outcome has a source to choose');
  }
  def.conditions.forEach((c, i) => {
    const at = `conditions.${i}`;
    const f = event?.conditionFields.find((x) => x.field === c.field);
    if (event && !f) return add(`${at}.field`, 'This event has no such field');
    if (!f) return;
    if (!OPERATORS[f.type].includes(c.operator))
      return add(`${at}.operator`, 'This field does not take this operator');
    const noValue = c.operator === 'EXISTS' || c.operator === 'NOT_EXISTS';
    if (noValue) {
      if (c.value !== undefined) add(`${at}.value`, 'This operator takes no value');
      return;
    }
    if (c.value === undefined) return add(`${at}.value`, 'Enter a value');
    const list = c.operator === 'INCLUDES' || c.operator === 'EXCLUDES';
    if (f.type === 'STATUS' || f.type === 'LIST') {
      const values = Array.isArray(c.value) ? c.value : [c.value];
      if (list && !Array.isArray(c.value)) return add(`${at}.value`, 'Choose one or more values');
      if (
        values.some(
          (v) =>
            typeof v !== 'string' || (f.options.length && !f.options.some((o) => o.value === v)),
        )
      )
        add(`${at}.value`, 'Choose from the field’s values');
      return;
    }
    if (Array.isArray(c.value)) return add(`${at}.value`, 'This operator takes one value');
    if ((f.type === 'NUMBER' || f.type === 'MONEY') && typeof c.value !== 'number')
      add(`${at}.value`, 'Enter a number');
    if (f.type === 'DATE' && !isDate(c.value)) add(`${at}.value`, 'Enter a date');
    if (f.type === 'BOOLEAN' && typeof c.value !== 'boolean')
      add(`${at}.value`, 'Choose yes or no');
    if (f.type === 'TEXT' && typeof c.value !== 'string') add(`${at}.value`, 'Enter text');
  });
  def.actions.forEach((a, i) => {
    const at = `actions.${i}`;
    if (a.dependsOn != null && !def.actions.slice(0, i).some((x) => x.id === a.dependsOn))
      add(`${at}.dependsOn`, 'Depend on an earlier action of this rule');
    const info = actionOf(a.type);
    if (!info) return add(`${at}.type`, 'This action is not in the catalog');
    // AU-F18 to F20: an event about the firm itself has no client to act for.
    if (event && !event.hasClient && info.needsClient)
      add(`${at}.type`, 'This event has no client: choose an action that needs none');
    for (const [key, value] of Object.entries(a.config)) {
      const f = info.fields.find((x) => x.key === key);
      if (!f) {
        add(`${at}.config.${key}`, 'This action has no such setting');
        continue;
      }
      if (value === null) continue;
      const path = `${at}.config.${key}`;
      switch (f.type) {
        case 'TEXT':
        case 'LONG_TEXT':
          if (typeof value !== 'string') add(path, 'Enter text');
          else
            for (const m of value.matchAll(TOKEN))
              if (!VARIABLE_KEYS.has(m[1] as string))
                add(path, `{{${m[1]}}} is not an approved merge field`);
          break;
        case 'NUMBER':
          if (typeof value !== 'number' || value < 0 || value > 3_650)
            add(path, 'Enter a number of days');
          break;
        case 'TOGGLE':
          if (typeof value !== 'boolean') add(path, 'Choose yes or no');
          break;
        case 'SELECT':
          if (typeof value !== 'string' || !f.choices.some((c) => c.value === value))
            add(path, 'Choose from the setting’s values');
          break;
        case 'MULTI_SELECT':
          if (!Array.isArray(value) || value.some((v) => !f.choices.some((c) => c.value === v)))
            add(path, 'Choose from the setting’s values');
          break;
        case 'TEMPLATE':
        case 'MEMBER':
        case 'DOCUMENT_CATEGORY':
          if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) add(path, 'Choose one');
          break;
        case 'TAGS':
          if (
            !Array.isArray(value) ||
            value.length > 20 ||
            new Set(value).size !== value.length ||
            value.some((v) => typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v))
          )
            add(path, 'Choose one to 20 of your firm’s tags');
          break;
        case 'MEMBERS':
          if (
            !Array.isArray(value) ||
            value.length > 20 ||
            new Set(value).size !== value.length ||
            value.some((v) => typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v))
          )
            add(path, 'Choose up to 20 members of your firm');
          break;
        default:
          break;
      }
    }
  });
  const q = def.settings.quietHours;
  if (q && q.start === q.end) add('settings.quietHours', 'The start and the end differ');
  return out;
}

/** Settings an action needs that are not there yet (a draft may lack them; activation may not). */
export function missingSettings(def: Def): Detail[] {
  const out: Detail[] = [];
  def.actions.forEach((a, i) => {
    const info = actionOf(a.type);
    if (!info) return;
    for (const f of info.fields)
      if (
        f.required &&
        (a.config[f.key] === undefined ||
          a.config[f.key] === null ||
          a.config[f.key] === '' ||
          (Array.isArray(a.config[f.key]) && (a.config[f.key] as unknown[]).length === 0))
      )
        out.push({ path: `actions.${i}.config.${f.key}`, message: `${f.label} is required` });
    if (a.type === 'SEND_CLIENT_MESSAGE' && !a.config.templateId && !a.config.body)
      out.push({
        path: `actions.${i}.config.body`,
        message: 'Choose a template or write the message',
      });
    if (a.type === 'SEND_CLIENT_EMAIL' && !a.config.templateId && !a.config.body)
      out.push({
        path: `actions.${i}.config.body`,
        message: 'Choose an email template or write the email',
      });
  });
  return out;
}

// ---------- Words ----------

const OPERATOR_WORDS: Record<AutomationOperator, string> = {
  IS: 'is',
  IS_NOT: 'is not',
  INCLUDES: 'is one of',
  EXCLUDES: 'is none of',
  GREATER_THAN: 'is more than',
  LESS_THAN: 'is less than',
  BEFORE: 'is before',
  AFTER: 'is after',
  CONTAINS: 'contains',
  EXISTS: 'is set',
  NOT_EXISTS: 'is not set',
};

export function triggerSummary(t: {
  event: string;
  timing: string;
  offsetValue: number | null;
  offsetUnit: string | null;
}): string {
  const label = eventOf(t.event)?.label ?? t.event;
  if (t.timing === 'BEFORE' || t.timing === 'AFTER')
    return `${label}: ${t.offsetValue} ${(t.offsetUnit ?? '').toLowerCase()}${t.offsetValue === 1 ? '' : 's'} ${t.timing === 'BEFORE' ? 'before' : 'after'}`;
  return label;
}

export function appliesTo(
  event: string,
  conditions: AutomationCondition[],
  matchMode: string,
): string {
  if (conditions.length === 0) return 'All records';
  const e = eventOf(event);
  const parts = conditions.map((c) => {
    const f = e?.conditionFields.find((x) => x.field === c.field);
    // AU-F01: a choice reads as its label ("Business"), not its code.
    const word = (v: unknown) => f?.options.find((o) => o.value === v)?.label ?? String(v);
    const value =
      c.value === undefined
        ? ''
        : ` ${Array.isArray(c.value) ? c.value.map(word).join(', ') : word(c.value)}`;
    return `${f?.label ?? c.field} ${OPERATOR_WORDS[c.operator]}${value}`;
  });
  return parts.join(matchMode === 'ANY' ? ' or ' : ' and ');
}

export const actionsSummary = (actions: { type: string }[]) =>
  actions.map((a) => actionOf(a.type)?.label ?? a.type).join(', ');

/** One action in a sentence for the Review step (never a message body). */
export function actionSummary(a: {
  type: string;
  delayMinutes: number;
  config: Record<string, unknown>;
}) {
  const label = actionOf(a.type)?.label ?? a.type;
  const delay =
    a.delayMinutes > 0
      ? `after ${a.delayMinutes >= 1_440 && a.delayMinutes % 1_440 === 0 ? `${a.delayMinutes / 1_440} day(s)` : `${a.delayMinutes} minute(s)`}`
      : 'right away';
  return `${label}, ${delay}`;
}

// ---------- A definition as stored and as shown ----------

export interface Defaults {
  defaultDedupeDays: number;
}

/** AU-F30: a confirmable event's source (Manual confirmation by default); null for any other. */
export function sourceOf(event: string, source: unknown): AutomationEventSource | null {
  if (!eventOf(event)?.confirmation) return null;
  return source === 'INTEGRATION_VERIFIED' || source === 'EITHER' ? source : 'MANUAL';
}

/** The shape a version stores: settings filled in with the firm's defaults, logging always on. */
export function stored(def: Def, defaults: Defaults) {
  const source = sourceOf(def.trigger.event, def.trigger.source);
  return {
    trigger: {
      module: def.trigger.module,
      event: def.trigger.event,
      timing: def.trigger.timing,
      offsetValue:
        def.trigger.timing === 'BEFORE' || def.trigger.timing === 'AFTER'
          ? (def.trigger.offsetValue ?? null)
          : null,
      offsetUnit:
        def.trigger.timing === 'BEFORE' || def.trigger.timing === 'AFTER'
          ? (def.trigger.offsetUnit ?? null)
          : null,
    },
    matchMode: def.matchMode,
    conditions: def.conditions.map((c) => ({
      field: c.field,
      operator: c.operator,
      ...(c.value === undefined ? {} : { value: c.value }),
    })),
    actions: def.actions.map((a) => ({
      id: a.id,
      type: a.type,
      config: a.config,
      delayMinutes: a.delayMinutes,
      dependsOn: a.dependsOn ?? null,
    })),
    settings: {
      preventDuplicatesDays: def.settings.preventDuplicatesDays ?? defaults.defaultDedupeDays,
      logAll: true,
      notifyOnFailureUserIds: def.settings.notifyOnFailureUserIds,
      addToCalendar: def.settings.addToCalendar,
      quietHours: def.settings.quietHours ?? null,
      safetyThreshold: def.settings.safetyThreshold ?? null,
      // The version's trigger columns hold no source; it travels with the settings.
      ...(source ? { triggerSource: source } : {}),
    },
  };
}

type VersionRow = {
  triggerModule: AutomationDefinitionView['trigger']['module'];
  triggerEvent: string;
  timing: AutomationDefinitionView['trigger']['timing'];
  offsetValue: number | null;
  offsetUnit: AutomationDefinitionView['trigger']['offsetUnit'];
  matchMode: AutomationDefinitionView['matchMode'];
  conditions: unknown;
  actions: unknown;
  settings: unknown;
};

export function viewOf(v: VersionRow): AutomationDefinitionView {
  const s = (v.settings ?? {}) as Record<string, unknown>;
  const q = s.quietHours as { start?: string; end?: string } | null | undefined;
  return {
    trigger: {
      module: v.triggerModule,
      event: v.triggerEvent,
      timing: v.timing,
      offsetValue: v.offsetValue,
      offsetUnit: v.offsetUnit,
      source: sourceOf(v.triggerEvent, s.triggerSource),
    },
    matchMode: v.matchMode,
    conditions: (Array.isArray(v.conditions) ? v.conditions : []).map((c) => {
      const x = c as { field: string; operator: AutomationOperator; value?: unknown };
      return {
        field: x.field,
        operator: x.operator,
        value: (x.value ?? null) as string | number | boolean | string[] | null,
      };
    }),
    actions: (Array.isArray(v.actions) ? v.actions : []).map((a) => {
      const x = a as {
        id: string;
        type: string;
        config?: Record<string, never>;
        delayMinutes?: number;
        dependsOn?: string | null;
      };
      return {
        id: x.id,
        type: x.type,
        config: x.config ?? {},
        delayMinutes: x.delayMinutes ?? 0,
        dependsOn: x.dependsOn ?? null,
      };
    }),
    settings: {
      preventDuplicatesDays: Number(s.preventDuplicatesDays ?? 0),
      logAll: s.logAll !== false,
      notifyOnFailureUserIds: (Array.isArray(s.notifyOnFailureUserIds)
        ? s.notifyOnFailureUserIds
        : []) as string[],
      addToCalendar: s.addToCalendar === true,
      quietHours: q?.start && q.end ? { start: q.start, end: q.end } : null,
      safetyThreshold: typeof s.safetyThreshold === 'number' ? s.safetyThreshold : null,
    },
  };
}

/** The stored shape of a view, as a definition (to preview or save again). */
export function defOf(view: AutomationDefinitionView): Def {
  return {
    trigger: {
      module: view.trigger.module,
      event: view.trigger.event,
      timing: view.trigger.timing,
      offsetValue: view.trigger.offsetValue,
      offsetUnit: view.trigger.offsetUnit,
      ...(view.trigger.source ? { source: view.trigger.source } : {}),
    },
    matchMode: view.matchMode,
    conditions: view.conditions.map((c) => ({
      field: c.field,
      operator: c.operator,
      ...(c.value === null ? {} : { value: c.value }),
    })),
    actions: view.actions,
    settings: {
      preventDuplicatesDays: view.settings.preventDuplicatesDays,
      logAll: view.settings.logAll,
      notifyOnFailureUserIds: view.settings.notifyOnFailureUserIds,
      addToCalendar: view.settings.addToCalendar,
      quietHours: view.settings.quietHours,
      safetyThreshold: view.settings.safetyThreshold,
    },
  } as Def;
}

// ---------- Conditions ----------

export type FieldValue = string | number | boolean | string[] | null;

const same = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b;

export function conditionHolds(
  fields: Record<string, FieldValue>,
  c: { field: string; operator: AutomationOperator; value?: unknown },
): boolean {
  const v = fields[c.field] ?? null;
  const set = v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  const want = c.value;
  switch (c.operator) {
    case 'EXISTS':
      return set;
    case 'NOT_EXISTS':
      return !set;
    case 'IS':
      return same(v, want);
    case 'IS_NOT':
      return !same(v, want);
    case 'INCLUDES':
    case 'EXCLUDES': {
      const wanted = Array.isArray(want) ? want : [want];
      const have = Array.isArray(v) ? v : [v];
      const hit = have.some((x) => wanted.some((w) => same(x, w)));
      return c.operator === 'INCLUDES' ? hit : !hit;
    }
    case 'GREATER_THAN':
      return typeof v === 'number' && typeof want === 'number' && v > want;
    case 'LESS_THAN':
      return typeof v === 'number' && typeof want === 'number' && v < want;
    case 'BEFORE':
      return typeof v === 'string' && typeof want === 'string' && v < want;
    case 'AFTER':
      return typeof v === 'string' && typeof want === 'string' && v > want;
    case 'CONTAINS':
      return (
        typeof v === 'string' &&
        typeof want === 'string' &&
        v.toLowerCase().includes(want.toLowerCase())
      );
  }
}

export function matches(
  fields: Record<string, FieldValue>,
  mode: 'ALL' | 'ANY',
  conditions: { field: string; operator: AutomationOperator; value?: unknown }[],
): boolean {
  if (conditions.length === 0) return true;
  return mode === 'ANY'
    ? conditions.some((c) => conditionHolds(fields, c))
    : conditions.every((c) => conditionHolds(fields, c));
}

// ---------- Loops ----------

/** The events a rule's actions can bring about (a task due soon is overdue before long). */
export function produces(actions: { type: string; config: Record<string, unknown> }[]): string[] {
  const out = new Set<string>();
  for (const a of actions) {
    if (a.type === 'CREATE_TASK') {
      const days = a.config.dueInDays;
      if (typeof days !== 'number' || days <= 1) out.add('task.overdue');
    }
    // A tag added or removed is a tag change; a new assignee is an assignment change.
    if (a.type === 'ADD_CLIENT_TAGS' || a.type === 'REMOVE_CLIENT_TAGS')
      out.add('client.tags_changed');
    if (a.type === 'ASSIGN_CLIENT') out.add('client.assignment_changed');
    // A document request is a new request (and, with a near due date, one coming due).
    if (a.type === 'REQUEST_DOCUMENTS') {
      out.add('document.requested');
      out.add('document.request_due');
    }
  }
  return [...out];
}

export interface RuleNode {
  id: string;
  name: string;
  event: string;
  actions: { type: string; config: Record<string, unknown> }[];
}

/**
 * A rule whose actions bring about an event that starts itself, or that starts another rule that
 * leads back (A starts B starts A), and the longest chain of rules one event can start.
 */
export function loopProblems(
  self: RuleNode,
  others: RuleNode[],
  maxDepth: number,
): { code: 'LOOP_RISK' | 'DEPTH_EXCEEDED'; message: string }[] {
  const all = [self, ...others.filter((o) => o.id !== self.id)];
  const next = (n: RuleNode) => all.filter((m) => produces(n.actions).includes(m.event));
  const problems: { code: 'LOOP_RISK' | 'DEPTH_EXCEEDED'; message: string }[] = [];
  let loop: string | null = null;
  let deepest = 0;
  const walk = (n: RuleNode, path: string[]) => {
    for (const m of next(n)) {
      if (m.id === self.id) {
        loop ??= [...path.map((p) => p), self.name].join(' → ');
        continue;
      }
      if (path.includes(m.name)) continue;
      deepest = Math.max(deepest, path.length);
      walk(m, [...path, m.name]);
    }
  };
  walk(self, [self.name]);
  if (loop) problems.push({ code: 'LOOP_RISK', message: `This rule can start itself: ${loop}.` });
  if (!loop && deepest > maxDepth)
    problems.push({
      code: 'DEPTH_EXCEEDED',
      message: `One event could start a chain of ${deepest + 1} rules; the limit is ${maxDepth}.`,
    });
  return problems;
}

// ---------- Templates ----------

const SECRET = /^(sk_|pk_|rk_|xox[abp]-|ghp_|gho_|AKIA|eyJ)|bearer\s+\S{10,}|[A-Za-z0-9_-]{40,}/i;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A definition for a template: the choices of a firm's own records (a template, a person) are left
 * out, a value that looks like a secret or token is removed, and one that names a record id is refused.
 */
export function forTemplate(def: Def): Def {
  const problems: Detail[] = [];
  const actions = def.actions.map((a, i) => {
    const info = actionOf(a.type);
    const config: Record<string, string | number | boolean | string[] | null> = {};
    for (const [key, value] of Object.entries(a.config)) {
      const f = info?.fields.find((x) => x.key === key);
      if (
        f?.type === 'TEMPLATE' ||
        f?.type === 'MEMBER' ||
        f?.type === 'TAGS' ||
        f?.type === 'DOCUMENT_CATEGORY' ||
        f?.type === 'MEMBERS'
      )
        continue;
      if (typeof value === 'string' && SECRET.test(value)) continue;
      if (typeof value === 'string' && UUID.test(value))
        problems.push({
          path: `actions.${i}.config.${key}`,
          message: 'A template names no record',
        });
      config[key] = value;
    }
    return { ...a, config };
  });
  def.conditions.forEach((c, i) => {
    const values = Array.isArray(c.value) ? c.value : [c.value];
    if (values.some((v) => typeof v === 'string' && UUID.test(v)))
      problems.push({ path: `conditions.${i}.value`, message: 'A template names no record' });
  });
  if (problems.length > 0) throw invalidDefinition(problems);
  return { ...def, actions, settings: { ...def.settings, notifyOnFailureUserIds: [] } } as Def;
}

// ---------- Merge fields ----------

export function fill(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN, (_m, key: string) => values[key] ?? '');
}

export type { AutomationCheck };
