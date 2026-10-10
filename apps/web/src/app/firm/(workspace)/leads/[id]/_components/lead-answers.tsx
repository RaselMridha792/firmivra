'use client';

import {
  fillIntakeText,
  type IntakeAnswerValue,
  type IntakeField,
  type IntakeScalarField,
  intakeConditionHolds,
  type LeadIntake,
  type LeadUpload,
  shownIntakeKeys,
  US_STATES,
} from '@firmivra/types';
import { Card } from '@firmivra/ui';
import type { ReactNode } from 'react';
import { LeadFile } from './lead-file';

type Texts = { taxYear?: number | null; firmName?: string | null };

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const utcDate = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
const isLast4 = (v: unknown): v is { last4: string } =>
  typeof v === 'object' && v !== null && 'last4' in v;
const state = (code: string) => US_STATES[code as keyof typeof US_STATES] ?? code;

/** One answer as text, or null when there is none. SSNs and EINs only ever arrive as last 4. */
function answerText(field: IntakeScalarField, value: IntakeAnswerValue | undefined) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (isLast4(value))
    return field.type === 'ein' ? `••-•••${value.last4}` : `•••-••-${value.last4}`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const label = (code: string) =>
    'options' in field ? (field.options.find((o) => o.value === code)?.label ?? code) : code;
  if (Array.isArray(value)) {
    const codes = value.filter((v): v is string => typeof v === 'string');
    return codes.map(field.type === 'state' ? state : label).join(', ');
  }
  if (typeof value === 'number') return field.type === 'currency' ? money(value) : String(value);
  if (typeof value !== 'string') return null;
  if (field.type === 'date') return utcDate(value, { dateStyle: 'medium' });
  if (field.type === 'month') return utcDate(`${value}-01`, { month: 'long', year: 'numeric' });
  if (field.type === 'state') return state(value);
  return label(value);
}

const gridCells = (value: IntakeAnswerValue | undefined) =>
  (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<
    string,
    Record<string, number | string | null> | null
  >;
const filled = (cell: number | string | null | undefined) =>
  cell !== null && cell !== undefined && cell !== '';

/** Whether a field has anything to read: an answer, a file, or "doesn't have it". */
function answered(field: IntakeField, value: IntakeAnswerValue | undefined, uploads: LeadUpload[]) {
  switch (field.type) {
    case 'info':
      return false;
    case 'upload':
      return (
        uploads.some((u) => u.slot === field.key) ||
        (typeof value === 'object' &&
          value !== null &&
          'notAvailable' in value &&
          value.notAvailable)
      );
    case 'group':
      return Array.isArray(value) && value.length > 0;
    case 'grid':
      return Object.values(gridCells(value)).some((row) => Object.values(row ?? {}).some(filled));
    default:
      return answerText(field, value) !== null;
  }
}

function Answer({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="break-words text-text">{children}</dd>
    </div>
  );
}

/** One field's answer, or null to leave the field out (no answer, or nothing to read). */
function FieldAnswer({
  leadId,
  field,
  value,
  uploads,
  texts,
}: {
  leadId: string;
  field: IntakeField;
  value: IntakeAnswerValue | undefined;
  uploads: LeadUpload[];
  texts: Texts;
}) {
  const label = fillIntakeText(field.label, texts);
  if (field.type === 'info') return null;
  if (field.type === 'upload') {
    const files = uploads.filter((u) => u.slot === field.key);
    const missing = value && typeof value === 'object' && 'notAvailable' in value ? value : null;
    return (
      <Answer label={label}>
        {files.length ? (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <LeadFile key={file.id} leadId={leadId} file={file} />
            ))}
          </ul>
        ) : null}
        {missing?.notAvailable ? (
          <span className="block text-sm">
            Doesn&apos;t have this document{missing.reason ? `: ${missing.reason}` : '.'}
          </span>
        ) : null}
      </Answer>
    );
  }
  if (field.type === 'group') {
    const rows = Array.isArray(value)
      ? value.filter((r) => typeof r === 'object' && r !== null)
      : [];
    return (
      <div className="flex flex-col gap-3 sm:col-span-2">
        <p className="text-sm font-medium text-text">{label}</p>
        {rows.map((row, index) => {
          const values = row as Record<string, IntakeAnswerValue>;
          return (
            <dl
              key={String(values['id'] ?? index)}
              className="grid gap-3 rounded-control border border-border p-4 sm:grid-cols-2"
            >
              <p className="text-sm font-semibold text-text sm:col-span-2">
                {fillIntakeText(field.itemLabel, texts)} {index + 1}
              </p>
              {field.fields
                .filter((sub) => intakeConditionHolds(sub.showIf, values))
                .map((sub) => {
                  const text = answerText(sub, values[sub.key]);
                  return text === null ? null : (
                    <Answer key={sub.key} label={fillIntakeText(sub.label, texts)}>
                      {text}
                    </Answer>
                  );
                })}
            </dl>
          );
        })}
      </div>
    );
  }
  if (field.type === 'grid') {
    const cells = gridCells(value);
    const rows = field.rows.filter((r) => Object.values(cells[r.key] ?? {}).some(filled));
    return (
      <div className="flex min-w-0 flex-col gap-2 sm:col-span-2">
        <p className="text-sm text-muted">{label}</p>
        <div className="overflow-x-auto rounded-control border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Row</span>
                </th>
                {field.columns.map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-2 font-medium">
                    {fillIntakeText(column.label, texts)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <th scope="row" className="px-3 py-2 text-left font-normal text-muted">
                    {fillIntakeText(row.label, texts)}
                  </th>
                  {field.columns.map((column) => {
                    const cell = cells[row.key]?.[column.key];
                    return (
                      <td key={column.key} className="px-3 py-2">
                        {!filled(cell)
                          ? '—'
                          : column.type === 'currency' && typeof cell === 'number'
                            ? money(cell)
                            : column.type === 'date' && typeof cell === 'string'
                              ? utcDate(cell, { dateStyle: 'medium' })
                              : String(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return <Answer label={label}>{answerText(field, value)}</Answer>;
}

/**
 * The intake as the visitor sent it, step by step, in the form's own order and labels. Only the
 * fields the answers show, and only those answered. Files sit under their upload field; files of
 * a slot the form no longer has are listed at the end.
 */
export function LeadAnswers({
  leadId,
  intake,
  texts,
}: {
  leadId: string;
  intake: LeadIntake;
  texts: Texts;
}) {
  const { definition, answers, uploads } = intake;
  const shown = shownIntakeKeys(definition, answers);
  const slots = new Set(
    definition.steps.flatMap((s) => s.sections.flatMap((x) => x.fields.map((f) => f.key))),
  );
  const loose = uploads.filter((u) => !slots.has(u.slot) || !shown.fields.has(u.slot));
  return (
    <div className="flex flex-col gap-4">
      {definition.steps
        .filter((step) => shown.steps.has(step.key))
        .map((step) => {
          const sections = step.sections
            .map((section) => ({
              section,
              fields: section.fields.filter(
                (field) =>
                  shown.fields.has(field.key) && answered(field, answers[field.key], uploads),
              ),
            }))
            .filter(({ fields }) => fields.length > 0);
          if (!sections.length) return null;
          return (
            <Card key={step.key} title={fillIntakeText(step.title, texts)}>
              <div className="flex flex-col gap-6">
                {sections.map(({ section, fields }) => (
                  <section key={section.key} className="flex flex-col gap-3">
                    {/* A section named like its step needs no second heading. */}
                    {section.title === step.title ? null : (
                      <h3 className="font-semibold text-text">
                        {fillIntakeText(section.title, texts)}
                      </h3>
                    )}
                    <dl className="grid gap-4 sm:grid-cols-2">
                      {fields.map((field) => (
                        <FieldAnswer
                          key={field.key}
                          leadId={leadId}
                          field={field}
                          value={answers[field.key]}
                          uploads={uploads}
                          texts={texts}
                        />
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            </Card>
          );
        })}
      {loose.length ? (
        <Card title="Other files">
          <ul className="flex flex-col gap-2">
            {loose.map((file) => (
              <LeadFile key={file.id} leadId={leadId} file={file} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
