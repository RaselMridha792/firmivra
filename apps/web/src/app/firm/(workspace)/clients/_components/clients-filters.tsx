'use client';

import type { ClientServiceRef, ClientStatus, MemberRef } from '@firmivra/types';
import {
  Button,
  DateRangePicker,
  FilterBar,
  FilterGroup,
  SearchField,
  Select,
  type DateRange,
} from '@firmivra/ui';
import { CalendarDots } from '@phosphor-icons/react';
import { dateText } from './client-parts';
import { type ClientFilters, type Records, STAGE_ORDER, STAGES } from './list-parts';

const day = (value: string) => dateText(`${value}T12:00:00`);

function rangeText({ from, to }: DateRange) {
  if (from && to) return `${day(from)} – ${day(to)}`;
  if (from) return `From ${day(from)}`;
  return to ? `To ${day(to)}` : '';
}

/** "Last Activity" with the calendar icon; opens the From and To days under it. */
function LastActivityFilter({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
}) {
  const text = rangeText(value);
  return (
    <div className="relative w-full sm:w-38">
      <details className="group">
        <summary
          aria-label={text ? `Last activity: ${text}` : 'Last activity: any time'}
          className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-xs text-text hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden"
        >
          <span className="min-w-0 flex-1 truncate">{text || 'Last Activity'}</span>
          <CalendarDots aria-hidden weight="fill" className="size-5 shrink-0 text-heading" />
        </summary>
        <div className="absolute top-full right-0 left-0 z-30 mt-2 rounded-xl border border-divider bg-surface p-4 shadow-lg sm:left-auto sm:w-md">
          <DateRangePicker label="Last activity" value={value} onChange={onChange} />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              className="min-h-9 px-3 py-1"
              disabled={!value.from && !value.to}
              onClick={() => onChange({ from: '', to: '' })}
            >
              Clear
            </Button>
            <Button
              variant="secondary"
              className="min-h-9 px-3 py-1"
              onClick={(event) => {
                const disclosure = event.currentTarget.closest('details');
                if (disclosure) disclosure.open = false;
              }}
            >
              Done
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

/** One choice of a More Filters group (the API takes one stage, one service, one record state). */
function Choices<T extends string>({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <>
      {options.map((option) => (
        <label
          key={option.value}
          className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-text"
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="size-4 shrink-0 accent-action"
          />
          {option.label}
        </label>
      ))}
    </>
  );
}

const RECORDS: { value: Records; label: string }[] = [
  { value: 'active', label: 'Current clients' },
  { value: 'archived', label: 'Archived clients' },
  { value: 'all', label: 'Current and archived' },
];

// The design's 12 px, 36 px tall filter controls.
const select = '!h-9 !min-h-0 !py-1.5 !text-xs';

/**
 * The filter row of clients.jpg: search, services, stages, staff (Owner and Admin: Staff get 403
 * for it), last activity, More Filters and Reset. Every control sets the list query directly.
 */
export function ClientsFilterRow({
  filters,
  services,
  members,
  manager,
  onChange,
  onReset,
}: {
  filters: ClientFilters;
  services: ClientServiceRef[];
  members: MemberRef[];
  manager: boolean;
  onChange: (patch: Partial<ClientFilters>) => void;
  onReset: () => void;
}) {
  const stageOptions = STAGE_ORDER.map((value) => ({ value, label: STAGES[value].label }));
  const more = (
    <>
      <FilterGroup title="Client Status">
        <Choices<ClientStatus | ''>
          name="more-client-status"
          value={filters.clientStatus}
          options={[{ value: '', label: 'Any status' }, ...stageOptions]}
          onChange={(clientStatus) => onChange({ clientStatus })}
        />
      </FilterGroup>
      <FilterGroup title="Service Type">
        <Choices
          name="more-service"
          value={filters.serviceId}
          options={[
            { value: '', label: 'Any service' },
            ...services.map((s) => ({ value: s.id, label: s.name })),
          ]}
          onChange={(serviceId) => onChange({ serviceId })}
        />
      </FilterGroup>
      <FilterGroup title="Records">
        <Choices
          name="more-records"
          value={filters.records}
          options={RECORDS}
          onChange={(records) => onChange({ records })}
        />
      </FilterGroup>
    </>
  );

  return (
    // A compact "More Filters" button, as narrow as the design's.
    <div className="min-w-0 [&>div>button]:!h-9 [&>div>button]:!text-xs [&>div>button[aria-controls]]:!gap-1.5 [&>div>button[aria-controls]]:!px-3">
      <FilterBar
        more={more}
        onReset={onReset}
        onClear={() => onChange({ clientStatus: '', serviceId: '', records: 'active' })}
      >
        <SearchField
          label="Search clients"
          placeholder="Search clients by name, email, phone, or company..."
          maxLength={100}
          minWidth="12rem"
          className="!h-9 [&_input]:!text-xs"
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
        />
        <div className="w-full sm:w-34">
          <Select
            label="Service"
            hideLabel
            className={select}
            value={filters.serviceId}
            onChange={(event) => onChange({ serviceId: event.target.value })}
            options={[
              { value: '', label: 'All Services' },
              ...services.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </div>
        <div className="w-full sm:w-30">
          <Select
            label="Status"
            hideLabel
            className={select}
            value={filters.clientStatus}
            onChange={(event) =>
              onChange({ clientStatus: event.target.value as ClientStatus | '' })
            }
            options={[{ value: '', label: 'All Statuses' }, ...stageOptions]}
          />
        </div>
        {manager ? (
          <div className="w-full sm:w-38">
            <Select
              label="Assigned staff member"
              hideLabel
              className={select}
              value={filters.assignedUserId}
              onChange={(event) => onChange({ assignedUserId: event.target.value })}
              options={[
                { value: '', label: 'All Staff Members' },
                ...members.map((m) => ({ value: m.userId, label: m.name })),
              ]}
            />
          </div>
        ) : null}
        <LastActivityFilter
          value={{ from: filters.from, to: filters.to }}
          onChange={({ from, to }) => onChange({ from, to })}
        />
      </FilterBar>
    </div>
  );
}
