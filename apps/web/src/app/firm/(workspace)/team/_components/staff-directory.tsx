'use client';

import {
  type MembershipRole,
  ROLES_MANAGED_BY,
  type StaffListItem,
  type StaffStatusFilter,
} from '@firmivra/types';
import { Avatar, Button, Modal, SearchField, Select, Table, type Column } from '@firmivra/ui';
import { Plus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { ActionModal, type StaffAction } from '../[id]/_components/staff-actions';
import { MEMBER_ERRORS, canManage } from '../[id]/_components/staff-parts';
import { NOT_LOADED } from './quiet-card';
import { RowMenu, type RowMenuItem } from './row-menu';
import { LastLogin, RoleChip, StatusChip } from './staff-list-parts';
import { StaffDrafts } from './staff-drafts';
import { DIRECTORY_ID } from './staff-links';

const PAGE_SIZES = [10, 25, 50, 100];

const STATUSES: { value: StaffStatusFilter; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
  { value: 'locked', label: 'Locked' },
  { value: 'inactive', label: 'Inactive' },
];
/** Create Staff's saved drafts: not people yet, so their own list (Owner and Admin). */
const DRAFTS = 'drafts';
type DirectoryStatus = StaffStatusFilter | typeof DRAFTS;

type Dialog =
  | { kind: 'action'; action: StaffAction; member: StaffListItem }
  | { kind: 'revoke'; member: StaffListItem };

/** The actor may change this member: Owner or Admin, a role below theirs, never themselves. */
const managesMember = (role: MembershipRole | undefined, m: StaffListItem) =>
  canManage(role) && role !== undefined && !m.isYou && ROLES_MANAGED_BY[role].includes(m.role);

/**
 * Staff Directory (`api.staff.list`): search (name, email, job title), department
 * (`api.staff.options`), status, the ticks, pages, and each person's ⋮ menu. The menu offers only
 * what the person's status allows and the API lets the signed-in person do (guide §1): Owner and
 * Admin open every page and act on the roles below theirs; the high-risk actions ask first.
 */
export function StaffDirectory({
  selected,
  onSelect,
}: {
  selected: string[];
  onSelect: (ids: string[]) => void;
}) {
  const router = useRouter();
  const { role } = useFirm();
  const admin = canManage(role);
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const [departmentId, setDepartmentId] = useState('');
  const [view, setView] = useState<DirectoryStatus>('all');
  const drafts = view === DRAFTS;
  const status: StaffStatusFilter = drafts ? 'all' : view;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0] ?? 10);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Only the latest action's result shows: an older error never sits next to a newer success.
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [now] = useState(() => Date.now());
  const query = {
    ...(term ? { search: term } : {}),
    ...(departmentId ? { departmentId } : {}),
    status,
    page,
    pageSize,
  };
  const list = useApiQuery(['staff', 'list', query], () => api.staff.list(query));
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const resend = useApiMutation((id: string) => api.staff.resendInvite(id), {
    invalidate: ['staff'],
  });
  const data = list.data;
  const rows = data?.items ?? [];
  const filtered = Boolean(term || departmentId || status !== 'all');
  // Drafts are Owner and Admin only, as the drafts API (Octavia's SM5: they could not be found).
  const views: { value: DirectoryStatus; label: string }[] = admin
    ? [...STATUSES, { value: DRAFTS, label: 'Drafts' }]
    : STATUSES;
  const open = (href: string) => () => router.push(href);
  const ask = (action: StaffAction, member: StaffListItem) => () => {
    setMessage(null);
    setDialog({ kind: 'action', action, member });
  };

  const menu = (m: StaffListItem): RowMenuItem[] => {
    // Everyone else who reads the directory opens the person's page (read only there).
    if (!admin) return [{ label: 'View', onSelect: open(`/team/${m.id}`) }];
    const mine = managesMember(role, m);
    const items: RowMenuItem[] = [
      { label: 'View Profile', onSelect: open(`/team/${m.id}/security`) },
      ...(mine ? [{ label: 'Edit', onSelect: open(`/team/${m.id}`) }] : []),
      { label: 'Permissions', onSelect: open(`/team/${m.id}/security/permissions`) },
      { label: 'Security', onSelect: open(`/team/${m.id}/security/login`) },
      { label: 'Activity', onSelect: open(`/team/${m.id}/security/activity`) },
    ];
    if (!mine) return items;
    if (m.status === 'INVITED') {
      items.push(
        {
          label: 'Resend Invitation',
          onSelect: () => {
            setMessage(null);
            resend.mutate(m.id, {
              onSuccess: () => setMessage({ text: `A fresh invitation was emailed to ${m.name}.` }),
              onError: (e) => setMessage({ text: errorMessage(e, MEMBER_ERRORS), error: true }),
            });
          },
        },
        {
          label: 'Revoke Invitation',
          danger: true,
          onSelect: () => {
            setMessage(null);
            setDialog({ kind: 'revoke', member: m });
          },
        },
      );
    }
    if (m.status === 'LOCKED') items.push({ label: 'Unlock Account', onSelect: ask('unlock', m) });
    if (m.status === 'ACTIVE' || m.status === 'LOCKED')
      items.push({ label: 'Reset Password', onSelect: ask('resetPassword', m) });
    if (m.status === 'ACTIVE')
      items.push({ label: 'Lock Account', danger: true, onSelect: ask('lock', m) });
    items.push(
      m.status === 'DEACTIVATED'
        ? { label: 'Reactivate', onSelect: ask('reactivate', m) }
        : { label: 'Deactivate', danger: true, onSelect: ask('deactivate', m) },
    );
    return items;
  };

  const columns: Column<StaffListItem>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (m) => (
        <Link
          href={`/team/${m.id}`}
          data-testid="staff-name"
          className="flex items-center gap-3 font-bold whitespace-nowrap text-heading hover:underline"
        >
          <span aria-hidden>
            <Avatar name={m.name} src={m.avatarUrl ?? undefined} size="md" />
          </span>
          {m.name}
        </Link>
      ),
    },
    {
      id: 'title',
      label: 'Job Title',
      className: 'whitespace-nowrap text-link',
      cell: (m) => m.jobTitle ?? <span className="text-muted">—</span>,
    },
    {
      id: 'department',
      label: 'Department',
      className: 'whitespace-nowrap text-link',
      cell: (m) =>
        m.departments.length ? (
          m.departments.map((d) => d.name).join(', ')
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { id: 'role', label: 'Role', cell: (m) => <RoleChip role={m.role} /> },
    { id: 'status', label: 'Status', cell: (m) => <StatusChip status={m.status} /> },
    {
      id: 'login',
      label: 'Last Login',
      className: 'text-link',
      cell: (m) => <LastLogin member={m} now={now} />,
    },
  ];

  const resetTo =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  return (
    <section
      id={DIRECTORY_ID}
      aria-labelledby="staff-directory-title"
      data-testid="staff-directory"
      className="flex min-w-0 scroll-mt-4 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <h2 id="staff-directory-title" className="text-2xl font-bold text-heading lg:mr-auto">
          Staff Directory
        </h2>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <SearchField
            label="Search staff"
            placeholder="Search staff by name, email, or role..."
            minWidth="18rem"
            value={search}
            onChange={(event) => resetTo(setSearch)(event.target.value)}
          />
          <div className="w-full sm:w-44">
            <Select
              label="Department"
              hideLabel
              options={[
                { value: '', label: 'All Departments' },
                ...(options.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name })),
              ]}
              value={departmentId}
              onChange={(event) => resetTo(setDepartmentId)(event.target.value)}
            />
          </div>
          <div className="w-full sm:w-40">
            <Select
              label="Status"
              hideLabel
              options={views}
              value={view}
              onChange={(event) =>
                resetTo(setView)(views.find((s) => s.value === event.target.value)?.value ?? 'all')
              }
            />
          </div>
          {admin ? (
            <Link
              href="/team/new"
              data-testid="add-staff"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-action px-4 text-sm font-semibold whitespace-nowrap text-on-action hover:bg-action-hover"
            >
              <Plus aria-hidden weight="bold" className="size-4" />
              Add Staff
            </Link>
          ) : null}
        </div>
      </div>
      {message ? (
        <p
          role={message.error ? 'alert' : 'status'}
          data-testid="staff-result"
          className={`text-sm ${message.error ? 'text-danger' : 'text-success'}`}
        >
          {message.text}
        </p>
      ) : null}
      {/* The table's frame stays when the call fails or finds nothing (design-match rule 2). */}
      {drafts ? (
        <StaffDrafts search={term} />
      ) : (
        <Table
          rows={rows}
          loading={list.isPending}
          rowKey={(m) => m.id}
          caption="Staff directory"
          noun="staff members"
          columns={columns}
          selection={{ selected, onChange: onSelect }}
          rowActions={(m) => <RowMenu vertical label={`Actions for ${m.name}`} items={menu(m)} />}
          tableClassName="[&_td]:py-0.5 [&_tbody_td]:border-divider [&_tbody_td:not(:first-child):not(:last-child)]:border-r [&_thead_th]:font-semibold [&_thead_th]:text-heading"
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          server={
            data && {
              page: data.page,
              total: data.total,
              hasNext: data.page * data.pageSize < data.total,
              hasPrevious: data.page > 1,
              onNext: () => setPage(data.page + 1),
              onPrevious: () => setPage(data.page - 1),
              onPage: setPage,
              onSort: () => undefined,
            }
          }
          emptyTitle={
            list.isError
              ? 'Staff are not available'
              : filtered
                ? 'No matching staff'
                : 'No staff members yet'
          }
          emptyText={
            list.isError
              ? NOT_LOADED
              : filtered
                ? 'Try another search, department or status.'
                : 'Create a staff account to add your first team member.'
          }
          emptyAction={
            list.isError ? (
              <Button variant="secondary" onClick={() => void list.refetch()}>
                Try again
              </Button>
            ) : undefined
          }
        />
      )}

      {dialog?.kind === 'action' ? (
        <ActionModal
          action={dialog.action}
          id={dialog.member.id}
          name={dialog.member.name}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage({ text });
          }}
        />
      ) : null}
      {dialog?.kind === 'revoke' ? (
        <RevokeInviteModal
          member={dialog.member}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage({ text });
          }}
        />
      ) : null}
    </section>
  );
}

/** Revoke Invitation: the link stops working and the person is kept as Inactive. */
function RevokeInviteModal({
  member,
  onClose,
  onDone,
}: {
  member: StaffListItem;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const revoke = useApiMutation(() => api.staff.revokeInvite(member.id), {
    invalidate: ['staff'],
  });
  return (
    <Modal open title="Revoke Invitation" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          {member.name}’s invitation link stops working and they show as Inactive. You can
          reactivate them later, which sends a new invitation.
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
                onSuccess: () => onDone(`${member.name}’s invitation was revoked.`),
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
