'use client';

import {
  FIRM_ROLE_LABELS,
  type FirmUser,
  type MembershipRole,
  type StaffStatusFilter,
} from '@firmivra/types';
import {
  Avatar,
  Badge,
  Button,
  Modal,
  SearchField,
  Select,
  Skeleton,
  Table,
  type Column,
  tileTones,
} from '@firmivra/ui';
import {
  DownloadSimple,
  EnvelopeSimple,
  FileText,
  type Icon,
  Key,
  Plus,
  ShieldCheck,
  ShieldWarning,
  User,
  UserMinus,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, createElement, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { RowMenu, type RowMenuItem } from '../../../team/_components/row-menu';
import { ActionModal, type StaffAction } from '../../../team/[id]/_components/staff-actions';
import { MEMBER_ERRORS, STATUS_LOOKS } from '../../../team/[id]/_components/staff-parts';
import { RoleTemplates } from '../../../team/roles/_components/role-side';
import { NOT_LOADED, SettingsHeader } from '../../_components/settings-parts';
import { InviteUserModal } from './invite-user-modal';
import { RolePanel } from './role-panel';

const PAGE_SIZE = 10;

const MFA: Record<FirmUser['mfa'], { label: string; tone: string; icon: Icon }> = {
  ENABLED: { label: 'Enabled', tone: 'text-success', icon: ShieldCheck },
  DISABLED: { label: 'Disabled', tone: 'text-muted', icon: ShieldWarning },
  PENDING: { label: 'Pending', tone: 'text-muted', icon: ShieldWarning },
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Today 9:12 AM", "Sep 28, 2026", or "Invited Sep 25, 2026". */
function lastLogin(u: FirmUser): string {
  if (u.status === 'INVITED' && u.invite) return `Invited ${day(u.invite.sentAt)}`;
  if (!u.lastLoginAt) return 'Never';
  const d = new Date(u.lastLoginAt);
  if (d.toDateString() === new Date().toDateString()) {
    return `Today ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  return day(u.lastLoginAt);
}

function Kpi({
  label,
  icon,
  tone,
  value,
  note,
}: {
  label: string;
  icon: Icon;
  tone: 'blue' | 'green' | 'amber' | 'purple';
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex items-center gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <span
        aria-hidden
        className={`flex size-16 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
      >
        {createElement(icon, { weight: 'fill', className: 'size-8' })}
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-heading">{label}</h2>
        <div className="text-3xl font-bold text-heading">{value}</div>
        <p className="text-sm text-link">{note}</p>
      </div>
    </section>
  );
}

type Dialog =
  | { kind: 'invite' }
  | { kind: 'action'; action: StaffAction; user: FirmUser }
  | { kind: 'revoke'; user: FirmUser }
  | { kind: 'pick'; action: 'resetPassword' | 'deactivate' };

/**
 * Settings > Users & Roles (users-and-role.jpg, guide §5-8): the KPIs (`api.users.summary`), User
 * Management (`api.users.list`: search, role, status, Export, pages, row menu through
 * `api.staff`), Quick Actions, Role Templates and the role grid (`api.roles`). Owner and Admin
 * only. A firm has one company, so the Company column shows the firm's name and has no filter.
 */
export function UsersScreen() {
  const router = useRouter();
  const { role: me } = useFirm();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<MembershipRole | ''>('');
  const [status, setStatus] = useState<StaffStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<MembershipRole | null>(null);
  const query = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(role ? { role } : {}),
    status,
    page,
    pageSize: PAGE_SIZE,
  };
  const summary = useApiQuery(['users', 'summary'], () => api.users.summary());
  const list = useApiQuery(['users', 'list', query], () => api.users.list(query));
  const roles = useApiQuery(['roles', 'list'], () => api.roles.list());
  const resend = useApiMutation((id: string) => api.staff.resendInvite(id), {
    invalidate: ['users'],
  });
  const s = summary.data;
  const roleItems = roles.data?.items ?? [];
  const selectedRole =
    roleItems.find((r) => r.role === picked) ?? roleItems.find((r) => !r.locked) ?? roleItems[0];
  const manages = me === 'OWNER' || me === 'ADMIN';
  const n = (v: number | undefined) =>
    summary.isPending ? <Skeleton className="h-8 w-12" /> : (v ?? '—');
  const filtered = Boolean(search.trim() || role || status !== 'all');

  const menu = (u: FirmUser): RowMenuItem[] => {
    const act = (action: StaffAction) => () => setDialog({ kind: 'action', action, user: u });
    const items: RowMenuItem[] = [
      { label: 'View Profile', onSelect: () => router.push(`/team/${u.id}/security`) },
    ];
    if (!manages || u.isYou) return items;
    items.push(
      { label: 'Edit User', onSelect: () => router.push(`/team/${u.id}`) },
      { label: 'Manage Access', onSelect: () => router.push(`/team/${u.id}/security/permissions`) },
    );
    if (u.status === 'INVITED') {
      items.push(
        {
          label: 'Resend Invitation',
          onSelect: () =>
            resend.mutate(u.id, {
              onSuccess: () => setMessage(`A fresh invitation was emailed to ${u.name}.`),
            }),
        },
        {
          label: 'Revoke Invitation',
          danger: true,
          onSelect: () => setDialog({ kind: 'revoke', user: u }),
        },
      );
    }
    if (u.status === 'ACTIVE' || u.status === 'LOCKED') {
      items.push(
        { label: 'Reset Password', onSelect: act('resetPassword') },
        { label: 'Reset MFA', onSelect: act('resetMfa') },
        { label: 'Sign Out All Sessions', onSelect: act('signOutAll') },
      );
    }
    items.push(
      u.status === 'DEACTIVATED'
        ? { label: 'Reactivate User', onSelect: act('reactivate') }
        : { label: 'Deactivate User', danger: true, onSelect: act('deactivate') },
      { label: 'View Activity', onSelect: () => router.push(`/team/${u.id}/security/activity`) },
    );
    return items;
  };

  const columns: Column<FirmUser>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (u) => (
        <Link
          href={`/team/${u.id}/security`}
          className="flex items-center gap-2 font-semibold whitespace-nowrap text-heading hover:underline"
        >
          <Avatar name={u.name} src={u.avatarUrl ?? undefined} size="sm" />
          {u.name}
        </Link>
      ),
    },
    { id: 'email', label: 'Email', cell: (u) => u.email },
    {
      id: 'role',
      label: 'Role',
      cell: (u) => <Badge tone="info">{FIRM_ROLE_LABELS[u.role]}</Badge>,
    },
    { id: 'company', label: 'Company', cell: (u) => u.company },
    {
      id: 'status',
      label: 'Status',
      cell: (u) => (
        <Badge tone={STATUS_LOOKS[u.status].tone} dot>
          {STATUS_LOOKS[u.status].label}
        </Badge>
      ),
    },
    {
      id: 'mfa',
      label: 'MFA',
      cell: (u) => (
        <span className={`inline-flex items-center gap-1.5 ${MFA[u.mfa].tone}`}>
          {createElement(MFA[u.mfa].icon, {
            'aria-hidden': true,
            weight: 'fill',
            className: 'size-4',
          })}
          {MFA[u.mfa].label}
        </span>
      ),
    },
    { id: 'last', label: 'Last Login', cell: lastLogin },
  ];

  const quick: [string, Icon, () => void][] = [
    ['Invite User', User, () => setDialog({ kind: 'invite' })],
    ['Manage Roles', ShieldCheck, () => router.push('/team/roles')],
    ['View Audit Log', FileText, () => router.push('/audit-log')],
    ['Reset User Passwords', Key, () => setDialog({ kind: 'pick', action: 'resetPassword' })],
    ['Deactivate User', UserMinus, () => setDialog({ kind: 'pick', action: 'deactivate' })],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={UsersThree}
        title="Users & Roles"
        subtitle="Manage staff access, assign roles, and control permissions across your Firmivra account."
        action={
          manages ? (
            <Button onClick={() => setDialog({ kind: 'invite' })}>
              <Plus aria-hidden weight="bold" className="size-4" />
              Invite User
            </Button>
          ) : null
        }
      />

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 min-[1440px]:grid-cols-4"
        data-testid="users-kpis"
      >
        <Kpi
          label="Total Users"
          icon={UsersThree}
          tone="blue"
          value={n(s?.total)}
          note={s ? `↑ ${s.addedThisMonth} this month` : summary.isError ? 'Not loaded' : ' '}
        />
        <Kpi
          label="Active Users"
          icon={User}
          tone="green"
          value={n(s?.active)}
          note={
            s
              ? `${s.total ? Math.round((s.active / s.total) * 100) : 0}% active`
              : summary.isError
                ? 'Not loaded'
                : ' '
          }
        />
        <Kpi
          label="Pending Invitations"
          icon={EnvelopeSimple}
          tone="amber"
          value={n(s?.pendingInvitations)}
          note={s ? 'Awaiting response' : summary.isError ? 'Not loaded' : ' '}
        />
        <Kpi
          label="Roles"
          icon={ShieldCheck}
          tone="purple"
          value={n(s?.roles)}
          note={s ? `${s.customRoles ?? 0} custom roles` : summary.isError ? 'Not loaded' : ' '}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-4 min-[1800px]:grid-cols-[1fr_20rem]">
        <section
          aria-labelledby="user-management"
          data-testid="user-management"
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <h2 id="user-management" className="text-xl font-bold text-heading">
            User Management
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              label="Search users"
              placeholder="Search by name, email, or role..."
              value={search}
              minWidth="16rem"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
            <div className="w-40">
              <Select
                label="Role"
                hideLabel
                options={[
                  { value: '', label: 'All Roles' },
                  ...roleItems.map((r) => ({ value: r.role, label: r.label })),
                ]}
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as MembershipRole | '');
                  setPage(1);
                }}
              />
            </div>
            <div className="w-40">
              <Select
                label="Status"
                hideLabel
                options={[
                  { value: 'all', label: 'All Statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'invited', label: 'Pending' },
                  { value: 'locked', label: 'Locked' },
                  { value: 'inactive', label: 'Inactive' },
                ]}
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as StaffStatusFilter);
                  setPage(1);
                }}
              />
            </div>
            <a
              href={api.users.exportUrl(query)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-action px-4 text-sm font-semibold text-action hover:bg-folder-surface"
            >
              <DownloadSimple aria-hidden weight="bold" className="size-4" />
              Export
            </a>
          </div>
          {message || resend.error ? (
            <p
              role={resend.error ? 'alert' : 'status'}
              data-testid="users-result"
              className={`text-sm ${resend.error ? 'text-danger' : 'text-success'}`}
            >
              {resend.error ? errorMessage(resend.error, MEMBER_ERRORS) : message}
            </p>
          ) : null}
          <Table
            rows={list.data?.items ?? []}
            loading={list.isPending}
            rowKey={(u) => u.id}
            caption="Users"
            noun="users"
            dense
            columns={columns}
            rowActions={(u) => <RowMenu label={`Actions for ${u.name}`} items={menu(u)} />}
            server={
              list.data && {
                page: list.data.page,
                total: list.data.total,
                hasNext: list.data.page * list.data.pageSize < list.data.total,
                hasPrevious: list.data.page > 1,
                onNext: () => setPage(list.data.page + 1),
                onPrevious: () => setPage(list.data.page - 1),
                onPage: setPage,
                onSort: () => undefined,
              }
            }
            emptyTitle={
              list.isError
                ? 'Users are not available'
                : filtered
                  ? 'No matching users'
                  : 'No users yet'
            }
            emptyText={
              list.isError
                ? NOT_LOADED
                : filtered
                  ? 'Try another search, role or status.'
                  : 'Invite your first user to give them access.'
            }
          />
        </section>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1800px]:grid-cols-1">
          <section
            aria-label="Quick Actions"
            data-testid="users-quick-actions"
            className="flex flex-col gap-2 rounded-xl border border-divider bg-surface p-4 shadow-sm"
          >
            <h2 className="text-lg font-bold text-heading">Quick Actions</h2>
            {quick.map(([label, icon, run]) => (
              <button
                key={label}
                type="button"
                disabled={!manages}
                onClick={run}
                className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-left text-sm font-medium text-heading hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-action text-on-action"
                >
                  {createElement(icon, { weight: 'fill', className: 'size-5' })}
                </span>
                {label}
              </button>
            ))}
          </section>
          {roles.data ? (
            <RoleTemplates
              roles={roleItems}
              selected={selectedRole?.role ?? ''}
              canChange={manages}
              onSelect={(r) => setPicked(r.role)}
              onCreate={() => router.push('/settings/users/roles/new')}
            />
          ) : (
            <section
              aria-label="Role Templates"
              className="flex flex-col gap-2 rounded-xl border border-divider bg-surface p-4 shadow-sm"
            >
              <h2 className="text-base font-bold text-heading">Role Templates</h2>
              {roles.isPending ? (
                <Skeleton className="h-40" />
              ) : (
                <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
              )}
            </section>
          )}
        </aside>
      </div>

      <RolePanel
        key={selectedRole?.role ?? 'none'}
        roles={roleItems}
        selected={selectedRole}
        onSelect={setPicked}
      />

      {dialog?.kind === 'invite' ? (
        <InviteUserModal
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
          }}
        />
      ) : null}
      {dialog?.kind === 'action' ? (
        <ActionModal
          action={dialog.action}
          id={dialog.user.id}
          name={dialog.user.name}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
          }}
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <RevokeModal
          user={dialog.user}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
          }}
        />
      ) : null}
      {dialog?.kind === 'pick' ? (
        <PickUserModal
          action={dialog.action}
          users={(list.data?.items ?? []).filter(
            (u) =>
              !u.isYou &&
              (dialog.action === 'deactivate'
                ? u.status !== 'DEACTIVATED'
                : u.status === 'ACTIVE' || u.status === 'LOCKED'),
          )}
          onClose={() => setDialog(null)}
          onPick={(user) => setDialog({ kind: 'action', action: dialog.action, user })}
        />
      ) : null}
    </div>
  );
}

/** Revoke Invitation: the link stops working and the person is removed from pending. */
function RevokeModal({
  user,
  onClose,
  onDone,
}: {
  user: FirmUser;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const revoke = useApiMutation(() => api.staff.revokeInvite(user.id), { invalidate: ['users'] });
  return (
    <Modal open title="Revoke Invitation" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          {user.name}&apos;s invitation link stops working. You can invite them again later.
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
            onClick={() =>
              revoke.mutate(undefined, {
                onSuccess: () => onDone(`${user.name}'s invitation was revoked.`),
              })
            }
          >
            Revoke Invitation
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Reset User Passwords and Deactivate User from Quick Actions: choose the user first. */
function PickUserModal({
  action,
  users,
  onClose,
  onPick,
}: {
  action: 'resetPassword' | 'deactivate';
  users: FirmUser[];
  onClose: () => void;
  onPick: (user: FirmUser) => void;
}) {
  const [id, setId] = useState('');
  const user = users.find((u) => u.id === id);
  return (
    <Modal
      open
      title={action === 'resetPassword' ? 'Reset User Password' : 'Deactivate User'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Select
          label="User"
          options={[
            { value: '', label: users.length ? 'Choose a user' : 'No users on this page' },
            ...users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` })),
          ]}
          value={id}
          onChange={(event) => setId(event.target.value)}
        />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!user} onClick={() => user && onPick(user)}>
            Continue
          </Button>
        </div>
      </div>
    </Modal>
  );
}
