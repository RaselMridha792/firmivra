'use client';

import {
  type BillingInterval,
  type ClientService,
  type Engagement,
  type EngagementActivityAction,
  type TeamMember,
} from '@firmivra/types';
import { ActionMenu, Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  CheckCircle,
  ClockCounterClockwise,
  DotsThree,
  PauseCircle,
  PencilSimple,
  StopCircle,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ServiceBillingDialog } from '../../../../../../components/service-billing-dialog';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { TEAM } from '../../../../setup/_components/shared';
import { dateText } from '../../_components/client-parts';

// Clients Review 2 (G8): the client's services are managed on Clients > Services. Enroll creates
// an engagement (POST /business/clients/{id}/engagements); a row's actions edit its details
// (package, staff, dates), pause or resume it through Service & Billing (the module's own pause
// for Bookkeeping and Payroll, billing for every recurring service), end it with a date and a
// reason, mark it completed, reactivate it, and show its history from the audit rows. Each call
// is the engagement API's own (its checks and audit row). No schema change.

const ERRORS: Record<string, string> = {
  CLIENT_ARCHIVED: 'This client is archived: restore them first.',
  INVALID_STATUS: 'This service has already moved on. Reload to see where it is.',
  REACTIVATION_WINDOW_PASSED: 'A cancelled service can be reactivated only within 90 days.',
  FORBIDDEN: 'Your role cannot make this change.',
};

const INTERVALS: { value: BillingInterval | ''; label: string }[] = [
  { value: '', label: "The service's default" },
  { value: 'ONE_TIME', label: 'One time' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
];

const FIELD_WORDS: Record<string, string> = {
  title: 'title',
  package: 'package',
  assignedUserId: 'assigned staff',
  periodStart: 'start date',
  periodEnd: 'end date',
  nextBillingOn: 'next billing date',
  stage: 'stage',
  taxYear: 'tax year',
  billingInterval: 'billing',
};

const ACTION_WORDS: Record<EngagementActivityAction, string> = {
  CREATED: 'Enrolled',
  UPDATED: 'Details changed',
  PAUSED: 'Paused',
  RESUMED: 'Resumed',
  BILLING_STOPPED: 'Billing paused',
  BILLING_RESUMED: 'Billing resumed',
  COMPLETED: 'Marked completed',
  CANCELLED: 'Ended',
  REACTIVATED: 'Reactivated',
  CANCELLATION_REQUESTED: 'The client asked to cancel',
};

const today = () => new Date().toISOString().slice(0, 10);

/** The firm's active members for Assigned staff: Owner and Admin only (the API's rule). */
function useMembers(manager: boolean) {
  const team = useApiQuery(
    manager ? TEAM : [...TEAM, 'not-a-manager'],
    (): Promise<TeamMember[]> => (manager ? api.team.list() : Promise.resolve([])),
  );
  return (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ value: m.user.id, label: m.user.name }));
}

/** After any change: the Services tab, Overview's Active Services and the engagement itself. */
function useRefresh(clientId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['clients', clientId] }),
      qc.invalidateQueries({ queryKey: ['engagements', clientId] }),
      qc.invalidateQueries({ queryKey: ['engagement'] }),
    ]);
}

export function EnrollDialog({
  clientId,
  clientName,
  manager,
  onClose,
  onDone,
}: {
  clientId: string;
  clientName: string;
  manager: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const catalog = useApiQuery(['catalog', 'services', 'enroll'], () =>
    api.servicesPricing.services({ status: 'active', pageSize: 100 }),
  );
  const members = useMembers(manager);
  const refresh = useRefresh(clientId);
  const [serviceId, setServiceId] = useState('');
  const [title, setTitle] = useState('');
  const [pkg, setPkg] = useState('');
  const [assignee, setAssignee] = useState('');
  const [start, setStart] = useState(today);
  const [billing, setBilling] = useState<BillingInterval | ''>('');
  const [nextBilling, setNextBilling] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const service = catalog.data?.items.find((s) => s.id === serviceId);
  const name = title.trim() || (service ? service.name : '');

  const submit = async () => {
    setTouched(true);
    if (!serviceId || !name) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.engagements.create(clientId, {
        serviceId,
        title: name,
        ...(pkg.trim() ? { package: pkg.trim() } : {}),
        ...(manager && assignee ? { assignedUserId: assignee } : {}),
        ...(start ? { periodStart: start } : {}),
        ...(billing ? { billingInterval: billing } : {}),
        ...(billing && billing !== 'ONE_TIME' && nextBilling ? { nextBillingOn: nextBilling } : {}),
      });
      await refresh();
      onDone(`${clientName} is enrolled in ${service?.name ?? 'the service'}.`);
    } catch (e) {
      setError(errorMessage(e, ERRORS));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title="Enroll in Service"
      subtitle={clientName}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void submit()}>
            {busy ? 'Enrolling…' : 'Enroll'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="enroll-dialog">
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Select
          label="Service *"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          error={touched && !serviceId ? 'Choose a service' : undefined}
          options={[
            {
              value: '',
              label: catalog.isPending
                ? 'Loading services…'
                : catalog.isError
                  ? 'Services are not available to your role'
                  : 'Choose a service',
            },
            ...(catalog.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Input
          label="Engagement title"
          maxLength={200}
          placeholder={service ? service.name : 'The service name'}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Package (optional)"
            maxLength={100}
            value={pkg}
            onChange={(e) => setPkg(e.target.value)}
          />
          {manager ? (
            <Select
              label="Assigned staff"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              options={[{ value: '', label: 'Unassigned' }, ...members]}
            />
          ) : null}
          <Input
            label="Start date"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <Select
            label="Billing"
            value={billing}
            onChange={(e) => setBilling(e.target.value as BillingInterval | '')}
            options={INTERVALS}
          />
          {billing && billing !== 'ONE_TIME' ? (
            <Input
              label="Next billing date (optional)"
              type="date"
              value={nextBilling}
              onChange={(e) => setNextBilling(e.target.value)}
            />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

type Dialog = 'edit' | 'billing' | 'end' | 'complete' | 'reactivate' | 'history';

/** A service row's actions; only for a row that is an engagement (an advisory workstream isn't). */
export function ServiceRowActions({
  clientId,
  clientName,
  service,
  engagement,
  manager,
  onNotice,
  open,
}: {
  clientId: string;
  clientName: string;
  service: ClientService;
  engagement: Engagement;
  manager: boolean;
  onNotice: (text: string, tone: 'success' | 'error') => void;
  /** Opened from the row's package or staff link. */
  open?: { dialog: Dialog; onClosed: () => void };
}) {
  const [own, setOwn] = useState<Dialog>();
  const dialog = open?.dialog ?? own;
  const close = () => {
    setOwn(undefined);
    open?.onClosed();
  };
  const done = (text: string, tone: 'success' | 'error' = 'success') => {
    close();
    onNotice(text, tone);
  };
  const live = engagement.status === 'ACTIVE' || engagement.status === 'PENDING';
  const items = [
    ...(live
      ? [
          { label: 'Edit Details', icon: PencilSimple, onSelect: () => setOwn('edit') },
          { label: 'Service & Billing', icon: PauseCircle, onSelect: () => setOwn('billing') },
          { label: 'Mark Completed', icon: CheckCircle, onSelect: () => setOwn('complete') },
          { label: 'End Service', icon: StopCircle, danger: true, onSelect: () => setOwn('end') },
        ]
      : []),
    ...(engagement.status === 'CANCELLED'
      ? [
          {
            label: 'Reactivate',
            icon: ArrowCounterClockwise,
            onSelect: () => setOwn('reactivate'),
          },
        ]
      : []),
    { label: 'History', icon: ClockCounterClockwise, onSelect: () => setOwn('history') },
  ];
  const name = service.service.name;
  return (
    <>
      <ActionMenu
        label={`Actions for ${name}`}
        align="right"
        trigger={<DotsThree aria-hidden weight="bold" className="size-5 text-heading" />}
        sections={[{ items }]}
      />
      {dialog === 'edit' ? (
        <EditServiceDialog
          clientId={clientId}
          engagement={engagement}
          manager={manager}
          onClose={close}
          onDone={() => done(`${name}: the details are saved.`)}
        />
      ) : null}
      {dialog === 'billing' ? (
        <ModuleServiceBilling
          service={service}
          clientName={clientName}
          engagement={engagement}
          onClose={close}
          onDone={done}
        />
      ) : null}
      {dialog === 'end' ? (
        <EndServiceDialog
          clientId={clientId}
          engagement={engagement}
          name={name}
          onClose={close}
          onDone={() => done(`${name} is ended.`)}
        />
      ) : null}
      {dialog === 'complete' || dialog === 'reactivate' ? (
        <StatusDialog
          clientId={clientId}
          engagement={engagement}
          name={name}
          kind={dialog}
          onClose={close}
          onDone={(text) => done(text)}
        />
      ) : null}
      {dialog === 'history' ? (
        <HistoryDialog engagement={engagement} name={name} onClose={close} />
      ) : null}
    </>
  );
}

function EditServiceDialog({
  clientId,
  engagement: e,
  manager,
  onClose,
  onDone,
}: {
  clientId: string;
  engagement: Engagement;
  manager: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const members = useMembers(manager);
  const refresh = useRefresh(clientId);
  const [title, setTitle] = useState(e.title);
  const [pkg, setPkg] = useState(e.package ?? '');
  const [assignee, setAssignee] = useState(e.assignedTo?.userId ?? '');
  const [start, setStart] = useState(e.periodStart ?? '');
  const [end, setEnd] = useState(e.periodEnd ?? '');
  const [nextBilling, setNextBilling] = useState(e.nextBillingOn ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Only what changed goes ("" clears).
  const body = {
    ...(title.trim() && title.trim() !== e.title ? { title: title.trim() } : {}),
    ...(pkg.trim() !== (e.package ?? '') ? { package: pkg.trim() } : {}),
    ...(manager && assignee !== (e.assignedTo?.userId ?? '')
      ? { assignedUserId: assignee || null }
      : {}),
    ...(start !== (e.periodStart ?? '') ? { periodStart: start } : {}),
    ...(end !== (e.periodEnd ?? '') ? { periodEnd: end } : {}),
    ...(e.recurring && nextBilling !== (e.nextBillingOn ?? '')
      ? { nextBillingOn: nextBilling }
      : {}),
  };
  const changed = Object.keys(body).length > 0;
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.engagements.update(e.id, body);
      await refresh();
      onDone();
    } catch (err) {
      setError(errorMessage(err, ERRORS));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Edit Service Details"
      subtitle={e.service.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !changed} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" data-testid="edit-service-dialog">
        {error ? (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Input
            label="Engagement title"
            maxLength={200}
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
          />
        </div>
        <Input
          label="Package"
          maxLength={100}
          value={pkg}
          onChange={(ev) => setPkg(ev.target.value)}
        />
        {manager ? (
          <Select
            label="Assigned staff"
            value={assignee}
            onChange={(ev) => setAssignee(ev.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...members,
              // A member who has left still shows as assigned until changed.
              ...(e.assignedTo && !members.some((m) => m.value === e.assignedTo!.userId)
                ? [{ value: e.assignedTo.userId, label: e.assignedTo.name }]
                : []),
            ]}
          />
        ) : null}
        <Input
          label="Start date"
          type="date"
          value={start}
          onChange={(ev) => setStart(ev.target.value)}
        />
        <Input
          label="End date"
          type="date"
          value={end}
          onChange={(ev) => setEnd(ev.target.value)}
        />
        {e.recurring ? (
          <Input
            label="Next billing date"
            type="date"
            value={nextBilling}
            onChange={(ev) => setNextBilling(ev.target.value)}
          />
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * Service & Billing for any service (G8): Bookkeeping and Payroll pause in their module, every
 * other service on its engagement (POST /business/engagements/{id}/pause, with the reason).
 */
function ModuleServiceBilling({
  service,
  clientName,
  engagement,
  onClose,
  onDone,
}: {
  service: ClientService;
  clientName: string;
  engagement: Engagement;
  onClose: () => void;
  onDone: (text: string, tone: 'success' | 'error') => void;
}) {
  const w = service.workspace;
  const books = w?.module === 'BOOKKEEPING' && w.id ? w.id : null;
  const payroll = w?.module === 'PAYROLL' && w.id ? w.id : null;
  const record = useApiQuery(
    // The engagement's own pause is read from it, so its key follows the engagement.
    ['clients', 'service-pause', books ?? payroll ?? engagement.id, engagement.pausedAt ?? ''],
    async () => {
      if (books) return { paused: (await api.bookkeeping.getClient(books)).paused };
      if (payroll) return { paused: (await api.payroll.getClient(payroll)).status === 'ON_HOLD' };
      return { paused: !!engagement.pausedAt };
    },
  );
  if (record.isPending) return null;
  const pause = books
    ? {
        pauseService: (reason: string) => api.bookkeeping.pause(books, { reason }),
        resumeService: () => api.bookkeeping.resume(books),
      }
    : payroll
      ? {
          pauseService: (reason: string) => api.payroll.pause(payroll, { reason }),
          resumeService: () => api.payroll.resume(payroll),
        }
      : {
          pauseService: (reason: string) => api.engagements.pause(engagement.id, { reason }),
          resumeService: () => api.engagements.resume(engagement.id),
        };
  return (
    <ServiceBillingDialog
      service={service.service.name}
      clientName={clientName}
      engagementId={engagement.id}
      servicePaused={record.data?.paused ?? false}
      {...(payroll ? { serviceNote: 'Payroll at the provider is not paused.' } : {})}
      {...pause}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function EndServiceDialog({
  clientId,
  engagement: e,
  name,
  onClose,
  onDone,
}: {
  clientId: string;
  engagement: Engagement;
  name: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const refresh = useRefresh(clientId);
  const [on, setOn] = useState(today);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const end = async () => {
    setTouched(true);
    if (!on || !reason.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      // The end date first (it is checked against the start), then the status with the reason.
      if (on !== e.periodEnd) await api.engagements.update(e.id, { periodEnd: on });
      await api.engagements.cancel(e.id, { reason: reason.trim() });
      await refresh();
      onDone();
    } catch (err) {
      setError(errorMessage(err, ERRORS));
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="End Service"
      subtitle={`${name} · ${e.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep Service
          </Button>
          <Button disabled={busy} onClick={() => void end()}>
            {busy ? 'Ending…' : 'End Service'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="end-service-dialog">
        <p className="text-sm text-text">
          The service ends on this date and shows as Cancelled with your reason. It can be
          reactivated within 90 days. Invoices already made are not changed.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Input
          label="End date *"
          type="date"
          value={on}
          onChange={(ev) => setOn(ev.target.value)}
          error={touched && !on ? 'Choose the end date' : undefined}
        />
        <Textarea
          label="Reason *"
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          error={touched && !reason.trim() ? 'Say why the service ends' : undefined}
        />
      </div>
    </Modal>
  );
}

function StatusDialog({
  clientId,
  engagement: e,
  name,
  kind,
  onClose,
  onDone,
}: {
  clientId: string;
  engagement: Engagement;
  name: string;
  kind: 'complete' | 'reactivate';
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const refresh = useRefresh(clientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const complete = kind === 'complete';
  const go = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await (complete ? api.engagements.complete(e.id) : api.engagements.reactivate(e.id));
      await refresh();
      onDone(complete ? `${name} is marked completed.` : `${name} is active again.`);
    } catch (err) {
      setError(errorMessage(err, ERRORS));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={complete ? 'Mark Completed' : 'Reactivate Service'}
      subtitle={`${name} · ${e.title}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void go()}>
            {complete ? 'Mark Completed' : 'Reactivate'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-text">
        <p>
          {complete
            ? 'The work on this service is done. It moves to Completed.'
            : 'The service becomes active again, as it was before it ended.'}
        </p>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function HistoryDialog({
  engagement: e,
  name,
  onClose,
}: {
  engagement: Engagement;
  name: string;
  onClose: () => void;
}) {
  const q = useApiQuery(['engagement', e.id, 'activity'], () => api.engagements.activity(e.id));
  return (
    <Modal open title="Service History" subtitle={`${name} · ${e.title}`} onClose={onClose}>
      <div data-testid="service-history" className="flex flex-col gap-3 text-sm">
        {e.status === 'CANCELLED' && e.cancellationReason ? (
          <p className="rounded-control bg-canvas px-3 py-2 text-text">
            <span className="font-semibold text-heading">Why it ended: </span>
            {e.cancellationReason}
          </p>
        ) : null}
        {q.isError ? (
          <p role="alert" className="text-danger">
            The history is not available right now.
          </p>
        ) : q.isPending ? (
          <p className="text-muted">Loading…</p>
        ) : q.data.length === 0 ? (
          <p className="text-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {q.data.map((item) => (
              <li key={item.id} className="flex flex-col gap-0.5 py-2">
                <span className="font-medium text-heading">
                  {ACTION_WORDS[item.action]}
                  {item.action === 'UPDATED' && item.fields.length
                    ? `: ${item.fields.map((f) => FIELD_WORDS[f] ?? f).join(', ')}`
                    : ''}
                  {item.action === 'BILLING_STOPPED' && item.stopsOn
                    ? ` from ${dateText(`${item.stopsOn}T12:00:00Z`)}`
                    : ''}
                </span>
                <span className="text-xs text-muted">
                  {dateText(item.at)}
                  {item.by ? ` · ${item.by}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}

export type { Dialog as ServiceDialog };
