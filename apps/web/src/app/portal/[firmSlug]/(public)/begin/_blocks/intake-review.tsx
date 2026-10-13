'use client';

import {
  type IntakeField,
  type IntakeFormDefinition,
  type IntakeScalarField,
  type IntakeUpload,
  US_STATES,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import {
  ChevronDown,
  CircleCheck,
  ClipboardList,
  CloudUpload,
  FileText,
  Pencil,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ReviewCard, ReviewRows, SectionPanel } from './form-blocks';
import type { Fill } from './intake-fields';
import { type FormLook, fullRows, type ReviewLook } from './intake-layout';
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
    <div className="relative overflow-x-auto">
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
  const steps = definition.steps.filter(
    (s) => !s.review && shownSteps.has(s.key) && !look.review?.skipSteps?.includes(s.key),
  );
  if (look.review?.collapsed) {
    const titles = look.review.titles;
    return (
      <div className="grid content-start gap-3" data-testid="intake-review">
        <SectionPanel
          number={titles ? 1 : undefined}
          numberInTitle
          title={titles?.answers ?? 'Review Your Information'}
          subtitle={titles?.answersNote}
          badge={<ClipboardList className="size-6" />}
          badgeDark
        >
          <div className="grid gap-2">
            {(
              look.review.rows ??
              steps.map((step) => ({ title: '', sections: step.sections.map((s) => s.key) }))
            ).map((row) => {
              const step = steps.find((st) => st.sections.some((s) => s.key === row.sections[0]));
              if (!step) return null;
              const sections = steps.flatMap((st) =>
                st.sections.filter((s) => row.sections.includes(s.key)),
              );
              return (
                <StepRow
                  key={row.sections.join('|')}
                  title={row.title || fill(step.title)}
                  note={look.review?.rows ? undefined : look.review?.notes?.[step.key]}
                  icon={look.review?.rows ? undefined : look.review?.icons?.[step.key]}
                  onEdit={() => onEdit(step.key)}
                  rows={lineRows(
                    sections.flatMap((s) =>
                      s.fields.filter((f) => f.type !== 'info' && shownFields.has(f.key)),
                    ),
                    values,
                    fill,
                    uploads,
                  )}
                />
              );
            })}
          </div>
        </SectionPanel>
        {titles?.files && (
          <FileRows
            definition={definition}
            uploads={uploads}
            fill={fill}
            onEdit={onEdit}
            title={titles.files}
            note={titles.filesNote}
          />
        )}
      </div>
    );
  }
  if (look.review?.byStep) {
    return (
      <div className="grid content-start gap-3" data-testid="intake-review">
        {steps.map((step, i) => (
          <StepCard
            key={step.key}
            title={fill(step.title)}
            index={i}
            review={look.review!}
            icon={look.review?.icons?.[step.key]}
            onEdit={() => onEdit(step.key)}
            rows={lineRows(
              step.sections.flatMap((s) =>
                s.fields.filter((f) => f.type !== 'info' && shownFields.has(f.key)),
              ),
              values,
              fill,
              uploads,
            )}
          />
        ))}
      </div>
    );
  }
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

/** The coloured title bands of a banded review, in turn (whole classes, so Tailwind finds them). */
const BANDS = [
  'bg-navigation text-on-action',
  'bg-action text-on-action',
  'bg-info text-on-action',
];

/** A step's answers as "Label: answer" lines: a table's filled cells and a group's rows each a line. */
function lineRows(
  fields: IntakeField[],
  values: ScreenValues,
  fill: Fill,
  uploads: readonly IntakeUpload[],
): [string, string, string][] {
  return units(fields).flatMap((unit): [string, string, string][] => {
    if (unit.kind !== 'field') {
      const parts = unit.kind === 'name' ? unit.parts : [unit.street, ...unit.rest];
      const text = parts
        .map((part) => scalarText(part as IntakeScalarField, values[part.key]))
        .filter(Boolean)
        .join(unit.kind === 'name' ? ' ' : ', ');
      return [[unit.key, unit.kind === 'name' ? 'Full Name' : fill(unit.street.label), text]];
    }
    const f = unit.field;
    const v = values[f.key];
    if (f.type === 'grid') {
      const grid = (v ?? {}) as ScreenGrid;
      return f.rows.flatMap((row) =>
        f.columns.flatMap((col): [string, string, string][] => {
          const text = grid[row.key]?.[col.key] ?? '';
          if (!text) return [];
          const cents = col.type === 'currency' ? toCents(text) : null;
          const shown =
            col.type === 'date' ? usDate(text) : cents === null ? text : formatCents(cents);
          const name =
            f.columns.length > 1 ? `${fill(row.label)} ${fill(col.label)}` : fill(row.label);
          return [[`${f.key}.${row.key}.${col.key}`, name, shown]];
        }),
      );
    }
    if (f.type === 'group') {
      const rows = (v ?? []) as ScreenRow[];
      return rows.flatMap((row, i) =>
        f.fields.flatMap((sub): [string, string, string][] => {
          const text = scalarText(sub, row[sub.key]);
          if (!text) return [];
          const name =
            rows.length > 1 ? `${fill(f.itemLabel)} ${i + 1}: ${fill(sub.label)}` : fill(sub.label);
          return [[`${f.key}.${row.id}.${sub.key}`, name, text]];
        }),
      );
    }
    if (f.type === 'upload') {
      const view = answerView(f, v, fill, uploads);
      return [[f.key, fill(f.label), typeof view === 'string' ? view : '']];
    }
    if (f.type === 'info') return [];
    return [[f.key, fill(f.label), scalarText(f, v)]];
  });
}

/** One step's answers under a title band (or a plain title), with its Edit button. */
function StepCard({
  title,
  index,
  review,
  icon: Icon,
  onEdit,
  rows,
}: {
  title: string;
  index: number;
  review: ReviewLook;
  icon: LucideIcon | undefined;
  onEdit: () => void;
  rows: [string, string, string][];
}) {
  const band = review.banded ? BANDS[index % BANDS.length] : 'text-heading';
  return (
    <section className="min-w-0 overflow-hidden rounded-card border border-folder-border bg-surface">
      <header className={`flex items-center gap-3 px-3 py-2 ${band}`}>
        {Icon && <Icon aria-hidden="true" className="size-7 shrink-0" />}
        <h3 className="min-w-0 flex-1 font-display text-xl font-bold">{title}</h3>
        <Button
          variant="outline"
          onClick={onEdit}
          aria-label={`Edit ${title}`}
          className="min-h-8! gap-1! border-surface! bg-surface! px-3! py-1! text-xs! text-heading!"
        >
          <Pencil aria-hidden="true" className="size-3" />
          Edit
        </Button>
      </header>
      <dl className="space-y-1 p-3 text-sm">
        {rows.map(([id, label, text]) => (
          <div key={id} className="flex gap-3">
            <dt className="w-2/5 shrink-0 text-firm-primary">{label}:</dt>
            <dd className="min-w-0 flex-1 break-words text-text">{text || 'N/A'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Every file of the form, as the review's "Uploaded Supporting Documents" card lists them. */
export function UploadedFiles({
  definition,
  uploads,
  fill,
  onEdit,
}: {
  definition: IntakeFormDefinition;
  uploads: readonly IntakeUpload[];
  fill: Fill;
  onEdit: (stepKey: string) => void;
}) {
  const slots = new Map(
    definition.steps.flatMap((step) =>
      step.sections.flatMap((s) =>
        s.fields.flatMap((f) => (f.type === 'upload' ? [[f.key, { step, f }] as const] : [])),
      ),
    ),
  );
  const firstStep = uploads.map((u) => slots.get(u.slot)?.step).find((s) => s && !s.review);
  return (
    <section className="min-w-0 rounded-card border border-folder-border bg-surface p-3">
      <header className="mb-2 flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-heading text-on-action">
          <CloudUpload aria-hidden="true" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold text-heading">
            Uploaded Supporting Documents
          </h3>
          <p className="text-xs text-firm-primary">
            Please review the documents you have uploaded. You can add more if needed.
          </p>
        </div>
        {firstStep && (
          <Button
            variant="outline"
            onClick={() => onEdit(firstStep.key)}
            aria-label="Edit Uploaded Supporting Documents"
            className="min-h-8! gap-1! px-3! py-1! text-xs!"
          >
            <Pencil aria-hidden="true" className="size-3" />
            Edit
          </Button>
        )}
      </header>
      {uploads.length ? (
        <div className="max-h-56 overflow-auto rounded-control border border-folder-border">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-folder-surface text-heading">
              <tr>
                <th scope="col" className="px-2 py-1 font-semibold">
                  File Name
                </th>
                <th scope="col" className="px-2 py-1 font-semibold">
                  Document Type
                </th>
                <th scope="col" className="px-2 py-1 font-semibold">
                  Date Uploaded
                </th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id} className="border-t border-folder-border">
                  <td className="px-2 py-1 break-all">{u.fileName}</td>
                  <td className="px-2 py-1">{fill(slots.get(u.slot)?.f.label ?? u.slot)}</td>
                  <td className="px-2 py-1">{usDate(u.uploadedAt.slice(0, 10))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted">No documents uploaded yet.</p>
      )}
    </section>
  );
}

/** The accent "Review & Submit" band over the agreement, with the step's subtitle under it. */
export function SubmitBand({ title, subtitle }: { title: string; subtitle: string | undefined }) {
  return (
    <div>
      <p className="flex items-center gap-3 rounded-card bg-action px-3 py-2 text-on-action">
        <CircleCheck aria-hidden="true" className="size-8 shrink-0" />
        <span className="font-display text-2xl font-bold">{title}</span>
      </p>
      {subtitle && <p className="mt-2 px-3 text-sm text-firm-primary">{subtitle}</p>}
    </div>
  );
}

/** One step as a row that opens to its answers: icon, title, a line on what it holds, Edit. */
function StepRow({
  title,
  note,
  icon: Icon,
  onEdit,
  rows,
}: {
  title: string;
  note: string | undefined;
  icon: LucideIcon | undefined;
  onEdit: () => void;
  rows: [string, string, string][];
}) {
  return (
    <details className="group rounded-control border border-folder-border bg-folder-surface">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
        {Icon && <Icon aria-hidden="true" className="size-8 shrink-0 fill-current text-heading" />}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base font-bold text-info">{title}</span>
          {note && <span className="block text-xs text-text">{note}</span>}
        </span>
        <Button
          variant="outline"
          onClick={(event) => {
            event.preventDefault();
            onEdit();
          }}
          aria-label={`Edit ${title}`}
          className="min-h-8! px-4! py-1! text-xs!"
        >
          Edit
        </Button>
        <ChevronDown
          aria-hidden="true"
          className="size-5 shrink-0 text-info transition-transform group-open:rotate-180"
        />
      </summary>
      <dl className="space-y-1 border-t border-folder-border bg-surface p-3 text-sm">
        {rows.map(([id, label, text]) => (
          <div key={id} className="flex gap-3">
            <dt className="w-2/5 shrink-0 text-firm-primary">{label}:</dt>
            <dd className="min-w-0 flex-1 break-words text-text">{text || 'N/A'}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The files as a list: the document's name, the file, the date and a button to its step. */
function FileRows({
  definition,
  uploads,
  fill,
  onEdit,
  title,
  note,
}: {
  definition: IntakeFormDefinition;
  uploads: readonly IntakeUpload[];
  fill: Fill;
  onEdit: (stepKey: string) => void;
  title: string;
  note: string | undefined;
}) {
  const slots = new Map(
    definition.steps.flatMap((step) =>
      step.sections.flatMap((s) =>
        s.fields.flatMap((f) => (f.type === 'upload' ? [[f.key, { step, f }] as const] : [])),
      ),
    ),
  );
  return (
    <SectionPanel
      number={2}
      numberInTitle
      title={title}
      subtitle={note}
      badge={<FileText className="size-6" />}
      badgeDark
    >
      {uploads.length ? (
        <ul className="grid gap-2">
          {uploads.map((u) => {
            const slot = slots.get(u.slot);
            return (
              <li
                key={u.id}
                className="flex flex-wrap items-center gap-3 rounded-control border border-folder-border p-2 text-xs"
              >
                <FileText aria-hidden="true" className="size-6 shrink-0 text-heading" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-sm font-bold text-info">
                    {fill(slot?.f.label ?? u.slot)}
                  </span>
                  <span className="block break-all">{u.fileName}</span>
                </span>
                <span>Uploaded {usDate(u.uploadedAt.slice(0, 10))}</span>
                {slot && !slot.step.review && (
                  <Button
                    variant="outline"
                    onClick={() => onEdit(slot.step.key)}
                    aria-label={`Replace ${u.fileName}`}
                    className="min-h-8! px-3! py-1! text-xs!"
                  >
                    Replace
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted">No documents uploaded yet.</p>
      )}
    </SectionPanel>
  );
}
