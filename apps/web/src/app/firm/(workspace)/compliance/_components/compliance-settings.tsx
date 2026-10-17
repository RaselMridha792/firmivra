'use client';

import type { ComplianceSettings } from '@firmivra/types';
import { Button, Checkbox, Modal } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { useSettings } from './compliance-data';
import { COMPLIANCE_ERRORS, COMPLIANCE_KEY, Label, field, quiet } from './compliance-shared';
import {
  type ReminderDraft,
  RemindersEditor,
  draftsToReminders,
  remindersToDrafts,
} from './deadline-dialogs';

interface Draft {
  dueSoonDays: string;
  atRiskDays: string;
  staleCalendarDays: string;
  escalateAfterDays: string;
  sendPastDueNotice: boolean;
  escalateToManager: boolean;
  reminders: ReminderDraft[];
}
const draftOf = (s: ComplianceSettings): Draft => ({
  dueSoonDays: String(s.dueSoonDays),
  atRiskDays: String(s.atRiskDays),
  staleCalendarDays: String(s.staleCalendarDays),
  escalateAfterDays: String(s.escalateAfterDays),
  sendPastDueNotice: s.sendPastDueNotice,
  escalateToManager: s.escalateToManager,
  reminders: remindersToDrafts(s.defaultReminders),
});

/** Settings: Due Soon and At Risk thresholds, stale calendars, default reminders, escalation. */
export function SettingsDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const settings = useSettings();
  if (!settings.data) {
    return (
      <Modal
        open
        title="Compliance Settings"
        subtitle="Reminder, escalation and calendar defaults for the whole firm."
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className={quiet}>
          {settings.isError ? 'Settings are not available right now.' : 'Loading…'}
        </p>
      </Modal>
    );
  }
  return <SettingsForm initial={draftOf(settings.data)} onClose={onClose} onDone={onDone} />;
}

function SettingsForm({
  initial,
  onClose,
  onDone,
}: {
  initial: Draft;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [form, setForm] = useState<Draft>(initial);
  const save = useApiMutation(
    () =>
      api.compliance.updateSettings({
        dueSoonDays: Number(form.dueSoonDays),
        atRiskDays: Number(form.atRiskDays),
        staleCalendarDays: Number(form.staleCalendarDays),
        escalateAfterDays: Number(form.escalateAfterDays),
        sendPastDueNotice: form.sendPastDueNotice,
        escalateToManager: form.escalateToManager,
        defaultReminders: draftsToReminders(form.reminders),
      }),
    { invalidate: [...COMPLIANCE_KEY] },
  );
  const number = (
    label: string,
    key: 'dueSoonDays' | 'atRiskDays' | 'staleCalendarDays' | 'escalateAfterDays',
    hint: string,
  ) => (
    <Label text={label}>
      <input
        type="number"
        min={1}
        aria-label={label}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className={field}
      />
      <p className="text-xs text-muted">{hint}</p>
    </Label>
  );
  return (
    <Modal
      open
      title="Compliance Settings"
      subtitle="Reminder, escalation and calendar defaults for the whole firm."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate(undefined, { onSuccess: () => onDone('Settings saved.') })}
          >
            Save Settings
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="settings-form">
        <div className="grid gap-3 sm:grid-cols-2">
          {number(
            'Due Soon (days)',
            'dueSoonDays',
            'An upcoming deadline within this many days shows as Due Soon.',
          )}
          {number(
            'At Risk (days)',
            'atRiskDays',
            'A high-priority deadline this close puts a client at risk.',
          )}
          {number(
            'Stale calendar (days)',
            'staleCalendarDays',
            'Warn when a calendar was last verified longer ago.',
          )}
          {number(
            'Escalate after (days)',
            'escalateAfterDays',
            'Days past due before the manager is told.',
          )}
        </div>
        <Checkbox
          label="Send a past-due notice"
          checked={form.sendPastDueNotice}
          onChange={(e) => setForm({ ...form, sendPastDueNotice: e.target.checked })}
        />
        <Checkbox
          label="Escalate overdue deadlines to a manager"
          checked={form.escalateToManager}
          onChange={(e) => setForm({ ...form, escalateToManager: e.target.checked })}
        />
        <div>
          <h3 className="mb-2 text-sm font-semibold text-heading">Default reminders</h3>
          <RemindersEditor
            value={form.reminders}
            onChange={(reminders) => setForm({ ...form, reminders })}
          />
        </div>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, COMPLIANCE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
