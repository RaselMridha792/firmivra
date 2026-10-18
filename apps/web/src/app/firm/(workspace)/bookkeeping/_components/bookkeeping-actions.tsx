'use client';

import type { BookkeepingClientRow, BookkeepingStatus } from '@firmivra/types';
import { BOOKKEEPING_PROVIDERS } from '@firmivra/types';
import {
  ActionMenu,
  type ActionMenuItem,
  Button,
  Input,
  Modal,
  Select,
  Textarea,
} from '@firmivra/ui';
import {
  Archive,
  CalendarPlus,
  ChatCircleDots,
  CheckCircle,
  Eye,
  FileText,
  FolderOpen,
  ListChecks,
  Pause,
  Phone,
  Play,
  Plugs,
  Repeat,
  UserSwitch,
  DotsThreeVertical,
  Warning,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { BK_ERRORS, BK_KEY, STATUS_LABEL, dateTimeText, quiet } from './bookkeeping-shared';

export type Notice = (text: string, tone: 'success' | 'error') => void;

/** Runs one action, refreshes every Bookkeeping view, and reports in a toast that outlives the row. */
export function useAct(onNotice: Notice) {
  const qc = useQueryClient();
  return async <T,>(work: () => Promise<T>, done: string): Promise<T | undefined> => {
    try {
      const result = await work();
      await qc.invalidateQueries({ queryKey: [...BK_KEY] });
      onNotice(done, 'success');
      return result;
    } catch (e) {
      onNotice(errorMessage(e, BK_ERRORS), 'error');
      return undefined;
    }
  };
}

type Row = Pick<BookkeepingClientRow, 'id' | 'status' | 'paused' | 'software'> & {
  client: { id: string; displayName: string };
};
type DialogName = 'status' | 'assign' | 'pause' | 'archive' | 'connection' | 'log' | 'sync';

function Shell({
  title,
  subtitle,
  confirm,
  disabled,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  confirm: string;
  disabled?: boolean;
  onConfirm: () => Promise<boolean | void>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={title}
      {...(subtitle ? { subtitle } : {})}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={busy || disabled}
            onClick={async () => {
              setBusy(true);
              const ok = await onConfirm();
              setBusy(false);
              if (ok !== false) onClose();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

function StatusDialog({
  row,
  onClose,
  onNotice,
}: {
  row: Row;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [status, setStatus] = useState<BookkeepingStatus | 'AUTOMATIC'>(row.status);
  const [reason, setReason] = useState('');
  return (
    <Shell
      title="Update Bookkeeping Status"
      subtitle={row.client.displayName}
      confirm="Update Status"
      onClose={onClose}
      onConfirm={async () => {
        await act(
          () =>
            api.bookkeeping.setStatus(row.id, {
              status,
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            }),
          'Status updated.',
        );
      }}
    >
      <div className="flex flex-col gap-3" data-testid="status-dialog">
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as BookkeepingStatus | 'AUTOMATIC')}
          options={[
            { value: 'AUTOMATIC', label: 'Automatic (follow the rules)' },
            ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Input
          label="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Shell>
  );
}

function AssignDialog({
  row,
  onClose,
  onNotice,
}: {
  row: Row;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const team = useApiQuery([...BK_KEY, 'team'], () => api.team.list());
  const [who, setWho] = useState('');
  return (
    <Shell
      title="Assign / Reassign Staff"
      subtitle={row.client.displayName}
      confirm="Assign"
      onClose={onClose}
      onConfirm={async () => {
        await act(
          () => api.bookkeeping.assign(row.id, { assignedUserId: who || null }),
          who ? 'Assigned.' : 'Unassigned.',
        );
      }}
    >
      <Select
        label="Assigned to"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        options={[
          { value: '', label: 'Unassigned' },
          ...(team.data ?? []).map((m) => ({ value: m.user.id, label: m.user.name })),
        ]}
      />
    </Shell>
  );
}

function ReasonDialog({
  title,
  confirm,
  row,
  required,
  work,
  done,
  onClose,
  onNotice,
}: {
  title: string;
  confirm: string;
  row: Row;
  required: boolean;
  work: (reason: string) => Promise<unknown>;
  done: string;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [reason, setReason] = useState('');
  return (
    <Shell
      title={title}
      subtitle={row.client.displayName}
      confirm={confirm}
      disabled={required && !reason.trim()}
      onClose={onClose}
      onConfirm={async () => {
        await act(() => work(reason.trim()), done);
      }}
    >
      <Textarea
        label={required ? 'Reason' : 'Reason (optional)'}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Shell>
  );
}

export function ConnectDialog({
  clientId,
  name,
  onClose,
  onNotice,
}: {
  clientId: string;
  name: string;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const conns = useApiQuery([...BK_KEY, 'connections', clientId], () =>
    api.bookkeeping.connections(clientId),
  );
  const [provider, setProvider] = useState('quickbooks');
  const [company, setCompany] = useState('');
  const [companyName, setCompanyName] = useState('');
  return (
    <Modal
      open
      title="Manage Accounting Connection"
      subtitle={name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!company.trim()}
            onClick={async () => {
              await act(
                () =>
                  api.bookkeeping.connect(clientId, {
                    provider,
                    providerCompany: company.trim(),
                    ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
                  }),
                'Connected.',
              );
              setCompany('');
            }}
          >
            Connect
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="connection-dialog">
        {conns.data?.items.length === 0 ? (
          <p className={quiet}>No accounting software is connected.</p>
        ) : null}
        <ul>
          {(conns.data?.items ?? []).map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-2 text-sm first:border-t-0"
            >
              <span className="min-w-0">
                <span className="block font-medium text-heading">{k.label}</span>
                <span className="block text-xs text-muted">
                  {k.companyName ?? k.providerCompanyId} ·{' '}
                  {k.status === 'CONNECTED'
                    ? 'Connected'
                    : k.status === 'DISCONNECTED'
                      ? 'Disconnected'
                      : (k.lastErrorCode ?? 'Needs attention')}
                </span>
              </span>
              {k.status === 'DISCONNECTED' ? (
                <button
                  type="button"
                  className="text-sm font-medium text-link"
                  onClick={() =>
                    void act(() => api.bookkeeping.reconnect(k.id), 'Reconnected.').then(() =>
                      conns.refetch(),
                    )
                  }
                >
                  Reconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="text-sm font-medium text-danger"
                  onClick={() =>
                    void act(() => api.bookkeeping.disconnect(k.id), 'Disconnected.').then(() =>
                      conns.refetch(),
                    )
                  }
                >
                  Disconnect
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="grid gap-3 border-t border-divider pt-3 sm:grid-cols-2">
          <Select
            label="Software"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            options={Object.entries(BOOKKEEPING_PROVIDERS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Input label="Company ID" value={company} onChange={(e) => setCompany(e.target.value)} />
          <div className="sm:col-span-2">
            <Input
              label="Company name (optional)"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function LogDialog({
  row,
  onClose,
  onNotice,
}: {
  row: Row;
  onClose: () => void;
  onNotice: Notice;
}) {
  const act = useAct(onNotice);
  const [kind, setKind] = useState<'NOTE' | 'CONTACT' | 'OTHER'>('CONTACT');
  const [summary, setSummary] = useState('');
  return (
    <Shell
      title="Log Activity"
      subtitle={row.client.displayName}
      confirm="Log Activity"
      disabled={!summary.trim()}
      onClose={onClose}
      onConfirm={async () => {
        await act(
          () => api.bookkeeping.logActivity(row.id, { kind, summary: summary.trim() }),
          'Activity logged.',
        );
      }}
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          options={[
            { value: 'CONTACT', label: 'Contact' },
            { value: 'NOTE', label: 'Note' },
            { value: 'OTHER', label: 'Other' },
          ]}
        />
        <Input label="What happened" value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
    </Shell>
  );
}

function SyncDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const conns = useApiQuery([...BK_KEY, 'connections', row.id], () =>
    api.bookkeeping.connections(row.id),
  );
  const first = conns.data?.items[0];
  const runs = useApiQuery([...BK_KEY, 'sync-runs', first?.id ?? 'none'], () =>
    first ? api.bookkeeping.syncRuns(first.id, { page: 1, pageSize: 10 }) : Promise.resolve(null),
  );
  return (
    <Modal
      open
      title="Sync Details"
      subtitle={row.client.displayName}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div data-testid="sync-dialog">
        {conns.data && !first ? (
          <p className={quiet}>No accounting software is connected.</p>
        ) : null}
        {first ? (
          <p className="mb-2 text-sm text-heading">
            {first.label} · last successful sync{' '}
            {first.lastSuccessfulSyncAt ? dateTimeText(first.lastSuccessfulSyncAt) : 'never'}
            {first.lastErrorCode ? ` · ${first.lastErrorCode}` : ''}
          </p>
        ) : null}
        {runs.data && runs.data.items.length === 0 ? <p className={quiet}>No syncs yet.</p> : null}
        <ul>
          {(runs.data?.items ?? []).map((r) => (
            <li
              key={r.id}
              className="flex justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
            >
              <span className="text-heading">
                {r.trigger.toLowerCase()} · {r.outcome.toLowerCase()}
              </span>
              <span className="text-muted">{dateTimeText(r.startedAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** The actions of one bookkeeping client (the design's Actions dropdown). Only what the contract supports is offered. */
export function ClientMenu({
  row,
  onNotice,
  canManage = true,
  triggerLabel,
}: {
  row: Row;
  onNotice: Notice;
  canManage?: boolean;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const act = useAct(onNotice);
  const [dialog, setDialog] = useState<DialogName>();
  const go = (href: string) => () => router.push(href);
  const connected = !!row.software;
  const items: ActionMenuItem[] = [
    {
      label: 'View Bookkeeping Profile',
      icon: Eye,
      onSelect: go(`/bookkeeping/clients/${row.id}`),
    },
    ...(connected
      ? [
          {
            label: 'Sync Now',
            icon: Repeat,
            onSelect: () => void act(() => api.bookkeeping.sync(row.id), 'Sync requested.'),
          },
          { label: 'View Sync Details', icon: ListChecks, onSelect: () => setDialog('sync') },
          {
            label: 'View Synced Reports',
            icon: FileText,
            onSelect: go(`/bookkeeping/clients/${row.id}?tab=reports`),
          },
        ]
      : []),
    {
      label: 'Request Documents',
      icon: FileText,
      onSelect: go(`/documents?clientId=${row.client.id}`),
    },
    {
      label: 'View Documents',
      icon: FolderOpen,
      onSelect: go(`/documents?clientId=${row.client.id}`),
    },
    { label: 'Create Task', icon: CheckCircle, onSelect: go(`/tasks?clientId=${row.client.id}`) },
    { label: 'Log Activity', icon: Phone, onSelect: () => setDialog('log') },
    {
      label: 'Send Message',
      icon: ChatCircleDots,
      onSelect: go(`/messages?clientId=${row.client.id}`),
    },
    { label: 'Schedule Appointment', icon: CalendarPlus, onSelect: go('/calendar') },
  ];
  const manage: ActionMenuItem[] = canManage
    ? [
        { label: 'Update Bookkeeping Status', icon: Warning, onSelect: () => setDialog('status') },
        { label: 'Assign/Reassign Staff', icon: UserSwitch, onSelect: () => setDialog('assign') },
        {
          label: 'Manage Accounting Connection',
          icon: Plugs,
          onSelect: () => setDialog('connection'),
        },
        row.paused
          ? {
              label: 'Resume Bookkeeping Service',
              icon: Play,
              onSelect: () => void act(() => api.bookkeeping.resume(row.id), 'Resumed.'),
            }
          : { label: 'Pause Bookkeeping Service', icon: Pause, onSelect: () => setDialog('pause') },
        {
          label: 'Archive Bookkeeping Client',
          icon: Archive,
          danger: true,
          onSelect: () => setDialog('archive'),
        },
      ]
    : [];
  const close = () => setDialog(undefined);
  return (
    <>
      <ActionMenu
        label={`Actions for ${row.client.displayName}`}
        trigger={
          triggerLabel ? (
            <span className="px-1 text-sm font-medium">{triggerLabel}</span>
          ) : (
            <DotsThreeVertical aria-hidden weight="bold" className="size-5" />
          )
        }
        sections={[{ items }, ...(manage.length ? [{ items: manage }] : [])]}
        align="right"
      />
      {dialog === 'status' ? <StatusDialog row={row} onClose={close} onNotice={onNotice} /> : null}
      {dialog === 'assign' ? <AssignDialog row={row} onClose={close} onNotice={onNotice} /> : null}
      {dialog === 'connection' ? (
        <ConnectDialog
          clientId={row.id}
          name={row.client.displayName}
          onClose={close}
          onNotice={onNotice}
        />
      ) : null}
      {dialog === 'log' ? <LogDialog row={row} onClose={close} onNotice={onNotice} /> : null}
      {dialog === 'sync' ? <SyncDialog row={row} onClose={close} /> : null}
      {dialog === 'pause' ? (
        <ReasonDialog
          title="Pause Bookkeeping Service"
          confirm="Pause"
          row={row}
          required
          work={(reason) => api.bookkeeping.pause(row.id, { reason })}
          done="Paused."
          onClose={close}
          onNotice={onNotice}
        />
      ) : null}
      {dialog === 'archive' ? (
        <ReasonDialog
          title="Archive Bookkeeping Client"
          confirm="Archive"
          row={row}
          required={false}
          work={(reason) => api.bookkeeping.archive(row.id, reason ? { reason } : {})}
          done="Archived."
          onClose={close}
          onNotice={onNotice}
        />
      ) : null}
    </>
  );
}
