'use client';

import {
  type IntakeField,
  type IntakeFormDefinition,
  type IntakeScalarField,
  type IntakeUpload,
  US_STATES,
} from '@firmivra/types';
import type { ReactNode } from 'react';
import { ReviewCard, ReviewRows } from './form-blocks';
import type { Fill } from './intake-fields';
import {
  formatCents,
  isMasked,
  type ScreenGrid,
  type ScreenRow,
  type ScreenUpload,
  type ScreenValue,
  type ScreenValues,
  toCents,
} from './intake-values';

const stateName = (code: string) => US_STATES[code as keyof typeof US_STATES] ?? code;
const usDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};
/** Only the last 4 digits of an SSN or EIN are ever shown. */
const lastFour = (v: ScreenValue, kind: 'ssn' | 'ein') => {
  const last4 = isMasked(v) ? v.last4 : typeof v === 'string' ? v.replace(/\D/g, '').slice(-4) : '';
  if (!last4) return '';
  return kind === 'ssn' ? `•••-••-${last4}` : `••-•••${last4}`;
};

function scalarText(f: IntakeScalarField, v: ScreenValue | undefined): string {
  if (v === undefined || v === null || v === '') return '';
  switch (f.type) {
    case 'ssn':
    case 'ein':
      return lastFour(v, f.type);
    case 'currency': {
      const cents = typeof v === 'string' ? toCents(v) : null;
      return cents === null ? String(v) : formatCents(cents);
    }
    case 'yesNo':
      return v === true ? 'Yes' : v === false ? 'No' : '';
    case 'checkbox':
      return v === true ? 'Yes' : '';
    case 'date':
      return typeof v === 'string' ? usDate(v) : '';
    case 'month':
      return typeof v === 'string' ? v.replace(/^(\d{4})-(\d{2})$/, '$2/$1') : '';
    case 'state':
      return Array.isArray(v) ? (v as string[]).map(stateName).join(', ') : stateName(String(v));
    case 'radio':
    case 'select':
    case 'checkboxes': {
      const codes = Array.isArray(v) ? v : [String(v)];
      return codes.map((c) => f.options.find((o) => o.value === c)?.label ?? c).join(', ');
    }
    default:
      return typeof v === 'string' ? v : '';
  }
}

function answerView(
  f: IntakeField,
  v: ScreenValue | undefined,
  fill: Fill,
  uploads: readonly IntakeUpload[],
): ReactNode {
  switch (f.type) {
    case 'info':
      return null;
    case 'upload': {
      const files = uploads.filter((u) => u.slot === f.key);
      const u = v as ScreenUpload | undefined;
      if (files.length) return files.map((file) => file.fileName).join(', ');
      return u?.notAvailable ? `Not available: ${u.reason}` : '';
    }
    case 'grid': {
      const grid = (v ?? {}) as ScreenGrid;
      const lines = f.rows
        .map((row) => {
          const cells = f.columns
            .map((col) => {
              const text = grid[row.key]?.[col.key] ?? '';
              if (!text) return '';
              const cents = col.type === 'currency' ? toCents(text) : null;
              return `${fill(col.label)} ${cents === null ? text : formatCents(cents)}`;
            })
            .filter(Boolean);
          return cells.length ? `${fill(row.label)}: ${cells.join(', ')}` : '';
        })
        .filter(Boolean);
      return lines.length ? (
        <ul>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        ''
      );
    }
    case 'group': {
      const rows = (v ?? []) as ScreenRow[];
      const lines = rows.map((row) =>
        f.fields
          .map((sub) => scalarText(sub, row[sub.key]))
          .filter(Boolean)
          .join(', '),
      );
      return lines.some(Boolean) ? (
        <ol className="list-inside list-decimal">
          {lines.map((line, i) => (
            <li key={rows[i]?.id}>{line}</li>
          ))}
        </ol>
      ) : (
        ''
      );
    }
    default:
      return scalarText(f, v);
  }
}

/**
 * The review step's summary: one card per earlier step the answers show, each with an Edit
 * button that opens that step, its answers by panel (SSNs and EINs as the last 4 only).
 */
export function IntakeReview({
  definition,
  values,
  shownSteps,
  shownFields,
  uploads,
  fill,
  onEdit,
}: {
  definition: IntakeFormDefinition;
  values: ScreenValues;
  shownSteps: ReadonlySet<string>;
  shownFields: ReadonlySet<string>;
  uploads: readonly IntakeUpload[];
  fill: Fill;
  onEdit: (stepKey: string) => void;
}) {
  const steps = definition.steps.filter((s) => !s.review && shownSteps.has(s.key));
  return (
    <div className="space-y-3" data-testid="intake-review">
      {steps.map((step) => (
        <ReviewCard key={step.key} title={fill(step.title)} onEdit={() => onEdit(step.key)}>
          <div className="grid gap-3 lg:grid-cols-2">
            {step.sections.map((section) => {
              const rows = section.fields
                .filter((f) => f.type !== 'info' && shownFields.has(f.key))
                .map((f): [string, ReactNode] => [
                  fill(f.label),
                  answerView(f, values[f.key], fill, uploads),
                ]);
              if (!rows.length) return null;
              return (
                <div key={section.key} className="min-w-0">
                  <h4 className="mb-1 text-xs font-semibold text-heading">{fill(section.title)}</h4>
                  <ReviewRows rows={rows} />
                </div>
              );
            })}
          </div>
        </ReviewCard>
      ))}
    </div>
  );
}
