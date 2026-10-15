'use client';

import type { Department } from '@firmivra/types';
import { Button, Skeleton } from '@firmivra/ui';
import { ArrowRight, PencilSimple, Plus, UsersThree } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { GroupFormModal } from '../../_components/group-dialogs';
import {
  GROUPS,
  GroupIcon,
  GroupStatusBadge,
  PersonCell,
  dateText,
} from '../../_components/groups-shared';
import { RowMenu } from '../../_components/row-menu';

/**
 * The chosen department: Department Details (head with Change, counts, created, description) and
 * Teams in This Department with Add Team and View All Teams.
 */
export function DepartmentDetails({
  id,
  canChange,
  onEdit,
  onChangeHead,
}: {
  id: string;
  canChange: boolean;
  onEdit: (d: Department) => void;
  onChangeHead: (d: Department) => void;
}) {
  const router = useRouter();
  const detail = useApiQuery([...GROUPS, 'detail', id], () => api.departments.get(id));
  const [adding, setAdding] = useState(false);
  const addTeam = useApiMutation(
    (body: Parameters<typeof api.departments.createTeam>[0]) => api.departments.createTeam(body),
    { invalidate: GROUPS },
  );
  const d = detail.data;
  const card = 'rounded-xl border border-divider bg-surface p-4 shadow-sm';
  if (!d) {
    return (
      <section className={card} aria-busy="true">
        <Skeleton className="h-40" />
      </section>
    );
  }
  const teams = d.teams.filter((t) => t.status !== 'ARCHIVED');
  const fact =
    'flex gap-3 border-t border-divider py-2.5 text-sm [&>dd]:min-w-0 [&>dd]:flex-1 [&>dt]:w-28 [&>dt]:shrink-0';
  return (
    <>
      <section
        aria-labelledby="department-details"
        className={card}
        data-testid="department-details"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="department-details" className="font-display text-xl font-bold text-heading">
            Department Details
          </h2>
          {canChange ? (
            <button
              type="button"
              onClick={() => onEdit(d)}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-link hover:underline"
            >
              <PencilSimple aria-hidden weight="fill" className="size-4" />
              Edit
            </button>
          ) : null}
        </div>
        <div className="mb-3 flex items-start gap-4">
          <GroupIcon name={d.name} size="lg" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-3">
              <span className="font-display text-xl font-bold text-heading">{d.name}</span>
              <GroupStatusBadge status={d.status} />
            </p>
            {d.description ? <p className="mt-1 text-sm text-link">{d.description}</p> : null}
          </div>
        </div>
        <dl>
          <div className={`${fact} flex-col [&>dd]:w-full`}>
            <dt className="font-semibold text-heading">Department Head</dt>
            <dd className="flex items-center justify-between gap-2">
              <PersonCell person={d.head} size="md" />
              {canChange ? (
                <Button variant="secondary" onClick={() => onChangeHead(d)}>
                  Change
                </Button>
              ) : null}
            </dd>
          </div>
          <div className={fact}>
            <dt className="font-semibold text-heading">Total Teams</dt>
            <dd>{d.teamCount}</dd>
          </div>
          <div className={fact}>
            <dt className="font-semibold text-heading">Total Staff</dt>
            <dd>{d.staffCount}</dd>
          </div>
          <div className={fact}>
            <dt className="font-semibold text-heading">Created</dt>
            <dd>{dateText(d.createdAt)}</dd>
          </div>
          <div className={fact}>
            <dt className="font-semibold text-heading">Description</dt>
            <dd className="text-link">{d.description ?? 'No description yet.'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="department-teams" className={card} data-testid="department-teams">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="department-teams" className="font-display text-lg font-bold text-heading">
            Teams in This Department
          </h2>
          {canChange && d.status === 'ACTIVE' ? (
            <Button
              variant="secondary"
              className="shrink-0 whitespace-nowrap"
              onClick={() => {
                addTeam.reset();
                setAdding(true);
              }}
            >
              <Plus aria-hidden weight="bold" className="size-4" />
              Add Team
            </Button>
          ) : null}
        </div>
        {teams.length ? (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Teams in {d.name}</caption>
            <thead className="bg-table-head text-xs text-text">
              <tr>
                <th scope="col" className="rounded-l-lg px-2 py-1.5 font-semibold">
                  Team Name
                </th>
                <th scope="col" className="px-2 py-1.5 font-semibold">
                  Members
                </th>
                <th scope="col" className="rounded-r-lg px-2 py-1.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id} className="border-b border-divider" data-testid="department-team">
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-2 font-medium text-heading">
                      <GroupIcon name={t.name} />
                      {t.name}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1.5 text-text">
                      <UsersThree aria-hidden weight="fill" className="size-4 text-heading" />
                      {t.memberCount}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    <RowMenu
                      label={`Actions for ${t.name}`}
                      items={[
                        {
                          label: 'Open Team',
                          onSelect: () => router.push(`/team/teams?teamId=${t.id}`),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
            No teams in this department yet.
          </p>
        )}
        <Link
          href={`/team/teams?departmentId=${d.id}`}
          className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-action text-sm font-semibold text-action hover:bg-folder-surface"
        >
          View All Teams
          <ArrowRight aria-hidden weight="bold" className="size-4" />
        </Link>
      </section>

      {adding ? (
        <GroupFormModal
          open
          title={`Add Team to ${d.name}`}
          personLabel="Team Lead"
          submitLabel="Add Team"
          initial={{ name: '', description: '', personId: '' }}
          pending={addTeam.isPending}
          error={addTeam.error}
          onClose={() => setAdding(false)}
          onSubmit={(v) =>
            addTeam.mutate(
              {
                departmentId: d.id,
                name: v.name,
                description: v.description || null,
                leadMembershipId: v.personId || null,
              },
              { onSuccess: () => setAdding(false) },
            )
          }
        />
      ) : null}
    </>
  );
}
