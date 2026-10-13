'use client';

import type { IntakeField } from '@firmivra/types';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { type RowsLook, SPAN } from './intake-layout';

/** How a cell asks for one field to be drawn (see intake-fields `ScalarInput`). */
export interface FieldLook {
  /** The label only for screen readers; the placeholder names the field. */
  quiet?: boolean;
  label?: string;
  placeholder?: string;
  /** Yes/No: the question and its answers on one line. */
  row?: boolean;
  /** The label on the left of a one-line input. */
  inline?: boolean;
  /** A tinted box with this icon and the label as its heading. */
  box?: LucideIcon;
  /** An upload as a narrow tile (one of a row of them). */
  tile?: boolean;
  /** A note as a list: its sentences as bullets beside a large icon. */
  list?: boolean;
}

type Unit =
  | { kind: 'field'; key: string; field: IntakeField }
  | { kind: 'name'; key: string; parts: IntakeField[] }
  | { kind: 'address'; key: string; street: IntakeField; rest: IntakeField[] };

const withPrefix = (prefix: string, name: string) =>
  prefix ? `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}` : name;

/**
 * The shown fields as the cells they make, in order: a name's parts (fullName in
 * packages/types) are one cell, and so are an address's street, city, state and ZIP.
 */
function units(fields: IntakeField[]): Unit[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const used = new Set<string>();
  const out: Unit[] = [];
  for (const f of fields) {
    if (used.has(f.key)) continue;
    const name = /^(.*?)(?:firstName|FirstName)$/.exec(f.key);
    const last = name && byKey.get(withPrefix(name[1]!, 'lastName'));
    if (name && last) {
      const middle = byKey.get(withPrefix(name[1]!, 'middleName'));
      const parts = middle ? [f, middle, last] : [f, last];
      for (const p of parts) used.add(p.key);
      out.push({ kind: 'name', key: withPrefix(name[1]!, 'name'), parts });
      continue;
    }
    const street = /^(.*?)(?:street|Street)$/.exec(f.key);
    const rest = street
      ? ['city', 'state', 'zip'].flatMap((n) => byKey.get(withPrefix(street[1]!, n)) ?? [])
      : [];
    if (street && rest.length) {
      for (const p of [f, ...rest]) used.add(p.key);
      out.push({ kind: 'address', key: withPrefix(street[1]!, 'address'), street: f, rest });
      continue;
    }
    used.add(f.key);
    out.push({ kind: 'field', key: f.key, field: f });
  }
  return out;
}

/** A cell: one unit, or several set side by side at their own widths ("a+b+c"). */
type Cell = { units: Unit[]; span: number };

/**
 * "a:8 b:4" → the cells' keys and spans; cells without a span share what is left evenly. A cell
 * "a+b" holds several units, each as wide as its content (a line of tick boxes).
 */
function parseRow(row: string): { keys: string[]; span: number | undefined }[] {
  const cells = row.split(/\s+/).filter(Boolean);
  return cells.map((cell) => {
    const [keys, span] = cell.split(':');
    return { keys: keys!.split('+'), span: span ? Number(span) : undefined };
  });
}

/** The units in rows: a listed row where its first shown unit comes, the rest one to a row. */
function arrange(list: Unit[], rows: string[] = []): Cell[][] {
  const plan = rows.map(parseRow);
  const rowOf = new Map<string, number>();
  plan.forEach((r, i) => r.forEach((c) => c.keys.forEach((k) => rowOf.set(k, i))));
  const byKey = new Map(list.map((u) => [u.key, u]));
  const placed = new Set<number>();
  const out: Cell[][] = [];
  for (const unit of list) {
    const i = rowOf.get(unit.key);
    if (i === undefined) {
      out.push([{ units: [unit], span: 12 }]);
      continue;
    }
    if (placed.has(i)) continue;
    placed.add(i);
    const cells = plan[i]!;
    const fixed = cells.reduce((sum, c) => sum + (c.span ?? 0), 0);
    const even = Math.max(
      1,
      Math.floor((12 - fixed) / Math.max(1, cells.filter((c) => !c.span).length)),
    );
    out.push(
      cells.flatMap((c) => {
        const shown = c.keys.flatMap((k) => byKey.get(k) ?? []);
        return shown.length ? [{ units: shown, span: c.span ?? even }] : [];
      }),
    );
  }
  return out;
}

const required = (f: IntakeField) => ('required' in f && f.required ? ' *' : '');

function UnitCell({
  unit,
  look,
  render,
}: {
  unit: Unit;
  look: RowsLook;
  render: (field: IntakeField, fieldLook: FieldLook) => ReactNode;
}) {
  if (unit.kind === 'name') {
    const placeholders =
      unit.parts.length === 3 ? ['First', 'Middle (if any)', 'Last'] : ['First', 'Last'];
    return (
      <fieldset className="min-w-0">
        <legend className="mb-1 text-xs font-medium text-firm-primary">
          {look.labels?.[unit.key] ?? 'Full Name'}
          {required(unit.parts[0]!)}
        </legend>
        <div className={`grid gap-2 ${unit.parts.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {unit.parts.map((part, i) => (
            <div key={part.key} className="min-w-0">
              {render(part, { quiet: true, placeholder: placeholders[i] })}
            </div>
          ))}
        </div>
      </fieldset>
    );
  }
  if (unit.kind === 'address') {
    const spans = ['col-span-5', 'col-span-3', 'col-span-4'];
    const placeholders = ['City', 'State', 'ZIP Code'];
    return (
      <div className="grid min-w-0 gap-2">
        {render(unit.street, {
          placeholder: 'Street Address',
          ...(look.labels?.[unit.key] ? { label: look.labels[unit.key] } : {}),
        })}
        <div className="grid grid-cols-12 gap-2">
          {unit.rest.map((part, i) => (
            <div key={part.key} className={`min-w-0 ${spans[i]}`}>
              {render(part, { quiet: !look.addressLabels, placeholder: placeholders[i] })}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const f = unit.field;
  return render(f, {
    ...(look.yesNoList && f.type === 'yesNo' ? { row: true } : {}),
    ...(look.inline?.includes(f.key) ? { inline: true } : {}),
    ...(look.boxed?.[f.key] ? { box: look.boxed[f.key] } : {}),
  });
}

function Rows({
  cells,
  look,
  render,
}: {
  cells: Cell[][];
  look: RowsLook;
  render: (field: IntakeField, fieldLook: FieldLook) => ReactNode;
}) {
  return (
    <div className={`grid grid-cols-12 gap-x-2 ${look.yesNoList ? 'gap-y-1' : 'gap-y-2'}`}>
      {cells.flat().map(({ units: list, span }) => (
        <div
          key={list[0]!.key}
          className={`col-span-12 min-w-0 ${SPAN[span] ?? SPAN[12]} ${list.length > 1 ? 'flex flex-wrap items-center gap-x-5' : ''}`}
        >
          {list.map((unit) => (
            <UnitCell key={unit.key} unit={unit} look={look} render={render} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A panel's (or a group row's) shown fields in the rows and columns its mockup draws. */
export function FieldRows({
  fields,
  look,
  render,
}: {
  fields: IntakeField[];
  look: RowsLook;
  render: (field: IntakeField, fieldLook: FieldLook) => ReactNode;
}) {
  const list = units(fields);
  if (!look.columns) return <Rows cells={arrange(list, look.rows)} look={look} render={render} />;
  // Each column takes the units its rows name; any other unit goes to the last column.
  const named = look.columns.map(
    (c) => new Set(c.rows.flatMap((r) => parseRow(r).flatMap((x) => x.keys))),
  );
  return (
    <div className="grid grid-cols-12 gap-x-4 gap-y-2">
      {look.columns.map((column, i) => {
        const mine = list.filter(
          (u) =>
            named[i]!.has(u.key) || (i === named.length - 1 && !named.some((s) => s.has(u.key))),
        );
        return (
          <div
            key={column.rows.join('|')}
            className={`col-span-12 min-w-0 ${SPAN[column.span] ?? SPAN[12]}`}
          >
            <Rows cells={arrange(mine, column.rows)} look={look} render={render} />
          </div>
        );
      })}
    </div>
  );
}
