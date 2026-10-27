'use client';

import type {
  TaxEstimateStatus,
  TaxReturnFiling,
  TaxReturnRow,
  TaxReturnWorkflowStatus,
  TaxpayerFilingStatus,
} from '@firmivra/types';
import {
  ActionMenu,
  type ActionMenuItem,
  Button,
  Drawer,
  Input,
  Modal,
  Select,
  Textarea,
  Timeline,
} from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  CalendarPlus,
  ChatCircleDots,
  ClockCounterClockwise,
  Copy,
  DotsThree,
  Eye,
  FileArrowUp,
  FolderOpen,
  NotePencil,
  PaperPlaneTilt,
  PencilSimpleLine,
  Signature,
  Swap,
  Trash,
  UserCircle,
  UserSwitch,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import {
  ACTIVITY_ICON,
  BLOCKER_LABEL,
  FILING_STATUS_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  TR_ERRORS,
  TR_KEY,
  dateTimeText,
  jurisdiction,
  linkText,
  nowLocal,
  quiet,
  toIso,
} from './tr-shared';

export type Notice = (text: string, tone: 'success' | 'error') => void;

/** Runs one change, refreshes every Tax Returns view, and reports in a toast that outlives the row. */
export function useAct(onNotice: Notice) {
  const qc = useQueryClient();
  return async <T,>(work: () => Promise<T>, done: string): Promise<T | undefined> => {
    try {
      const result = await work();
      await qc.invalidateQueries({ queryKey: [...TR_KEY] });
      onNotice(done, 'success');
      return result;
    } catch (e) {
      onNotice(errorMessage(e, TR_ERRORS), 'error');
      return undefined;
    }
  };
}

/** The firm's active members, for the preparer and reviewer pickers (empty when the role may not list them). */
export function useMembers() {
  const q = useApiQuery([...TR_KEY, 'members'], () => api.team.list());
  return (q.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ value: m.user.id, label: m.user.name }));
}

/** Owner and Admin: the elevated actions (delete, export). The API checks every request again. */
export function useManager() {
  const { role } = useFirm();
  return role === 'OWNER' || role === 'ADMIN';
}

export const isBackward = (from: TaxReturnWorkflowStatus, to: TaxReturnWorkflowStatus) => {
  const step = (s: TaxReturnWorkflowStatus) =>
    ({
      IN_PREPARATION: 1,
      READY_FOR_REVIEW: 2,
      READY_FOR_SIGNATURE: 3,
      READY_TO_FILE: 4,
      TRANSMITTED: 5,
      REJECTED: 6,
      ACCEPTED: 7,
      CLOSED: 8,
    })[s as string];
  const a = step(from);
  const b = step(to);
  return a !== undefined && b !== undefined && b < a;
};

export function Dialog({
  title,
  subtitle,
  confirm,
  disabled,
  busy,
  onConfirm,
  onClose,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  confirm: string;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Modal
      open
      title={title}
      {...(subtitle ? { subtitle } : {})}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={disabled || busy} onClick={onConfirm}>
            {busy ? 'Saving…' : confirm}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4" data-testid={testId}>
        {children}
      </div>
    </Modal>
  );
}

type DialogName =
  'details' | 'status' | 'assign' | 'amend' | 'carry' | 'activity' | 'archive' | 'delete';

/** The row's three-dots menu (developer guide, section 7) and the dialogs behind it. */
export function ReturnMenu({ row, onNotice }: { row: TaxReturnRow; onNotice: Notice }) {
  const router = useRouter();
  const manager = useManager();
  const [dialog, setDialog] = useState<DialogName>();
  const go = (href: string) => () => router.push(href);
  const client = `/clients/${row.client.id}`;
  const filedOnce = row.status !== 'IN_PROGRESS';
  const open: ActionMenuItem = {
    label: 'Open / View Return',
    icon: Eye,
    onSelect: go(`/tax-returns/${row.id}`),
  };
  const profile: ActionMenuItem = {
    label: 'View Client Profile',
    icon: UserCircle,
    onSelect: go(client),
  };
  const activity: ActionMenuItem = {
    label: 'Activity / Audit History',
    icon: ClockCounterClockwise,
    onSelect: () => setDialog('activity'),
  };
  const items: ActionMenuItem[] = [
    open,
    { label: 'Edit Return Details', icon: PencilSimpleLine, onSelect: () => setDialog('details') },
    { label: 'Change Status', icon: Swap, onSelect: () => setDialog('status') },
    { label: 'Assign / Reassign Staff', icon: UserSwitch, onSelect: () => setDialog('assign') },
  ];
  const client_: ActionMenuItem[] = [
    profile,
    { label: 'Documents', icon: FolderOpen, onSelect: go(`${client}/documents`) },
    { label: 'Request Client Information', icon: FileArrowUp, onSelect: go(`${client}/documents`) },
    { label: 'Send Message', icon: ChatCircleDots, onSelect: go(`${client}/messages`) },
    { label: 'Schedule Appointment', icon: CalendarPlus, onSelect: go('/calendar/new') },
  ];
  const filing: ActionMenuItem[] = [
    {
      label: 'Signature / Authorization',
      icon: Signature,
      onSelect: go(`/tax-returns/${row.id}/review#signatures`),
    },
    {
      label: 'E-File / Transmission Details',
      icon: PaperPlaneTilt,
      onSelect: go(`/tax-returns/${row.id}/review#efile`),
    },
    ...(filedOnce && !row.amendsReturnId
      ? [{ label: 'Amend Return', icon: NotePencil, onSelect: () => setDialog('amend') }]
      : []),
    { label: 'Duplicate / Carry Forward', icon: Copy, onSelect: () => setDialog('carry') },
    activity,
  ];
  const end: ActionMenuItem[] = [
    row.archivedAt
      ? { label: 'Restore', icon: ArrowCounterClockwise, onSelect: () => setDialog('archive') }
      : { label: 'Archive', icon: Archive, onSelect: () => setDialog('archive') },
    ...(manager && !filedOnce
      ? [{ label: 'Delete', icon: Trash, danger: true, onSelect: () => setDialog('delete') }]
      : []),
  ];
  const close = () => setDialog(undefined);
  const props = { row, onClose: close, onNotice };
  return (
    <>
      <ActionMenu
        label={`Actions for ${row.client.name} ${row.taxYear}`}
        trigger={<DotsThree aria-hidden weight="bold" className="size-5" />}
        sections={
          row.archivedAt
            ? // An archived return changes only by Restore (the API answers RETURN_LOCKED).
              [{ items: [open, profile] }, { items: [activity] }, { items: end }]
            : [{ items }, { items: client_ }, { items: filing }, { items: end }]
        }
        align="right"
      />
      {dialog === 'details' ? <DetailsDialog {...props} /> : null}
      {dialog === 'status' ? <StatusDialog {...props} /> : null}
      {dialog === 'assign' ? <AssignDialog {...props} /> : null}
      {dialog === 'amend' ? <AmendDialog {...props} /> : null}
      {dialog === 'carry' ? <CarryDialog {...props} /> : null}
      {dialog === 'activity' ? <ActivityDrawer {...props} /> : null}
      {dialog === 'archive' ? <ArchiveDialog {...props} /> : null}
      {dialog === 'delete' ? <DeleteDialog {...props} /> : null}
    </>
  );
}

interface DialogProps {
  row: TaxReturnRow;
  onClose: () => void;
  onNotice: Notice;
}
const label = (row: TaxReturnRow) =>
  `${row.client.name}, ${row.taxYear}${row.formType ? ` ${row.formType}` : ''}`;

const ESTIMATE_LABEL: Record<TaxEstimateStatus, string> = {
  NOT_STARTED: 'Not Started',
  CALCULATED: 'Calculated',
  SENT_TO_CLIENT: 'Sent to Client',
  SCHEDULED: 'Scheduled',
  PAID: 'Paid / Confirmed',
};

/** Edit Return Details: the return type, filing status, due date and a quarterly estimate. */
export function DetailsDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const detail = useApiQuery([...TR_KEY, 'detail', row.id], () =>
    api.taxReturnWorkspace.get(row.id),
  );
  const d = detail.data;
  const [formType, setFormType] = useState(row.formType ?? '');
  const [filingStatus, setFilingStatus] = useState<string>();
  const [dueOn, setDueOn] = useState(row.dueOn ?? '');
  const [amount, setAmount] = useState(
    row.estimate?.amountCents != null ? String(row.estimate.amountCents / 100) : '',
  );
  const [estimateStatus, setEstimateStatus] = useState<string>(
    row.estimate?.status ?? 'NOT_STARTED',
  );
  const [paidOn, setPaidOn] = useState(row.estimate?.paidOn ?? '');
  const [busy, setBusy] = useState(false);
  const status = filingStatus ?? d?.filingStatus ?? '';
  const quarterly = row.quarter !== null;
  const cents = amount.trim() === '' ? null : Math.round(Number(amount) * 100);
  const badAmount = cents !== null && (!Number.isFinite(cents) || cents < 0);
  const paid = estimateStatus === 'PAID';
  const save = async () => {
    setBusy(true);
    const done = await act(
      () =>
        api.taxReturnWorkspace.updateDetails(row.id, {
          formType: formType.trim() || null,
          dueOn: dueOn || null,
          ...(row.filingType === 'INDIVIDUAL' && !quarterly
            ? { filingStatus: (status || null) as TaxpayerFilingStatus | null }
            : {}),
          ...(quarterly
            ? {
                estimateAmountCents: cents,
                estimateStatus: estimateStatus as TaxEstimateStatus,
                estimatePaidOn: paid ? paidOn || null : null,
              }
            : {}),
        }),
      'Return details saved.',
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog
      title="Edit Return Details"
      subtitle={label(row)}
      confirm="Save Changes"
      busy={busy}
      disabled={badAmount || (paid && !paidOn)}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="details-dialog"
    >
      <Input
        label="Return type (form)"
        value={formType}
        maxLength={20}
        onChange={(e) => setFormType(e.target.value)}
      />
      {row.filingType === 'INDIVIDUAL' && !quarterly ? (
        <Select
          label="Filing status"
          value={status}
          onChange={(e) => setFilingStatus(e.target.value)}
          options={[
            { value: '', label: 'Not set' },
            ...Object.entries(FILING_STATUS_LABEL).map(([value, l]) => ({ value, label: l })),
          ]}
        />
      ) : null}
      <Input
        label="Due date"
        type="date"
        value={dueOn}
        onChange={(e) => setDueOn(e.target.value)}
      />
      {quarterly ? (
        <>
          <Input
            label="Estimated payment amount ($)"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            {...(badAmount ? { error: 'Enter an amount of zero or more' } : {})}
          />
          <Select
            label="Estimate status"
            value={estimateStatus}
            onChange={(e) => setEstimateStatus(e.target.value)}
            options={Object.entries(ESTIMATE_LABEL).map(([value, l]) => ({ value, label: l }))}
          />
          {paid ? (
            <Input
              label="Paid on"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}

/** An agency's rejection of a transmission (Octavia's TX-F22), for Record Acknowledgment too. */
export function useRejection(filing: Pick<TaxReturnFiling, 'jurisdiction'> | undefined) {
  // The IRS for a federal filing until staff type another (undefined: the filing's default).
  const [typed, setTyped] = useState<string>();
  const agency = typed ?? (filing?.jurisdiction === 'US' ? 'IRS' : '');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [action, setAction] = useState('');
  return {
    agency,
    setAgency: setTyped,
    code,
    setCode,
    description,
    setDescription,
    action,
    setAction,
    complete: !!agency.trim() && !!(code.trim() || description.trim()) && !!action.trim(),
    body: (acknowledgedAt: string) => ({
      ackStatus: 'REJECTED' as const,
      acknowledgedAt,
      rejectingAgency: agency.trim(),
      ...(code.trim() ? { rejectCode: code.trim() } : {}),
      ...(description.trim() ? { rejectDescription: description.trim() } : {}),
      correctiveAction: action.trim(),
    }),
  };
}

export function RejectionFields(r: ReturnType<typeof useRejection>) {
  return (
    <>
      <Input
        label="Rejecting agency"
        value={r.agency}
        maxLength={100}
        onChange={(e) => r.setAgency(e.target.value)}
      />
      <Input
        label="Reject code"
        value={r.code}
        maxLength={50}
        onChange={(e) => r.setCode(e.target.value)}
      />
      <Textarea
        label="Description"
        value={r.description}
        maxLength={2000}
        onChange={(e) => r.setDescription(e.target.value)}
      />
      <p className="-mt-2 text-xs text-muted">Enter the reject code, the description, or both.</p>
      <Textarea
        label="Corrective action"
        value={r.action}
        maxLength={2000}
        onChange={(e) => r.setAction(e.target.value)}
      />
    </>
  );
}

/**
 * Move to Rejected (Octavia's TX-F22): the agency's answer comes first. With a transmission
 * waiting for its answer, this records the rejection on it and then moves the return; with a
 * rejection already recorded, it names it and moves the return; with neither, it says to record
 * the transmission on the E-File page. The API refuses Rejected otherwise (REJECTION_NOT_RECORDED).
 */
export function RejectDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const filings = useApiQuery([...TR_KEY, 'filings', row.id], () =>
    api.taxReturnWorkspace.filings(row.id),
  );
  const newest = (filings.data ?? []).flatMap((f) =>
    f.attempts[0] ? [{ filing: f, attempt: f.attempts[0] }] : [],
  );
  const waiting = newest.filter(
    (x) => x.filing.filingMethod === 'EFILE' && x.attempt.ackStatus === 'PENDING',
  );
  const recorded = newest.filter((x) => x.attempt.ackStatus === 'REJECTED');
  const [attemptId, setAttemptId] = useState<string>();
  const chosen = waiting.find((x) => x.attempt.id === attemptId) ?? waiting[0];
  const rejection = useRejection(chosen?.filing);
  const [at, setAt] = useState(nowLocal);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const done = await act(
      async () => {
        if (chosen) {
          await api.taxReturnWorkspace.updateAttempt(
            row.id,
            chosen.attempt.id,
            rejection.body(toIso(at)),
          );
        }
        return api.taxReturnWorkspace.changeStatus(row.id, { workflowStatus: 'REJECTED' });
      },
      chosen ? 'Rejection recorded. Moved to Rejected.' : 'Moved to Rejected.',
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog
      title={chosen ? 'Record Rejection' : 'Move to Rejected'}
      subtitle={label(row)}
      confirm={chosen ? 'Record Rejection' : 'Move to Rejected'}
      busy={busy}
      disabled={chosen ? !at || !rejection.complete : !recorded.length}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="reject-dialog"
    >
      {filings.isError ? (
        <p role="alert" className={quiet}>
          We could not load this return&apos;s filings. Try again in a moment.
        </p>
      ) : filings.isPending ? (
        <p className={quiet}>Loading…</p>
      ) : chosen ? (
        <>
          <p className="text-sm text-text">
            A return is rejected by the agency&apos;s answer to a transmission. Record that answer
            here. The rejected transmission and its history are kept, and the corrected return is
            transmitted again as a new attempt.
          </p>
          {waiting.length > 1 ? (
            <Select
              label="Transmission"
              value={chosen.attempt.id}
              onChange={(e) => {
                setAttemptId(e.target.value);
                rejection.setAgency(undefined);
              }}
              options={waiting.map((x) => ({
                value: x.attempt.id,
                label: `${jurisdiction(x.filing.jurisdiction)} · ${x.attempt.submissionId}`,
              }))}
            />
          ) : (
            <p className="text-sm text-heading">
              {jurisdiction(chosen.filing.jurisdiction)} · {chosen.attempt.submissionId},
              transmitted {dateTimeText(chosen.attempt.transmittedAt)}
            </p>
          )}
          <Input
            label="Rejected at"
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
          <RejectionFields {...rejection} />
        </>
      ) : recorded.length ? (
        <ul className="flex flex-col gap-2 text-sm text-text" aria-label="Recorded rejections">
          {recorded.map(({ filing, attempt }) => (
            <li key={attempt.id} className={quiet}>
              {jurisdiction(filing.jurisdiction)} · {attempt.submissionId}: rejected
              {attempt.rejectingAgency ? ` by ${attempt.rejectingAgency}` : ''}
              {attempt.acknowledgedAt ? ` on ${dateTimeText(attempt.acknowledgedAt)}` : ''}
              {attempt.rejectCode ? ` (${attempt.rejectCode})` : ''}
              {attempt.correctiveAction ? `. Fix: ${attempt.correctiveAction}` : ''}
            </li>
          ))}
        </ul>
      ) : (
        <p className={quiet} data-testid="no-transmission">
          No transmission is waiting for an answer, so there is no rejection to record.{' '}
          <Link href={`/tax-returns/${row.id}/review#efile`} className={linkText}>
            Record the transmission on the E-File page
          </Link>{' '}
          first.
        </p>
      )}
    </Dialog>
  );
}

/** Change Status: only the moves the workflow allows now; going back needs a reason. */
export function StatusDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const detail = useApiQuery([...TR_KEY, 'detail', row.id], () =>
    api.taxReturnWorkspace.get(row.id),
  );
  const [to, setTo] = useState<TaxReturnWorkflowStatus>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const options = STATUS_ORDER.filter((s) => detail.data?.canMoveTo.includes(s));
  const back = !!to && isBackward(row.workflowStatus, to);
  const blockers = detail.data?.blockers ?? [];
  const save = async () => {
    if (!to) return;
    setBusy(true);
    const done = await act(
      () =>
        api.taxReturnWorkspace.changeStatus(row.id, {
          workflowStatus: to,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      `Moved to ${STATUS_LABEL[to]}.`,
    );
    setBusy(false);
    if (done) onClose();
  };
  if (rejecting) return <RejectDialog row={row} onClose={onClose} onNotice={onNotice} />;
  return (
    <Dialog
      title="Change Status"
      subtitle={`${label(row)}: now ${STATUS_LABEL[row.workflowStatus]}`}
      confirm={to === 'REJECTED' ? 'Continue' : 'Change Status'}
      busy={busy}
      disabled={!to || (back && !reason.trim())}
      onConfirm={() => (to === 'REJECTED' ? setRejecting(true) : void save())}
      onClose={onClose}
      testId="status-dialog"
    >
      {detail.isError ? (
        <p role="alert" className={quiet}>
          We could not load this return. Try again in a moment.
        </p>
      ) : options.length === 0 && detail.data ? (
        <p className={quiet}>A closed return does not change status.</p>
      ) : (
        <Select
          label="New status"
          value={to ?? ''}
          onChange={(e) => setTo((e.target.value || undefined) as TaxReturnWorkflowStatus)}
          options={[
            { value: '', label: detail.isPending ? 'Loading…' : 'Choose a status' },
            ...options.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
          ]}
        />
      )}
      {back ? (
        <Textarea
          label="Reason (required to go back a step)"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      ) : null}
      {blockers.length > 0 ? (
        <div
          className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-text"
          data-testid="blockers"
        >
          <p className="font-semibold">Before Ready to File:</p>
          <ul className="list-disc pl-5">
            {blockers.map((b) => (
              <li key={b}>{BLOCKER_LABEL[b]}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

/** Assign / Reassign Staff: the preparer and the reviewer (active members only). */
export function AssignDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const members = useMembers();
  const [preparer, setPreparer] = useState(row.preparer?.userId ?? '');
  const [reviewer, setReviewer] = useState(row.reviewer?.userId ?? '');
  const [busy, setBusy] = useState(false);
  const options = [{ value: '', label: 'Unassigned' }, ...members];
  const save = async () => {
    setBusy(true);
    const done = await act(
      () =>
        api.taxReturnWorkspace.updateDetails(row.id, {
          preparerUserId: preparer || null,
          reviewerUserId: reviewer || null,
        }),
      'Assignment saved.',
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog
      title="Assign / Reassign Staff"
      subtitle={label(row)}
      confirm="Save Assignment"
      busy={busy}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="assign-dialog"
    >
      <Select
        label="Preparer"
        value={preparer}
        onChange={(e) => setPreparer(e.target.value)}
        options={options}
      />
      <Select
        label="Reviewer"
        value={reviewer}
        onChange={(e) => setReviewer(e.target.value)}
        options={options}
      />
    </Dialog>
  );
}

/** Amend Return: a new return linked to this filed one, which stays as it was filed. */
function AmendDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const created = await act(
      () => api.taxReturnWorkspace.amend(row.id, { reason: reason.trim() }),
      'Amended return created.',
    );
    setBusy(false);
    if (created) router.push(`/tax-returns/${created.id}`);
  };
  return (
    <Dialog
      title="Amend Return"
      subtitle={label(row)}
      confirm="Create Amended Return"
      busy={busy}
      disabled={!reason.trim()}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="amend-dialog"
    >
      <p className={quiet}>
        The original return and its history stay as they were filed. The amendment gets its own
        signatures and filing.
      </p>
      <Textarea
        label="Reason for the amendment"
        value={reason}
        maxLength={2000}
        onChange={(e) => setReason(e.target.value)}
      />
    </Dialog>
  );
}

/** Duplicate / Carry Forward: next period's return with the people and checklist, never amounts. */
function CarryDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const router = useRouter();
  const [year, setYear] = useState(String(row.taxYear + 1));
  const [busy, setBusy] = useState(false);
  const ok = /^\d{4}$/.test(year);
  const save = async () => {
    setBusy(true);
    const created = await act(
      () => api.taxReturnWorkspace.carryForward(row.id, { taxYear: Number(year) }),
      `${year} return created.`,
    );
    setBusy(false);
    if (created) router.push(`/tax-returns/${created.id}`);
  };
  return (
    <Dialog
      title="Duplicate / Carry Forward"
      subtitle={label(row)}
      confirm="Create Return"
      busy={busy}
      disabled={!ok}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="carry-dialog"
    >
      <p className={quiet}>
        Copies the client, form, preparer, reviewer, states, approval steps and checklist labels.
        Amounts, answers and documents are never copied.
      </p>
      <Input
        label="Tax year"
        inputMode="numeric"
        maxLength={4}
        value={year}
        onChange={(e) => setYear(e.target.value)}
        {...(ok ? {} : { error: 'Enter a four-digit year' })}
      />
    </Dialog>
  );
}

/** Activity / Audit History: the return's events and its status and assignment changes. */
function ActivityDrawer({ row, onClose }: DialogProps) {
  const activity = useApiQuery([...TR_KEY, 'activity', row.id], () =>
    api.taxReturnWorkspace.activity(row.id),
  );
  const history = useApiQuery([...TR_KEY, 'history', row.id], () =>
    api.taxReturnWorkspace.history(row.id),
  );
  return (
    <Drawer open title="Activity / Audit History" subtitle={label(row)} onClose={onClose}>
      <div className="flex flex-col gap-6" data-testid="activity-drawer">
        <section aria-label="Activity">
          <h3 className="mb-2 font-semibold text-heading">Activity</h3>
          {activity.isError ? (
            <p role="alert" className={quiet}>
              We could not load the activity. Try again in a moment.
            </p>
          ) : (
            <Timeline
              label="Return activity"
              variant="plain"
              emptyText={activity.isPending ? 'Loading…' : 'No activity yet.'}
              items={(activity.data ?? []).map((a) => ({
                id: a.id,
                ...ACTIVITY_ICON[a.kind],
                title: a.label,
                time: dateTimeText(a.at),
                dateTime: a.at,
                ...(a.by ? { actor: a.by } : {}),
              }))}
            />
          )}
        </section>
        <section aria-label="Status history">
          <h3 className="mb-2 font-semibold text-heading">Status and assignments</h3>
          {history.isError ? (
            <p role="alert" className={quiet}>
              We could not load the history. Try again in a moment.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-divider text-sm">
              {(history.data ?? []).map((h) => (
                <li key={`${h.at}-${h.workflowStatus}-${h.by?.userId ?? ''}`} className="py-2">
                  <p className="font-medium text-heading">{STATUS_LABEL[h.workflowStatus]}</p>
                  <p className="text-muted">
                    {dateTimeText(h.at)}
                    {h.by ? ` · ${h.by.name}` : ''}
                    {h.preparer ? ` · Preparer ${h.preparer.name}` : ''}
                    {h.reviewer ? ` · Reviewer ${h.reviewer.name}` : ''}
                  </p>
                  {h.reason ? <p className="text-text">“{h.reason}”</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function ArchiveDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const [busy, setBusy] = useState(false);
  const restore = !!row.archivedAt;
  const save = async () => {
    setBusy(true);
    const done = await act(
      () =>
        restore ? api.taxReturnWorkspace.restore(row.id) : api.taxReturnWorkspace.archive(row.id),
      restore ? 'Return restored.' : 'Return archived.',
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog
      title={restore ? 'Restore Return' : 'Archive Return'}
      subtitle={label(row)}
      confirm={restore ? 'Restore' : 'Archive'}
      busy={busy}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="archive-dialog"
    >
      <p className="text-sm text-text">
        {restore
          ? 'The return goes back to the active lists.'
          : 'The return leaves the active lists. Its history, documents and filings stay, and you can restore it from the archived view.'}
      </p>
    </Dialog>
  );
}

/** Delete: Owner and Admin, and only a return that was never filed (the API refuses others). */
function DeleteDialog({ row, onClose, onNotice }: DialogProps) {
  const act = useAct(onNotice);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const done = await act(() => api.taxReturns.remove(row.id), 'Return deleted.');
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog
      title="Delete Return"
      subtitle={label(row)}
      confirm="Delete"
      busy={busy}
      onConfirm={() => void save()}
      onClose={onClose}
      testId="delete-dialog"
    >
      <p className="text-sm text-text">
        This removes a return that was never filed. A return that was ever filed is kept for the
        record; archive it instead.
      </p>
    </Dialog>
  );
}
