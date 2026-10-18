'use client';

import type { ComplianceDeadlineRow, ComplianceReminderOut } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { Plus, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { useMembers } from './compliance-data';
import { COMPLIANCE_ERRORS, COMPLIANCE_KEY, STATUS_LABEL, today } from './compliance-shared';

/** How a reminder is sent, as the select offers it. */
export type ReminderMode = 'APP' | 'EMAIL' | 'SMS' | 'EMAIL_APP' | 'EMAIL_SMS';
export const MODE_LABEL: Record<ReminderMode, string> = {
  APP: 'In-App',
  EMAIL: 'Email',
  SMS: 'SMS',
  EMAIL_APP: 'Email + In-App',
  EMAIL_SMS: 'Email + SMS',
};

/** A reminder as the form edits it: the days as text and one way of sending. */
export interface ReminderDraft {
  key: string;
  days: string;
  mode: ReminderMode;
}
let counter = 0;
export const newReminder = (days = '7', mode: ReminderMode = 'EMAIL_APP'): ReminderDraft => ({
  key: `r${(counter += 1)}`,
  days,
  mode,
});
const modeOf = (r: ComplianceReminderOut): ReminderMode => {
  const email = r.channels.includes('EMAIL');
  const sms = r.channels.includes('SMS');
  if (email && sms) return 'EMAIL_SMS';
  if (email) return r.inApp ? 'EMAIL_APP' : 'EMAIL';
  if (sms) return 'SMS';
  return 'APP';
};
export const remindersToDrafts = (list: ComplianceReminderOut[]): ReminderDraft[] =>
  list.map((r) => ({ key: `r${(counter += 1)}`, days: String(r.daysBefore), mode: modeOf(r) }));
export const draftsToReminders = (drafts: ReminderDraft[]) =>
  drafts
    .filter((d) => d.days.trim() !== '')
    .map((d) => ({
      daysBefore: Number(d.days),
      inApp: d.mode === 'APP' || d.mode === 'EMAIL_APP',
      channels: (d.mode === 'EMAIL' || d.mode === 'EMAIL_APP'
        ? ['EMAIL']
        : d.mode === 'SMS'
          ? ['SMS']
          : d.mode === 'EMAIL_SMS'
            ? ['EMAIL', 'SMS']
            : []) as ('EMAIL' | 'SMS')[],
    }));

/** The reminder rows ("14 days before (Email)") with their "Add Reminder" button. */
export function RemindersEditor({
  value,
  onChange,
}: {
  value: ReminderDraft[];
  onChange: (next: ReminderDraft[]) => void;
}) {
  const set = (key: string, change: Partial<ReminderDraft>) =>
    onChange(value.map((r) => (r.key === key ? { ...r, ...change } : r)));
  return (
    <div className="flex flex-col gap-2" data-testid="reminders">
      {value.length === 0 ? (
        <p className="text-sm text-muted">No reminders. Add one to be told before the due date.</p>
      ) : null}
      {value.map((r, i) => (
        <div key={r.key} className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={365}
            aria-label={`Reminder ${i + 1} days before`}
            value={r.days}
            onChange={(e) => set(r.key, { days: e.target.value })}
            className="min-h-10 w-20 shrink-0 rounded-control border border-border bg-surface px-3 text-sm"
          />
          <select
            aria-label={`Reminder ${i + 1} sent by`}
            value={r.mode}
            onChange={(e) => set(r.key, { mode: e.target.value as ReminderMode })}
            className="min-h-10 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 text-sm text-text"
          >
            {(Object.keys(MODE_LABEL) as ReminderMode[]).map((m) => (
              <option key={m} value={m}>
                {`${r.days === '1' ? 'day' : 'days'} before (${MODE_LABEL[m]})`}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={`Remove reminder ${i + 1}`}
            onClick={() => onChange(value.filter((x) => x.key !== r.key))}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-canvas"
          >
            <X aria-hidden weight="bold" className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, newReminder('3', 'EMAIL')])}
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-link"
      >
        <Plus aria-hidden weight="bold" className="size-4" /> Add Reminder
      </button>
    </div>
  );
}

export type SingleKind = 'complete' | 'reassign' | 'reminders' | 'notApplicable' | 'extension';

const TITLE: Record<SingleKind, string> = {
  complete: 'Mark Complete',
  reassign: 'Reassign',
  reminders: 'Reminders',
  notApplicable: 'Mark Not Applicable',
  extension: 'File an Extension',
};

/** One small dialog per action on a single deadline. */
export function DeadlineDialog({
  kind,
  deadline,
  reminders,
  onClose,
  onDone,
}: {
  kind: SingleKind;
  deadline: Pick<ComplianceDeadlineRow, 'id' | 'name' | 'dueOn'> & {
    assignedTo?: { userId: string } | null;
  };
  reminders?: ComplianceReminderOut[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { members } = useMembers();
  const [filedOn, setFiledOn] = useState(today());
  const [confirmation, setConfirmation] = useState('');
  const [who, setWho] = useState(deadline.assignedTo?.userId ?? '');
  const [reason, setReason] = useState('');
  const [drafts, setDrafts] = useState(() => remindersToDrafts(reminders ?? []));
  const [extended, setExtended] = useState('');
  const id = deadline.id;
  const send = useApiMutation(
    () => {
      if (kind === 'complete') {
        return api.compliance.completeDeadline(id, {
          filedOn,
          ...(confirmation.trim() ? { confirmationNumber: confirmation.trim() } : {}),
        });
      }
      if (kind === 'reassign') return api.compliance.reassign(id, { assignedUserId: who || null });
      if (kind === 'notApplicable')
        return api.compliance.notApplicable(id, { reason: reason.trim() });
      if (kind === 'extension') {
        return api.compliance.fileExtension(id, { filedOn, extendedDueOn: extended });
      }
      return api.compliance.saveReminders(id, { reminders: draftsToReminders(drafts) });
    },
    { invalidate: [...COMPLIANCE_KEY] },
  );
  const blocked =
    send.isPending ||
    (kind === 'notApplicable' && !reason.trim()) ||
    (kind === 'extension' && !extended);
  const done = {
    complete: 'Deadline completed.',
    reassign: 'Deadline reassigned.',
    reminders: 'Reminders saved.',
    notApplicable: 'Marked not applicable.',
    extension: 'Extension filed.',
  }[kind];
  return (
    <Modal
      open
      title={TITLE[kind]}
      subtitle={deadline.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={blocked}
            onClick={() => send.mutate(undefined, { onSuccess: () => onDone(done) })}
          >
            {kind === 'complete' ? 'Complete' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {kind === 'complete' ? (
          <>
            <Input
              label="Filed on"
              type="date"
              value={filedOn}
              onChange={(e) => setFiledOn(e.target.value)}
            />
            <Input
              label="Confirmation number (optional)"
              value={confirmation}
              maxLength={100}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </>
        ) : null}
        {kind === 'reassign' ? (
          <Select
            label="Assign to"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
        ) : null}
        {kind === 'notApplicable' ? (
          <Textarea
            label="Why does this not apply?"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        {kind === 'extension' ? (
          <>
            <Input
              label="Extension filed on"
              type="date"
              value={filedOn}
              onChange={(e) => setFiledOn(e.target.value)}
            />
            <Input
              label="Extended due date"
              type="date"
              value={extended}
              min={deadline.dueOn}
              onChange={(e) => setExtended(e.target.value)}
            />
          </>
        ) : null}
        {kind === 'reminders' ? <RemindersEditor value={drafts} onChange={setDrafts} /> : null}
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, COMPLIANCE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export type BulkKind = 'reassign' | 'status' | 'archive';

/** Reassign, change the status of, or archive the selected deadlines (one bulk call). */
export function BulkDialog({
  kind,
  ids,
  onClose,
  onDone,
}: {
  kind: BulkKind;
  ids: string[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const { members } = useMembers();
  const [who, setWho] = useState('');
  const [status, setStatus] = useState<
    'IN_PROGRESS' | 'WAITING_ON_CLIENT' | 'COMPLETED' | 'NOT_APPLICABLE'
  >('IN_PROGRESS');
  const [reason, setReason] = useState('');
  const send = useApiMutation(
    () =>
      kind === 'reassign'
        ? api.compliance.bulk({ ids, action: 'REASSIGN', assignedUserId: who || null })
        : kind === 'archive'
          ? api.compliance.bulk({ ids, action: 'ARCHIVE' })
          : api.compliance.bulk({
              ids,
              action: 'STATUS',
              status,
              ...(status === 'NOT_APPLICABLE' ? { reason: reason.trim() } : {}),
            }),
    { invalidate: [...COMPLIANCE_KEY] },
  );
  const title = { reassign: 'Reassign', status: 'Change Status', archive: 'Archive Deadlines' }[
    kind
  ];
  return (
    <Modal
      open
      title={title}
      subtitle={`${ids.length} deadline(s)`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              send.isPending || (kind === 'status' && status === 'NOT_APPLICABLE' && !reason.trim())
            }
            onClick={() =>
              send.mutate(undefined, {
                onSuccess: (r) =>
                  onDone(
                    `${r.updated.length} updated${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}.`,
                  ),
              })
            }
          >
            {kind === 'archive' ? 'Archive' : 'Apply'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {kind === 'reassign' ? (
          <Select
            label="Assign to"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
        ) : null}
        {kind === 'status' ? (
          <>
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              options={(
                ['IN_PROGRESS', 'WAITING_ON_CLIENT', 'COMPLETED', 'NOT_APPLICABLE'] as const
              ).map((value) => ({ value, label: STATUS_LABEL[value] }))}
            />
            {status === 'NOT_APPLICABLE' ? (
              <Textarea
                label="Why does this not apply?"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            ) : null}
          </>
        ) : null}
        {kind === 'archive' ? (
          <p className="text-sm text-text">
            Archived deadlines leave the lists and keep their history.
          </p>
        ) : null}
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, COMPLIANCE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
