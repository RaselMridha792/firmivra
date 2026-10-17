'use client';

import type {
  IntakeAnswers,
  IntakeField,
  IntakeGridField,
  IntakeGroupField,
  IntakeSection,
} from '@firmivra/types';
import { tileTones, type TileTone } from '@firmivra/ui';
import { PencilSimple, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Quiet, SHORT_LABEL, answerText, isPlain } from './detail-shared';

/** A card of the submission: a round tinted icon, a bold title and an Edit link on the right. */
export function InfoCard({
  icon: Glyph,
  tone = 'blue',
  title,
  children,
  testId,
  edit = true,
}: {
  icon: Icon;
  tone?: TileTone;
  title: string;
  children: ReactNode;
  testId?: string;
  edit?: boolean;
}) {
  return (
    <section className="min-w-0 rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={`flex size-11 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
          >
            <Glyph weight="fill" className="size-6" />
          </span>
          <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
        </div>
        {edit ? (
          <span
            title="Answers are changed by the client. Use Request Revision to send the form back."
            className="inline-flex items-center gap-1 text-sm text-muted"
          >
            <PencilSimple aria-hidden weight="fill" className="size-4" /> Edit
          </span>
        ) : null}
      </header>
      {children}
    </section>
  );
}

/** Label and value rows. A missing answer reads "Not provided". */
export function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,40%)_1fr] gap-x-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="border-b border-divider py-2 text-text">{label}</dt>
          <dd className="border-b border-divider py-2 whitespace-pre-line text-heading">
            {value || <span className="text-muted">Not provided</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Yes and No as the green and grey pills of the Deductions & Credits card. */
export function YesNo({ value }: { value: string }) {
  return (
    <span
      className={`inline-flex min-w-10 justify-center rounded-md px-2 py-0.5 text-xs font-semibold ${value === 'Yes' ? 'bg-success-soft text-success' : 'bg-disabled text-muted'}`}
    >
      {value}
    </span>
  );
}

/** The plain fields of a section as rows; a yes or no answer is a pill. */
export function SectionRows({
  section,
  answers,
  only,
  short,
}: {
  section: IntakeSection;
  answers: IntakeAnswers;
  only?: string[];
  /** Use the short names of the Overview cards. */
  short?: boolean;
}) {
  const fields = section.fields.filter(
    (f: IntakeField) => isPlain(f) && (!only || only.includes(f.key)),
  );
  return (
    <Rows
      rows={fields.map((f) => {
        const text = answerText(f, answers[f.key]);
        return [
          short ? (SHORT_LABEL[f.key] ?? f.label) : f.label,
          f.type === 'yesNo' && text ? <YesNo key={f.key} value={text} /> : text,
        ] as [string, ReactNode];
      })}
    />
  );
}

/** A repeating group (Dependents, Businesses) as a table of its rows. */
export function GroupTable({
  field,
  answers,
  columns,
}: {
  field: IntakeGroupField;
  answers: IntakeAnswers;
  columns?: string[];
}) {
  const rows = Array.isArray(answers[field.key])
    ? (answers[field.key] as Record<string, unknown>[])
    : [];
  const shown = columns
    ? columns.flatMap((key) => field.fields.filter((f) => f.key === key))
    : field.fields;
  const head = (key: string, label: string) =>
    key === 'firstName' ? 'Name' : key === 'relationship' ? 'Relationship' : label;
  if (rows.length === 0) return <Quiet>No {field.itemLabel.toLowerCase()} entered.</Quiet>;
  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full text-left text-sm">
        <thead className="bg-table-head text-heading">
          <tr>
            {shown.map((f) => (
              <th key={f.key} className="px-3 py-2 font-semibold">
                {head(f.key, f.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row['id'])} className="border-t border-divider">
              {shown.map((f) => (
                <td key={f.key} className="px-3 py-2 text-heading">
                  {(f.key === 'firstName'
                    ? ['firstName', 'middleName', 'lastName']
                        .map((k) => String(row[k] ?? ''))
                        .filter(Boolean)
                        .join(' ')
                    : answerText(f, row[f.key] as IntakeAnswers[string])) || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A grid of amounts (business income, expenses) as a table. */
export function GridTable({ field, answers }: { field: IntakeGridField; answers: IntakeAnswers }) {
  const value = (answers[field.key] ?? {}) as Record<string, Record<string, unknown> | null>;
  const has = Object.values(value).some((r) => r && Object.keys(r).length > 0);
  if (!has) return <Quiet>Nothing entered in this table.</Quiet>;
  return (
    <div className="overflow-x-auto rounded-lg border border-divider">
      <table className="w-full text-left text-sm">
        <thead className="bg-table-head text-heading">
          <tr>
            <th className="px-3 py-2 font-semibold">&nbsp;</th>
            {field.columns.map((c) => (
              <th key={c.key} className="px-3 py-2 font-semibold">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {field.rows.map((row) => (
            <tr key={row.key} className="border-t border-divider">
              <td className="px-3 py-2 text-heading">{row.label}</td>
              {field.columns.map((c) => {
                const cell = value[row.key]?.[c.key];
                return (
                  <td key={c.key} className="px-3 py-2 text-heading">
                    {typeof cell === 'number'
                      ? (cell / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                      : cell === undefined || cell === null
                        ? '—'
                        : String(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
