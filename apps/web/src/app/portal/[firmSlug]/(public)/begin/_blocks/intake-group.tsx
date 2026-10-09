'use client';

import { type IntakeGroupField, intakeConditionHolds } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { type Fill, ScalarInput } from './intake-fields';
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
}: {
  field: IntakeGroupField;
  rows: ScreenRow[];
  onChange: (rows: ScreenRow[]) => void;
  errors: Readonly<Record<string, string>>;
  fill: Fill;
}) {
  const item = fill(field.itemLabel);
  const setCell = (index: number, key: string, v: ScreenScalar) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: v } : row)));
  const groupError = errors[issueKey([field.key])];
  return (
    <div className="min-w-0 space-y-2" data-group={field.key} data-rows={rows.length}>
      <p className="text-xs font-medium text-firm-primary">
        {fill(field.label)}
        {field.required ? ' *' : ''}
      </p>
      {field.help && <p className="text-xs text-muted">{fill(field.help)}</p>}
      {rows.map((row, index) => (
        <details
          key={row.id}
          open
          data-testid={`${field.key}-${index + 1}`}
          className="rounded-control border border-folder-border"
        >
          <summary className="flex cursor-pointer items-center gap-2 rounded-t-control bg-folder-surface px-2 py-1 text-xs font-semibold text-heading">
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
        </details>
      ))}
      {groupError && <p className="text-xs text-danger">{groupError}</p>}
      {rows.length < field.maxItems && (
        <Button
          variant="outline"
          onClick={() => onChange([...rows, emptyRow(field.fields)])}
          className="w-full border-dashed text-xs! sm:min-h-7!"
        >
          <Plus aria-hidden="true" className="size-4" />
          {fill(field.addLabel)}
        </Button>
      )}
    </div>
  );
}
