'use client';

import {
  type IntakeGroupField,
  type IntakeScalarField,
  intakeConditionHolds,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { ChevronDown, Info, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { type Fill, ScalarInput } from './intake-fields';
import type { RowsLook } from './intake-layout';
import { FieldRows } from './intake-rows';
import { emptyRow, issueKey, type ScreenRow, type ScreenScalar } from './intake-values';

/**
 * A group field: repeating rows of the same fields ("Dependent 1", "+ Add Another Dependent").
 * A row's field can depend on another field in the same row (showIf).
 */
export function GroupInput({
  field,
  rows,
  onChange,
  errors,
  fill,
  look,
}: {
  field: IntakeGroupField;
  rows: ScreenRow[];
  onChange: (rows: ScreenRow[]) => void;
  errors: Readonly<Record<string, string>>;
  fill: Fill;
  /** The rows its mockup draws a row's fields in; the group's own label is then left out. */
  look?: RowsLook | undefined;
}) {
  const item = fill(field.itemLabel);
  const setCell = (index: number, key: string, v: ScreenScalar) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: v } : row)));
  const groupError = errors[issueKey([field.key])];
  // A required group opens with its first row, as its mockup shows it ("Dependent 1").
  const needsRow = look !== undefined && field.required && rows.length === 0;
  const bare = look?.bare === true && rows.length === 1;
  useEffect(() => {
    if (needsRow) onChange([emptyRow(field.fields)]);
  }, [needsRow, onChange, field.fields]);
  if (look?.table) {
    return (
      <div className="min-w-0 space-y-2" data-group={field.key} data-rows={rows.length}>
        {/* With a help line the table has its own heading and note (Business Assets). */}
        {field.help ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="font-display text-lg font-bold text-heading">{fill(field.label)}</p>
            <p className="flex min-w-48 flex-1 items-start gap-2 rounded-control bg-folder-surface px-2 py-1 text-xs">
              <Info aria-hidden="true" className="size-5 shrink-0 fill-action text-surface" />
              {fill(field.help)}
            </p>
          </div>
        ) : (
          <p className="sr-only">{fill(field.label)}</p>
        )}
        <div className="relative overflow-x-auto rounded-control border border-folder-border">
          <table className="w-full min-w-xl border-collapse text-left text-xs lg:min-w-0">
            <thead className="bg-folder-surface text-heading">
              <tr>
                {field.fields.map((sub) => (
                  <th key={sub.key} scope="col" className="px-2 py-1 font-semibold">
                    {fill(sub.label)}
                    {sub.required ? '\u00a0*' : ''}
                  </th>
                ))}
                <th scope="col" className="w-8">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  data-testid={`${field.key}-${index + 1}`}
                  className="border-t border-folder-border"
                >
                  {field.fields.map((sub) => (
                    <td key={sub.key} className="px-1 py-1 align-middle">
                      {intakeConditionHolds(sub.showIf, row) && (
                        <ScalarInput
                          field={sub}
                          name={`${field.key}-${row.id}-${sub.key}`}
                          value={row[sub.key] ?? null}
                          onChange={(v) => setCell(index, sub.key, v)}
                          error={errors[issueKey([field.key, index, sub.key])]}
                          fill={fill}
                          look={{ quiet: true, ...(sub.type === 'yesNo' ? { row: true } : {}) }}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1">
                    {rows.length > field.minItems && (
                      <Button
                        variant="ghost"
                        aria-label={`Remove ${item.toLowerCase()} ${index + 1}`}
                        onClick={() => onChange(rows.filter((_, i) => i !== index))}
                        className="min-h-7! px-1! py-1!"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {groupError && <p className="text-xs text-danger">{groupError}</p>}
        {rows.length < field.maxItems && (
          <Button
            variant="outline"
            onClick={() => onChange([...rows, emptyRow(field.fields)])}
            className="w-full border-heading! text-xs! text-heading! sm:min-h-8!"
          >
            <Plus aria-hidden="true" className="size-4" />
            {fill(field.addLabel)}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="min-w-0 space-y-2" data-group={field.key} data-rows={rows.length}>
      <p className={look ? 'sr-only' : 'text-xs font-medium text-firm-primary'}>
        {fill(field.label)}
        {field.required ? ' *' : ''}
      </p>
      {field.help && <p className="text-xs text-muted">{fill(field.help)}</p>}
      {rows.map((row, index) => (
        <details
          key={row.id}
          open
          data-testid={`${field.key}-${index + 1}`}
          className={bare ? '' : 'rounded-control border border-folder-border'}
        >
          <summary
            className={`flex cursor-pointer items-center gap-2 rounded-t-control bg-folder-surface px-2 py-1 text-xs font-semibold text-heading ${bare ? 'sr-only' : ''}`}
          >
            <ChevronDown aria-hidden="true" className="size-4" />
            {item} {index + 1}
            {rows.length > field.minItems && (
              <Button
                variant="ghost"
                aria-label={`Remove ${item.toLowerCase()} ${index + 1}`}
                onClick={(event) => {
                  event.preventDefault();
                  onChange(rows.filter((_, i) => i !== index));
                }}
                className="ml-auto min-h-7! px-1! py-1!"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            )}
          </summary>
          {look ? (
            <div className={bare ? '' : 'p-2'}>
              <FieldRows
                fields={field.fields.filter((sub) => intakeConditionHolds(sub.showIf, row))}
                look={look}
                render={(sub, fieldLook) => (
                  <ScalarInput
                    // A group's fields are all scalar (IntakeGroupField).
                    field={sub as IntakeScalarField}
                    name={`${field.key}-${row.id}-${sub.key}`}
                    value={row[sub.key] ?? null}
                    onChange={(v) => setCell(index, sub.key, v)}
                    error={errors[issueKey([field.key, index, sub.key])]}
                    fill={fill}
                    look={fieldLook}
                  />
                )}
              />
            </div>
          ) : (
            <div className="grid gap-2 p-2 sm:grid-cols-2">
              {field.fields
                .filter((sub) => intakeConditionHolds(sub.showIf, row))
                .map((sub) => (
                  <div
                    key={sub.key}
                    className={
                      sub.type === 'textarea' || sub.type === 'checkboxes' ? 'sm:col-span-2' : ''
                    }
                  >
                    <ScalarInput
                      field={sub}
                      name={`${field.key}-${row.id}-${sub.key}`}
                      value={row[sub.key] ?? null}
                      onChange={(v) => setCell(index, sub.key, v)}
                      error={errors[issueKey([field.key, index, sub.key])]}
                      fill={fill}
                    />
                  </div>
                ))}
            </div>
          )}
        </details>
      ))}
      {groupError && <p className="text-xs text-danger">{groupError}</p>}
      {rows.length < field.maxItems && (
        <div className={look?.bare ? 'flex justify-end' : ''}>
          <Button
            variant="outline"
            onClick={() => onChange([...rows, emptyRow(field.fields)])}
            className={`w-full border-dashed text-xs! sm:min-h-7! ${look?.bare ? 'sm:w-1/3' : ''}`}
          >
            <Plus aria-hidden="true" className="size-4" />
            {fill(field.addLabel)}
          </Button>
        </div>
      )}
    </div>
  );
}
