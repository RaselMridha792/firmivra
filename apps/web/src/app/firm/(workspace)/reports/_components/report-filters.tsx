'use client';

import { Checkbox, Input, Select } from '@firmivra/ui';
import { Plus } from '@phosphor-icons/react';
import { type ReactNode, useDeferredValue, useId } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import {
  type FilterDraft,
  type FilterField,
  NO_VALUE,
  OPS,
  draftProblem,
  isDate,
  isList,
  isNumeric,
  newDraft,
  onField,
} from './filter-rules';
import { PRESETS, RP_KEY, outlined } from './reports-shared';

// RP-F02, F09, F10 (Octavia's Reports review, Oct 28): the filter rows of the builder and of More
// Filters. Each row: the field, how to compare it (only what its type takes), and a value box that
// fits the type: an amount in dollars, a date, a range, one or several statuses, Yes or No, text
// (a client's name suggested from the clients the caller may see). A value that does not fit says
// so under its own box; `showAll` shows every row's problem (after Apply).

const isClientField = (f: FilterField) =>
  f.type === 'TEXT' && /^client(name)?$/i.test(f.key.replace(/_/g, ''));

/** A client's name, suggested from the clients the caller may see (RP-F09). */
function ClientSuggestions({ id, term }: { id: string; term: string }) {
  const search = useDeferredValue(term.trim());
  const q = useApiQuery([...RP_KEY, 'lookups', 'CLIENT', search], () =>
    api.reports.lookups({ kind: 'CLIENT', ...(search ? { search } : {}), limit: 20 }),
  );
  return (
    <datalist id={id}>
      {(q.data ?? []).map((c) => (
        <option key={c.id} value={c.label} />
      ))}
    </datalist>
  );
}

function FilterRow({
  fields,
  row,
  index,
  showProblem,
  onChange,
  onRemove,
}: {
  fields: readonly FilterField[];
  row: FilterDraft;
  index: number;
  showProblem: boolean;
  onChange: (d: FilterDraft) => void;
  onRemove: () => void;
}) {
  const listId = useId();
  const f = fields.find((x) => x.key === row.field);
  const problem = draftProblem(f, row);
  // A problem shows once something was typed or chosen, or after Apply.
  const touched = !!(row.value || row.to || row.values.length);
  const error = problem && (showProblem || touched) ? problem : undefined;
  const set = (over: Partial<FilterDraft>) => onChange({ ...row, ...over });
  const n = index + 1;

  let value: ReactNode;
  if (!f || NO_VALUE.has(row.op))
    value = <p className="min-h-10 text-sm text-muted">No value needed</p>;
  else if (isNumeric(f.type)) {
    const box = (label: string, v: string, key: 'value' | 'to', err?: string) => (
      <Input
        label={label}
        inputMode="decimal"
        placeholder={f.type === 'MONEY' ? '500.00' : f.type === 'PERCENT' ? '15' : '500'}
        value={v}
        onChange={(e) => set({ [key]: e.target.value })}
        {...(err ? { error: err } : {})}
      />
    );
    const unit = f.type === 'MONEY' ? ' ($)' : f.type === 'PERCENT' ? ' (%)' : '';
    value =
      row.op === 'BETWEEN' ? (
        <div className="grid grid-cols-2 gap-2">
          {box(`From${unit}`, row.value, 'value', error)}
          {box(`To${unit}`, row.to, 'to')}
        </div>
      ) : (
        box(`Value${unit}`, row.value, 'value', error)
      );
  } else if (isDate(f.type)) {
    value =
      row.op === 'RELATIVE' ? (
        <Select
          label="Value"
          value={row.value}
          onChange={(e) => set({ value: e.target.value })}
          options={[{ value: '', label: 'Choose…' }, ...PRESETS.map((p) => ({ ...p }))]}
          {...(error ? { error } : {})}
        />
      ) : row.op === 'BETWEEN' ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            label="From"
            type="date"
            value={row.value}
            onChange={(e) => set({ value: e.target.value })}
            {...(error ? { error } : {})}
          />
          <Input
            label="To"
            type="date"
            value={row.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
      ) : (
        <Input
          label="Value"
          type="date"
          value={row.value}
          onChange={(e) => set({ value: e.target.value })}
          {...(error ? { error } : {})}
        />
      );
  } else if (f.type === 'STATUS' && isList(row.op)) {
    value = (
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-semibold text-heading">Values</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {f.options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={row.values.includes(o.value)}
              onChange={(e) =>
                set({
                  values: e.target.checked
                    ? [...row.values, o.value]
                    : row.values.filter((v) => v !== o.value),
                })
              }
            />
          ))}
        </div>
        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      </fieldset>
    );
  } else if (f.type === 'STATUS' || f.type === 'BOOLEAN') {
    value = (
      <Select
        label="Value"
        value={row.value}
        onChange={(e) => set({ value: e.target.value })}
        options={[
          { value: '', label: 'Choose…' },
          ...(f.type === 'BOOLEAN'
            ? [
                { value: 'true', label: 'Yes' },
                { value: 'false', label: 'No' },
              ]
            : f.options),
        ]}
        {...(error ? { error } : {})}
      />
    );
  } else {
    value = (
      <>
        <Input
          label="Value"
          value={row.value}
          maxLength={200}
          onChange={(e) => set({ value: e.target.value })}
          {...(isClientField(f) ? { list: listId, placeholder: 'Type a client’s name' } : {})}
          {...(error ? { error } : {})}
        />
        {isClientField(f) ? <ClientSuggestions id={listId} term={row.value} /> : null}
      </>
    );
  }

  // Field and Condition side by side, the value below at full width: it fits the builder's
  // narrow column and the More Filters dialog alike.
  return (
    <div
      className="grid gap-2 rounded-lg border border-divider p-3"
      data-testid={`filter-row-${n}`}
    >
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="Field"
          value={row.field}
          onChange={(e) => {
            const next = fields.find((x) => x.key === e.target.value);
            if (next) onChange(onField(row, next));
          }}
          options={fields.map((x) => ({ value: x.key, label: x.label }))}
        />
        <Select
          label="Condition"
          value={row.op}
          onChange={(e) => set({ op: e.target.value, to: '', values: [] })}
          options={f ? OPS[f.type] : []}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">{value}</div>
        <button
          type="button"
          aria-label={`Remove filter ${n}`}
          onClick={onRemove}
          className="mt-7 min-h-10 px-2 text-sm font-medium text-danger"
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/** The rows, Add Filter and Clear All. */
export function FilterRows({
  fields,
  rows,
  onChange,
  showAll = false,
}: {
  fields: readonly FilterField[];
  rows: readonly FilterDraft[];
  onChange: (rows: FilterDraft[]) => void;
  showAll?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((r, i) => (
        <FilterRow
          key={i}
          fields={fields}
          row={r}
          index={i}
          showProblem={showAll}
          onChange={(d) => onChange(rows.map((x, j) => (j === i ? d : x)))}
          onRemove={() => onChange(rows.filter((_, j) => j !== i))}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`${outlined} min-h-9 w-fit`}
          disabled={!fields[0]}
          onClick={() => fields[0] && onChange([...rows, newDraft(fields[0])])}
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add Filter
        </button>
        {rows.length ? (
          <button
            type="button"
            className="text-sm font-medium text-link"
            onClick={() => onChange([])}
          >
            Clear All
          </button>
        ) : null}
      </div>
    </div>
  );
}
