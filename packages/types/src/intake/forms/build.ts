import {
  INTAKE_LIMITS,
  type IntakeCondition,
  type IntakeField,
  type IntakeGridField,
  type IntakeGroupField,
  type IntakeOption,
  type IntakeScalarField,
  type IntakeSection,
  type IntakeStep,
} from '../definition.js';

// Short builders for the built-in definitions, so each form reads like its mockup. They return
// plain JSON objects (what the API stores and returns).

interface Common {
  required?: boolean;
  help?: string;
  placeholder?: string;
  showIf?: IntakeCondition;
}
/** Spread into a field's options: `{ ...R }` makes it required. */
export const R = { required: true } as const;

const base = (key: string, label: string, o: Common) => ({
  key,
  label,
  required: o.required ?? false,
  ...(o.help === undefined ? {} : { help: o.help }),
  ...(o.placeholder === undefined ? {} : { placeholder: o.placeholder }),
  ...(o.showIf === undefined ? {} : { showIf: o.showIf }),
});

// ---------- Conditions ----------
export const is = (field: string, equals: string | boolean): IntakeCondition => ({ field, equals });
export const oneOf = (field: string, values: string[]): IntakeCondition => ({
  field,
  oneOf: values,
});
export const has = (field: string, values: string[]): IntakeCondition => ({
  field,
  includesAny: values,
});

// ---------- Options ----------
/** `{ CODE: 'Label' }` to options, in order. */
export const opts = (labels: Readonly<Record<string, string>>): IntakeOption[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

// ---------- Fields ----------
type Text = Common & { maxLength?: number };
export const f = {
  text: (key: string, label: string, o: Text = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'text',
    maxLength: o.maxLength ?? 200,
  }),
  textarea: (key: string, label: string, o: Text = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'textarea',
    maxLength: o.maxLength ?? 2000,
  }),
  email: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'email',
  }),
  phone: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'phone',
  }),
  url: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'url',
  }),
  date: (key: string, label: string, o: Common & { past?: boolean } = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'date',
    past: o.past ?? false,
  }),
  month: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'month',
  }),
  year: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'year',
  }),
  /** A count: 0 to 100,000 unless given. */
  number: (
    key: string,
    label: string,
    o: Common & { min?: number; max?: number } = {},
  ): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'number',
    min: o.min ?? 0,
    max: o.max ?? 100_000,
  }),
  /** Dollars and cents, 0 (or `min`, e.g. a negative amount owed) up to the limit. */
  currency: (key: string, label: string, o: Common & { min?: number } = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'currency',
    min: o.min ?? 0,
    max: INTAKE_LIMITS.maxCents,
  }),
  ssn: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'ssn',
  }),
  ein: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'ein',
  }),
  zip: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'zip',
  }),
  state: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'state',
    multiple: false,
  }),
  states: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'state',
    multiple: true,
  }),
  yesNo: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'yesNo',
  }),
  checkbox: (key: string, label: string, o: Common = {}): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'checkbox',
  }),
  radio: (
    key: string,
    label: string,
    options: IntakeOption[],
    o: Common & { cards?: boolean; defaultValue?: string } = {},
  ): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'radio',
    options,
    ...(o.cards ? { display: 'cards' as const } : {}),
    ...(o.defaultValue === undefined ? {} : { defaultValue: o.defaultValue }),
  }),
  select: (
    key: string,
    label: string,
    options: IntakeOption[],
    o: Common = {},
  ): IntakeScalarField => ({ ...base(key, label, o), type: 'select', options }),
  checkboxes: (
    key: string,
    label: string,
    options: IntakeOption[],
    o: Common & { cards?: boolean; selectAll?: string } = {},
  ): IntakeScalarField => ({
    ...base(key, label, o),
    type: 'checkboxes',
    options,
    ...(o.cards ? { display: 'cards' as const } : {}),
    ...(o.selectAll === undefined ? {} : { selectAll: o.selectAll }),
  }),
  grid: (
    key: string,
    label: string,
    rows: IntakeGridField['rows'],
    columns: IntakeGridField['columns'],
    o: Common & { totalLabel?: string } = {},
  ): IntakeField => ({
    ...base(key, label, o),
    type: 'grid',
    rows,
    columns,
    ...(o.totalLabel === undefined ? {} : { totalLabel: o.totalLabel }),
  }),
  group: (
    key: string,
    label: string,
    fields: IntakeScalarField[],
    o: Common & { itemLabel: string; addLabel: string; minItems?: number; maxItems?: number },
  ): IntakeGroupField => ({
    ...base(key, label, o),
    type: 'group',
    fields,
    minItems: o.minItems ?? 0,
    maxItems: o.maxItems ?? 20,
    itemLabel: o.itemLabel,
    addLabel: o.addLabel,
  }),
  upload: (
    key: string,
    label: string,
    o: Common & { notAvailable?: boolean; examples?: string[]; maxFiles?: number } = {},
  ): IntakeField => ({
    ...base(key, label, o),
    type: 'upload',
    notAvailable: o.notAvailable ?? false,
    ...(o.examples === undefined ? {} : { examples: o.examples }),
    maxFiles: o.maxFiles ?? INTAKE_LIMITS.maxFilesPerSlot,
  }),
  info: (key: string, label: string, text: string, o: { showIf?: IntakeCondition } = {}) =>
    ({
      key,
      type: 'info',
      label,
      text,
      required: false,
      ...(o.showIf === undefined ? {} : { showIf: o.showIf }),
    }) satisfies IntakeField,
};

/** Rows of a grid from `{ key: 'Label' }`. */
export const rows = (labels: Readonly<Record<string, string>>): IntakeGridField['rows'] =>
  Object.entries(labels).map(([key, label]) => ({ key, label }));

/** Rows of a grid from `[key, label, hint]`: the hint as each row's help or text placeholder. */
export const rowsWith = (
  hint: 'help' | 'placeholder',
  list: readonly (readonly [key: string, label: string, text: string])[],
): IntakeGridField['rows'] =>
  list.map(([key, label, text]) =>
    hint === 'help' ? { key, label, help: text } : { key, label, placeholder: text },
  );

/** Q1 to Q4 money columns, as most grids have them. */
export const quarterColumns: IntakeGridField['columns'] = [
  { key: 'q1', label: 'Q1', type: 'currency' },
  { key: 'q2', label: 'Q2', type: 'currency' },
  { key: 'q3', label: 'Q3', type: 'currency' },
  { key: 'q4', label: 'Q4', type: 'currency' },
];

/**
 * Street, city, state and ZIP: `street`, `city`, `state`, `zip`, or with a prefix
 * (`spouseStreet`...).
 */
export function address(prefix: string, label: string, o: Common = {}): IntakeScalarField[] {
  const key = (name: string) =>
    prefix ? `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}` : name;
  return [
    f.text(key('street'), label, { ...o, placeholder: 'Street address' }),
    f.text(key('city'), 'City', o),
    f.state(key('state'), 'State', o),
    f.zip(key('zip'), 'ZIP code', o),
  ];
}

/** First, middle (if any) and last name: `firstName`... or with a prefix (`spouseFirstName`...). */
export function fullName(prefix: string, o: Common = {}): IntakeScalarField[] {
  const key = (name: string) =>
    prefix ? `${prefix}${name[0]!.toUpperCase()}${name.slice(1)}` : name;
  return [
    f.text(key('firstName'), 'First name', { ...o, maxLength: 100 }),
    f.text(key('middleName'), 'Middle name (if any)', {
      maxLength: 100,
      ...(o.showIf ? { showIf: o.showIf } : {}),
    }),
    f.text(key('lastName'), 'Last name', { ...o, maxLength: 100 }),
  ];
}

export const section = (
  key: string,
  title: string,
  fields: IntakeField[],
  o: { subtitle?: string; showIf?: IntakeCondition } = {},
): IntakeSection => ({
  key,
  title,
  ...(o.subtitle === undefined ? {} : { subtitle: o.subtitle }),
  ...(o.showIf === undefined ? {} : { showIf: o.showIf }),
  fields,
});

export const step = (
  key: string,
  title: string,
  sections: IntakeSection[],
  o: { subtitle?: string; showIf?: IntakeCondition; review?: boolean } = {},
): IntakeStep => ({
  key,
  title,
  ...(o.subtitle === undefined ? {} : { subtitle: o.subtitle }),
  ...(o.showIf === undefined ? {} : { showIf: o.showIf }),
  review: o.review ?? false,
  sections,
});
