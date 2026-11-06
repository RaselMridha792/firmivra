'use client';

import type { ReportDefinitionBody, ReportDefinitionView } from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { PRESETS, RP_ERRORS, RP_KEY } from './reports-shared';
import { ReportHelp } from './report-help';
import { schedulePreview } from './schedule-preview';

export type Notice = (text: string, tone: 'success' | 'error') => void;
export const bodyOf = (d: ReportDefinitionView): ReportDefinitionBody =>
  ({ ...d }) as ReportDefinitionBody;

/** Save Report: a name, a description and who may open it. */
export function SaveReportDialog({
  definition,
  defaultName,
  onClose,
  onSaved,
}: {
  definition: ReportDefinitionView;
  defaultName: string;
  onClose: () => void;
  onSaved: (id: string, name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'SELECTED' | 'COMPANY'>('PRIVATE');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title="Save Report"
      subtitle="A saved report keeps its settings, not its numbers."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await api.reports.save({
                  name: name.trim(),
                  ...(description.trim() ? { description: description.trim() } : {}),
                  visibility,
                  definition: bodyOf(definition),
                });
                onSaved(r.id, r.name);
              } catch (e) {
                setError(errorMessage(e, RP_ERRORS));
                setBusy(false);
              }
            }}
          >
            Save Report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="save-dialog">
        <Input label="Report name" value={name} onChange={(e) => setName(e.target.value)} />
        <Textarea
          label="Description (optional)"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Select
          label="Who can open it"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          options={[
            { value: 'PRIVATE', label: 'Only me' },
            { value: 'SELECTED', label: 'Selected people' },
            { value: 'COMPANY', label: 'Everyone in the firm' },
          ]}
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

type Target =
  | { kind: 'SYSTEM'; key: string }
  | { kind: 'SAVED'; id: string }
  | { kind: 'NEW'; definition: ReportDefinitionView; name: string };

/** The current minute, kept fresh while a dialog is open (a preview that names "next"). */
function useMinute(): number {
  const subscribe = useCallback((onChange: () => void) => {
    const timer = window.setInterval(onChange, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const snapshot = () => Math.floor(Date.now() / 60_000) * 60_000;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Schedule Report: when it runs, what it covers, who gets it and how. */
export function ScheduleReportDialog({
  target,
  defaultName,
  onClose,
  onNotice,
}: {
  target: Target;
  defaultName: string;
  onClose: () => void;
  onNotice: Notice;
}) {
  const team = useApiQuery([...RP_KEY, 'team'], () => api.team.list());
  const [name, setName] = useState(defaultName);
  const [frequency, setFrequency] = useState<
    'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'ANNUAL'
  >('WEEKLY');
  const [weekday, setWeekday] = useState('1');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [month, setMonth] = useState('1');
  const [time, setTime] = useState('08:00');
  const [preset, setPreset] = useState('last_30_days');
  const [formats, setFormats] = useState<string[]>(['PDF']);
  const [users, setUsers] = useState<string[]>([]);
  const [emails, setEmails] = useState('');
  const [deliverEmail, setDeliverEmail] = useState(true);
  const [deliverInApp, setDeliverInApp] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mails = emails.split(/[\s,;]+/).filter(Boolean);
  // RP-F19 (Octavia's Reports review, Oct 28): the next run, with the schedules' own rules, in the
  // firm's named time zone, recomputed as the frequency, day, month and time change.
  const settings = useApiQuery([...RP_KEY, 'settings'], () => api.reports.settings());
  const zone = settings.data?.timezone ?? 'America/New_York';
  const minute = useMinute();
  const preview = schedulePreview(
    {
      frequency,
      weekday: frequency === 'WEEKLY' ? Number(weekday) : null,
      dayOfMonth: ['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(frequency)
        ? Number(dayOfMonth)
        : null,
      monthOfYear: frequency === 'ANNUAL' ? Number(month) : null,
      runTime: time,
    },
    zone,
    new Date(minute),
  );
  return (
    <Modal
      open
      title="Schedule Report"
      subtitle={`The report runs in your firm's time zone, ${zone}.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              busy || !name.trim() || formats.length === 0 || users.length + mails.length === 0
            }
            onClick={async () => {
              setBusy(true);
              try {
                const t =
                  target.kind === 'NEW'
                    ? {
                        kind: 'NEW' as const,
                        report: { name: target.name, definition: bodyOf(target.definition) },
                      }
                    : target;
                await api.reports.createSchedule({
                  target: t as never,
                  name: name.trim(),
                  frequency,
                  ...(frequency === 'WEEKLY' ? { weekday: Number(weekday) } : {}),
                  ...(['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(frequency)
                    ? { dayOfMonth: Number(dayOfMonth) }
                    : {}),
                  ...(frequency === 'ANNUAL' ? { monthOfYear: Number(month) } : {}),
                  runTime: time,
                  datePreset: preset as never,
                  formats: formats as never,
                  recipientUserIds: users,
                  recipientEmails: mails,
                  deliverEmail,
                  deliverInApp,
                });
                onNotice('Report scheduled.', 'success');
                onClose();
              } catch (e) {
                setError(errorMessage(e, RP_ERRORS));
                setBusy(false);
              }
            }}
          >
            Schedule Report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="schedule-dialog">
        <p className="flex items-center gap-2 text-sm text-muted">
          How schedules work <ReportHelp area="schedules" />
        </p>
        <Input label="Schedule name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="How often"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as typeof frequency)}
            options={[
              { value: 'DAILY', label: 'Daily' },
              { value: 'WEEKLY', label: 'Weekly' },
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'QUARTERLY', label: 'Quarterly' },
              { value: 'ANNUAL', label: 'Annually' },
            ]}
          />
          <Input
            label="At"
            type="time"
            step={300}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          {frequency === 'WEEKLY' ? (
            <Select
              label="On"
              value={weekday}
              onChange={(e) => setWeekday(e.target.value)}
              options={[
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
              ].map((d, i) => ({ value: String(i), label: d }))}
            />
          ) : null}
          {['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(frequency) ? (
            <Input
              label="Day of the month"
              type="number"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
            />
          ) : null}
          {frequency === 'ANNUAL' ? (
            <Input
              label="Month (1 to 12)"
              type="number"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          ) : null}
          <Select
            label="Each run covers"
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </div>
        <p
          role="status"
          data-testid="next-run"
          className={`rounded-lg p-3 text-sm ${'text' in preview ? 'bg-info-soft text-heading' : 'bg-warning-soft text-warning'}`}
        >
          {'text' in preview ? (
            <>
              <strong>Next run:</strong> {preview.text}
            </>
          ) : (
            preview.problem
          )}
        </p>
        <fieldset className="flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-semibold text-heading">Formats</legend>
          {['PDF', 'XLSX', 'CSV'].map((f) => (
            <Checkbox
              key={f}
              label={f}
              checked={formats.includes(f)}
              onChange={(e) =>
                setFormats(e.target.checked ? [...formats, f] : formats.filter((x) => x !== f))
              }
            />
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-semibold text-heading">Send to</legend>
          {(team.data ?? []).slice(0, 8).map((m) => (
            <Checkbox
              key={m.user.id}
              label={m.user.name}
              checked={users.includes(m.user.id)}
              onChange={(e) =>
                setUsers(
                  e.target.checked ? [...users, m.user.id] : users.filter((x) => x !== m.user.id),
                )
              }
            />
          ))}
          <Input
            label="Other email addresses (separated by commas)"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
          />
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <Checkbox
            label="Email"
            checked={deliverEmail}
            onChange={(e) => setDeliverEmail(e.target.checked)}
          />
          <Checkbox
            label="In the app"
            checked={deliverInApp}
            onChange={(e) => setDeliverInApp(e.target.checked)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
