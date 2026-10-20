'use client';

import {
  Button,
  DateRangePicker,
  FilterBar,
  IconButton,
  SearchField,
  Select,
  type DateRange,
} from '@firmivra/ui';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import { useApiQuery } from '../../../../../lib/query';
import { KEY } from './parts';
import {
  adminSubscriptions,
  CYCLE_LABELS,
  STATUS_FILTERS,
  type BillingCycle,
  type PlanId,
  type StatusFilter,
} from './subscriptions-api';

export interface Filters {
  search: string;
  plan: PlanId | '';
  status: StatusFilter | '';
  cycle: BillingCycle | '';
  /** The reporting period; null is this month. */
  period: DateRange | null;
}
export const NO_FILTERS: Filters = { search: '', plan: '', status: '', cycle: '', period: null };

/** The statuses, then the KPI cards' groups. */
const statusOptions = [{ value: '', label: 'All Statuses' }, ...STATUS_FILTERS];
const cycleOptions = [
  { value: '', label: 'All Billing Cycles' },
  { value: 'MONTHLY', label: CYCLE_LABELS.MONTHLY },
  { value: 'ANNUAL', label: CYCLE_LABELS.ANNUAL },
];

const pick = <T extends string>(values: readonly T[], value: string): T | '' =>
  values.find((candidate) => candidate === value) ?? '';

/**
 * Search, Plan, Status, Billing Cycle and the reporting period. Nothing changes until Apply (or
 * Enter); Clear goes back to every subscription this month.
 */
export function SubscriptionFilters({
  draft,
  thisMonth,
  onDraft,
  onApply,
  onClear,
}: {
  draft: Filters;
  thisMonth: DateRange;
  onDraft: (filters: Filters) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  // The plans are the API's (meta), in display order; until they load only "All Plans".
  const meta = useApiQuery([KEY, 'meta'], () => adminSubscriptions.meta());
  const plans = meta.data?.plans ?? [];
  const planOptions = [
    { value: '', label: 'All Plans' },
    ...plans.map((plan) => ({ value: plan.id, label: plan.name })),
  ];
  return (
    <form
      role="search"
      aria-label="Filter subscriptions"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <FilterBar>
        <SearchField
          label="Search subscriptions"
          placeholder="Search by firm name, email or domain..."
          maxLength={100}
          minWidth="12rem"
          value={draft.search}
          onChange={(event) => onDraft({ ...draft, search: event.target.value })}
        />
        <div className="w-full sm:w-44">
          <Select
            label="Plan"
            hideLabel
            options={planOptions}
            value={draft.plan}
            onChange={(event) =>
              onDraft({
                ...draft,
                plan: pick(
                  plans.map((plan) => plan.id),
                  event.target.value,
                ),
              })
            }
          />
        </div>
        <div className="w-full sm:w-44">
          <Select
            label="Status"
            hideLabel
            options={statusOptions}
            value={draft.status}
            onChange={(event) =>
              onDraft({
                ...draft,
                status: pick(
                  STATUS_FILTERS.map((option) => option.value),
                  event.target.value,
                ),
              })
            }
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            label="Billing cycle"
            hideLabel
            options={cycleOptions}
            value={draft.cycle}
            onChange={(event) =>
              onDraft({ ...draft, cycle: pick(['MONTHLY', 'ANNUAL'] as const, event.target.value) })
            }
          />
        </div>
        <div className="flex w-full min-w-0 items-end gap-2 sm:w-auto">
          <div className="min-w-0 flex-1">
            <DateRangePicker
              label="Reporting period"
              value={draft.period ?? thisMonth}
              onChange={(period) => onDraft({ ...draft, period })}
            />
          </div>
          <IconButton
            icon={ArrowCounterClockwise}
            label="Reset the period to this month"
            className="mb-1"
            onClick={() => onDraft({ ...draft, period: null })}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" onClick={onClear}>
            Clear
          </Button>
          <Button type="submit">Apply</Button>
        </div>
      </FilterBar>
    </form>
  );
}
