'use client';

import {
  type IntakeField,
  type IntakeFormDefinition,
  type IntakeScalarField,
  type IntakeUpload,
  US_STATES,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import { ReviewCard, ReviewRows, SectionPanel } from './form-blocks';
import type { Fill } from './intake-fields';
import { type FormLook, fullRows } from './intake-layout';
import { units } from './intake-rows';
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
      const cell = (text: string, type: string) => {
        if (!text) return '';
        if (type === 'date') return usDate(text);
        const cents = type === 'currency' ? toCents(text) : null;
        return cents === null ? text : formatCents(cents);
      };
      const rows = f.rows.filter((row) => f.columns.some((col) => grid[row.key]?.[col.key]));
      if (!rows.length) return '';
      return (
        <AnswerTable
          head={['', ...f.columns.map((col) => fill(col.label))]}
          rows={rows.map((row) => ({
            key: row.key,
            cells: [
              fill(row.label),
              ...f.columns.map((col) => cell(grid[row.key]?.[col.key] ?? '', col.type)),
            ],
          }))}
        />
      );
    }
    case 'group': {
      // The mockups' tables (Dependents...): a column per field (the name's parts as one, the
      // tick boxes as "Other Details"), a row per entry.
      const rows = ((v ?? []) as ScreenRow[]).filter((row) =>
        f.fields.some((sub) => scalarText(sub, row[sub.key])),
      );
      if (!rows.length) return '';
      const ticks = f.fields.filter((sub) => sub.type === 'checkbox');
      const columns = units(f.fields.filter((sub) => sub.type !== 'checkbox'));
      const cellOf = (unit: (typeof columns)[number], row: ScreenRow) =>
        unit.kind === 'field'
          ? scalarText(unit.field as IntakeScalarField, row[unit.key])
          : (unit.kind === 'name' ? unit.parts : [unit.street, ...unit.rest])
              .map((part) => scalarText(part as IntakeScalarField, row[part.key]))
              .filter(Boolean)
              .join(unit.kind === 'name' ? ' ' : ', ');
      return (
        <AnswerTable
          head={[
            ...columns.map((u) =>
              u.kind === 'name' ? 'Name' : u.kind === 'address' ? 'Address' : fill(u.field.label),
            ),
            ...(ticks.length ? ['Other Details'] : []),
          ]}
          rows={rows.map((row) => ({
            key: row.id,
            cells: [
              ...columns.map((u) => cellOf(u, row)),
              ...(ticks.length
                ? [
                    ticks
                      .filter((t) => row[t.key] === true)
                      .map((t) => fill(t.label))
                      .join(', ') || 'N/A',
                  ]
                : []),
            ],
          }))}
        />
      );
    }
    default:
      return scalarText(f, v);
  }
}

/** A small table inside a review row (a group's entries, a grid's filled rows). */
function AnswerTable({ head, rows }: { head: string[]; rows: { key: string; cells: string[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead className="bg-folder-surface">
          <tr>
            {head.map((h, i) => (
              <th
                key={`${h}-${String(i)}`}
                scope="col"
                className="px-2 py-1 font-semibold text-heading"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-folder-border">
              {row.cells.map((c, i) => (
                <td key={`${String(i)}-${c}`} className="px-2 py-1 align-top">
                  {c || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A section's answers as review rows: a name or an address on one row, as entered together. */
function sectionRows(
  fields: IntakeField[],
  values: ScreenValues,
  fill: Fill,
  uploads: readonly IntakeUpload[],
  /** A table named like its card shows no label of its own. */
  title: string,
): [string, ReactNode, string, boolean][] {
  return units(fields).map((unit): [string, ReactNode, string, boolean] => {
    if (unit.kind === 'field') {
      const f = unit.field;
      const wide = f.type === 'group' || f.type === 'grid';
      return [
        wide && fill(f.label) === title ? '' : fill(f.label),
        answerView(f, values[f.key], fill, uploads),
        f.key,
        wide,
      ];
    }
    const parts = unit.kind === 'name' ? unit.parts : [unit.street, ...unit.rest];
    const text = parts
      .map((part) => scalarText(part as IntakeScalarField, values[part.key]))
      .filter(Boolean)
      .join(unit.kind === 'name' ? ' ' : ', ');
    const label = unit.kind === 'name' ? 'Full Name' : fill(unit.street.label);
    return [label, text, unit.key, false];
  });
}

/**
 * The review step's summary as its mockup draws it: the step's own heading with "Edit
 * Information", then a card per panel the answers show (two to a row), each with an Edit button
 * that opens its step. SSNs and EINs show as the last 4 only.
 */
export function IntakeReview({
  definition,
  values,
  shownSteps,
  shownFields,
  uploads,
  fill,
  onEdit,
  look,
  heading,
}: {
  definition: IntakeFormDefinition;
  values: ScreenValues;
  shownSteps: ReadonlySet<string>;
  shownFields: ReadonlySet<string>;
  uploads: readonly IntakeUpload[];
  fill: Fill;
  onEdit: (stepKey: string) => void;
  look: FormLook;
  /** The step's number and subtitle for its "Review Your Information" heading. */
  heading?: { number: number; subtitle: string | undefined } | undefined;
}) {
  const steps = definition.steps.filter((s) => !s.review && shownSteps.has(s.key));
  const cards = steps.flatMap((step) =>
    step.sections.flatMap((section) => {
      const fields = section.fields.filter((f) => f.type !== 'info' && shownFields.has(f.key));
      if (!fields.length) return [];
      const panel = look.panels[section.key];
      const wide = fields.some(
        (f) => f.type === 'grid' || (f.type === 'group' && f.fields.length > 6),
      );
      return [
        {
          step,
          section,
          title: fill(section.title),
          icon: panel?.icon ?? panel?.badge,
          fields,
          wide,
        },
      ];
    }),
  );
  const first = steps[0];
  const span = fullRows(cards.map((c) => c.wide));
  return (
    <div className="space-y-3" data-testid="intake-review">
      {heading && first && (
        <SectionPanel
          number={heading.number}
          title="Review Your Information"
          subtitle={heading.subtitle}
          size="intro"
          action={
            <Button
              variant="outline"
              onClick={() => onEdit(first.key)}
              className="min-h-9! gap-2! px-4! text-sm!"
            >
              <Pencil aria-hidden="true" className="size-4" />
              Edit Information
            </Button>
          }
        >
          {null}
        </SectionPanel>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {cards.map(({ step, section, title, icon: Icon, fields }, i) => (
          <ReviewCard
            key={section.key}
            title={title}
            icon={Icon ? <Icon aria-hidden="true" className="size-8 fill-accent-soft" /> : null}
            onEdit={() => onEdit(step.key)}
            className={span[i] ? 'lg:col-span-2' : ''}
          >
            <ReviewRows rows={sectionRows(fields, values, fill, uploads, title)} />
          </ReviewCard>
        ))}
      </div>
    </div>
  );
}
