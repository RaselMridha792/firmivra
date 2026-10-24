'use client';

import {
  ApiRequestError,
  CreateProfileChangeRequest,
  PROFILE_CHANGE_FIELDS,
  PROFILE_CHANGE_KIND_LABELS,
  PROFILE_CHANGE_STATUS_LABELS,
  type ProfileChange,
  type ProfileChangeField,
  type ProfileChangeKind,
  type SupportTicketStatus,
} from '@firmivra/types';
import { Badge, Button, Input, Modal, Textarea, Toast } from '@firmivra/ui';
import { type Icon, Info, Lock, PencilCircle } from '@phosphor-icons/react';
import { type ReactNode, createElement, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

/** The firm's change requests; both cards read the one list. */
export const PROFILE_CHANGES = ['settings', 'profile-changes'] as const;
export function useProfileChanges() {
  return useApiQuery(PROFILE_CHANGES, () => api.profileChanges.list());
}

const STATUS_TONES: Record<SupportTicketStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  OPEN: 'info',
  IN_PROGRESS: 'info',
  WAITING_ON_CUSTOMER: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

const fieldsOf = (kind: ProfileChangeKind) =>
  (Object.keys(PROFILE_CHANGE_FIELDS) as ProfileChangeField[]).filter(
    (f) => PROFILE_CHANGE_FIELDS[f].kind === kind,
  );

const dayOf = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });

/** The newest request of a card, its status and Firmivra's latest reply. */
function RequestStatus({
  kind,
  changes,
  timeZone,
}: {
  kind: ProfileChangeKind;
  changes: ReturnType<typeof useProfileChanges>;
  timeZone: string;
}) {
  if (changes.isError)
    return (
      <p className="text-sm text-muted">Your change requests can&apos;t be shown right now.</p>
    );
  const latest = changes.data?.items.find((r) => r.kind === kind);
  if (!latest) return null;
  return (
    <div data-testid={`${kind.toLowerCase()}-request`} className="flex flex-col gap-1 sm:pl-12">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={STATUS_TONES[latest.status]} dot>
          {PROFILE_CHANGE_STATUS_LABELS[latest.status]}
        </Badge>
        <span className="font-semibold text-heading">Request {latest.number}</span>
        <span className="text-muted">
          {latest.fields.map((f) => PROFILE_CHANGE_FIELDS[f].label).join(', ')} · sent{' '}
          {dayOf(latest.submittedAt, timeZone)} by {latest.submittedBy}
        </span>
      </div>
      {latest.latestReply ? (
        <p className="text-sm text-text">
          <span className="font-semibold text-heading">Firmivra: </span>
          {latest.latestReply.body}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A locked card of Company Profile (company-profile-settings.jpg): the solid icon, the title and
 * her line, Request Change, the locked rows with their locks, the note, and the newest request's
 * status. `children` (the editable company fields) follow.
 */
export function LockedDetailsCard({
  kind,
  icon,
  title,
  rows,
  note,
  current,
  timeZone,
  testId,
  children,
}: {
  kind: ProfileChangeKind;
  icon: Icon;
  title: string;
  rows: readonly { label: string; value: string | null }[];
  note: ReactNode;
  /** The values the dialog shows as current, by field. */
  current: Partial<Record<ProfileChangeField, string | null>>;
  timeZone: string;
  testId: string;
  children?: ReactNode;
}) {
  const changes = useProfileChanges();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<ProfileChange | null>(null);
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        {createElement(icon, {
          'aria-hidden': true,
          weight: 'fill',
          className: 'mt-0.5 size-9 shrink-0 text-action',
        })}
        {/* The button sits beside the title, and her line runs under both. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <h2 className="min-w-0 self-center text-lg font-bold text-heading">{title}</h2>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <PencilCircle aria-hidden weight="fill" className="size-5 text-action" />
            Request Change
          </Button>
          <p className="basis-full text-sm text-muted">
            Your legal business information is provided during application and is locked. To make
            changes, submit a request to Firmivra.
          </p>
        </div>
      </div>
      <dl className="border-t border-divider">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] items-center gap-3 border-b border-divider py-1.5 text-sm sm:pl-12"
          >
            <dt className="text-text">{row.label}</dt>
            <dd className={row.value ? 'text-heading' : 'text-muted'}>
              {row.value ?? 'Not on file'}
            </dd>
            <Lock role="img" aria-label="Locked" weight="fill" className="size-4 text-heading" />
          </div>
        ))}
      </dl>
      <div className="flex items-start gap-3 rounded-lg bg-info-soft p-3 text-xs text-text">
        <Info aria-hidden weight="bold" className="size-5 shrink-0 text-heading" />
        <p>{note}</p>
      </div>
      {sent ? (
        <Toast
          message={`Request ${sent.number} sent to Firmivra. Its status shows on this card.`}
          onDismiss={() => setSent(null)}
        />
      ) : null}
      <RequestStatus kind={kind} changes={changes} timeZone={timeZone} />
      {children}
      {open ? (
        <RequestChangeModal
          kind={kind}
          current={current}
          onClose={() => setOpen(false)}
          onSent={(change) => {
            setOpen(false);
            setSent(change);
          }}
        />
      ) : null}
    </section>
  );
}

type Errors = Partial<Record<ProfileChangeField | 'reason' | 'form', string>>;

/** Guide E4: the current values, the proposed ones, the reason; Submit sends it to Firmivra. */
function RequestChangeModal({
  kind,
  current,
  onClose,
  onSent,
}: {
  kind: ProfileChangeKind;
  current: Partial<Record<ProfileChangeField, string | null>>;
  onClose: () => void;
  onSent: (change: ProfileChange) => void;
}) {
  const fields = fieldsOf(kind);
  // One per opening: a double click or a retry answers the same request.
  const [requestId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<Partial<Record<ProfileChangeField, string>>>({});
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const send = useApiMutation(
    (body: CreateProfileChangeRequest) => api.profileChanges.create(body),
    {
      invalidate: PROFILE_CHANGES,
    },
  );

  const errorsOf = (issues: readonly { path: string; message: string }[]): Errors => {
    const next: Errors = {};
    for (const issue of issues) {
      const key = issue.path.replace(/^changes\.?/, '') || 'form';
      next[(key === 'reason' || key in PROFILE_CHANGE_FIELDS ? key : 'form') as keyof Errors] ??=
        issue.message;
    }
    return next;
  };

  const submit = () => {
    const changes = Object.fromEntries(
      fields.map((f) => [f, values[f]?.trim()]).filter(([, v]) => v),
    );
    const body = { requestId, kind, changes, reason };
    const checked = CreateProfileChangeRequest.safeParse(body);
    if (!checked.success) {
      setErrors(
        errorsOf(checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))),
      );
      return;
    }
    setErrors({});
    send.mutate(body, {
      onSuccess: onSent,
      onError: (error) =>
        setErrors(
          error instanceof ApiRequestError && error.details?.length
            ? errorsOf(error.details)
            : { form: errorMessage(error) },
        ),
    });
  };

  return (
    <Modal
      open
      title="Request a Change"
      subtitle={`${PROFILE_CHANGE_KIND_LABELS[kind]}: Firmivra's Super Admin team reviews your request. Nothing changes until they approve it.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={send.isPending}>
            {send.isPending ? 'Sending…' : 'Submit Request'}
          </Button>
        </>
      }
    >
      <form
        noValidate
        data-testid="request-change"
        className="flex w-full max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <p className="text-sm text-text">
          Enter the new value for each detail to change; leave the others blank.
        </p>
        {fields.map((f) => {
          const { label } = PROFILE_CHANGE_FIELDS[f];
          return (
            <div key={f} className="flex flex-col gap-1">
              <Input
                label={`New ${label}`}
                type={f === 'expirationDate' ? 'date' : 'text'}
                inputMode={f === 'ein' ? 'numeric' : undefined}
                autoComplete="off"
                placeholder={f === 'ein' ? '12-3456789' : undefined}
                maxLength={f === 'legalName' ? 200 : f === 'ein' ? 11 : 120}
                value={values[f] ?? ''}
                error={errors[f]}
                onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              />
              <p className="text-xs text-muted">Current: {current[f] ?? 'Not on file'}</p>
            </div>
          );
        })}
        <Textarea
          label="Reason for the change *"
          rows={3}
          maxLength={2000}
          placeholder="For example: we registered a new legal name with the state."
          value={reason}
          error={errors.reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {errors.form ? (
          <p role="alert" className="text-sm text-danger">
            {errors.form}
          </p>
        ) : null}
        {/* Enter submits from any field. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
