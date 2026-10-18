'use client';

import {
  DotsThree,
  Envelope,
  Funnel,
  ListBullets,
  PaperPlaneTilt,
  ShieldCheck,
  SquaresFour,
  ToggleRight,
  UserMinus,
  Users,
  X,
} from '@phosphor-icons/react';
import { ActionMenu, Button, Card, Select, type ActionMenuItem } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ACCESS_LEVELS,
  MEMBER_STATUSES,
  type TeamCapabilities,
  type TeamFilterOptions,
  type TeamView,
} from '../../../../../mocks/admin-team';
import { SearchBox } from '../../_components/list-parts';

export interface TeamFilters {
  departmentId: string;
  roleId: string;
  status: string;
  locationId: string;
  teamId: string;
  accessLevel: string;
  reportsToId: string;
}
export const NO_FILTERS: TeamFilters = {
  departmentId: '',
  roleId: '',
  status: '',
  locationId: '',
  teamId: '',
  accessLevel: '',
  reportsToId: '',
};

const all = (label: string, values: { value: string; label: string }[]) => [
  { value: '', label },
  ...values,
];

/** Search, the four filters and the Card / List switch. */
export function FilterRow({
  search,
  onSearch,
  filters,
  onFilter,
  options,
  view,
  onView,
}: {
  search: string;
  onSearch: (value: string) => void;
  filters: TeamFilters;
  onFilter: (key: keyof TeamFilters, value: string) => void;
  options: UseQueryResult<TeamFilterOptions>;
  view: TeamView;
  onView: (view: TeamView) => void;
}) {
  const data = options.data;
  // The design's 14px selects, each wide enough for its "All …" label.
  const select = (
    key: keyof TeamFilters,
    label: string,
    allLabel: string,
    values: { value: string; label: string }[],
    width: string,
  ) => (
    <div className={`min-w-0 ${width}`}>
      <Select
        label={label}
        hideLabel
        value={filters[key]}
        onChange={(event) => onFilter(key, event.target.value)}
        options={all(allLabel, values)}
        className="text-sm!"
      />
    </div>
  );
  return (
    // One row from 1440 px as in the design; narrower screens put the search on its own line.
    <div className="flex flex-col gap-3 min-[1440px]:flex-row min-[1440px]:items-center">
      <SearchBox
        label="Search team members"
        className="min-w-0 min-[1440px]:flex-1"
        placeholder="Search team members by name, email, or role..."
        value={search}
        onChange={(event) => onSearch(event.target.value)}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
          {select(
            'departmentId',
            'Department',
            'All Departments',
            (data?.departments ?? []).map(({ id, name }) => ({ value: id, label: name })),
            'sm:w-40',
          )}
          {select(
            'roleId',
            'Role',
            'All Roles',
            (data?.roles ?? []).map(({ id, title }) => ({ value: id, label: title })),
            'sm:w-32',
          )}
          {select(
            'status',
            'Status',
            'All Statuses',
            (data?.statuses ?? []).map((value) => ({ value, label: MEMBER_STATUSES[value] })),
            'sm:w-36',
          )}
          {select(
            'locationId',
            'Location',
            'All Locations',
            (data?.locations ?? []).map(({ id, name }) => ({ value: id, label: name })),
            'sm:w-36',
          )}
        </div>
        <div role="group" aria-label="Layout" className="flex shrink-0 sm:ml-auto">
          <Button
            variant={view === 'card' ? 'primary' : 'secondary'}
            aria-pressed={view === 'card'}
            onClick={() => onView('card')}
            className="flex-1 rounded-r-none! px-3!"
          >
            <SquaresFour aria-hidden weight="fill" className="size-5" />
            Card View
          </Button>
          <Button
            variant={view === 'list' ? 'primary' : 'secondary'}
            aria-pressed={view === 'list'}
            onClick={() => onView('list')}
            className="flex-1 rounded-l-none! px-3!"
          >
            <ListBullets aria-hidden weight="bold" className="size-5" />
            List View
          </Button>
        </div>
      </div>
    </div>
  );
}

export type BulkCommand = 'message' | 'department' | 'role' | 'status' | 'resend' | 'remove';

/** "0 selected" with the bulk actions, and the More Filters switch at the end. */
export function SelectionBar({
  count,
  pageCount,
  onToggleAll,
  can,
  onCommand,
  onClear,
  extraFilters,
  filtersOpen,
  onFiltersOpen,
}: {
  count: number;
  /** Members on this page: the box selects or clears them all. */
  pageCount: number;
  onToggleAll: (on: boolean) => void;
  can: TeamCapabilities | undefined;
  onCommand: (command: BulkCommand) => void;
  onClear: () => void;
  extraFilters: number;
  filtersOpen: boolean;
  onFiltersOpen: (open: boolean) => void;
}) {
  const boxRef = useRef<HTMLInputElement>(null);
  const allOn = pageCount > 0 && count >= pageCount;
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = count > 0 && !allOn;
  }, [count, allOn]);
  const button = (command: BulkCommand, icon: ReactNode, label: string) => (
    <Button variant="secondary" onClick={() => onCommand(command)}>
      {icon}
      {label}
    </Button>
  );
  const more: ActionMenuItem[] = [
    { label: 'Resend Invitation', icon: Envelope, onSelect: () => onCommand('resend') },
    ...(can?.remove
      ? [
          {
            label: 'Remove from Team',
            icon: UserMinus,
            danger: true,
            onSelect: () => onCommand('remove'),
          },
        ]
      : []),
    { label: 'Clear Selection', icon: X, onSelect: onClear },
  ];
  return (
    <Card
      variant="elevated"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-3 !px-4 !py-3"
    >
      <label className="flex min-h-11 items-center gap-3 pr-2 text-base text-text">
        <input
          ref={boxRef}
          type="checkbox"
          checked={allOn}
          disabled={pageCount === 0}
          onChange={(event) => onToggleAll(event.target.checked)}
          aria-label="Select all team members on this page"
          className="size-5 cursor-pointer"
        />
        <span data-testid="selected-count" aria-live="polite">
          {count} selected
        </span>
      </label>
      {button(
        'message',
        <PaperPlaneTilt aria-hidden weight="fill" className="size-5 text-action" />,
        'Send Message',
      )}
      {can?.changeRoles
        ? button(
            'department',
            <Users aria-hidden weight="fill" className="size-5 text-action" />,
            'Change Department',
          )
        : null}
      {can?.changeRoles
        ? button(
            'role',
            <ShieldCheck aria-hidden weight="fill" className="size-5 text-action" />,
            'Change Role',
          )
        : null}
      {can?.changeStatus
        ? button(
            'status',
            <ToggleRight aria-hidden weight="fill" className="size-5 text-action" />,
            'Change Status',
          )
        : null}
      <ActionMenu
        label="More actions for the selected team members"
        align="left"
        trigger={
          <>
            <DotsThree aria-hidden weight="bold" className="size-5 text-action" />
            <span className="font-medium text-action">More Actions</span>
          </>
        }
        sections={[{ items: more }]}
      />
      <Button
        variant="ghost"
        aria-expanded={filtersOpen}
        aria-controls="team-more-filters"
        onClick={() => onFiltersOpen(!filtersOpen)}
        className="ml-auto"
      >
        <Funnel aria-hidden weight="fill" className="size-5" />
        More Filters{extraFilters ? ` (${extraFilters})` : ''}
      </Button>
    </Card>
  );
}

/** Team, Permission Level and Reports To: the Team docx's filters the design's row has no room for. */
export function MoreFilters({
  filters,
  onFilter,
  options,
  onClear,
}: {
  filters: TeamFilters;
  onFilter: (key: keyof TeamFilters, value: string) => void;
  options: TeamFilterOptions | undefined;
  onClear: () => void;
}) {
  return (
    <Card
      id="team-more-filters"
      variant="elevated"
      aria-label="More filters"
      className="grid items-end gap-4 !p-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <Select
        label="Team"
        value={filters.teamId}
        onChange={(event) => onFilter('teamId', event.target.value)}
        options={all(
          'All Teams',
          (options?.teams ?? []).map(({ id, name }) => ({ value: id, label: name })),
        )}
      />
      <Select
        label="Permission Level"
        value={filters.accessLevel}
        onChange={(event) => onFilter('accessLevel', event.target.value)}
        options={all(
          'All Permission Levels',
          (options?.accessLevels ?? []).map((value) => ({ value, label: ACCESS_LEVELS[value] })),
        )}
      />
      <Select
        label="Reports To"
        value={filters.reportsToId}
        onChange={(event) => onFilter('reportsToId', event.target.value)}
        options={all(
          'Anyone',
          (options?.supervisors ?? []).map(({ id, name }) => ({ value: id, label: name })),
        )}
      />
      <div>
        <Button variant="secondary" onClick={onClear}>
          Clear All Filters
        </Button>
      </div>
    </Card>
  );
}
