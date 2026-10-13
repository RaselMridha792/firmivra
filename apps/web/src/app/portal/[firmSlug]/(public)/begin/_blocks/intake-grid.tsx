'use client';

import type { IntakeGridField } from '@firmivra/types';
import {
  CalendarDays,
  Ellipsis,
  Landmark,
  type LucideIcon,
  Paperclip,
  Percent,
  Utensils,
} from 'lucide-react';
import type { Fill } from './intake-fields';
import type { GridLook } from './intake-layout';
import { formatCents, issueKey, type ScreenGrid, toCents } from './intake-values';

/** The first column's heading, as the mockups name it (the grid's title is its caption). */
const ROW_HEADER: Readonly<Record<string, string>> = {
  businessIncome: 'Income Source / Type',
  grossReceipts: 'Quarter',
  incomeTaxesPaid: 'Tax Type',
  federalPayments: 'Quarter',
  payrollWages: 'Quarter',
  businessExpenses: 'Expense Category',
  expenses: 'Expense Category',
};

/** The quarter columns' names as the mockups write them. */
const QUARTER_NAMES: Readonly<Record<string, string>> = {
  Q1: 'Q1 (Jan \u2013 Mar)',
  Q2: 'Q2 (Apr \u2013 Jun)',
  Q3: 'Q3 (Jul \u2013 Sep)',
  Q4: 'Q4 (Oct \u2013 Dec)',
};

/** Amount columns' tints, in order (whole classes, so Tailwind finds them). */
const TONES = ['bg-info-soft', 'bg-warning-soft', 'bg-success-soft', 'bg-purple-soft'];

/**
 * A grid field: rows by columns of amounts, dates or notes (income by Q1 to Q4 and Total Annual).
 * With `totalLabel` a footer row sums each currency column as the person types (shown, not stored).
 * A long list with one amount (Business Expenses) sits in two tables side by side, as its mockup
 * draws it, the total under the second. Scrolls sideways inside its own box on a phone.
 */
export function GridInput({
  field,
  value,
  onChange,
  errors,
  fill,
  quiet = false,
  look,
}: {
  field: IntakeGridField;
  value: ScreenGrid;
  onChange: (value: ScreenGrid) => void;
  errors: Readonly<Record<string, string>>;
  fill: Fill;
  /** The label only for screen readers (its panel's title says the same). */
  quiet?: boolean;
  look?: GridLook | undefined;
}) {
  const label = fill(field.label);
  const set = (row: string, col: string, text: string) =>
    onChange({ ...value, [row]: { ...value[row], [col]: text } });
  const total = (col: string) =>
    field.rows.reduce((sum, row) => sum + (toCents(value[row.key]?.[col] ?? '') ?? 0), 0);
  const wide = field.columns.length > 2;
  const tones = look?.tones === true;
  // The mockups' widths: a fifth each for the row names and notes beside four quarters, two
  // fifths each beside a single amount.
  const labelWidth = tones ? 'w-1/3' : wide ? 'w-1/5' : 'w-2/5';
  const half =
    field.columns.length <= 2 && field.rows.length > 12 ? Math.ceil(field.rows.length / 2) : 0;
  const parts = half ? [field.rows.slice(0, half), field.rows.slice(half)] : [field.rows];
  return (
    <div className="min-w-0">
      <p className={quiet ? 'sr-only' : 'mb-1 text-xs font-medium text-firm-primary'}>
        {label}
        {field.required ? ' *' : ''}
      </p>
      {field.help && <p className="mb-1 text-xs text-muted">{fill(field.help)}</p>}
      <div className={half ? 'grid items-start gap-3 lg:grid-cols-2' : ''}>
        {parts.map((rows, part) => (
          <div
            key={rows[0]!.key}
            className="w-full min-w-0 overflow-x-auto rounded-control border border-folder-border"
            tabIndex={0}
            role="region"
            aria-label={parts.length > 1 ? `${label}, part ${part + 1} of ${parts.length}` : label}
          >
            <table
              className={`w-full border-collapse text-left text-xs ${wide ? 'min-w-3xl lg:min-w-0' : ''}`}
            >
              <caption className="sr-only">{label}</caption>
              <thead className="bg-folder-surface text-heading">
                <tr>
                  <th
                    scope="col"
                    className={`${labelWidth} px-2 py-1 font-semibold ${tones ? 'text-sm' : ''}`}
                  >
                    {ROW_HEADER[field.key] ?? 'Description'}
                  </th>
                  {field.columns.map((col, i) =>
                    tones && col.type === 'currency' ? (
                      <th
                        key={col.key}
                        scope="col"
                        className={`px-2 py-1 text-center ${TONES[i % TONES.length]}`}
                      >
                        <span className="flex items-center justify-center gap-1 text-sm font-semibold">
                          <CalendarDays aria-hidden="true" className="size-4" />
                          {QUARTER_NAMES[fill(col.label)] ?? fill(col.label)}
                        </span>
                        <span className="block font-normal text-text">Enter amount</span>
                      </th>
                    ) : (
                      <th
                        key={col.key}
                        scope="col"
                        className={`px-2 py-1 font-semibold ${col.type === 'text' ? labelWidth : ''}`}
                      >
                        {fill(col.label)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-folder-border">
                    <th scope="row" className="px-2 py-1 font-normal text-firm-primary">
                      <RowName
                        label={fill(row.label)}
                        help={row.help ? fill(row.help) : undefined}
                        icon={look?.icons?.[row.key]}
                      />
                    </th>
                    {field.columns.map((col) => {
                      const error = errors[issueKey([field.key, row.key, col.key])];
                      const errorId = `${field.key}-${row.key}-${col.key}-error`;
                      return (
                        <td
                          key={col.key}
                          className={`px-1 py-1 ${tones ? 'align-middle' : 'align-top'}`}
                        >
                          <span className="relative block">
                            {col.type === 'currency' && (
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text"
                              >
                                $
                              </span>
                            )}
                            <input
                              aria-label={`${fill(row.label)}, ${fill(col.label)}`}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? errorId : undefined}
                              type={col.type === 'date' ? 'date' : 'text'}
                              inputMode={col.type === 'currency' ? 'decimal' : undefined}
                              maxLength={col.type === 'text' ? (col.maxLength ?? 200) : undefined}
                              placeholder={
                                col.type === 'currency'
                                  ? '0.00'
                                  : row.placeholder
                                    ? fill(row.placeholder)
                                    : undefined
                              }
                              value={value[row.key]?.[col.key] ?? ''}
                              onChange={(event) => set(row.key, col.key, event.target.value)}
                              className={`min-h-11 w-full rounded-control border bg-surface px-2 py-1 text-xs sm:min-h-7 ${col.type === 'currency' ? 'pl-5' : ''} ${error ? 'border-danger' : 'border-border'}`}
                            />
                          </span>
                          {error && (
                            <span id={errorId} className="text-xs text-danger">
                              {error}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {field.totalLabel && part === parts.length - 1 && (
                <tfoot className="border-t border-folder-border bg-folder-surface font-semibold text-heading">
                  <tr>
                    <th scope="row" className="px-2 py-1">
                      <span className={tones ? 'font-display text-lg leading-tight' : ''}>
                        {fill(field.totalLabel)}
                      </span>
                      {tones && (
                        <span className="block font-sans text-xs font-normal text-text">
                          (This will auto-calculate)
                        </span>
                      )}
                    </th>
                    {field.columns.map((col, i) => (
                      <td
                        key={col.key}
                        className={`px-2 py-1 ${tones && col.type === 'currency' ? TONES[i % TONES.length] : ''}`}
                        data-total={col.key}
                      >
                        <span className={tones ? 'block px-2 py-2 text-xl font-bold' : ''}>
                          {col.type === 'currency' ? formatCents(total(col.key)) : ''}
                        </span>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        ))}
      </div>
      {errors[issueKey([field.key])] && (
        <p className="text-xs text-danger">{errors[issueKey([field.key])]}</p>
      )}
    </div>
  );
}

/** Icons drawn as lines (a fill would blot them); the rest are solid, as the mockups draw them. */
const LINE_ICONS = new Set<LucideIcon>([Ellipsis, Landmark, Paperclip, Percent, Utensils]);

/** A row's name: with an icon and its help line under it when its mockup draws one. */
function RowName({
  label,
  help,
  icon: Icon,
}: {
  label: string;
  help: string | undefined;
  icon: LucideIcon | undefined;
}) {
  if (!Icon) {
    return (
      <>
        {label}
        {help && <span className="block text-muted">{help}</span>}
      </>
    );
  }
  return (
    <span className="flex items-center gap-3">
      <Icon
        aria-hidden="true"
        className={`size-7 shrink-0 text-accent ${LINE_ICONS.has(Icon) ? '' : 'fill-current [&_path+path]:stroke-surface'}`}
      />
      <span className="min-w-0">
        <span className="block font-display text-sm font-bold text-heading">{label}</span>
        {help && <span className="block text-firm-primary">{help}</span>}
      </span>
    </span>
  );
}
