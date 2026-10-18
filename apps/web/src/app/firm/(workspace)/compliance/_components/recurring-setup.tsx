'use client';

import type {
  ComplianceRecurrence,
  ComplianceRepeatRule,
  DeadlineFrequency,
  DeadlineType,
  HolidayRule,
  JurisdictionLevel,
  RecurrenceEnd,
} from '@firmivra/types';
import { COMPLIANCE_STATES } from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Radio, Textarea, Toast } from '@firmivra/ui';
import { ArrowsClockwise, Gear, Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useMembers } from './compliance-data';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  Label,
  Section,
  Selectbox,
  TYPE_LABEL,
  TYPE_OPTIONS,
  dayText,
  frequencyText,
  quiet,
  subtle,
  today,
} from './compliance-shared';
import {
  type ReminderDraft,
  RemindersEditor,
  draftsToReminders,
  remindersToDrafts,
} from './deadline-dialogs';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const FREQUENCIES: { value: DeadlineFrequency; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'CUSTOM', label: 'Custom (every N months)' },
  { value: 'AUTHORITY_DEFINED', label: 'Authority-defined' },
];
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
];
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

interface Setup {
  origin: 'new' | 'template' | 'import';
  templateId: string;
  calendarId: string;
  entryId: string;
  name: string;
  type: DeadlineType;
  agency: string;
  jurisdiction: string;
  state: string;
  relatedForm: string;
  description: string;
  frequency: DeadlineFrequency;
  interval: string;
  repeatKind: 'day' | 'nth';
  dayOfMonth: string;
  nth: string;
  weekday: string;
  monthsAfter: string;
  month: string;
  startOn: string;
  holidayOn: boolean;
  holidayMove: 'NEXT_BUSINESS_DAY' | 'PREVIOUS_BUSINESS_DAY';
  endMode: RecurrenceEnd;
  endAfterCount: string;
  endOn: string;
  createTask: boolean;
  taskTemplateId: string;
  assignOn: boolean;
  assignedUserId: string;
  clientVisible: boolean;
  remindClient: boolean;
  addToTaxCalendar: boolean;
  notifyTeam: boolean;
  remindersOn: boolean;
  reminders: ReminderDraft[];
  sendPastDueNotice: boolean;
  escalateToManager: boolean;
  entityType: string;
  ruleState: string;
  service: string;
  onlyEstimated: boolean;
  onlyLiability: boolean;
  excludeExempt: boolean;
  individuals: boolean;
  business: boolean;
  multiState: boolean;
}

const blank = (): Setup => ({
  origin: 'new',
  templateId: '',
  calendarId: '',
  entryId: '',
  name: '',
  type: 'TAX_FILING',
  agency: '',
  jurisdiction: '',
  state: '',
  relatedForm: '',
  description: '',
  frequency: 'QUARTERLY',
  interval: '',
  repeatKind: 'day',
  dayOfMonth: '15',
  nth: '1',
  weekday: '1',
  monthsAfter: '0',
  month: '4',
  startOn: today(),
  holidayOn: true,
  holidayMove: 'NEXT_BUSINESS_DAY',
  endMode: 'NEVER',
  endAfterCount: '',
  endOn: '',
  createTask: false,
  taskTemplateId: '',
  assignOn: false,
  assignedUserId: '',
  clientVisible: false,
  remindClient: false,
  addToTaxCalendar: true,
  notifyTeam: false,
  remindersOn: true,
  reminders: remindersToDrafts([
    { daysBefore: 14, inApp: true, channels: [] },
    { daysBefore: 7, inApp: true, channels: [] },
  ]),
  sendPastDueNotice: false,
  escalateToManager: false,
  entityType: '',
  ruleState: '',
  service: '',
  onlyEstimated: false,
  onlyLiability: false,
  excludeExempt: false,
  individuals: false,
  business: false,
  multiState: false,
});

/** A saved definition (a template or an existing recurrence) as the form shows it. */
function fromRecurrence(r: ComplianceRecurrence, keepStart: boolean): Partial<Setup> {
  const rule = r.repeatRule as Record<string, number | undefined>;
  return {
    name: r.name,
    type: r.type,
    agency: r.agency ?? '',
    jurisdiction: r.jurisdiction ?? '',
    state: r.state ?? '',
    relatedForm: r.relatedForm ?? '',
    description: r.description ?? '',
    frequency: r.frequency,
    interval: r.interval ? String(r.interval) : '',
    repeatKind: rule['nth'] ? 'nth' : 'day',
    dayOfMonth: String(rule['dayOfMonth'] ?? 15),
    nth: String(rule['nth'] ?? 1),
    weekday: String(rule['weekday'] ?? 1),
    monthsAfter: String(rule['monthsAfterQuarterEnd'] ?? 0),
    month: String(rule['month'] ?? 4),
    ...(keepStart && r.startOn ? { startOn: r.startOn } : {}),
    holidayOn: r.holidayRule !== 'NONE',
    holidayMove:
      r.holidayRule === 'PREVIOUS_BUSINESS_DAY' ? 'PREVIOUS_BUSINESS_DAY' : 'NEXT_BUSINESS_DAY',
    endMode: r.endMode,
    endAfterCount: r.endAfterCount ? String(r.endAfterCount) : '',
    endOn: r.endOn ?? '',
    createTask: r.createTask,
    taskTemplateId: r.taskTemplateId ?? '',
    assignOn: r.assignedTo !== null,
    assignedUserId: r.assignedTo?.userId ?? '',
    clientVisible: r.clientVisible,
    remindClient: r.remindClient,
    addToTaxCalendar: r.addToTaxCalendar,
    notifyTeam: r.notifyTeam,
    remindersOn: r.reminders.length > 0,
    reminders: remindersToDrafts(r.reminders),
    sendPastDueNotice: r.sendPastDueNotice,
    escalateToManager: r.escalateToManager,
  };
}

function repeatRuleOf(s: Setup): ComplianceRepeatRule {
  if (s.frequency === 'AUTHORITY_DEFINED') return {};
  if (s.frequency === 'ANNUAL') return { month: Number(s.month), day: Number(s.dayOfMonth) };
  if (s.frequency === 'QUARTERLY') {
    return { monthsAfterQuarterEnd: Number(s.monthsAfter), dayOfMonth: Number(s.dayOfMonth) };
  }
  return s.repeatKind === 'nth'
    ? { nth: Number(s.nth), weekday: Number(s.weekday) }
    : { dayOfMonth: Number(s.dayOfMonth) };
}
const holidayOf = (s: Setup): HolidayRule => (s.holidayOn ? s.holidayMove : 'NONE');

/** The "Setup Recurring Deadline" tab: create or edit a recurring definition, with a live preview. */
export function RecurringSetup({
  editId,
  fromDeadline,
}: {
  editId?: string;
  fromDeadline?: string;
}) {
  const existing = useApiQuery([...COMPLIANCE_KEY, 'recurrence', editId ?? 'new'], async () =>
    editId ? api.compliance.getRecurrence(editId) : undefined,
  );
  const origin = useApiQuery([...COMPLIANCE_KEY, 'deadline', fromDeadline ?? 'none'], async () =>
    fromDeadline ? api.compliance.getDeadline(fromDeadline) : undefined,
  );
  if ((editId && !existing.data) || (fromDeadline && !origin.data)) {
    return (
      <p className={quiet}>
        {existing.isError || origin.isError ? 'This is not available right now.' : 'Loading…'}
      </p>
    );
  }
  const initial: Setup = existing.data
    ? { ...blank(), ...fromRecurrence(existing.data, true) }
    : origin.data
      ? {
          ...blank(),
          name: origin.data.name,
          type: origin.data.type,
          agency: origin.data.agency ?? '',
          jurisdiction: origin.data.jurisdiction ?? '',
          state: origin.data.state ?? '',
          relatedForm: origin.data.relatedForm ?? '',
          description: origin.data.description ?? '',
          startOn: origin.data.dueOn,
          frequency: 'ANNUAL',
          month: String(Number(origin.data.dueOn.slice(5, 7))),
          dayOfMonth: String(Number(origin.data.dueOn.slice(8, 10))),
        }
      : blank();
  return <SetupForm key={editId ?? fromDeadline ?? 'new'} editId={editId} initial={initial} />;
}

function SetupForm({ editId, initial }: { editId: string | undefined; initial: Setup }) {
  const router = useRouter();
  const [s, setS] = useState<Setup>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof Setup, string>>>({});
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [more, setMore] = useState(false);
  const [templateAsk, setTemplateAsk] = useState(false);
  const { members } = useMembers();
  const set = (change: Partial<Setup>) => setS((cur) => ({ ...cur, ...change }));

  const templates = useApiQuery([...COMPLIANCE_KEY, 'recurrences', true, 'setup'], () =>
    api.compliance.recurrences({ templates: true, pageSize: 50 }),
  );
  const calendars = useApiQuery([...COMPLIANCE_KEY, 'calendars', 'published', 'setup'], () =>
    api.compliance.calendars({ status: 'PUBLISHED', pageSize: 50 }),
  );
  const calendar = useApiQuery([...COMPLIANCE_KEY, 'calendar', s.calendarId], async () =>
    s.calendarId ? api.compliance.getCalendar(s.calendarId) : undefined,
  );
  const taskTemplates = useApiQuery([...COMPLIANCE_KEY, 'task-templates'], () =>
    api.taskWork.templates({ status: 'active' }),
  );

  const intervalOk = s.frequency !== 'CUSTOM' || Number(s.interval) >= 1;
  const endOk =
    (s.endMode !== 'AFTER_COUNT' || Number(s.endAfterCount) >= 1) &&
    (s.endMode !== 'ON_DATE' || (s.endOn !== '' && s.endOn >= s.startOn));
  const previewBody = {
    frequency: s.frequency,
    ...(s.frequency === 'CUSTOM' ? { interval: Number(s.interval) } : {}),
    repeatRule: repeatRuleOf(s),
    startOn: s.startOn || today(),
    endMode: s.endMode,
    ...(s.endMode === 'AFTER_COUNT' ? { endAfterCount: Number(s.endAfterCount) } : {}),
    ...(s.endMode === 'ON_DATE' ? { endOn: s.endOn } : {}),
    holidayRule: holidayOf(s),
    count: more ? 12 : 5,
  };
  const preview = useApiQuery([...COMPLIANCE_KEY, 'preview', previewBody], async () =>
    intervalOk && endOk
      ? api.compliance.previewRecurrence(
          previewBody as Parameters<typeof api.compliance.previewRecurrence>[0],
        )
      : { dates: [], message: 'Finish the schedule to see the dates.' },
  );

  const body = (asTemplate: boolean) => ({
    name: s.name.trim(),
    type: s.type,
    ...(s.description.trim() ? { description: s.description.trim() } : {}),
    ...(s.agency.trim() ? { agency: s.agency.trim() } : {}),
    ...(s.relatedForm.trim() ? { relatedForm: s.relatedForm.trim() } : {}),
    ...(s.jurisdiction ? { jurisdiction: s.jurisdiction as JurisdictionLevel } : {}),
    ...(s.state ? { state: s.state } : {}),
    ...(s.origin === 'import' && s.entryId ? { calendarEntryId: s.entryId } : {}),
    frequency: s.frequency,
    ...(s.frequency === 'CUSTOM' ? { interval: Number(s.interval) } : {}),
    repeatRule: repeatRuleOf(s),
    ...(asTemplate ? {} : { startOn: s.startOn }),
    endMode: s.endMode,
    ...(s.endMode === 'AFTER_COUNT' ? { endAfterCount: Number(s.endAfterCount) } : {}),
    ...(s.endMode === 'ON_DATE' ? { endOn: s.endOn } : {}),
    holidayRule: holidayOf(s),
    isTemplate: asTemplate,
    createTask: s.createTask,
    ...(s.createTask && s.taskTemplateId ? { taskTemplateId: s.taskTemplateId } : {}),
    ...(s.assignOn && s.assignedUserId ? { assignedUserId: s.assignedUserId } : {}),
    clientVisible: s.clientVisible,
    remindClient: s.remindClient,
    addToTaxCalendar: s.addToTaxCalendar,
    notifyTeam: s.notifyTeam,
    reminders: s.remindersOn ? draftsToReminders(s.reminders) : [],
    sendPastDueNotice: s.sendPastDueNotice,
    escalateToManager: s.escalateToManager,
  });
  const hasRule =
    s.entityType !== '' ||
    s.ruleState !== '' ||
    s.service !== '' ||
    s.onlyEstimated ||
    s.onlyLiability ||
    s.excludeExempt ||
    s.individuals ||
    s.business ||
    s.multiState;

  const options = { invalidate: [...COMPLIANCE_KEY] };
  const save = useApiMutation(async (asTemplate: boolean) => {
    const input = body(asTemplate);
    const r = editId
      ? await api.compliance.updateRecurrence(editId, input)
      : await api.compliance.createRecurrence(input);
    if (hasRule && !editId && !asTemplate) {
      await api.compliance.createRule({
        name: `${r.name} applies to`,
        target: { kind: 'RECURRENCE', id: r.id },
        outcome: 'SUGGEST',
        entityTypes: s.entityType ? [s.entityType] : [],
        states: s.ruleState ? [s.ruleState as (typeof COMPLIANCE_STATES)[number]] : [],
        services: s.service ? [s.service as 'ANNUAL_TAX'] : [],
        excludeStatuses: s.excludeExempt ? ['Tax-exempt'] : [],
        priorYearLiabilityOverCents: s.onlyLiability ? 100_000 : null,
        criteria: {
          ...(s.onlyEstimated ? { estimatedTaxRequired: true } : {}),
          ...(s.individuals ? { individualClients: true } : {}),
          ...(s.business ? { businessClients: true } : {}),
          ...(s.multiState ? { multiState: true } : {}),
        },
        active: true,
      });
    }
    return r;
  }, options);

  const check = (asTemplate: boolean) => {
    const e: Partial<Record<keyof Setup, string>> = {};
    if (!s.name.trim()) e.name = 'Enter the deadline name';
    if (!asTemplate && !s.startOn) e.startOn = 'Choose when it starts';
    if (s.frequency === 'CUSTOM' && !(Number(s.interval) >= 1))
      e.interval = 'Say how many months apart';
    if (s.endMode === 'AFTER_COUNT' && !(Number(s.endAfterCount) >= 1))
      e.endAfterCount = 'Say how many';
    if (s.endMode === 'ON_DATE' && !s.endOn) e.endOn = 'Choose the end date';
    if (s.endMode === 'ON_DATE' && s.endOn && s.startOn && s.endOn < s.startOn) {
      e.endOn = 'The end date is before the start';
    }
    if (s.origin === 'import' && !s.entryId) e.entryId = 'Choose the calendar entry';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const submit = (asTemplate: boolean) => {
    if (!check(asTemplate)) return;
    save.mutate(asTemplate, {
      onSuccess: (r) => {
        setTemplateAsk(false);
        router.push(`/compliance/recurring/new?tab=manage&saved=${encodeURIComponent(r.name)}`);
      },
      onError: (e) => setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' }),
    });
  };

  const applyTemplate = (id: string) => {
    const t = templates.data?.items.find((x) => x.id === id);
    if (t) set({ ...fromRecurrence(t, false), origin: 'template', templateId: id });
    else set({ origin: 'template', templateId: '' });
  };
  const applyEntry = (calendarId: string, entryId: string) => {
    const c = calendar.data;
    const e = c?.entries.find((x) => x.id === entryId);
    if (!c || !e) return set({ entryId });
    const formula = e.rule;
    set({
      entryId,
      name: e.name,
      type: e.type,
      agency: c.authority,
      relatedForm: e.form ?? '',
      jurisdiction: c.jurisdiction,
      state: c.state ?? '',
      description: e.description ?? '',
      frequency: 'ANNUAL',
      ...(formula
        ? {
            month: String(((formula.monthsAfterYearEnd % 12) + 12) % 12 || 12),
            dayOfMonth: String(formula.day),
          }
        : e.dueOn
          ? {
              month: String(Number(e.dueOn.slice(5, 7))),
              dayOfMonth: String(Number(e.dueOn.slice(8, 10))),
            }
          : {}),
      calendarId,
    });
  };

  const summary: [string, string][] = [
    ['Name', s.name || '—'],
    ['Type', TYPE_LABEL[s.type]],
    ['Agency', s.agency || '—'],
    ['Form', s.relatedForm || '—'],
    [
      'Frequency',
      frequencyText({
        frequency: s.frequency,
        interval: s.frequency === 'CUSTOM' ? Number(s.interval) || null : null,
        repeatRule: repeatRuleOf(s),
      }),
    ],
    ['Start Date', s.startOn ? dayText(s.startOn) : '—'],
    ['Adjust for Holidays', s.holidayOn ? 'Yes' : 'No'],
    ['Create Task', s.createTask ? 'Yes' : 'No'],
    [
      'Assign To',
      s.assignOn ? (members.find((m) => m.userId === s.assignedUserId)?.name ?? 'Yes') : '—',
    ],
    ['Client Portal', s.clientVisible ? 'Yes' : 'No'],
    ['Applies To', hasRule ? 'Clients that match the rules' : 'All applicable clients'],
    [
      'Reminders',
      s.remindersOn && s.reminders.length
        ? `${s.reminders.map((r) => r.days).join(', ')} day(s) before`
        : 'None',
    ],
  ];

  const check1 = (label: string, key: keyof Setup, hint?: string) => (
    <Checkbox
      key={key}
      label={label}
      checked={Boolean(s[key])}
      onChange={(e) => set({ [key]: e.target.checked } as Partial<Setup>)}
      {...(hint ? { title: hint } : {})}
    />
  );
  const dayOptions = range(1, 31).map((n) => ({ value: String(n), label: String(n) }));

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="recurring-setup">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            step={1}
            title="Select a Template or Create New"
            subtitle="Choose an existing deadline template or create a new recurring deadline."
            testId="sec-source"
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <fieldset className="flex min-w-0 flex-col gap-1">
                <legend className="sr-only">Where to start</legend>
                <Radio
                  name="origin"
                  label="Create New Recurring Deadline"
                  checked={s.origin === 'new'}
                  onChange={() =>
                    set({ origin: 'new', templateId: '', calendarId: '', entryId: '' })
                  }
                />
                <Radio
                  name="origin"
                  label="Use Existing Template"
                  checked={s.origin === 'template'}
                  onChange={() => set({ origin: 'template' })}
                />
                <Selectbox
                  label="Template"
                  value={s.templateId}
                  disabled={s.origin !== 'template'}
                  onChange={applyTemplate}
                  options={[
                    { value: '', label: 'Select a template' },
                    ...(templates.data?.items ?? []).map((t) => ({ value: t.id, label: t.name })),
                  ]}
                />
                <Radio
                  name="origin"
                  label="Import from Government Calendar"
                  checked={s.origin === 'import'}
                  onChange={() => set({ origin: 'import' })}
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Selectbox
                    label="Calendar"
                    value={s.calendarId}
                    disabled={s.origin !== 'import'}
                    onChange={(v) => set({ calendarId: v, entryId: '' })}
                    options={[
                      { value: '', label: 'Select calendar' },
                      ...(calendars.data?.items ?? []).map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />
                  <Selectbox
                    label="Deadline"
                    value={s.entryId}
                    disabled={s.origin !== 'import' || !s.calendarId}
                    onChange={(v) => applyEntry(s.calendarId, v)}
                    options={[
                      { value: '', label: 'Select deadline' },
                      ...(calendar.data?.entries ?? []).map((e) => ({
                        value: e.id,
                        label: e.name,
                      })),
                    ]}
                  />
                </div>
                {errors.entryId ? <p className="text-xs text-danger">{errors.entryId}</p> : null}
              </fieldset>
              <div
                className="rounded-lg border border-divider bg-canvas p-3"
                data-testid="quick-templates"
              >
                <h3 className="mb-2 text-sm font-bold text-heading">Quick Templates</h3>
                {(templates.data?.items ?? []).length === 0 ? (
                  <p className="text-sm text-muted">
                    {templates.isPending
                      ? 'Loading…'
                      : 'Save a recurring deadline as a template to see it here.'}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {(templates.data?.items ?? []).slice(0, 5).map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => applyTemplate(t.id)}
                          className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-action bg-surface px-3 text-left text-sm text-action hover:bg-accent-soft"
                        >
                          <Plus aria-hidden weight="bold" className="size-4 shrink-0" />
                          <span className="truncate">{t.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Section>

          <Section
            step={2}
            title="Deadline Details"
            subtitle="Set the basic information for this recurring deadline."
            testId="sec-details"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Input
                label="Deadline Name *"
                value={s.name}
                maxLength={200}
                onChange={(e) => set({ name: e.target.value })}
                {...(errors.name ? { error: errors.name } : {})}
              />
              <Label text="Deadline Type" required htmlFor="rs-type">
                <Selectbox
                  id="rs-type"
                  label="Deadline Type"
                  value={s.type}
                  onChange={(v) => set({ type: v as DeadlineType })}
                  options={TYPE_OPTIONS}
                />
              </Label>
              <Input
                label="Agency"
                value={s.agency}
                maxLength={120}
                onChange={(e) => set({ agency: e.target.value })}
              />
              <Label text="Jurisdiction" htmlFor="rs-juris">
                <Selectbox
                  id="rs-juris"
                  label="Jurisdiction"
                  value={s.jurisdiction}
                  onChange={(v) => set({ jurisdiction: v })}
                  options={[
                    { value: '', label: 'Select jurisdiction' },
                    { value: 'FEDERAL', label: 'Federal' },
                    { value: 'STATE', label: 'State' },
                    { value: 'LOCAL', label: 'Local' },
                    { value: 'INTERNAL', label: 'Internal' },
                  ]}
                />
              </Label>
              <Label text="State (if applicable)" htmlFor="rs-state">
                <Selectbox
                  id="rs-state"
                  label="State"
                  value={s.state}
                  onChange={(v) => set({ state: v })}
                  options={[
                    { value: '', label: 'Select State' },
                    ...COMPLIANCE_STATES.map((x) => ({ value: x, label: x })),
                  ]}
                />
              </Label>
              <Input
                label="Related Form (if applicable)"
                value={s.relatedForm}
                maxLength={60}
                onChange={(e) => set({ relatedForm: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Textarea
                label="Description"
                value={s.description}
                rows={3}
                maxLength={2000}
                onChange={(e) => set({ description: e.target.value })}
              />
            </div>
          </Section>

          <section
            className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
            data-testid="sec-recurrence"
          >
            <header className="mb-3 flex items-start gap-3">
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action"
              >
                3
              </span>
              <div>
                <h2 className="font-display text-lg font-bold text-heading">Recurrence Settings</h2>
                <p className="text-sm text-muted">Define how often this deadline should repeat.</p>
              </div>
            </header>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="grid gap-3 grid-cols-2">
                  <Label text="Frequency" required htmlFor="rs-freq">
                    <Selectbox
                      id="rs-freq"
                      label="Frequency"
                      value={s.frequency}
                      onChange={(v) => set({ frequency: v as DeadlineFrequency })}
                      options={FREQUENCIES}
                    />
                  </Label>
                  {s.frequency === 'CUSTOM' ? (
                    <Input
                      label="Every (months)"
                      type="number"
                      min={1}
                      value={s.interval}
                      onChange={(e) => set({ interval: e.target.value })}
                      {...(errors.interval ? { error: errors.interval } : {})}
                    />
                  ) : null}
                  {s.frequency === 'QUARTERLY' ? (
                    <Label text="Repeat On" htmlFor="rs-after">
                      <Selectbox
                        id="rs-after"
                        label="Repeat On"
                        value={s.monthsAfter}
                        onChange={(v) => set({ monthsAfter: v })}
                        options={[
                          { value: '0', label: 'Quarter-end month' },
                          { value: '1', label: '1 month after quarter end' },
                          { value: '2', label: '2 months after quarter end' },
                          { value: '3', label: '3 months after quarter end' },
                        ]}
                      />
                    </Label>
                  ) : null}
                  {s.frequency === 'ANNUAL' ? (
                    <Label text="Month" htmlFor="rs-month">
                      <Selectbox
                        id="rs-month"
                        label="Month"
                        value={s.month}
                        onChange={(v) => set({ month: v })}
                        options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
                      />
                    </Label>
                  ) : null}
                  {s.frequency === 'MONTHLY' || s.frequency === 'CUSTOM' ? (
                    <Label text="Repeat On" htmlFor="rs-kind">
                      <Selectbox
                        id="rs-kind"
                        label="Repeat On"
                        value={s.repeatKind}
                        onChange={(v) => set({ repeatKind: v as 'day' | 'nth' })}
                        options={[
                          { value: 'day', label: 'Specific day of month' },
                          { value: 'nth', label: 'Nth weekday' },
                        ]}
                      />
                    </Label>
                  ) : null}
                  {s.frequency !== 'AUTHORITY_DEFINED' &&
                  !(
                    (s.frequency === 'MONTHLY' || s.frequency === 'CUSTOM') &&
                    s.repeatKind === 'nth'
                  ) ? (
                    <Label text="Day of Month" htmlFor="rs-day">
                      <Selectbox
                        id="rs-day"
                        label="Day of Month"
                        value={s.dayOfMonth}
                        onChange={(v) => set({ dayOfMonth: v })}
                        options={dayOptions}
                      />
                    </Label>
                  ) : null}
                  {(s.frequency === 'MONTHLY' || s.frequency === 'CUSTOM') &&
                  s.repeatKind === 'nth' ? (
                    <>
                      <Label text="Which" htmlFor="rs-nth">
                        <Selectbox
                          id="rs-nth"
                          label="Which"
                          value={s.nth}
                          onChange={(v) => set({ nth: v })}
                          options={range(1, 5).map((n) => ({
                            value: String(n),
                            label: n === 5 ? 'Last' : `${n}${['st', 'nd', 'rd', 'th'][n - 1]}`,
                          }))}
                        />
                      </Label>
                      <Label text="Weekday" htmlFor="rs-weekday">
                        <Selectbox
                          id="rs-weekday"
                          label="Weekday"
                          value={s.weekday}
                          onChange={(v) => set({ weekday: v })}
                          options={WEEKDAYS.map((w, i) => ({ value: String(i), label: w }))}
                        />
                      </Label>
                    </>
                  ) : null}
                  <Input
                    label="Start Date *"
                    id="rs-start"
                    type="date"
                    value={s.startOn}
                    onChange={(e) => set({ startOn: e.target.value })}
                    {...(errors.startOn ? { error: errors.startOn } : {})}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Checkbox
                    label="Adjust for weekends/holidays"
                    checked={s.holidayOn}
                    onChange={(e) => set({ holidayOn: e.target.checked })}
                  />
                  {s.holidayOn ? (
                    <Selectbox
                      label="Move to"
                      value={s.holidayMove}
                      onChange={(v) => set({ holidayMove: v as Setup['holidayMove'] })}
                      options={[
                        { value: 'NEXT_BUSINESS_DAY', label: 'Next business day' },
                        { value: 'PREVIOUS_BUSINESS_DAY', label: 'Previous business day' },
                      ]}
                    />
                  ) : null}
                </div>
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-1 text-sm font-semibold text-heading">
                    End Recurrence
                  </legend>
                  <Radio
                    name="end"
                    label="No end date"
                    checked={s.endMode === 'NEVER'}
                    onChange={() => set({ endMode: 'NEVER' })}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Radio
                      name="end"
                      label="End after"
                      checked={s.endMode === 'AFTER_COUNT'}
                      onChange={() => set({ endMode: 'AFTER_COUNT' })}
                    />
                    <input
                      type="number"
                      min={1}
                      aria-label="Occurrences"
                      disabled={s.endMode !== 'AFTER_COUNT'}
                      value={s.endAfterCount}
                      onChange={(e) => set({ endAfterCount: e.target.value })}
                      className="min-h-10 w-24 rounded-control border border-border bg-surface px-3 text-sm disabled:bg-canvas"
                    />
                    <span className="text-sm text-text">occurrences</span>
                    {errors.endAfterCount ? (
                      <span className="text-xs text-danger">{errors.endAfterCount}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Radio
                      name="end"
                      label="End on"
                      checked={s.endMode === 'ON_DATE'}
                      onChange={() => set({ endMode: 'ON_DATE' })}
                    />
                    <input
                      type="date"
                      aria-label="End date"
                      disabled={s.endMode !== 'ON_DATE'}
                      value={s.endOn}
                      onChange={(e) => set({ endOn: e.target.value })}
                      className="min-h-10 rounded-control border border-border bg-surface px-3 text-sm disabled:bg-canvas"
                    />
                    {errors.endOn ? (
                      <span className="text-xs text-danger">{errors.endOn}</span>
                    ) : null}
                  </div>
                </fieldset>
              </div>
              <div
                className="rounded-lg border border-divider bg-info-soft/40 p-3"
                data-testid="preview"
              >
                <h3 className="mb-2 text-sm font-bold text-heading">Upcoming Dates Preview</h3>
                {(preview.data?.dates ?? []).length === 0 ? (
                  <p className="text-sm text-muted">
                    {preview.isError
                      ? 'The preview is not available right now.'
                      : (preview.data?.message ?? 'Loading…')}
                  </p>
                ) : (
                  <ol
                    className="flex flex-col gap-1.5 text-sm text-heading"
                    data-testid="preview-dates"
                  >
                    {(preview.data?.dates ?? []).map((d) => (
                      <li key={d.dueOn} className="flex items-center gap-2">
                        <span aria-hidden className="size-2 rounded-full bg-action" />
                        {dayText(d.dueOn)} (
                        {new Date(`${d.dueOn}T12:00:00Z`).toLocaleDateString('en-US', {
                          timeZone: 'UTC',
                          weekday: 'short',
                        })}
                        )
                        {d.adjusted ? (
                          <span className="text-xs text-muted">
                            moved from {dayText(d.statutoryOn)}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
                {(preview.data?.dates ?? []).length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setMore(!more)}
                    className="mt-2 text-sm font-medium text-link"
                  >
                    {more ? 'Show fewer dates' : 'View More Dates →'}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <Section
            step={4}
            title="Applicability Rules"
            subtitle="Set which clients or entities this deadline should apply to."
            testId="sec-rules"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 sm:col-span-2">
              <Label text="Entity Type" htmlFor="rs-entity">
                <Selectbox
                  id="rs-entity"
                  label="Entity Type"
                  value={s.entityType}
                  onChange={(v) => set({ entityType: v })}
                  options={[
                    { value: '', label: 'All Applicable' },
                    ...ENTITY_TYPES.map((x) => ({ value: x, label: x })),
                  ]}
                />
              </Label>
              <Label text="State (if applicable)" htmlFor="rs-rstate">
                <Selectbox
                  id="rs-rstate"
                  label="Rule state"
                  value={s.ruleState}
                  onChange={(v) => set({ ruleState: v })}
                  options={[
                    { value: '', label: 'All States' },
                    ...COMPLIANCE_STATES.map((x) => ({ value: x, label: x })),
                  ]}
                />
              </Label>
              <Label text="Services" htmlFor="rs-service">
                <Selectbox
                  id="rs-service"
                  label="Services"
                  value={s.service}
                  onChange={(v) => set({ service: v })}
                  options={[{ value: '', label: 'All Services' }, ...SERVICES]}
                />
              </Label>
            </div>
            <div className="sm:col-span-2">
              <p className="mb-1 text-sm font-medium text-text">Additional Rules (optional)</p>
              <div className="grid gap-1 md:grid-cols-2">
                {check1('Only apply to clients with estimated tax requirement', 'onlyEstimated')}
                {check1('Apply to individual clients (Form 1040)', 'individuals')}
                {check1(
                  'Only apply to clients with prior year tax liability > $1,000',
                  'onlyLiability',
                )}
                {check1(
                  'Apply to business clients (Schedule C, S-Corp, Partnership, etc.)',
                  'business',
                )}
                {check1('Exclude clients marked as tax-exempt', 'excludeExempt')}
                {check1('Apply to clients with multi-state filings', 'multiState')}
              </div>
              {editId ? (
                <p className="mt-2 text-xs text-muted">
                  Rules of an existing recurring deadline are changed in the Applicability Rules
                  tab.
                </p>
              ) : null}
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section
            className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
            data-testid="sec-automation"
          >
            <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-heading">
              <Gear aria-hidden weight="fill" className="size-5 text-action" /> Automation Options
            </h2>
            <p className="mb-3 text-sm text-muted">
              Choose what should happen when each occurrence is created.
            </p>
            <div className="flex flex-col gap-2">
              {check1('Automatically create a task', 'createTask')}
              {s.createTask ? (
                <div className="ml-6 flex flex-col gap-2">
                  <Selectbox
                    label="Task template"
                    value={s.taskTemplateId}
                    onChange={(v) => set({ taskTemplateId: v })}
                    options={[
                      { value: '', label: 'No template' },
                      ...(taskTemplates.data ?? []).map((t) => ({ value: t.id, label: t.name })),
                    ]}
                  />
                </div>
              ) : null}
              {check1('Assign to', 'assignOn')}
              {s.assignOn ? (
                <div className="ml-6">
                  <Selectbox
                    label="Assigned to"
                    value={s.assignedUserId}
                    onChange={(v) => set({ assignedUserId: v })}
                    options={[
                      { value: '', label: 'Choose a team member' },
                      ...members.map((m) => ({ value: m.userId, label: m.name })),
                    ]}
                  />
                </div>
              ) : null}
              {check1('Add to client portal (visible to client)', 'clientVisible')}
              {check1('Send reminder emails to client', 'remindClient')}
              {check1('Add to tax calendar', 'addToTaxCalendar')}
              {check1('Notify team when created', 'notifyTeam')}
              {s.remindClient && !s.clientVisible ? (
                <p className="text-xs text-danger">
                  Make the deadline visible to the client to remind them.
                </p>
              ) : null}
            </div>
          </section>

          <section
            className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
            data-testid="sec-reminders"
          >
            <h2 className="mb-1 font-display text-lg font-bold text-heading">
              Notifications &amp; Reminders
            </h2>
            <p className="mb-3 text-sm text-muted">
              Set the default reminder schedule for each occurrence.
            </p>
            <div className="flex flex-col gap-3">
              {check1('Enable reminders', 'remindersOn')}
              {s.remindersOn ? (
                <RemindersEditor value={s.reminders} onChange={(reminders) => set({ reminders })} />
              ) : null}
              {check1('Send past due notification if not marked complete', 'sendPastDueNotice')}
              {check1('Escalate to manager if overdue', 'escalateToManager')}
            </div>
          </section>

          <section
            className="min-w-0 rounded-xl bg-success-soft p-4"
            data-testid="setup-summary"
            aria-label="Preview & Confirm"
          >
            <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-bold text-heading">
              <ArrowsClockwise aria-hidden weight="fill" className="size-5 text-success" /> Preview
              &amp; Confirm
            </h2>
            <p className="mb-2 text-sm text-muted">Review your settings before saving.</p>
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
              {summary.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text">{k}:</dt>
                  <dd className="font-medium break-words text-heading">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/compliance" className={subtle}>
          Cancel
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={subtle}
            disabled={save.isPending}
            onClick={() => {
              if (check(true)) setTemplateAsk(true);
            }}
          >
            Save as Template
          </button>
          <Button
            data-testid="recurring-save"
            disabled={save.isPending}
            onClick={() => submit(false)}
          >
            {editId ? 'Save Changes' : 'Save Recurring Deadline'}
          </Button>
        </div>
      </footer>
      {templateAsk ? (
        <Modal
          open
          title="Save as Template"
          subtitle="A template keeps the schedule and settings, not a start date, so you can reuse it."
          onClose={() => setTemplateAsk(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setTemplateAsk(false)}>
                Cancel
              </Button>
              <Button disabled={save.isPending} onClick={() => submit(true)}>
                Save Template
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">It will be saved as “{s.name.trim()}”.</p>
        </Modal>
      ) : null}
    </div>
  );
}
