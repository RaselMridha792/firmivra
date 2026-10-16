'use client';

import type { StaffTeamDetail } from '@firmivra/types';
import { Avatar, Badge, Button, Skeleton } from '@firmivra/ui';
import { PencilSimple, UsersThree } from '@phosphor-icons/react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  GROUPS,
  GroupIcon,
  GroupStatusBadge,
  PersonCell,
  dateText,
} from '../../_components/groups-shared';
import { NOT_LOADED, QuietCard } from '../../_components/quiet-card';
import { KIND_LABELS } from './team-dialogs';

/**
 * The chosen team, drawn like the Departments tab's panel: Team Details (lead with Change,
 * department, members, created, description) and Members of This Team with Manage Members.
 */
export function TeamDetails({
  id,
  canChange,
  onEdit,
  onChangeLead,
  onManageMembers,
}: {
  id: string;
  canChange: boolean;
  onEdit: (t: StaffTeamDetail) => void;
  onChangeLead: (t: StaffTeamDetail) => void;
  onManageMembers: (t: StaffTeamDetail) => void;
}) {
  const detail = useApiQuery([...GROUPS, 'team', id], () => api.departments.team(id));
  const t = detail.data;
  const card = 'rounded-xl border border-divider bg-surface p-4 shadow-sm';
  if (!t && detail.isError) {
    return (
      <>
        <QuietCard title="Team Details" testId="team-details" line={NOT_LOADED} />
        <QuietCard title="Team Members" testId="team-members" line={NOT_LOADED} />
      </>
    );
  }
  if (!t) {
    return (
      <section className={card} aria-busy="true">
        <Skeleton className="h-40" />
      </section>
    );
  }
  const fact = 'flex gap-3 border-t border-divider py-1.5 text-sm';
  const term = 'w-24 shrink-0 border-r border-divider font-semibold text-heading';
  return (
    <>
      <section aria-labelledby="team-details" className={card} data-testid="team-details">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="team-details" className="text-base font-bold text-heading">
            Team Details
          </h2>
          {canChange ? (
            <button
              type="button"
              onClick={() => onEdit(t)}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-link hover:underline"
            >
              <PencilSimple aria-hidden weight="fill" className="size-4" />
              Edit
            </button>
          ) : null}
        </div>
        <div className="mb-3 flex items-start gap-4">
          <GroupIcon name={t.name} size="lg" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-3">
              <span className="text-xl font-bold text-heading">{t.name}</span>
              <GroupStatusBadge status={t.status} />
            </p>
            <p className="mt-1 text-sm text-link">{t.department.name} department</p>
          </div>
        </div>
        <dl>
          <div className={`${fact} flex-wrap`}>
            <dt className={term}>Team Lead</dt>
            <dd className="flex min-w-56 flex-1 items-center justify-between gap-2">
              {t.lead ? (
                <PersonCell person={t.lead} />
              ) : (
                <span className="text-muted">No lead yet</span>
              )}
              {canChange ? (
                <Button variant="secondary" onClick={() => onChangeLead(t)}>
                  Change
                </Button>
              ) : null}
            </dd>
          </div>
          <div className={fact}>
            <dt className={term}>Department</dt>
            <dd className="min-w-0 flex-1">{t.department.name}</dd>
          </div>
          <div className={fact}>
            <dt className={term}>Members</dt>
            <dd className="min-w-0 flex-1">{t.memberCount}</dd>
          </div>
          <div className={fact}>
            <dt className={term}>Created</dt>
            <dd className="min-w-0 flex-1">{dateText(t.createdAt)}</dd>
          </div>
          <div className={fact}>
            <dt className={term}>Description</dt>
            <dd className="min-w-0 flex-1 text-link">{t.description ?? 'No description yet.'}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="team-members" className={card} data-testid="team-members">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="team-members" className="text-base font-bold text-heading">
            Team Members
          </h2>
          {canChange && t.status === 'ACTIVE' ? (
            <Button
              variant="secondary"
              className="shrink-0 whitespace-nowrap"
              onClick={() => onManageMembers(t)}
            >
              <UsersThree aria-hidden weight="fill" className="size-4" />
              Manage Members
            </Button>
          ) : null}
        </div>
        {t.members.length ? (
          <ul className="flex flex-col divide-y divide-divider">
            {t.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 py-2"
                data-testid="team-member"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name} src={m.avatarUrl ?? undefined} size="md" />
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-semibold text-heading">{m.name}</span>
                    {m.jobTitle ? (
                      <span className="block truncate text-xs text-link">{m.jobTitle}</span>
                    ) : null}
                  </span>
                </span>
                <Badge tone={m.kind === 'MEMBER' ? 'neutral' : 'info'}>{KIND_LABELS[m.kind]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
            No members in this team yet.
          </p>
        )}
      </section>
    </>
  );
}
