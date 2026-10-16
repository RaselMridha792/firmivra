'use client';

import type { AppointmentDisplayStatus } from '@firmivra/types';
import { SearchField, Select } from '@firmivra/ui';
import { useDeferredValue, useState } from 'react';
import { useAgenda, useOptions } from './ap-data';
import { Overview, type OverviewState, applyKpiFilter } from './ap-overview';
import { STATUS_LABELS, dayRange } from './ap-shared';
import { AppointmentsTable } from './ap-table';
import { addDays } from './time';

const STATUSES = Object.entries(STATUS_LABELS).filter(([id]) => id !== 'DRAFT');

/** /calendar/list: the same appointments as the calendar, as a table with search and filters. */
export function ListScreen() {
  const { options } = useOptions();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [staff, setStaff] = useState('');
  const term = useDeferredValue(search.trim());
  return (
    <Overview
      view="list"
      toolbar={() => (
        <>
          <SearchField
            label="Search appointments"
            placeholder="Search by name, email, phone, or service…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            minWidth="12rem"
          />
          <div className="w-44">
            <Select
              label="Status"
              hideLabel
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={[
                { value: '', label: 'All statuses' },
                ...STATUSES.map(([value, label]) => ({ value, label })),
              ]}
            />
          </div>
          <div className="w-44">
            <Select
              label="Staff member"
              hideLabel
              value={staff}
              onChange={(event) => setStaff(event.target.value)}
              options={[
                { value: '', label: 'All staff' },
                ...(options?.staff ?? []).map((m) => ({ value: m.userId, label: m.name })),
              ]}
            />
          </div>
        </>
      )}
    >
      {(state) => (
        <List
          state={state}
          term={term}
          status={status as AppointmentDisplayStatus | ''}
          staff={staff}
        />
      )}
    </Overview>
  );
}

function List({
  state,
  term,
  status,
  staff,
}: {
  state: OverviewState;
  term: string;
  status: AppointmentDisplayStatus | '';
  staff: string;
}) {
  const { timeZone, today } = state;
  // A month back and four months ahead of today; the API pages at 500.
  const agenda = useAgenda({
    from: dayRange(addDays(today, -31), timeZone).from,
    to: dayRange(addDays(today, 122), timeZone).from,
    ...(term ? { search: term } : {}),
    ...(status ? { status } : {}),
    ...(staff ? { staffUserId: staff } : {}),
  });
  const kept = new Set(applyKpiFilter(agenda.items, state.filter).map((item) => item.id));
  const entries = agenda.entries.filter(
    (entry) => state.filter === 'all' || (!entry.restricted && kept.has(entry.id)),
  );
  return (
    <section
      aria-label="All appointments"
      className="rounded-xl bg-surface p-4 shadow-md"
      data-testid="list-card"
    >
      <h2 className="mb-3 text-lg font-bold text-heading">All Appointments</h2>
      <AppointmentsTable
        entries={entries}
        timeZone={timeZone}
        notify={state.notify}
        loading={agenda.query.isPending}
        caption="All appointments"
        emptyTitle={agenda.query.isError ? 'Appointments are not available' : 'No appointments'}
        emptyText={
          agenda.query.isError
            ? 'We could not load the appointments. Try again in a moment.'
            : 'Appointments you schedule will appear here.'
        }
      />
    </section>
  );
}
