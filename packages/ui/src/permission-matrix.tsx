'use client';

import type { Icon } from '@phosphor-icons/react';
import { tileTones, type TileTone } from './tones';

export interface PermissionRow {
  id: string;
  label: string;
  /** Create Staff shows a tinted icon tile per module; Users & Roles shows none. */
  icon?: Icon;
  tone?: TileTone;
}
export interface PermissionColumn {
  id: string;
  label: string;
}
/** Granted column ids per row id. */
export type PermissionValue = Record<string, readonly string[]>;

export interface ToggleRules {
  columns: readonly PermissionColumn[];
  /** Column needs another ({ create: 'view' }): granting adds it, removing it removes this. */
  requires?: Readonly<Record<string, string>>;
}

/** Turns one cell on or off and keeps the `requires` rules true across the row. */
export function toggleCell(
  value: PermissionValue,
  rowId: string,
  columnId: string,
  on: boolean,
  { requires = {} }: ToggleRules,
): PermissionValue {
  const row = new Set(value[rowId] ?? []);
  if (on) {
    let need: string | undefined = columnId;
    // Follow the chain (manage needs edit needs view), stopping at a loop.
    while (need && !row.has(need)) {
      row.add(need);
      need = requires[need];
    }
  } else {
    const drop = [columnId];
    while (drop.length) {
      const c = drop.pop() as string;
      if (!row.delete(c)) continue;
      for (const [dependent, needed] of Object.entries(requires)) {
        if (needed === c) drop.push(dependent);
      }
    }
  }
  return { ...value, [rowId]: [...row] };
}

/** Full Access: every column on, or all off. */
export function setRowAll(
  value: PermissionValue,
  rowId: string,
  on: boolean,
  { columns }: ToggleRules,
): PermissionValue {
  return { ...value, [rowId]: on ? columns.map((c) => c.id) : [] };
}

export interface PermissionMatrixProps {
  rows: PermissionRow[];
  columns: PermissionColumn[];
  value: PermissionValue;
  onChange?: (next: PermissionValue) => void;
  /** First column's heading: "Module / Page" (Create Staff) or "Module" (Users & Roles). */
  rowHeader?: string;
  /** Adds the "Full Access" column (Create Staff). */
  fullAccess?: boolean | string;
  requires?: Record<string, string>;
  /** Cells that do not apply to a module: shown empty, not as a box. */
  isAvailable?: (rowId: string, columnId: string) => boolean;
  /** Owner's grid, or a member without the right to change it. */
  readOnly?: boolean;
  caption?: string;
  emptyText?: string;
}

const box = 'size-5 cursor-pointer accent-action disabled:cursor-not-allowed';

/** The module × capability grid of checkboxes (Create Staff step 2, Settings > Users & Roles). */
export function PermissionMatrix({
  rows,
  columns,
  value,
  onChange,
  rowHeader = 'Module',
  fullAccess,
  requires,
  isAvailable = () => true,
  readOnly,
  caption = 'Module permissions',
  emptyText = 'No modules to show.',
}: PermissionMatrixProps) {
  const rules = { columns, requires };
  const fullLabel = typeof fullAccess === 'string' ? fullAccess : 'Full Access';
  if (rows.length === 0) {
    return <p className="rounded-lg border border-border p-6 text-sm text-muted">{emptyText}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-table-head">
          <tr>
            <th scope="col" className="px-3 py-3 text-left font-bold text-heading">
              {rowHeader}
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className="border-l border-divider px-3 py-3 text-center font-bold text-heading"
              >
                {c.label}
              </th>
            ))}
            {fullAccess ? (
              <th
                scope="col"
                className="border-l border-divider px-3 py-3 text-center font-bold text-heading"
              >
                {fullLabel}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const granted = new Set(value[row.id] ?? []);
            const all = columns.every((c) => !isAvailable(row.id, c.id) || granted.has(c.id));
            return (
              <tr key={row.id} className="border-t border-divider hover:bg-subtle">
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-heading">
                  <span className="flex items-center gap-3">
                    {row.icon ? (
                      <span
                        className={`flex h-7 w-10 shrink-0 items-center justify-center rounded-md ${tileTones[row.tone ?? 'blue']}`}
                      >
                        <row.icon aria-hidden weight="fill" className="size-4" />
                      </span>
                    ) : null}
                    {row.label}
                  </span>
                </th>
                {columns.map((c) => (
                  <td key={c.id} className="border-l border-divider px-3 py-1.5 text-center">
                    {isAvailable(row.id, c.id) ? (
                      <input
                        type="checkbox"
                        aria-label={`${row.label}: ${c.label}`}
                        checked={granted.has(c.id)}
                        disabled={readOnly}
                        onChange={(e) =>
                          onChange?.(toggleCell(value, row.id, c.id, e.target.checked, rules))
                        }
                        className={box}
                      />
                    ) : (
                      <span className="sr-only">Not available</span>
                    )}
                  </td>
                ))}
                {fullAccess ? (
                  <td className="border-l border-divider px-3 py-1.5 text-center">
                    <input
                      type="checkbox"
                      aria-label={`${row.label}: ${fullLabel}`}
                      checked={all}
                      disabled={readOnly}
                      onChange={(e) =>
                        onChange?.(
                          setRowAll(value, row.id, e.target.checked, {
                            columns: columns.filter((c) => isAvailable(row.id, c.id)),
                          }),
                        )
                      }
                      className={box}
                    />
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
