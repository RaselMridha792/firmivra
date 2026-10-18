'use client';

import { XSquare } from '@phosphor-icons/react';
import { Input, Toggle } from '@firmivra/ui';
import { type ReactNode, useId } from 'react';
import { api } from '../../../../../../lib/api';
import { errorCode } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import {
  controlBox,
  FieldError,
  FieldLabel,
  Loading,
  Panel,
  QuietLine,
  UNAVAILABLE,
} from './panel';
import { PersonPicker } from './person-picker';
import { type FieldErrors, type Member, MESSAGE_MAX } from './send-model';

/** A calendar day (or none), with a clear button; the browser's own date picker. */
function DateField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  const id = useId();
  const errorId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldLabel htmlFor={id} optional>
        {label}
      </FieldLabel>
      <div
        className={`flex min-w-0 items-center gap-1 rounded-control border bg-surface pr-2 focus-within:outline-2 focus-within:outline-accent-500 ${error ? 'border-danger' : 'border-border'}`}
      >
        <input
          id={id}
          type="date"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 rounded-control bg-surface py-2 pl-3 text-base text-text focus:outline-none"
        />
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          disabled={!value}
          onClick={() => onChange('')}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-control-border hover:text-heading disabled:cursor-not-allowed disabled:opacity-40"
        >
          <XSquare aria-hidden weight="fill" className="size-5" />
        </button>
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

/** Assign To: the firm's active members (GET /business/team, Owner and Admin). */
function AssignField({
  value,
  onChange,
}: {
  value: Member | undefined;
  onChange: (member: Member | undefined) => void;
}) {
  const team = useApiQuery(['team'], () => api.team.list());
  const labelId = useId();
  const buttonId = useId();
  const members: Member[] = (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ userId: m.user.id, name: m.user.name }));

  let body: ReactNode;
  if (team.isPending) body = <Loading rows={1} />;
  else if (team.isError)
    body = (
      <QuietLine>
        {errorCode(team.error) === 'FORBIDDEN'
          ? 'Only an owner or admin can choose who the form is assigned to.'
          : UNAVAILABLE}
      </QuietLine>
    );
  else if (members.length === 0) body = <QuietLine>No active team members yet.</QuietLine>;
  else
    body = (
      <PersonPicker
        compact
        labelId={labelId}
        buttonId={buttonId}
        listLabel="Team members"
        placeholder="Not assigned"
        noneLabel="Not assigned"
        value={value ? { id: value.userId, name: value.name } : undefined}
        options={members.map((m) => ({ id: m.userId, name: m.name }))}
        onSelect={(option) => onChange(members.find((m) => m.userId === option?.id))}
      />
    );

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel id={labelId} htmlFor={buttonId} optional>
        Assign To
      </FieldLabel>
      {body}
    </div>
  );
}

/** A setting with its bold title, the switch and the line that explains it. */
function Setting({
  title,
  checked,
  onChange,
  label,
  text,
  action,
}: {
  title: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-bold text-heading">{title}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          <Toggle checked={checked} onChange={onChange} label={label} />
          <span className="text-sm text-text">{text}</span>
        </div>
        {action}
      </div>
    </div>
  );
}

export interface MessageValues {
  subject: string;
  message: string;
  dueOn: string;
  expiresOn: string;
  assignee: Member | undefined;
  reminders: boolean;
  allowSave: boolean;
}

/** Step 4: subject, message, dates, who it is assigned to, reminders and save-and-continue. */
export function MessagePanel({
  values,
  set,
  errors,
  onEditSchedule,
}: {
  values: MessageValues;
  set: (patch: Partial<MessageValues>) => void;
  errors: FieldErrors;
  onEditSchedule: () => void;
}) {
  const subjectId = useId();
  const subjectLabelId = useId();
  const messageId = useId();
  const messageErrorId = useId();
  return (
    <Panel
      step={4}
      title="Message & Settings"
      subtitle="Add a personal message and set delivery options."
      testId="send-message"
      grow
    >
      <div className="flex flex-col gap-1">
        <FieldLabel id={subjectLabelId} htmlFor={subjectId} required>
          Subject
        </FieldLabel>
        <Input
          id={subjectId}
          label="Subject"
          hideLabel
          aria-labelledby={subjectLabelId}
          required
          maxLength={200}
          value={values.subject}
          onChange={(event) => set({ subject: event.target.value })}
          error={errors.subject}
        />
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={messageId} required>
          Message
        </FieldLabel>
        <textarea
          id={messageId}
          rows={12}
          required
          maxLength={MESSAGE_MAX}
          value={values.message}
          onChange={(event) => set({ message: event.target.value })}
          aria-invalid={errors.message ? true : undefined}
          aria-describedby={errors.message ? messageErrorId : undefined}
          className={`${controlBox} resize-y ${errors.message ? 'border-danger' : 'border-border'}`}
        />
        <div className="flex justify-between gap-2 text-xs">
          <FieldError id={messageErrorId}>{errors.message}</FieldError>
          <p className="ml-auto text-muted">
            {values.message.length}/{MESSAGE_MAX}
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          label="Due Date"
          value={values.dueOn}
          onChange={(dueOn) => set({ dueOn })}
          error={errors.dueOn}
        />
        <DateField
          label="Expiration Date"
          value={values.expiresOn}
          onChange={(expiresOn) => set({ expiresOn })}
          error={errors.expiresOn}
        />
      </div>
      <AssignField value={values.assignee} onChange={(assignee) => set({ assignee })} />
      <Setting
        title="Send Reminders"
        label="Send reminders"
        checked={values.reminders}
        onChange={(reminders) => set({ reminders })}
        text="Yes, send reminder notifications"
        action={
          <button
            type="button"
            disabled={!values.reminders}
            onClick={onEditSchedule}
            className="text-sm font-medium text-link underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
          >
            Edit Schedule
          </button>
        }
      />
      <Setting
        title="Allow Client to Save and Continue"
        label="Allow client to save and continue"
        checked={values.allowSave}
        onChange={(allowSave) => set({ allowSave })}
        text="Yes, allow the client to save and come back later"
      />
    </Panel>
  );
}
