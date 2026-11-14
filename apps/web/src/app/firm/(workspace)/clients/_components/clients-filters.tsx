'use client';

import {
  type ClientServiceRef,
  type ClientStatus,
  type MemberRef,
  US_STATES,
} from '@firmivra/types';
import {
  Button,
  DateRangePicker,
  FilterBar,
  FilterChip,
  FilterGroup,
  Input,
  SearchField,
  Select,
  type DateRange,
} from '@firmivra/ui';
import { CalendarDots } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { SOURCES } from '../../leads/_components/lead-shared';
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

/** The firm's tags (the same key as the client's Tags card and Add Tag). */
const FIRM_TAGS = ['tags'] as const;

// The design's 12 px, 36 px tall filter controls.
const select = '!h-9 !min-h-0 !py-1.5 !text-xs';

/** What More Filters sets (Octavia's E2 additions), applied together with Apply Filters. */
const MORE_KEYS = [
  'clientStatus',
  'serviceId',
  'records',
  'deadlineFrom',
  'deadlineTo',
  'appointmentFrom',
  'appointmentTo',
  'accountType',
  'state',
  'area',
  'balance',
  'documents',
  'tagId',
  'source',
  'priority',
] as const;
type More = Pick<ClientFilters, (typeof MORE_KEYS)[number]>;
const pickMore = (f: ClientFilters): More =>
  Object.fromEntries(MORE_KEYS.map((k) => [k, f[k]])) as More;
const NO_MORE: More = {
  clientStatus: '',
  serviceId: '',
  records: 'active',
  deadlineFrom: '',
  deadlineTo: '',
  appointmentFrom: '',
  appointmentTo: '',
  accountType: '',
  state: '',
  area: '',
  balance: '',
  documents: '',
  tagId: '',
  source: '',
  priority: '',
};
const STATE_OPTIONS = [
  { value: '', label: 'All States' },
  ...Object.entries(US_STATES).map(([value, label]) => ({ value, label })),
];
const PRIORITY_LABEL = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' } as const;
const BALANCE_LABEL = { DUE: 'Balance due', NONE: 'No balance' } as const;
const DOCUMENTS_LABEL = { MISSING: 'Missing documents', NONE: 'No missing documents' } as const;
const RECORD_LABEL = {
  active: 'Current clients',
  archived: 'Archived',
  all: 'Current and archived',
};

/** "Oct 2 to Oct 9", "From Oct 2", "To Oct 9". */
const span = (from: string, to: string) => rangeText({ from, to });

function Dates({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Input
        label={`${label} from`}
        type="date"
        className={select}
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
      />
      <Input
        label={`${label} to`}
        type="date"
        className={select}
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
      />
    </div>
  );
}

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
  const tags = useApiQuery(FIRM_TAGS, () => api.tags.list());
  // More Filters edits a draft; Apply Filters applies it, Clear Filters clears them all.
  const [draft, setDraft] = useState<More>(() => pickMore(filters));
  const applied = JSON.stringify(pickMore(filters));
  // A change from outside (a chip, a tab, Reset) shows in the draft too.
  const [seen, setSeen] = useState(applied);
  if (seen !== applied) {
    setSeen(applied);
    setDraft(JSON.parse(applied) as More);
  }
  const set = (patch: Partial<More>) => setDraft((was) => ({ ...was, ...patch }));
  // Four columns, as the design's panel.
  const more = (
    <>
      <div className="flex min-w-0 flex-col gap-5">
        <FilterGroup title="Client Status">
          <Choices<ClientStatus | ''>
            name="more-client-status"
            value={draft.clientStatus}
            options={[{ value: '', label: 'Any status' }, ...stageOptions]}
            onChange={(clientStatus) => set({ clientStatus })}
          />
        </FilterGroup>
        <FilterGroup title="Service Type">
          <Choices
            name="more-service"
            value={draft.serviceId}
            options={[
              { value: '', label: 'Any service' },
              ...services.map((s) => ({ value: s.id, label: s.name })),
            ]}
            onChange={(serviceId) => set({ serviceId })}
          />
        </FilterGroup>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <FilterGroup title="Due Date / Deadline">
          <Dates
            label="Deadline"
            from={draft.deadlineFrom}
            to={draft.deadlineTo}
            onChange={(deadlineFrom, deadlineTo) => set({ deadlineFrom, deadlineTo })}
          />
        </FilterGroup>
        <FilterGroup title="Next Appointment">
          <Dates
            label="Appointment"
            from={draft.appointmentFrom}
            to={draft.appointmentTo}
            onChange={(appointmentFrom, appointmentTo) => set({ appointmentFrom, appointmentTo })}
          />
        </FilterGroup>
        <FilterGroup title="Client Source">
          <Select
            label="Client Source"
            hideLabel
            className={select}
            value={draft.source}
            onChange={(e) => set({ source: e.target.value })}
            options={[{ value: '', label: 'All Sources' }, ...SOURCES]}
          />
        </FilterGroup>
        <FilterGroup title="Records">
          <Choices
            name="more-records"
            value={draft.records}
            options={RECORDS}
            onChange={(records) => set({ records })}
          />
        </FilterGroup>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <FilterGroup title="Client Type">
          <Choices<More['accountType']>
            name="more-type"
            value={draft.accountType}
            options={[
              { value: '', label: 'Any type' },
              { value: 'INDIVIDUAL', label: 'Individual' },
              { value: 'BUSINESS', label: 'Business' },
            ]}
            onChange={(accountType) => set({ accountType })}
          />
        </FilterGroup>
        <FilterGroup title="Location / State">
          <Select
            label="State"
            className={select}
            value={draft.state}
            onChange={(e) => set({ state: e.target.value })}
            options={STATE_OPTIONS}
          />
          <Input
            label="City or County (optional)"
            className={select}
            maxLength={100}
            value={draft.area}
            onChange={(e) => set({ area: e.target.value })}
          />
        </FilterGroup>
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <FilterGroup title="Balance Due">
          <Choices<More['balance']>
            name="more-balance"
            value={draft.balance}
            options={[
              { value: '', label: 'Any amount' },
              { value: 'DUE', label: BALANCE_LABEL.DUE },
              { value: 'NONE', label: BALANCE_LABEL.NONE },
            ]}
            onChange={(balance) => set({ balance })}
          />
        </FilterGroup>
        <FilterGroup title="Missing Documents">
          <Choices<More['documents']>
            name="more-documents"
            value={draft.documents}
            options={[
              { value: '', label: 'Any' },
              { value: 'MISSING', label: DOCUMENTS_LABEL.MISSING },
              { value: 'NONE', label: DOCUMENTS_LABEL.NONE },
            ]}
            onChange={(documents) => set({ documents })}
          />
        </FilterGroup>
        <FilterGroup title="Tags">
          <Select
            label="Tags"
            hideLabel
            className={select}
            value={draft.tagId}
            onChange={(e) => set({ tagId: e.target.value })}
            options={[
              { value: '', label: 'All Tags' },
              ...(tags.data?.items ?? []).map((t) => ({ value: t.id, label: t.name })),
            ]}
          />
        </FilterGroup>
        <FilterGroup title="Priority">
          <Select
            label="Priority"
            hideLabel
            className={select}
            value={draft.priority}
            onChange={(e) => set({ priority: e.target.value as More['priority'] })}
            options={[
              { value: '', label: 'All Priorities' },
              ...(['HIGH', 'MEDIUM', 'LOW'] as const).map((v) => ({
                value: v,
                label: PRIORITY_LABEL[v],
              })),
            ]}
          />
        </FilterGroup>
      </div>
    </>
  );

  // The chips of what More Filters has set, each removed on its own.
  const tagName = tags.data?.items.find((t) => t.id === filters.tagId)?.name ?? 'A tag';
  const chips: { label: string; clear: Partial<ClientFilters> }[] = [
    ...(filters.addedFrom
      ? [{ label: `Added since ${day(filters.addedFrom)}`, clear: { addedFrom: '' } }]
      : []),
    ...(filters.deadlineFrom || filters.deadlineTo
      ? [
          {
            label: `Deadline: ${span(filters.deadlineFrom, filters.deadlineTo)}`,
            clear: { deadlineFrom: '', deadlineTo: '' },
          },
        ]
      : []),
    ...(filters.appointmentFrom || filters.appointmentTo
      ? [
          {
            label: `Appointment: ${span(filters.appointmentFrom, filters.appointmentTo)}`,
            clear: { appointmentFrom: '', appointmentTo: '' },
          },
        ]
      : []),
    ...(filters.accountType
      ? [
          {
            label: filters.accountType === 'BUSINESS' ? 'Business' : 'Individual',
            clear: { accountType: '' as const },
          },
        ]
      : []),
    ...(filters.state ? [{ label: `State: ${filters.state}`, clear: { state: '' } }] : []),
    ...(filters.area.trim()
      ? [{ label: `Area: ${filters.area.trim()}`, clear: { area: '' } }]
      : []),
    ...(filters.balance
      ? [{ label: BALANCE_LABEL[filters.balance], clear: { balance: '' as const } }]
      : []),
    ...(filters.documents
      ? [{ label: DOCUMENTS_LABEL[filters.documents], clear: { documents: '' as const } }]
      : []),
    ...(filters.tagId ? [{ label: `Tag: ${tagName}`, clear: { tagId: '' } }] : []),
    ...(filters.source
      ? [
          {
            label: `Source: ${SOURCES.find((x) => x.value === filters.source)?.label ?? filters.source}`,
            clear: { source: '' },
          },
        ]
      : []),
    ...(filters.priority
      ? [
          {
            label: `Priority: ${PRIORITY_LABEL[filters.priority]}`,
            clear: { priority: '' as const },
          },
        ]
      : []),
    ...(filters.records !== 'active'
      ? [{ label: RECORD_LABEL[filters.records], clear: { records: 'active' as const } }]
      : []),
  ];

  return (
    // A compact "More Filters" button, as narrow as the design's.
    <div className="flex min-w-0 flex-col gap-2 [&>div>button]:!h-9 [&>div>button]:!text-xs [&>div>button[aria-controls]]:!gap-1.5 [&>div>button[aria-controls]]:!px-3">
      <FilterBar
        more={more}
        onReset={onReset}
        onApply={() => onChange(draft)}
        onClear={() => {
          setDraft(NO_MORE);
          onChange(NO_MORE);
        }}
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
      {chips.length ? (
        <div
          className="flex flex-wrap gap-2"
          aria-label="Filters applied"
          data-testid="filter-chips"
        >
          {chips.map((c) => (
            <FilterChip key={c.label} label={c.label} onRemove={() => onChange(c.clear)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
