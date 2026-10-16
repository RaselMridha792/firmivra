'use client';

import {
  FIRM_ROLE_LABELS,
  type StaffLoginEvent,
  type StaffSecurity,
  type StaffSessionItem,
} from '@firmivra/types';
import { Badge, Button, Modal, Skeleton, Table, Textarea } from '@firmivra/ui';
import {
  CheckCircle,
  ClockCounterClockwise,
  Desktop,
  FileText,
  LockKey,
  Monitor,
  ShieldCheck,
  SignOut,
  User,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { RowMenu } from '../../../_components/row-menu';
import { ACCESS_LEVELS } from '../../../new/_components/wizard-parts';
import { ActionModal } from '../../_components/staff-actions';
import { MEMBER_ERRORS, STATUS_LOOKS, dateTime, longDate } from '../../_components/staff-parts';
import { Panel } from './panel';
import { tabHref } from './security-shell';

const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';

const STATUS_LINES: Record<StaffSecurity['status'], string> = {
  ACTIVE: 'This account is active and has access to the system.',
  INVITED: 'The invitation is open. The account becomes active when they accept it.',
  LOCKED: 'This account is locked and cannot sign in until it is unlocked.',
  DEACTIVATED: 'This account is deactivated. Its record and history are kept.',
};

/** "Logged in from Chrome on macOS, Springfield, GA, USA" (approximate, never proof of place). */
const loginLine = (s: StaffSecurity) =>
  [s.lastLogin?.device ? `Logged in from ${s.lastLogin.device}` : null, s.lastLogin?.place]
    .filter(Boolean)
    .join(', ');

export function useSecurity(id: string) {
  return useApiQuery(['staff', 'security', id], () => api.staff.security(id));
}

/** Account Status: the status with its line, User Access Level, Role and Last Login. */
export function AccountStatusCard({ id }: { id: string }) {
  const security = useSecurity(id);
  const s = security.data;
  return (
    <Panel title="Account Status" icon={User} tone="green" testId="account-status">
      {!s ? (
        security.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <p className={quiet}>{NOT_LOADED}</p>
        )
      ) : (
        <>
          <div className="flex flex-col gap-1 border-b border-divider pb-3">
            <p className="flex items-center gap-2 text-lg font-bold text-heading">
              {s.status === 'ACTIVE' ? (
                <CheckCircle aria-hidden weight="fill" className="size-5 text-success" />
              ) : (
                <XCircle aria-hidden weight="fill" className="size-5 text-muted" />
              )}
              {STATUS_LOOKS[s.status].label}
            </p>
            <p className="text-xs text-muted">{STATUS_LINES[s.status]}</p>
            {s.status === 'LOCKED' && s.lockedReason ? (
              <p className="text-xs text-muted">Reason: {s.lockedReason}</p>
            ) : null}
          </div>
          <dl className="grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr]">
            <div>
              <dt className="text-sm font-semibold text-heading">User Access Level</dt>
              <dd className="text-sm text-link">{ACCESS_LEVELS[s.accessLevel]}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-heading">Role</dt>
              <dd className="text-sm text-link">{FIRM_ROLE_LABELS[s.role]}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-sm font-semibold text-heading">Last Login</dt>
              <dd className="text-sm text-link">
                {s.lastLogin ? dateTime(s.lastLogin.at) : 'Not signed in yet'}
              </dd>
              {s.lastLogin && loginLine(s) ? (
                <dd className="mt-1 flex items-start gap-1.5 text-xs text-muted">
                  <Monitor aria-hidden weight="fill" className="size-4 shrink-0 text-heading" />
                  {loginLine(s)}
                </dd>
              ) : null}
            </div>
          </dl>
        </>
      )}
    </Panel>
  );
}

/** "None", or what limits where and how the member signs in. */
function restrictions(s: StaffSecurity): string {
  const parts = [
    s.accessLocation === 'ALLOWED_IPS' ? `IP addresses: ${s.allowedIps.join(', ')}` : null,
    s.accessLocation === 'ALLOWED_COUNTRIES' ? `Countries: ${s.allowedCountries.join(', ')}` : null,
    s.restrictDevices ? 'Known devices only' : null,
    s.disableOn ? `Ends ${longDate(`${s.disableOn}T12:00:00`)}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : 'None';
}

const MFA: Record<
  StaffSecurity['mfa'],
  { label: string; tone: 'success' | 'warning' | 'neutral' }
> = {
  ENABLED: { label: 'Enabled', tone: 'success' },
  PENDING: { label: 'Not set up yet', tone: 'warning' },
  DISABLED: { label: 'Off', tone: 'neutral' },
};

/** Security Settings: 2FA, Password Last Changed, Account Restrictions, Automatic Logout. */
export function SecuritySettingsCard({
  id,
  name,
  enabled,
}: {
  id: string;
  name: string | undefined;
  enabled: boolean;
}) {
  const security = useSecurity(id);
  const s = security.data;
  const [reset, setReset] = useState(false);
  const [done, setDone] = useState('');
  const edit = tabHref(id, 'login');
  const button =
    'inline-flex min-h-9 w-20 items-center justify-center rounded-lg border border-action bg-surface text-xs font-semibold text-action hover:bg-canvas';
  const rows: [string, ReactNode, ReactNode][] = s
    ? [
        [
          'Two-Factor Authentication (2FA)',
          <Badge key="mfa" tone={MFA[s.mfa].tone} dot>
            {MFA[s.mfa].label}
          </Badge>,
          <Link key="e" href={edit} className={button}>
            Edit
          </Link>,
        ],
        [
          'Password Last Changed',
          s.passwordChangedAt ? longDate(s.passwordChangedAt) : 'Not yet',
          <button
            key="r"
            type="button"
            disabled={!enabled || (s.status !== 'ACTIVE' && s.status !== 'LOCKED')}
            onClick={() => setReset(true)}
            className={`${button} disabled:cursor-not-allowed disabled:border-border disabled:text-muted`}
          >
            Reset
          </button>,
        ],
        [
          'Account Restrictions',
          restrictions(s),
          <Link key="e" href={edit} className={button}>
            Edit
          </Link>,
        ],
        [
          'Automatic Logout',
          s.autoLogoutMinutes ? `${s.autoLogoutMinutes} minutes` : 'Firm default',
          <Link key="e" href={edit} className={button}>
            Edit
          </Link>,
        ],
      ]
    : [];
  return (
    <Panel title="Security Settings" icon={ShieldCheck} testId="security-settings">
      {!s ? (
        security.isPending ? (
          <Skeleton className="h-32" />
        ) : (
          <p className={quiet}>{NOT_LOADED}</p>
        )
      ) : (
        <dl className="flex flex-col divide-y divide-divider">
          {rows.map(([label, value, action]) => (
            <div
              key={label}
              className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] items-center gap-3 py-2"
            >
              <dt className="text-sm font-medium text-heading">{label}</dt>
              <dd className="text-sm break-words text-text">{value}</dd>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      )}
      {done ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      {reset && name ? (
        <ActionModal
          action="resetPassword"
          id={id}
          name={name}
          onClose={() => setReset(false)}
          onDone={(text) => {
            setReset(false);
            setDone(text);
          }}
        />
      ) : null}
    </Panel>
  );
}

const lastActive = (s: StaffSessionItem) =>
  s.activeNow ? (
    <span className="inline-flex items-center gap-1.5 text-success">
      <span aria-hidden className="size-2 rounded-full bg-success" />
      Active now
    </span>
  ) : (
    dateTime(s.lastActiveAt)
  );

/** Active Sessions: device, place, IP, last active, and Sign out for one row or all. */
export function SessionsCard({
  id,
  name,
  enabled,
  limit,
}: {
  id: string;
  name: string | undefined;
  enabled: boolean;
  /** The overview shows the first few; the Active Sessions tab shows them all. */
  limit?: number;
}) {
  const sessions = useApiQuery(['staff', 'sessions', id], () => api.staff.sessions(id));
  const [all, setAll] = useState(false);
  const [one, setOne] = useState<StaffSessionItem | null>(null);
  const [done, setDone] = useState('');
  const rows = sessions.data ?? [];
  return (
    <Panel
      title="Active Sessions"
      subtitle="View all current active sessions for this user."
      icon={Desktop}
      testId="active-sessions"
      action={
        <button
          type="button"
          disabled={!enabled || !name || !rows.length}
          onClick={() => {
            setDone('');
            setAll(true);
          }}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-danger bg-danger-soft px-4 text-sm font-semibold text-danger disabled:cursor-not-allowed disabled:border-border disabled:bg-surface disabled:text-muted"
        >
          <LockKey aria-hidden weight="fill" className="size-4" />
          Sign Out All Sessions
        </button>
      }
    >
      <Table
        rows={limit ? rows.slice(0, limit) : rows}
        loading={sessions.isPending}
        rowKey={(s) => s.id}
        caption="Active sessions"
        noun="sessions"
        dense
        showPagination={!limit}
        emptyTitle={sessions.isError ? 'Sessions are not available' : 'No active sessions'}
        emptyText={
          sessions.isError ? NOT_LOADED : 'This person is not signed in anywhere right now.'
        }
        columns={[
          {
            id: 'device',
            label: 'Device / Browser',
            cell: (s) => <span className="text-link">{s.device}</span>,
          },
          { id: 'place', label: 'Location', cell: (s) => s.place ?? 'Unknown' },
          { id: 'ip', label: 'IP Address', cell: (s) => s.ip ?? '—' },
          { id: 'last', label: 'Last Active', cell: lastActive },
        ]}
        rowActions={(s) =>
          enabled ? (
            <RowMenu
              label={`Actions for ${s.device}`}
              items={[
                {
                  label: 'Sign out this session',
                  danger: true,
                  onSelect: () => {
                    setDone('');
                    setOne(s);
                  },
                },
              ]}
            />
          ) : null
        }
      />
      {limit && rows.length > limit ? (
        <Link href={tabHref(id, 'sessions')} className="text-sm font-semibold text-link">
          View all {rows.length} sessions
        </Link>
      ) : null}
      {done ? (
        <p role="status" data-testid="sessions-result" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      {all && name ? (
        <ActionModal
          action="signOutAll"
          id={id}
          name={name}
          onClose={() => setAll(false)}
          onDone={(text) => {
            setAll(false);
            setDone(text);
          }}
        />
      ) : null}
      {one ? (
        <RevokeModal
          id={id}
          session={one}
          onClose={() => setOne(null)}
          onDone={() => {
            setDone(`${one.device} was signed out.`);
            setOne(null);
          }}
        />
      ) : null}
    </Panel>
  );
}

function RevokeModal({
  id,
  session,
  onClose,
  onDone,
}: {
  id: string;
  session: StaffSessionItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const revoke = useApiMutation(() => api.staff.revokeSession(id, session.id), {
    invalidate: ['staff'],
  });
  return (
    <Modal open title="Sign Out Session" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          Sign out {session.device}
          {session.place ? ` (${session.place})` : ''}? They sign in again on that device.
        </p>
        {revoke.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(revoke.error, MEMBER_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={revoke.isPending}
            className="bg-danger text-on-action hover:bg-danger"
            onClick={() => revoke.mutate(undefined, { onSuccess: onDone })}
          >
            <SignOut aria-hidden weight="bold" className="size-4" />
            Sign Out
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const outcome = (e: StaffLoginEvent) =>
  e.outcome === 'SUCCESS' ? (
    <Badge tone="success" icon={CheckCircle}>
      Success
    </Badge>
  ) : (
    <Badge tone="danger" icon={XCircle}>
      Failed
    </Badge>
  );

export const LOGIN_COLUMNS = [
  { id: 'at', label: 'Date & Time', cell: (e: StaffLoginEvent) => dateTime(e.at) },
  { id: 'place', label: 'Location', cell: (e: StaffLoginEvent) => e.place ?? 'Unknown' },
  { id: 'ip', label: 'IP Address', cell: (e: StaffLoginEvent) => e.ip ?? '—' },
  { id: 'outcome', label: 'Status', cell: outcome },
  { id: 'device', label: 'Device', cell: (e: StaffLoginEvent) => e.device ?? '—' },
];

/** Login History on the overview: the last five sign-ins, and the Login History tab. */
export function LoginHistoryCard({ id }: { id: string }) {
  const history = useApiQuery(['staff', 'login-history', id, 5], () =>
    api.staff.loginHistory(id, { limit: 5 }),
  );
  return (
    <Panel
      title="Login History"
      subtitle="Recent login activity for this user."
      icon={ClockCounterClockwise}
      testId="login-history"
      action={
        <Link
          href={tabHref(id, 'history')}
          className="inline-flex min-h-10 items-center rounded-lg border border-action px-4 text-sm font-semibold text-action hover:bg-folder-surface"
        >
          View All Activity
        </Link>
      }
    >
      <Table
        rows={history.data?.items ?? []}
        loading={history.isPending}
        rowKey={(e) => e.at + (e.ip ?? '')}
        caption="Login history"
        dense
        showPagination={false}
        emptyTitle={history.isError ? 'Login history is not available' : 'No sign-ins yet'}
        emptyText={history.isError ? NOT_LOADED : 'Sign-ins show here once this person signs in.'}
        columns={LOGIN_COLUMNS}
      />
    </Panel>
  );
}

/** Account Notes: the internal note (Owner and Admin), 0/500, saved with Save Note. */
export function AccountNotesCard({ id, enabled }: { id: string; enabled: boolean }) {
  const note = useApiQuery(['staff', 'note', id], () => api.staff.note(id));
  const [saved, setSaved] = useState('');
  // Kept here: the saved note refetches, and its new time refills the box below.
  const save = useApiMutation(
    async (t: string) => {
      await api.staff.setNote(id, { text: t });
      setSaved('Note saved.');
    },
    { invalidate: ['staff', 'note', id] },
  );
  const n = note.data;
  return (
    <Panel
      title="Account Notes"
      subtitle="Internal notes about this staff member (visible to administrators only)."
      icon={FileText}
      testId="account-notes"
    >
      {note.isError ? <p className={quiet}>{NOT_LOADED}</p> : null}
      <NoteBox
        key={n ? n.updatedAt : note.isPending ? 'loading' : 'none'}
        initial={n?.text ?? ''}
        disabled={!enabled || note.isPending || note.isError}
        pending={save.isPending}
        footer={
          saved ? (
            <span role="status" className="text-sm text-success">
              {saved}
            </span>
          ) : n ? (
            <span className="text-xs text-muted">
              Last updated {longDate(n.updatedAt)}
              {n.updatedBy ? ` by ${n.updatedBy}` : ''}
            </span>
          ) : null
        }
        onChange={() => setSaved('')}
        onSave={(text) => save.mutate(text)}
      />
      {save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, MEMBER_ERRORS)}
        </p>
      ) : null}
    </Panel>
  );
}

function NoteBox({
  initial,
  disabled,
  pending,
  footer,
  onChange,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  pending: boolean;
  footer: ReactNode;
  onChange: () => void;
  onSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  return (
    <>
      <div className="[&_label]:sr-only">
        <Textarea
          label="Account note"
          placeholder="Add a note..."
          maxLength={500}
          rows={3}
          disabled={disabled}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange();
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {footer}
        <span className="ml-auto text-xs text-muted">{text.length}/500</span>
        <Button
          variant="secondary"
          disabled={disabled || pending || text.trim() === initial.trim()}
          onClick={() => onSave(text)}
        >
          Save Note
        </Button>
      </div>
    </>
  );
}
