'use client';

import type { Department, GroupStatusFilter } from '@firmivra/types';
import { Button, SearchField, Select, Table } from '@firmivra/ui';
import { Plus } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { PageState } from '../../../../../../components/page-state';
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
import { RowMenu } from '../../_components/row-menu';
import { DepartmentDetails } from './department-details';

const PAGE_SIZE = 10;

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit' | 'head'; department: Department }
  | { kind: 'status'; department: Department; action: 'Deactivate' | 'Archive' };

/**
 * Teams & Departments, Departments tab (teams-and-departments.jpg, docx §13): the counts, the
 * Department List with search and status, and the chosen department's details and teams. Owner
 * and Admin change; a Manager reads (R42 contract). Nothing is deleted.
 */
export function DepartmentsScreen() {
  const { role } = useFirm();
  const canChange = role === 'OWNER' || role === 'ADMIN';
  const router = useRouter();
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const [status, setStatus] = useState<GroupStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useApiQuery([...GROUPS, 'list', query, status, page], () =>
    api.departments.list({ search: query || undefined, status, page, pageSize: PAGE_SIZE }),
  );
  // Every active department, for "Move its staff to".
  const active = useApiQuery([...GROUPS, 'list', 'active'], () =>
    api.departments.list({ status: 'active', pageSize: 100 }),
  );
  const create = useApiMutation(
    (body: Parameters<typeof api.departments.create>[0]) => api.departments.create(body),
    { invalidate: GROUPS },
  );
  const update = useApiMutation(
    ({ id, body }: { id: string; body: Parameters<typeof api.departments.update>[1] }) =>
      api.departments.update(id, body),
    { invalidate: GROUPS },
  );
  const rows = list.data?.items ?? [];
  const selectedId = picked && rows.some((d) => d.id === picked) ? picked : rows[0]?.id;
  const open = (next: Dialog) => {
    create.reset();
    update.reset();
    setDialog(next);
  };
  const close = () => setDialog(null);
  const done = { onSuccess: close };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <GroupsHeader />
      <GroupsKpis />
      <GroupsTabs current="/team/departments">
        <SearchField
          label="Search departments"
          placeholder="Search departments..."
          value={search}
          minWidth="12rem"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <Select
          label="Status"
          hideLabel
          options={[...STATUS_OPTIONS]}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as GroupStatusFilter);
            setPage(1);
          }}
        />
        {canChange ? (
          <Button data-testid="add-department" onClick={() => open({ kind: 'add' })}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Department
          </Button>
        ) : null}
      </GroupsTabs>

      {/* The design's two-to-one split needs 1440 px; narrower, the cards go under the list. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <section
          aria-labelledby="department-list"
          className="min-w-0 rounded-xl border border-divider bg-surface p-4 shadow-sm min-[1440px]:col-span-2"
        >
          <h2 id="department-list" className="text-xl font-bold text-heading">
            Department List
          </h2>
          <p className="mb-4 text-sm text-link">
            Manage your departments. Click on a department to view teams, members, and settings.
          </p>
          <PageState query={list} isEmpty={() => false}>
            {(data) => (
              <Table
                rows={data.items}
                rowKey={(d) => d.id}
                caption="Departments"
                noun="departments"
                pageSize={PAGE_SIZE}
                tableClassName="[&_td]:py-1.5 [&_tbody_tr:has([aria-pressed=true])]:bg-folder-surface"
                emptyTitle={
                  query || status !== 'all' ? 'No matching departments' : 'No departments yet'
                }
                emptyText={
                  query || status !== 'all'
                    ? 'Try another search or status.'
                    : 'Add your first department to group your staff.'
                }
                server={{
                  page: data.page,
                  total: data.total,
                  hasNext: data.page * data.pageSize < data.total,
                  hasPrevious: data.page > 1,
                  onNext: () => setPage(data.page + 1),
                  onPrevious: () => setPage(data.page - 1),
                  onPage: setPage,
                  onSort: () => undefined,
                }}
                columns={[
                  {
                    id: 'name',
                    label: 'Department Name',
                    cell: (d) => (
                      <button
                        type="button"
                        aria-pressed={d.id === selectedId}
                        data-testid="department-row"
                        onClick={() => setPicked(d.id)}
                        className="flex items-center gap-3 text-left font-semibold whitespace-nowrap text-heading"
                      >
                        <GroupIcon name={d.name} />
                        {d.name}
                      </button>
                    ),
                  },
                  {
                    id: 'head',
                    label: 'Department Head',
                    className: 'max-w-48',
                    cell: (d) => <PersonCell person={d.head} />,
                  },
                  { id: 'teams', label: 'Teams', cell: (d) => d.teamCount },
                  { id: 'staff', label: 'Staff Count', cell: (d) => d.staffCount },
                  {
                    id: 'status',
                    label: 'Status',
                    cell: (d) => <GroupStatusBadge status={d.status} />,
                  },
                ]}
                rowActions={(d) => (
                  <RowMenu
                    label={`Actions for ${d.name}`}
                    items={[
                      ...(canChange
                        ? [
                            {
                              label: 'Edit',
                              onSelect: () => open({ kind: 'edit', department: d }),
                            },
                            {
                              label: 'Change Head',
                              onSelect: () => open({ kind: 'head', department: d }),
                            },
                          ]
                        : []),
                      {
                        label: 'Manage Teams',
                        onSelect: () => router.push(`/team/teams?departmentId=${d.id}`),
                      },
                      ...(canChange && d.status === 'ACTIVE'
                        ? [
                            {
                              label: 'Deactivate',
                              onSelect: () =>
                                open({ kind: 'status', department: d, action: 'Deactivate' }),
                            },
                          ]
                        : []),
                      ...(canChange && d.status !== 'ACTIVE'
                        ? [
                            {
                              label: 'Reactivate',
                              onSelect: () =>
                                update.mutate({ id: d.id, body: { status: 'ACTIVE' } }),
                            },
                          ]
                        : []),
                      ...(canChange && d.status !== 'ARCHIVED'
                        ? [
                            {
                              label: 'Archive',
                              danger: true,
                              onSelect: () =>
                                open({ kind: 'status', department: d, action: 'Archive' }),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              />
            )}
          </PageState>
        </section>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          {selectedId ? (
            <DepartmentDetails
              id={selectedId}
              canChange={canChange}
              onEdit={(d) => open({ kind: 'edit', department: d })}
              onChangeHead={(d) => open({ kind: 'head', department: d })}
            />
          ) : null}
          <NeedHelpCard />
        </aside>
      </div>

      {dialog?.kind === 'add' || dialog?.kind === 'edit' ? (
        <GroupFormModal
          open
          title={dialog.kind === 'add' ? 'Add Department' : `Edit ${dialog.department.name}`}
          personLabel="Department Head"
          submitLabel={dialog.kind === 'add' ? 'Add Department' : 'Save Changes'}
          initial={
            dialog.kind === 'add'
              ? { name: '', description: '', personId: '' }
              : {
                  name: dialog.department.name,
                  description: dialog.department.description ?? '',
                  personId: dialog.department.head?.id ?? '',
                }
          }
          pending={create.isPending || update.isPending}
          error={create.error ?? update.error}
          onClose={close}
          onSubmit={(v) => {
            const body = {
              name: v.name,
              description: v.description || null,
              headMembershipId: v.personId || null,
            };
            if (dialog.kind === 'add') {
              create.mutate(body, { onSuccess: (d) => (setPicked(d.id), close()) });
            } else {
              update.mutate({ id: dialog.department.id, body }, done);
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'head' ? (
        <PersonModal
          open
          title={`Change Head of ${dialog.department.name}`}
          label="Department Head"
          current={dialog.department.head?.id ?? ''}
          pending={update.isPending}
          error={update.error}
          onClose={close}
          onSubmit={(headMembershipId) =>
            update.mutate({ id: dialog.department.id, body: { headMembershipId } }, done)
          }
        />
      ) : null}
      {dialog?.kind === 'status' ? (
        <StatusModal
          open
          action={dialog.action}
          name={dialog.department.name}
          inUse={dialog.department.staffCount > 0}
          moveOptions={(active.data?.items ?? []).filter((d) => d.id !== dialog.department.id)}
          pending={update.isPending}
          error={update.error}
          onClose={close}
          onConfirm={(moveTo) =>
            update.mutate(
              {
                id: dialog.department.id,
                body: { status: dialog.action === 'Archive' ? 'ARCHIVED' : 'INACTIVE', moveTo },
              },
              done,
            )
          }
        />
      ) : null}
    </div>
  );
}
