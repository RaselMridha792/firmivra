'use client';

import { Input } from '@firmivra/ui';
import { compactInput } from './form-blocks';

export interface CurrencyRow {
  description: string;
  quarters: string[];
  annual: string;
}
const cents = (value: string) =>
  /^\d+(\.\d{0,2})?$/.test(value) ? Math.round(Number(value) * 100) : 0;
export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
export function QuarterlyGrid({
  title,
  labels,
  rows,
  onChange,
  annualOnly = false,
  errors,
  showTotal = true,
  totalRows = rows,
  firstColumn = 'Income Source / Type',
  readOnly = false,
}: {
  title: string;
  labels: readonly (readonly [string, string])[];
  rows: CurrencyRow[];
  onChange?: (index: number, field: 'description' | 'annual' | number, value: string) => void;
  annualOnly?: boolean;
  errors?: (index: number, quarter?: number) => string | undefined;
  showTotal?: boolean;
  totalRows?: CurrencyRow[];
  firstColumn?: string;
  readOnly?: boolean;
}) {
  const columns = annualOnly ? ['Total Annual'] : ['Q1', 'Q2', 'Q3', 'Q4', 'Total Annual'];
  return (
    <div
      className="relative w-full min-w-0 max-w-full overflow-x-auto rounded-control border border-folder-border"
      tabIndex={0}
      role="region"
      aria-label={`${title} amounts`}
    >
      <table
        className={`w-full border-collapse text-left text-xs ${annualOnly ? 'min-w-96' : 'min-w-3xl'}`}
      >
        <caption className="sr-only">{title}, in U.S. dollars</caption>
        <thead className="bg-folder-surface text-heading">
          <tr>
            {[firstColumn, 'Description (optional)', ...columns].map((label) => (
              <th
                key={label}
                scope="col"
                className="border-r border-folder-border px-2 py-1 font-semibold"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map(([label, placeholder], index) => (
            <tr key={label} className="border-t border-folder-border">
              <th
                scope="row"
                className="min-w-36 border-r border-folder-border px-2 py-1 font-normal text-firm-primary"
              >
                {label}
              </th>
              <td className="min-w-40 border-r border-folder-border px-1 py-0.5 [&_label]:sr-only">
                <Input
                  label={`${label} description`}
                  value={rows[index]?.description ?? ''}
                  placeholder={placeholder}
                  maxLength={1000}
                  readOnly={readOnly}
                  onChange={(event) => onChange?.(index, 'description', event.target.value)}
                  className={compactInput}
                />
              </td>
              {(annualOnly ? [0] : [0, 1, 2, 3]).map((quarter) => (
                <td
                  key={quarter}
                  className="min-w-24 border-r border-folder-border px-1 py-0.5 [&_label]:sr-only"
                >
                  <Input
                    label={`${label} ${annualOnly ? 'annual amount' : `Q${quarter + 1}`}`}
                    value={
                      annualOnly
                        ? (rows[index]?.annual ?? '')
                        : (rows[index]?.quarters[quarter] ?? '')
                    }
                    inputMode="decimal"
                    placeholder="0.00"
                    maxLength={14}
                    readOnly={readOnly}
                    onChange={(event) =>
                      onChange?.(index, annualOnly ? 'annual' : quarter, event.target.value)
                    }
                    error={errors?.(index, annualOnly ? undefined : quarter)}
                    className={compactInput}
                  />
                </td>
              ))}
              {!annualOnly && (
                <td className="min-w-24 px-2 py-1 text-heading">
                  <output aria-label={`${label} annual total`}>
                    {formatCurrency(
                      (rows[index]?.quarters ?? []).reduce(
                        (total, amount) => total + cents(amount),
                        0,
                      ),
                    )}
                  </output>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {showTotal && (
          <tfoot className="border-t border-folder-border bg-folder-surface font-semibold text-heading">
            <tr>
              <th colSpan={2} scope="row" className="px-2 py-2">
                Total {title}
              </th>
              {columns.map((column, index) => (
                <td key={column} className="border-l border-folder-border px-2 py-2">
                  <output aria-label={`${title} ${column} total`}>
                    {formatCurrency(
                      totalRows.reduce(
                        (total, row) =>
                          total +
                          (annualOnly
                            ? cents(row.annual)
                            : index === 4
                              ? row.quarters.reduce((sum, amount) => sum + cents(amount), 0)
                              : cents(row.quarters[index] ?? '')),
                        0,
                      ),
                    )}
                  </output>
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
