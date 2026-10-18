'use client';

import { Button, DateRangePicker, type DateRange } from '@firmivra/ui';
import { useId, useState } from 'react';
import {
  SLA_STATES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  type SlaState,
  type SupportDirectory,
  type SupportSettings,
  type TicketFilters,
  type TicketSource,
  type TicketStatus,
} from '../../../../../mocks/admin-support';
import { SelectField } from './fields';
import { formatDate } from './support-data';

/** The Filters panel's choices (docx §1 Filters): every one narrows the list together. */
export interface FilterState {
  status: '' | TicketStatus;
  priorityId: string;
  categoryId: string;
  firmId: string;
  assigneeId: string;
  source: '' | TicketSource;
  sla: '' | SlaState;
  escalated: '' | 'YES' | 'NO';
  created: DateRange;
  activity: DateRange;
}
export const NO_FILTERS: FilterState = {
  status: '',
  priorityId: '',
  categoryId: '',
  firmId: '',
  assigneeId: '',
  source: '',
  sla: '',
  escalated: '',
  created: { from: '', to: '' },
  activity: { from: '', to: '' },
};

export function filterQuery(f: FilterState): TicketFilters {
  return {
    ...(f.status ? { statuses: [f.status] } : {}),
    ...(f.priorityId ? { priorityIds: [f.priorityId] } : {}),
    ...(f.categoryId ? { categoryIds: [f.categoryId] } : {}),
    ...(f.firmId ? { firmId: f.firmId } : {}),
    ...(f.assigneeId ? { assigneeId: f.assigneeId } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.sla ? { sla: f.sla } : {}),
    ...(f.escalated ? { escalated: f.escalated } : {}),
    ...(f.created.from ? { createdFrom: f.created.from } : {}),
    ...(f.created.to ? { createdTo: f.created.to } : {}),
    ...(f.activity.from ? { activityFrom: f.activity.from } : {}),
    ...(f.activity.to ? { activityTo: f.activity.to } : {}),
  };
}

const day = (value: string) => formatDate(`${value}T12:00:00`);
const range = (r: DateRange) =>
  r.from && r.to
    ? `${day(r.from)} – ${day(r.to)}`
    : r.from
      ? `from ${day(r.from)}`
      : `until ${day(r.to)}`;

/** One chip per active filter, with what clears it. */
export function filterChips(
  f: FilterState,
  directory: SupportDirectory | undefined,
  settings: SupportSettings | undefined,
): { id: string; label: string; clear: Partial<FilterState> }[] {
  const chips: { id: string; label: string; clear: Partial<FilterState> }[] = [];
  if (f.status)
    chips.push({
      id: 'status',
      label: `Status: ${TICKET_STATUSES[f.status]}`,
      clear: { status: '' },
    });
  if (f.priorityId) {
    const name = settings?.priorities.find((p) => p.id === f.priorityId)?.name ?? 'Selected';
    chips.push({ id: 'priority', label: `Priority: ${name}`, clear: { priorityId: '' } });
  }
  if (f.categoryId) {
    const name = settings?.categories.find((c) => c.id === f.categoryId)?.name ?? 'Selected';
    chips.push({ id: 'category', label: `Category: ${name}`, clear: { categoryId: '' } });
  }
  if (f.firmId) {
    const name = directory?.firms.find((x) => x.id === f.firmId)?.name ?? 'Selected';
    chips.push({ id: 'firm', label: `Firm: ${name}`, clear: { firmId: '' } });
  }
  if (f.assigneeId) {
    const name =
      f.assigneeId === 'UNASSIGNED'
        ? 'Unassigned'
        : (directory?.agents.find((a) => a.id === f.assigneeId)?.name ?? 'Selected');
    chips.push({ id: 'assignee', label: `Assigned To: ${name}`, clear: { assigneeId: '' } });
  }
  if (f.source)
    chips.push({
      id: 'source',
      label: `Source: ${TICKET_SOURCES[f.source]}`,
      clear: { source: '' },
    });
  if (f.sla) chips.push({ id: 'sla', label: `SLA: ${SLA_STATES[f.sla]}`, clear: { sla: '' } });
  if (f.escalated) {
    chips.push({
      id: 'escalated',
      label: f.escalated === 'YES' ? 'Escalated' : 'Not escalated',
      clear: { escalated: '' },
    });
  }
  if (f.created.from || f.created.to) {
    chips.push({
      id: 'created',
      label: `Created ${range(f.created)}`,
      clear: { created: { from: '', to: '' } },
    });
  }
  if (f.activity.from || f.activity.to) {
    chips.push({
      id: 'activity',
      label: `Last activity ${range(f.activity)}`,
      clear: { activity: { from: '', to: '' } },
    });
  }
  return chips;
}

/** The panel under the toolbar: the choices are applied together with Apply Filters. */
export function FiltersPanel({
  id,
  value,
  directory,
  settings,
  onApply,
}: {
  id: string;
  value: FilterState;
  directory: SupportDirectory | undefined;
  settings: SupportSettings | undefined;
  onApply: (next: FilterState) => void;
}) {
  const fieldId = useId();
  const [draft, setDraft] = useState(value);
  const set = <K extends keyof FilterState>(key: K, next: FilterState[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));
  return (
    <div
      id={id}
      role="region"
      aria-label="Ticket filters"
      className="border-b border-divider bg-subtle px-4 py-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField
          id={`${fieldId}-status`}
          label="Status"
          placeholder="Any status"
          options={(Object.keys(TICKET_STATUSES) as TicketStatus[]).map((s) => ({
            value: s,
            label: TICKET_STATUSES[s],
          }))}
          value={draft.status}
          onChange={(event) => set('status', event.target.value as FilterState['status'])}
        />
        <SelectField
          id={`${fieldId}-priority`}
          label="Priority"
          placeholder="Any priority"
          options={[...(settings?.priorities ?? [])]
            .sort((a, b) => a.rank - b.rank)
            .map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (inactive)` }))}
          value={draft.priorityId}
          onChange={(event) => set('priorityId', event.target.value)}
        />
        <SelectField
          id={`${fieldId}-category`}
          label="Category"
          placeholder="Any category"
          options={(settings?.categories ?? []).map((c) => ({
            value: c.id,
            label: c.active ? c.name : `${c.name} (inactive)`,
          }))}
          value={draft.categoryId}
          onChange={(event) => set('categoryId', event.target.value)}
        />
        <SelectField
          id={`${fieldId}-firm`}
          label="Firm"
          placeholder="Any firm"
          options={(directory?.firms ?? []).map((f) => ({ value: f.id, label: f.name }))}
          value={draft.firmId}
          onChange={(event) => set('firmId', event.target.value)}
        />
        <SelectField
          id={`${fieldId}-assignee`}
          label="Assigned To"
          placeholder="Anyone"
          options={[
            { value: 'UNASSIGNED', label: 'Unassigned' },
            ...(directory?.agents ?? []).map((a) => ({
              value: a.id,
              label: a.active ? a.name : `${a.name} (deactivated)`,
            })),
          ]}
          value={draft.assigneeId}
          onChange={(event) => set('assigneeId', event.target.value)}
        />
        <SelectField
          id={`${fieldId}-source`}
          label="Source"
          placeholder="Any source"
          options={(Object.keys(TICKET_SOURCES) as TicketSource[]).map((s) => ({
            value: s,
            label: TICKET_SOURCES[s],
          }))}
          value={draft.source}
          onChange={(event) => set('source', event.target.value as FilterState['source'])}
        />
        <SelectField
          id={`${fieldId}-sla`}
          label="SLA State"
          placeholder="Any SLA state"
          options={(Object.keys(SLA_STATES) as SlaState[]).map((s) => ({
            value: s,
            label: SLA_STATES[s],
          }))}
          value={draft.sla}
          onChange={(event) => set('sla', event.target.value as FilterState['sla'])}
        />
        <SelectField
          id={`${fieldId}-escalated`}
          label="Escalation"
          placeholder="Any"
          options={[
            { value: 'YES', label: 'Escalated' },
            { value: 'NO', label: 'Not escalated' },
          ]}
          value={draft.escalated}
          onChange={(event) => set('escalated', event.target.value as FilterState['escalated'])}
        />
        <div className="sm:col-span-2">
          <DateRangePicker
            label="Created Date"
            value={draft.created}
            onChange={(next) => set('created', next)}
          />
        </div>
        <div className="sm:col-span-2">
          <DateRangePicker
            label="Last Activity Date"
            value={draft.activity}
            onChange={(next) => set('activity', next)}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={() => setDraft(NO_FILTERS)}>
          Clear Filters
        </Button>
        <Button onClick={() => onApply(draft)}>Apply Filters</Button>
      </div>
    </div>
  );
}
