'use client';

import type { IntakeGridField } from '@firmivra/types';
import { formatCents, issueKey, type ScreenGrid, toCents } from './intake-values';
import type { Fill } from './intake-fields';

/**
 * A grid field: rows by columns of amounts, dates or notes (income by Q1 to Q4 and Total Annual).
 * With `totalLabel` a footer row sums each currency column as the person types (shown, not stored).
 * Scrolls sideways inside its own box on a phone, never the page.
 */
export function GridInput({
  field,
  value,
  onChange,
  errors,
  fill,
}: {
  field: IntakeGridField;
  value: ScreenGrid;
  onChange: (value: ScreenGrid) => void;
  errors: Readonly<Record<string, string>>;
  fill: Fill;
}) {
  const label = fill(field.label);
  const set = (row: string, col: string, text: string) =>
    onChange({ ...value, [row]: { ...value[row], [col]: text } });
  const total = (col: string) =>
    field.rows.reduce((sum, row) => sum + (toCents(value[row.key]?.[col] ?? '') ?? 0), 0);
  const wide = field.columns.length > 2;
  return (
    <div className="min-w-0">
      {field.help && <p className="mb-1 text-xs text-muted">{fill(field.help)}</p>}
      <div
        className="w-full min-w-0 overflow-x-auto rounded-control border border-folder-border"
        tabIndex={0}
        role="region"
        aria-label={label}
      >
        <table className={`w-full border-collapse text-left text-xs ${wide ? 'min-w-3xl' : ''}`}>
          <caption className="sr-only">{label}</caption>
          <thead className="bg-folder-surface text-heading">
            <tr>
              <th scope="col" className="px-2 py-1 font-semibold">
                {label}
              </th>
              {field.columns.map((col) => (
                <th key={col.key} scope="col" className="px-2 py-1 font-semibold">
                  {fill(col.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {field.rows.map((row) => (
              <tr key={row.key} className="border-t border-folder-border">
                <th scope="row" className="px-2 py-1 font-normal text-firm-primary">
                  {fill(row.label)}
                  {row.help && <span className="block text-muted">{fill(row.help)}</span>}
                </th>
                {field.columns.map((col) => {
                  const error = errors[issueKey([field.key, row.key, col.key])];
                  const errorId = `${field.key}-${row.key}-${col.key}-error`;
                  return (
                    <td key={col.key} className="px-1 py-1 align-top">
                      <input
                        aria-label={`${fill(row.label)}, ${fill(col.label)}`}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        type={col.type === 'date' ? 'date' : 'text'}
                        inputMode={col.type === 'currency' ? 'decimal' : undefined}
                        maxLength={col.type === 'text' ? (col.maxLength ?? 200) : undefined}
                        placeholder={
                          col.type === 'currency'
                            ? '$0.00'
                            : row.placeholder
                              ? fill(row.placeholder)
                              : undefined
                        }
                        value={value[row.key]?.[col.key] ?? ''}
                        onChange={(event) => set(row.key, col.key, event.target.value)}
                        className={`min-h-11 w-full rounded-control border bg-surface px-2 py-1 text-xs sm:min-h-7 ${error ? 'border-danger' : 'border-border'}`}
                      />
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
          {field.totalLabel && (
            <tfoot className="border-t border-folder-border bg-folder-surface font-semibold text-heading">
              <tr>
                <th scope="row" className="px-2 py-1">
                  {fill(field.totalLabel)}
                </th>
                {field.columns.map((col) => (
                  <td key={col.key} className="px-2 py-1" data-total={col.key}>
                    {col.type === 'currency' ? formatCents(total(col.key)) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {errors[issueKey([field.key])] && (
        <p className="text-xs text-danger">{errors[issueKey([field.key])]}</p>
      )}
    </div>
  );
}
