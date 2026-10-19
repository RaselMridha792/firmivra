'use client';

import type {
  CalendarFamily,
  ComplianceCalendarDiff,
  ComplianceCalendarEntryInput,
  DeadlineType,
  ImportComplianceCalendarRequest,
  JurisdictionLevel,
} from '@firmivra/types';
import { COMPLIANCE_STATES } from '@firmivra/types';
import { Badge, Button, Input, Toast } from '@firmivra/ui';
import { DownloadSimple, Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  FAMILY_LABEL,
  Label,
  Section,
  Selectbox,
  TYPE_OPTIONS,
  dayText,
  quiet,
  subtle,
} from './compliance-shared';

const CHANGE_TONE = {
  ADDED: 'success',
  CHANGED: 'warning',
  REMOVED: 'danger',
  UNCHANGED: 'neutral',
} as const;

/** Added, changed, removed and unchanged records, and the conflicts with the firm's own dates. */
export function DiffView({ diff }: { diff: ComplianceCalendarDiff }) {
  const rule = (s: NonNullable<ComplianceCalendarDiff['entries'][number]['after']>) =>
    s.ruleKind === 'FIXED_DATE' && s.dueOn
      ? dayText(s.dueOn)
      : s.ruleKind === 'FORMULA' && s.rule
        ? `${s.rule.monthsAfterYearEnd} month(s) after year end, day ${s.rule.day}`
        : 'Needs verification';
  return (
    <div className="flex flex-col gap-3" data-testid="diff">
      <ul className="flex flex-wrap gap-2 text-sm">
        <li>
          <Badge tone="success">{diff.counts.added} added</Badge>
        </li>
        <li>
          <Badge tone="warning">{diff.counts.changed} changed</Badge>
        </li>
        <li>
          <Badge tone="danger">{diff.counts.removed} removed</Badge>
        </li>
        <li>
          <Badge tone="neutral">{diff.counts.unchanged} unchanged</Badge>
        </li>
        {diff.conflicts > 0 ? (
          <li>
            <Badge tone="danger">{diff.conflicts} conflict(s) with the firm’s own dates</Badge>
          </li>
        ) : null}
      </ul>
      {diff.entries.length === 0 ? (
        <p className={quiet}>There are no records to compare.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-divider">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Differences</caption>
            <thead className="bg-table-head text-heading">
              <tr>
                <th className="px-3 py-2 font-semibold">Change</th>
                <th className="px-3 py-2 font-semibold">Deadline</th>
                <th className="px-3 py-2 font-semibold">Before</th>
                <th className="px-3 py-2 font-semibold">After</th>
              </tr>
            </thead>
            <tbody>
              {diff.entries.map((e) => (
                <tr key={`${e.name}|${e.form ?? ''}`} className="border-t border-divider">
                  <td className="px-3 py-2">
                    <Badge tone={CHANGE_TONE[e.change]}>
                      {e.change.charAt(0) + e.change.slice(1).toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-medium text-heading">
                    {e.name}
                    {e.form ? ` (${e.form})` : ''}
                  </td>
                  <td className="px-3 py-2">{e.before ? rule(e.before) : '—'}</td>
                  <td className="px-3 py-2">{e.after ? rule(e.after) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface EntryDraft {
  key: string;
  name: string;
  type: DeadlineType;
  form: string;
  kind: 'FIXED_DATE' | 'FORMULA' | 'NEEDS_VERIFICATION';
  dueOn: string;
  months: string;
  day: string;
}
let n = 0;
const newEntry = (): EntryDraft => ({
  key: `e${(n += 1)}`,
  name: '',
  type: 'TAX_FILING',
  form: '',
  kind: 'FIXED_DATE',
  dueOn: '',
  months: '3',
  day: '15',
});

/** The "Import Government Calendar" tab: the official calendar's details and its records. */
export function CalendarImport({ onImported }: { onImported: (name: string) => void }) {
  const [family, setFamily] = useState<CalendarFamily>('IRS_GENERAL');
  const [authority, setAuthority] = useState('');
  const [jurisdiction, setJurisdiction] = useState<JurisdictionLevel>('FEDERAL');
  const [state, setState] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [name, setName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [entries, setEntries] = useState<EntryDraft[]>([newEntry()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState<ComplianceCalendarDiff>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const setEntry = (key: string, change: Partial<EntryDraft>) =>
    setEntries(entries.map((e) => (e.key === key ? { ...e, ...change } : e)));

  const body = (): ImportComplianceCalendarRequest => ({
    family,
    authority: authority.trim(),
    jurisdiction,
    ...(jurisdiction !== 'FEDERAL' && state ? { state } : {}),
    effectiveYear: Number(year),
    name: name.trim(),
    sourceUrl: sourceUrl.trim(),
    entries: entries
      .filter((e) => e.name.trim())
      .map((e): ComplianceCalendarEntryInput => {
        const base = {
          name: e.name.trim(),
          type: e.type,
          ...(e.form.trim() ? { form: e.form.trim() } : {}),
        };
        if (e.kind === 'FIXED_DATE') return { ...base, ruleKind: 'FIXED_DATE', dueOn: e.dueOn };
        if (e.kind === 'FORMULA') {
          return {
            ...base,
            ruleKind: 'FORMULA',
            rule: { monthsAfterYearEnd: Number(e.months), day: Number(e.day) },
          };
        }
        return { ...base, ruleKind: 'NEEDS_VERIFICATION' };
      }),
  });
  const check = () => {
    const e: Record<string, string> = {};
    if (!authority.trim()) e['authority'] = 'Enter the authority';
    if (!name.trim()) e['name'] = 'Enter the calendar name';
    if (!/^https:\/\/\S+$/.test(sourceUrl.trim()))
      e['sourceUrl'] = 'Use the official page, starting with https://';
    if (entries.some((x) => x.name.trim() && x.kind === 'FIXED_DATE' && !x.dueOn))
      e['entries'] = 'Give every dated entry its date';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' });
  const preview = useApiMutation(() => api.compliance.previewImport(body()), {});
  const save = useApiMutation(() => api.compliance.importCalendar(body()), {
    invalidate: [...COMPLIANCE_KEY],
  });

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="calendar-import">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <Section
        step={1}
        title="Calendar Details"
        subtitle="Where the dates come from. Every calendar keeps its official source."
        testId="import-details"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Label text="Calendar family" required htmlFor="ci-family">
            <Selectbox
              id="ci-family"
              label="Calendar family"
              value={family}
              onChange={(v) => setFamily(v as CalendarFamily)}
              options={(Object.keys(FAMILY_LABEL) as CalendarFamily[]).map((v) => ({
                value: v,
                label: FAMILY_LABEL[v],
              }))}
            />
          </Label>
          <Input
            label="Authority *"
            value={authority}
            maxLength={120}
            onChange={(e) => setAuthority(e.target.value)}
            {...(errors['authority'] ? { error: errors['authority'] } : {})}
          />
          <Label text="Jurisdiction" htmlFor="ci-juris">
            <Selectbox
              id="ci-juris"
              label="Jurisdiction"
              value={jurisdiction}
              onChange={(v) => setJurisdiction(v as JurisdictionLevel)}
              options={[
                { value: 'FEDERAL', label: 'Federal' },
                { value: 'STATE', label: 'State' },
                { value: 'LOCAL', label: 'Local' },
                { value: 'INTERNAL', label: 'Internal' },
              ]}
            />
          </Label>
          {jurisdiction !== 'FEDERAL' ? (
            <Label text="State" htmlFor="ci-state">
              <Selectbox
                id="ci-state"
                label="State"
                value={state}
                onChange={setState}
                options={[
                  { value: '', label: 'Select State' },
                  ...COMPLIANCE_STATES.map((x) => ({ value: x, label: x })),
                ]}
              />
            </Label>
          ) : null}
          <Input
            label="Effective year *"
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
          <Input
            label="Calendar name *"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            {...(errors['name'] ? { error: errors['name'] } : {})}
          />
          <div className="sm:col-span-2 xl:col-span-3">
            <Input
              label="Official source URL *"
              type="url"
              value={sourceUrl}
              maxLength={500}
              placeholder="https://"
              onChange={(e) => setSourceUrl(e.target.value)}
              {...(errors['sourceUrl'] ? { error: errors['sourceUrl'] } : {})}
            />
          </div>
        </div>
      </Section>
      <Section
        step={2}
        title="Deadline Records"
        subtitle="A date, a formula from the year end, or “needs verification” when the date is not confirmed."
        testId="import-entries"
      >
        <div className="flex flex-col gap-3">
          {entries.map((e, i) => (
            <div
              key={e.key}
              className="grid items-end gap-2 rounded-lg border border-divider p-3 sm:grid-cols-2 xl:grid-cols-[2fr_1.2fr_1fr_1.2fr_1.6fr_auto]"
            >
              <Input
                label={`Record ${i + 1} name`}
                value={e.name}
                maxLength={200}
                onChange={(x) => setEntry(e.key, { name: x.target.value })}
              />
              <Label text="Type" htmlFor={`ci-type-${e.key}`}>
                <Selectbox
                  id={`ci-type-${e.key}`}
                  label={`Record ${i + 1} type`}
                  value={e.type}
                  onChange={(v) => setEntry(e.key, { type: v as DeadlineType })}
                  options={TYPE_OPTIONS}
                />
              </Label>
              <Input
                label="Form"
                value={e.form}
                maxLength={60}
                onChange={(x) => setEntry(e.key, { form: x.target.value })}
              />
              <Label text="Date rule" htmlFor={`ci-kind-${e.key}`}>
                <Selectbox
                  id={`ci-kind-${e.key}`}
                  label={`Record ${i + 1} date rule`}
                  value={e.kind}
                  onChange={(v) => setEntry(e.key, { kind: v as EntryDraft['kind'] })}
                  options={[
                    { value: 'FIXED_DATE', label: 'Fixed date' },
                    { value: 'FORMULA', label: 'Formula from year end' },
                    { value: 'NEEDS_VERIFICATION', label: 'Needs verification' },
                  ]}
                />
              </Label>
              {e.kind === 'FIXED_DATE' ? (
                <Input
                  label="Due date"
                  type="date"
                  value={e.dueOn}
                  onChange={(x) => setEntry(e.key, { dueOn: x.target.value })}
                />
              ) : e.kind === 'FORMULA' ? (
                <div className="flex items-end gap-2">
                  <Input
                    label="Months after year end"
                    type="number"
                    min={0}
                    max={12}
                    value={e.months}
                    onChange={(x) => setEntry(e.key, { months: x.target.value })}
                  />
                  <Input
                    label="Day"
                    type="number"
                    min={1}
                    max={31}
                    value={e.day}
                    onChange={(x) => setEntry(e.key, { day: x.target.value })}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted">Flagged for review, never guessed.</p>
              )}
              <button
                type="button"
                aria-label={`Remove record ${i + 1}`}
                onClick={() => setEntries(entries.filter((x) => x.key !== e.key))}
                className="inline-flex size-10 items-center justify-center rounded-lg text-muted hover:bg-canvas"
              >
                <X aria-hidden weight="bold" className="size-4" />
              </button>
            </div>
          ))}
          {errors['entries'] ? <p className="text-xs text-danger">{errors['entries']}</p> : null}
          <button
            type="button"
            onClick={() => setEntries([...entries, newEntry()])}
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-link"
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Record
          </button>
        </div>
      </Section>
      {diff ? (
        <Section
          title="Import Preview"
          subtitle="Compared with the published calendar for the same year."
          testId="import-preview"
        >
          <div className="sm:col-span-2">
            <DiffView diff={diff} />
          </div>
        </Section>
      ) : null}
      <footer className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          className={subtle}
          disabled={preview.isPending}
          onClick={() => {
            if (!check()) return;
            preview.mutate(undefined, { onSuccess: setDiff, onError: fail });
          }}
        >
          Preview Import
        </button>
        <Button
          data-testid="import-save"
          disabled={save.isPending}
          onClick={() => {
            if (!check()) return;
            save.mutate(undefined, {
              onSuccess: (c) => onImported(c.name),
              onError: fail,
            });
          }}
        >
          <DownloadSimple aria-hidden weight="bold" className="mr-2 inline size-4" /> Import as
          Draft
        </Button>
      </footer>
    </div>
  );
}
