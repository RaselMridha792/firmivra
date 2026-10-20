'use client';

import { ChatText } from '@phosphor-icons/react';
import { Avatar, IconButton, Table, type Column, type TableSort } from '@firmivra/ui';
import { MemberMenu, type MemberCommand } from './member-menu';
import type { AdminTeamMember, TeamSort } from './team-api';
import { AccessBadge, Presence, StatusBadge } from './team-parts';

/** List View: the design's eight columns, sorted by the API, checkboxes shared with Card View. */
export function MemberTable({
  rows,
  loading,
  sort,
  onSort,
  selected,
  onSelected,
  onCommand,
}: {
  rows: AdminTeamMember[];
  loading: boolean;
  sort: { id: TeamSort; descending: boolean };
  onSort: (sort: TableSort) => void;
  selected: string[];
  onSelected: (ids: string[]) => void;
  onCommand: (command: MemberCommand, member: AdminTeamMember) => void;
}) {
  const columns: Column<AdminTeamMember>[] = [
    {
      id: 'name',
      label: 'Name',
      sortable: true,
      cell: (member) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={member.name} size="lg" />
          <span className="flex min-w-0 flex-col">
            <button
              type="button"
              onClick={() => onCommand('profile', member)}
              className="text-left font-semibold text-heading hover:text-action hover:underline"
            >
              {member.name}
              {member.isYou ? <span className="font-normal text-muted"> (you)</span> : null}
            </button>
            <span className="text-xs text-link">{member.email}</span>
          </span>
        </span>
      ),
    },
    { id: 'department', label: 'Department', sortable: true, cell: (m) => m.departmentName },
    { id: 'jobTitle', label: 'Job Title', sortable: true, cell: (m) => m.jobTitle },
    {
      id: 'accessLevel',
      label: 'Permission Level',
      sortable: true,
      cell: (m) => <AccessBadge level={m.accessLevel} />,
    },
    { id: 'location', label: 'Location', sortable: true, cell: (m) => m.locationName ?? '—' },
    {
      id: 'status',
      label: 'Status',
      sortable: true,
      cell: (m) => <StatusBadge status={m.status} />,
    },
    {
      id: 'availability',
      label: 'Availability',
      sortable: true,
      cell: (m) => <Presence value={m.availability} signedInAt={m.lastActiveAt} />,
    },
  ];
  return (
    <Table
      caption="Team members"
      rows={rows}
      columns={columns}
      rowKey={(member) => member.id}
      loading={loading}
      noun="team members"
      showPagination={false}
      tableClassName="min-w-5xl"
      selection={{ selected, onChange: onSelected }}
      server={{
        page: 1,
        hasNext: false,
        hasPrevious: false,
        onNext: () => undefined,
        onPrevious: () => undefined,
        sort,
        onSort,
      }}
      rowActions={(member) => (
        <>
          <IconButton
            icon={ChatText}
            label={`Message ${member.name}`}
            tone="action"
            disabled={!member.allowed.message}
            onClick={() => onCommand('message', member)}
          />
          <MemberMenu member={member} onCommand={onCommand} />
        </>
      )}
    />
  );
}
