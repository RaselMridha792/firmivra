'use client';

import type { GroupStatusFilter, StaffTeam } from '@firmivra/types';
import { Button, SearchField, Select, Table } from '@firmivra/ui';
import { Plus, UsersThree } from '@phosphor-icons/react';
import { useDeferredValue, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { GroupFormModal, PersonModal, StatusModal } from '../../_components/group-dialogs';
import { GroupsHeader } from '../../_components/groups-header';
import { GroupsKpis } from '../../_components/groups-kpis';
import {
  GROUPS,
  GroupIcon,
  GroupStatusBadge,
  PersonCell,
  STATUS_OPTIONS,
} from '../../_components/groups-shared';
import { GroupsTabs } from '../../_components/groups-tabs';
import { NeedHelpCard } from '../../_components/need-help-card';
import { NOT_LOADED, QuietCard } from '../../_components/quiet-card';
import { RowMenu } from '../../_components/row-menu';
import { MembersModal, MoveModal } from './team-dialogs';
import { TeamDetails } from './team-details';

const PAGE_SIZE = 10;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit' | 'lead' | 'move' | 'members'; team: StaffTeam }
  | { kind: 'status'; team: StaffTeam; action: 'Deactivate' | 'Archive' };

/**
 * Teams & Departments, Teams tab (docx §13; the design has no Teams frame, so it follows the
 * Departments tab): the counts, the Team List with search, department and status, and the chosen
 * team's details and members. `departmentId` (View All Teams, Manage Teams) filters the list and
 * `teamId` (Open Team) opens one team. Owner and Admin change; a Manager reads.
 */
export function TeamsScreen({ departmentId, teamId }: { departmentId?: string; teamId?: string }) {
  const { role } = useFirm();
  const canChange = role === 'OWNER' || role === 'ADMIN';
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const [status, setStatus] = useState<GroupStatusFilter>('all');
  const [department, setDepartment] = useState(departmentId ?? '');
  const [picked, setPicked] = useState<string | null>(teamId ?? null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useApiQuery([...GROUPS, 'teams', query, status, department], () =>
    api.departments.teams({
      search: query || undefined,
      status,
      departmentId: department || undefined,
    }),
  );
  // Every department for the filter; the active ones for Add Team and Move Department.
  const departments = useApiQuery([...GROUPS, 'list', 'every'], () =>
    api.departments.list({ pageSize: 100 }),
  );
  const allDepartments = departments.data?.items ?? [];
  const activeDepartments = allDepartments.filter((d) => d.status === 'ACTIVE');
  const create = useApiMutation(
    (body: Parameters<typeof api.departments.createTeam>[0]) => api.departments.createTeam(body),
    { invalidate: GROUPS },
  );
  const update = useApiMutation(
    ({ id, body }: { id: string; body: Parameters<typeof api.departments.updateTeam>[1] }) =>
      api.departments.updateTeam(id, body),
    { invalidate: GROUPS },
  );
  const setMembers = useApiMutation(
    ({ id, body }: { id: string; body: Parameters<typeof api.departments.setTeamMembers>[1] }) =>
      api.departments.setTeamMembers(id, body),
    { invalidate: GROUPS },
  );
  const rows = list.data ?? [];
  const selectedId = picked && rows.some((t) => t.id === picked) ? picked : rows[0]?.id;
  const filtered = Boolean(query) || status !== 'all' || Boolean(department);
  const open = (next: Dialog) => {
    create.reset();
    update.reset();
    setMembers.reset();
    setDialog(next);
  };
  const close = () => setDialog(null);
  const done = { onSuccess: close };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <GroupsHeader />
      <GroupsKpis />
      <GroupsTabs current="/team/teams">
        <SearchField
          label="Search teams"
          placeholder="Search teams..."
          value={search}
          minWidth="12rem"
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          label="Department"
          hideLabel
          options={[
            { value: '', label: 'All Departments' },
            ...allDepartments.map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        />
        <Select
          label="Status"
          hideLabel
          options={[...STATUS_OPTIONS]}
          value={status}
          onChange={(event) => setStatus(event.target.value as GroupStatusFilter)}
        />
        {canChange ? (
          <Button data-testid="add-team" onClick={() => open({ kind: 'add' })}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Team
          </Button>
        ) : null}
      </GroupsTabs>

      {/* The Departments tab's two-to-one split, from 1440 px; narrower, the cards go under. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <section
          aria-labelledby="team-list"
          className="min-w-0 rounded-xl border border-divider bg-surface p-4 shadow-sm min-[1440px]:col-span-2"
        >
          <h2 id="team-list" className="text-xl font-bold text-heading">
            Team List
          </h2>
          <p className="mb-4 text-sm text-link">
            Manage your teams. Click on a team to view its lead, members, and settings.
          </p>
          {/* The table's frame stays when the call fails or finds nothing (design-match rule 2). */}
          <Table
            rows={rows}
            loading={list.isPending}
            rowKey={(t) => t.id}
            caption="Teams"
            noun="teams"
            pageSize={PAGE_SIZE}
            tableClassName="[&_td]:py-1.5 [&_tbody_tr:has([aria-pressed=true])]:bg-folder-surface"
            emptyTitle={
              list.isError
                ? 'Teams are not available'
                : filtered
                  ? 'No matching teams'
                  : 'No teams yet'
            }
            emptyText={
              list.isError
                ? NOT_LOADED
                : filtered
                  ? 'Try another search, department or status.'
                  : 'Add your first team inside a department.'
            }
            columns={[
              {
                id: 'name',
                label: 'Team Name',
                cell: (t) => (
                  <button
                    type="button"
                    aria-pressed={t.id === selectedId}
                    data-testid="team-row"
                    onClick={() => setPicked(t.id)}
                    className="flex items-center gap-3 text-left font-semibold whitespace-nowrap text-heading"
                  >
                    <GroupIcon name={t.name} />
                    {t.name}
                  </button>
                ),
              },
              {
                id: 'department',
                label: 'Department',
                cell: (t) => <span className="whitespace-nowrap">{t.department.name}</span>,
              },
              {
                id: 'lead',
                label: 'Team Lead',
                className: 'max-w-40',
                cell: (t) =>
                  t.lead ? (
                    <PersonCell person={t.lead} />
                  ) : (
                    <span className="text-muted">No lead yet</span>
                  ),
              },
              {
                id: 'members',
                label: 'Members',
                cell: (t) => (
                  <span className="inline-flex items-center gap-1.5">
                    <UsersThree aria-hidden weight="fill" className="size-4 text-heading" />
                    {t.memberCount}
                  </span>
                ),
              },
              {
                id: 'status',
                label: 'Status',
                cell: (t) => <GroupStatusBadge status={t.status} />,
              },
            ]}
            rowActions={(t) =>
              canChange ? (
                <RowMenu
                  label={`Actions for ${t.name}`}
                  items={[
                    { label: 'Edit', onSelect: () => open({ kind: 'edit', team: t }) },
                    ...(t.status === 'ACTIVE'
                      ? [
                          {
                            label: 'Manage Members',
                            onSelect: () => open({ kind: 'members', team: t }),
                          },
                        ]
                      : []),
                    { label: 'Change Lead', onSelect: () => open({ kind: 'lead', team: t }) },
                    {
                      label: 'Move Department',
                      onSelect: () => open({ kind: 'move', team: t }),
                    },
                    t.status === 'ACTIVE'
                      ? {
                          label: 'Deactivate',
                          onSelect: () => open({ kind: 'status', team: t, action: 'Deactivate' }),
                        }
                      : {
                          label: 'Reactivate',
                          onSelect: () => update.mutate({ id: t.id, body: { status: 'ACTIVE' } }),
                        },
                    ...(t.status !== 'ARCHIVED'
                      ? [
                          {
                            label: 'Archive',
                            danger: true,
                            onSelect: () => open({ kind: 'status', team: t, action: 'Archive' }),
                          },
                        ]
                      : []),
                  ]}
                />
              ) : (
                <RowMenu
                  label={`Actions for ${t.name}`}
                  items={[{ label: 'View Team', onSelect: () => setPicked(t.id) }]}
                />
              )
            }
          />
        </section>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          {selectedId ? (
            <TeamDetails
              id={selectedId}
              canChange={canChange}
              onEdit={(t) => open({ kind: 'edit', team: t })}
              onChangeLead={(t) => open({ kind: 'lead', team: t })}
              onManageMembers={(t) => open({ kind: 'members', team: t })}
            />
          ) : (
            // No team to open: the two cards keep their frames.
            <>
              <QuietCard
                title="Team Details"
                testId="team-details"
                loading={list.isPending}
                line={
                  list.isError
                    ? NOT_LOADED
                    : filtered
                      ? 'No team matches. Its details show here.'
                      : 'Add a team to see its lead, department and members here.'
                }
              />
              <QuietCard
                title="Team Members"
                testId="team-members"
                loading={list.isPending}
                line={list.isError ? NOT_LOADED : 'The members of the chosen team show here.'}
              />
            </>
          )}
          <NeedHelpCard />
        </aside>
      </div>

      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <GroupFormModal
          open
          title={dialog.kind === 'add' ? 'Add Team' : `Edit ${dialog.team.name}`}
          personLabel="Team Lead"
          submitLabel={dialog.kind === 'add' ? 'Add Team' : 'Save Changes'}
          groups={dialog.kind === 'add' ? activeDepartments : undefined}
          initial={
            dialog.kind === 'add'
              ? {
                  name: '',
                  description: '',
                  personId: '',
                  groupId: activeDepartments.some((d) => d.id === department) ? department : '',
                }
              : {
                  name: dialog.team.name,
                  description: dialog.team.description ?? '',
                  personId: dialog.team.lead?.id ?? '',
                }
          }
          pending={create.isPending || update.isPending}
          error={create.error ?? update.error}
          onClose={close}
          onSubmit={(v) => {
            const fields = {
              name: v.name,
              description: v.description || null,
              leadMembershipId: v.personId || null,
            };
            if (dialog.kind === 'add') {
              create.mutate(
                { ...fields, departmentId: v.groupId ?? '' },
                { onSuccess: (t) => (setPicked(t.id), close()) },
              );
            } else {
              update.mutate({ id: dialog.team.id, body: fields }, done);
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'lead' ? (
        <PersonModal
          open
          title={`Change Lead of ${dialog.team.name}`}
          label="Team Lead"
          current={dialog.team.lead?.id ?? ''}
          pending={update.isPending}
          error={update.error}
          onClose={close}
          onSubmit={(leadMembershipId) =>
            update.mutate({ id: dialog.team.id, body: { leadMembershipId } }, done)
          }
        />
      ) : null}
      {dialog?.kind === 'move' ? (
        <MoveModal
          open
          team={dialog.team}
          departments={activeDepartments}
          pending={update.isPending}
          error={update.error}
          onClose={close}
          onSubmit={(departmentId) =>
            update.mutate({ id: dialog.team.id, body: { departmentId } }, done)
          }
        />
      ) : null}
      {dialog?.kind === 'members' ? (
        <MembersModal
          open
          teamId={dialog.team.id}
          pending={setMembers.isPending}
          error={setMembers.error}
          onClose={close}
          onSubmit={(members) => setMembers.mutate({ id: dialog.team.id, body: { members } }, done)}
        />
      ) : null}
      {dialog?.kind === 'status' ? (
        <StatusModal
          open
          action={dialog.action}
          name={dialog.team.name}
          inUse={false}
          moveOptions={[]}
          pending={update.isPending}
          error={update.error}
          onClose={close}
          onConfirm={() =>
            update.mutate(
              {
                id: dialog.team.id,
                body: { status: dialog.action === 'Archive' ? 'ARCHIVED' : 'INACTIVE' },
              },
              done,
            )
          }
        />
      ) : null}
    </div>
  );
}
