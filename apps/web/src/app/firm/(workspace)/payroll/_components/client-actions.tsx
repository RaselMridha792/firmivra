'use client';

import type { PayrollClientRow, PayrollStatusRequest } from '@firmivra/types';
import { ActionMenu, type ActionMenuItem, Button, Modal, Select, Textarea } from '@firmivra/ui';
import {
  Archive,
  Bell,
  CalendarBlank,
  ChartBar,
  ChatCircleDots,
  Eye,
  FileText,
  Folder,
  ListBullets,
  ListChecks,
  NotePencil,
  Pause,
  Phone,
  Play,
  Plug,
  Receipt,
  Repeat,
  Trash,
  UserSwitch,
  type Icon,
  ArrowsClockwise,
  Briefcase,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  CLIENT_STATUS_LABEL,
  FREQUENCY_OPTIONS,
  PAYROLL_ERRORS,
  PAYROLL_KEY,
  PROVIDER_OPTIONS,
  dayText,
  quiet,
  stamp,
} from './payroll-shared';
import { useOriginNavigate } from '../../../../../components/origin-link';
import { useServiceDocuments } from '../../../../../components/service-documents';
import { newTaskHref } from '../../tasks/_components/new-task-href';
import { describeConnection } from '../../../../../lib/connection-state';
import { CatalogPlanSelect } from '../../../../../components/catalog-plan-select';

type Kind =
  | 'sync'
  | 'note'
  | 'activity'
  | 'status'
  | 'assign'
  | 'connection'
  | 'frequency'
  | 'plan'
  | 'pause'
  | 'archive'
  | 'remove';

export type ActionClient = Pick<
  PayrollClientRow,
  'id' | 'client' | 'engagementId' | 'provider' | 'status' | 'frequency'
> & {
  assignedTo?: PayrollClientRow['assignedTo'];
};

/** The Actions menu of one payroll client, with the small dialogs it opens (design: Actions Menu). */
export function ClientActionMenu({
  client,
  trigger,
  label,
  onNotice,
  align = 'right',
}: {
  client: ActionClient;
  trigger: ReactNode;
  label: string;
  onNotice: (text: string, tone: 'success' | 'error') => void;
  align?: 'left' | 'right';
}) {
  const router = useRouter();
  const toOrigin = useOriginNavigate();
  const docs = useServiceDocuments();
  const [dialog, setDialog] = useState<Kind>();
  const options = { invalidate: [...PAYROLL_KEY] };
  const sync = useApiMutation(() => api.payroll.sync(client.id), options);
  // SH1: a page outside the workspace gets Back to this exact place.
  const go = (path: string) => () =>
    path.startsWith('/payroll') || path.startsWith('/bookkeeping')
      ? router.push(path)
      : toOrigin(path);
  const item = (
    text: string,
    icon: Icon,
    onSelect: () => void,
    extra: Partial<ActionMenuItem> = {},
  ): ActionMenuItem => ({ label: text, icon, onSelect, ...extra });
  const base = `/payroll/clients/${client.id}`;
  const connected = client.provider !== null;
  const items: ActionMenuItem[] = [
    item('View Payroll Profile', Eye, go(base)),
    ...(connected
      ? [
          item('Sync Now', ArrowsClockwise, () =>
            sync.mutate(undefined, {
              onSuccess: () => onNotice('Sync queued.', 'success'),
              onError: (e) => onNotice(errorMessage(e, PAYROLL_ERRORS), 'error'),
            }),
          ),
        ]
      : []),
    item('View Sync Details', ListBullets, () => setDialog('sync')),
    item('View Payroll Runs', CalendarBlank, go(`${base}?tab=runs`)),
    item('View Payroll Reports', ChartBar, go(`${base}?tab=reports`), { submenu: true }),
    item('View Tax Filings', Receipt, go(`${base}?tab=filings`)),
    // SH3: the request opens here, for this client's payroll service.
    item('Request Payroll Documents', FileText, () =>
      docs.open('request', {
        clientId: client.client.id,
        clientName: client.client.displayName,
        engagementId: client.engagementId,
        service: 'Payroll',
      }),
    ),
    item('View Documents', Folder, go(`/clients/${client.client.id}/documents`)),
    item(
      'Create Task',
      ListChecks,
      go(newTaskHref({ clientId: client.client.id, engagementId: client.engagementId })),
    ),
    item('Add Note', NotePencil, () => setDialog('note')),
    item('Log Activity', Phone, () => setDialog('activity')),
    // SH5: this client's conversations, with New Message for them.
    item(
      'Send Message',
      ChatCircleDots,
      go(`/messages?clientId=${client.client.id}&service=Payroll`),
    ),
    // SH6: the form opens on this client and their payroll service.
    item(
      'Schedule Appointment',
      CalendarBlank,
      go(`/calendar/new?clientId=${client.client.id}&engagementId=${client.engagementId}`),
    ),
    item('Update Payroll Status', Bell, () => setDialog('status'), { submenu: true }),
    item('Assign/Reassign Staff', UserSwitch, () => setDialog('assign')),
    item('Manage Payroll Connection', Plug, () => setDialog('connection')),
    item('Change Payroll Frequency', Repeat, () => setDialog('frequency')),
    item('Change Payroll Plan/Service', Briefcase, () => setDialog('plan')),
    item(
      client.status === 'ON_HOLD' ? 'Resume Payroll Service' : 'Pause Payroll Service',
      client.status === 'ON_HOLD' ? Play : Pause,
      () =>
        client.status === 'ON_HOLD'
          ? api.payroll
              .resume(client.id)
              .then(() => onNotice('Payroll service resumed.', 'success'))
              .catch((e) => onNotice(errorMessage(e, PAYROLL_ERRORS), 'error'))
          : setDialog('pause'),
    ),
    item('Archive Payroll Client', Archive, () => setDialog('archive')),
    item('Remove Payroll Service', Trash, () => setDialog('remove'), { danger: true }),
  ];
  return (
    <>
      <ActionMenu label={label} align={align} trigger={trigger} sections={[{ items }]} />
      {dialog ? (
        <ClientDialog
          kind={dialog}
          client={client}
          onClose={() => setDialog(undefined)}
          onDone={(text) => {
            setDialog(undefined);
            onNotice(text, 'success');
          }}
        />
      ) : null}
    </>
  );
}

const TITLE: Record<Kind, string> = {
  sync: 'Sync Details',
  note: 'Add Note',
  activity: 'Log Activity',
  status: 'Update Payroll Status',
  assign: 'Assign / Reassign Staff',
  connection: 'Manage Payroll Connection',
  frequency: 'Change Payroll Frequency',
  plan: 'Change Payroll Plan / Service',
  pause: 'Pause Payroll Service',
  archive: 'Archive Payroll Client',
  remove: 'Remove Payroll Service',
};

const ACTIVITY_KINDS = [
  { value: 'PAYROLL_REVIEW', label: 'Payroll review' },
  { value: 'CLIENT_CALL', label: 'Client call' },
  { value: 'PROVIDER_ISSUE', label: 'Provider issue' },
  { value: 'NOTICE_FOLLOW_UP', label: 'Notice follow-up' },
  { value: 'DOCUMENT_FOLLOW_UP', label: 'Document follow-up' },
  { value: 'OTHER', label: 'Other' },
] as const;

function ClientDialog({
  kind,
  client,
  onClose,
  onDone,
}: {
  kind: Kind;
  client: ActionClient;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [choice, setChoice] = useState<string>(
    kind === 'frequency'
      ? (client.frequency ?? 'MONTHLY')
      : kind === 'connection'
        ? (client.provider?.key ?? '')
        : kind === 'assign'
          ? (client.assignedTo?.userId ?? '')
          : kind === 'status'
            ? 'ON_TRACK'
            : 'PAYROLL_REVIEW',
  );
  const detail = useApiQuery([...PAYROLL_KEY, 'client', client.id], () =>
    api.payroll.getClient(client.id),
  );
  const team = useApiQuery([...PAYROLL_KEY, 'members'], () => api.team.list());
  const members = (team.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ value: m.user.id, label: m.user.name }));
  const send = useApiMutation(
    async () => {
      const id = client.id;
      switch (kind) {
        case 'note':
          return api.payroll.logActivity(id, { kind: 'OTHER', summary: text.trim() });
        case 'activity':
          return api.payroll.logActivity(id, { kind: choice as 'OTHER', summary: text.trim() });
        case 'status':
          return api.payroll.setStatus(id, {
            status: choice as PayrollStatusRequest['status'],
            ...(text.trim() ? { reason: text.trim() } : {}),
          });
        case 'assign':
          return api.payroll.assign(id, { assignedUserId: choice || null });
        case 'connection':
          return api.payroll.updateClient(id, { providerKey: choice || null });
        case 'frequency':
          return api.payroll.setFrequency(id, { frequency: choice as 'MONTHLY' });
        case 'plan':
          return api.payroll.setPlan(id, { catalogServiceId: text || null });
        case 'pause':
          return api.payroll.pause(id, text.trim() ? { reason: text.trim() } : {});
        case 'archive':
          return api.payroll.archive(id, text.trim() ? { reason: text.trim() } : {});
        case 'remove':
          return api.payroll.removeService(id, { reason: text.trim() });
        default:
          return null;
      }
    },
    { invalidate: [...PAYROLL_KEY] },
  );
  const done: Record<Kind, string> = {
    sync: '',
    note: 'Note added.',
    activity: 'Activity logged.',
    status: 'Status updated.',
    assign: 'Staff assigned.',
    connection: 'Connection saved.',
    frequency: 'Frequency changed.',
    plan: 'Plan saved.',
    pause: 'Payroll service paused.',
    archive: 'Payroll client archived.',
    remove: 'Payroll service removed.',
  };
  const needsText = kind === 'note' || kind === 'activity' || kind === 'remove';
  const d = detail.data;
  const conn = d
    ? describeConnection({
        provider: d.provider?.label ?? null,
        status: d.provider ? (d.provider.connected ? 'CONNECTED' : 'NOT_AUTHORIZED') : null,
        lastSuccessAt: d.lastSyncedAt,
        lastAttemptAt: d.lastSyncAttemptAt,
      })
    : undefined;
  return (
    <Modal
      open
      title={TITLE[kind]}
      subtitle={client.client.displayName}
      onClose={onClose}
      footer={
        kind === 'sync' ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={send.isPending || (needsText && !text.trim())}
              onClick={() => send.mutate(undefined, { onSuccess: () => onDone(done[kind]) })}
            >
              {kind === 'remove'
                ? 'Remove Service'
                : kind === 'pause'
                  ? 'Pause Service'
                  : kind === 'archive'
                    ? 'Archive'
                    : 'Save'}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        {kind === 'sync' ? (
          d ? (
            <dl
              className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm"
              data-testid="sync-details"
            >
              {(
                [
                  // SH7: the connection apart from the sync; times only from real syncs.
                  ['Provider', d.provider ? d.provider.label : 'None chosen'],
                  ['Connection', `${conn!.label}. ${conn!.detail}`],
                  ['Sync', conn!.sync.label],
                  ['Last successful sync', d.lastSyncedAt ? stamp(d.lastSyncedAt) : 'Never'],
                  ['Last attempt', d.lastSyncAttemptAt ? stamp(d.lastSyncAttemptAt) : 'Never'],
                  ['Employees found', d.employeeCount === null ? '—' : String(d.employeeCount)],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-text">{k}</dt>
                  <dd className="text-heading">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={quiet}>
              {detail.isError ? 'Sync details are not available right now.' : 'Loading…'}
            </p>
          )
        ) : null}
        {kind === 'note' ? (
          <Textarea
            label="Internal note (never shown to the client)"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
        ) : null}
        {kind === 'activity' ? (
          <>
            <Select
              label="Kind"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              options={[...ACTIVITY_KINDS]}
            />
            <Textarea
              label="What happened"
              value={text}
              maxLength={1000}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        ) : null}
        {kind === 'status' ? (
          <>
            <Select
              label="Status"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              options={(
                ['ON_TRACK', 'PROCESSING', 'ACTION_REQUIRED', 'PAST_DUE', 'NOT_STARTED'] as const
              ).map((v) => ({ value: v, label: CLIENT_STATUS_LABEL[v] }))}
            />
            <Textarea
              label="Reason (optional)"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="text-xs text-muted">
              The old and new status, who changed it and when are logged.
            </p>
          </>
        ) : null}
        {kind === 'assign' ? (
          <Select
            label="Assign to"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...(client.assignedTo && !members.some((m) => m.value === client.assignedTo?.userId)
                ? [{ value: client.assignedTo.userId, label: client.assignedTo.name }]
                : []),
              ...members,
            ]}
          />
        ) : null}
        {kind === 'connection' ? (
          <>
            <Select
              label="Payroll provider"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              options={[{ value: '', label: 'Not connected' }, ...PROVIDER_OPTIONS]}
            />
            <p className="text-xs text-muted">
              Sign-in to the provider happens in the provider’s own authorization page, never in a
              form here.
            </p>
          </>
        ) : null}
        {kind === 'frequency' ? (
          <>
            <Select
              label="Payroll frequency"
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              options={FREQUENCY_OPTIONS}
            />
            <p className="text-xs text-muted">
              This changes Firmivra’s record only. The provider’s own schedule is not changed.
            </p>
          </>
        ) : null}
        {kind === 'plan' ? (
          <CatalogPlanSelect kind="PAYROLL" value={text} onChange={setText} />
        ) : null}
        {kind === 'pause' ? (
          <>
            <p className="text-sm text-text">
              Firmivra’s payroll service and its reminders go on hold. Payroll at the provider is
              not paused.
            </p>
            <Textarea
              label="Reason (optional)"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        ) : null}
        {kind === 'archive' ? (
          <>
            <p className="text-sm text-text">
              The client leaves the active payroll views. The client and its history stay.
            </p>
            <Textarea
              label="Reason (optional)"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        ) : null}
        {kind === 'remove' ? (
          <>
            <p className="text-sm text-text">
              This ends the payroll service for this client. The client record and required history
              stay.
            </p>
            <Textarea
              label="Reason"
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
            />
          </>
        ) : null}
        {send.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(send.error, PAYROLL_ERRORS)}
          </p>
        ) : null}
        {kind === 'sync' && d?.nextPayrollOn ? (
          <p className="text-xs text-muted">Next payroll {dayText(d.nextPayrollOn)}.</p>
        ) : null}
      </div>
    </Modal>
  );
}
