import { z } from 'zod';
import { ServiceKind } from '../db-enums.js';

// The intake form engine (R11): one versioned definition per service form, the same for Begin
// Online (the public intake on a firm's portal site, no account) and the client's Intake Forms tab
// in the portal. A definition is plain JSON: it is stored in IntakeForm.definition per firm and
// service, a published version never changes (packages/db), and the API returns it with every
// draft and intake so a screen renders and checks the form from it.
//
// Shape: steps (the stepper), each with sections (the numbered panels), each with fields. Every
// field has a key that is unique in its form; the answers are one flat map from field key to a
// typed value (answers.ts). A step, section or field can carry `showIf`: it is shown only while an
// earlier field has the given answer (a hidden field is not checked and its answer is dropped on
// submit). The last step is the review step (`review: true`): the screen shows the answers of the
// steps before it with an Edit link per step, then the review step's own fields (payment choice,
// consent boxes). The agreement, its acknowledgments and the signature are not part of a form:
// they come from the firm's versioned agreements (R14, `api.publicAgreements(slug)`).
//
// Texts may hold `{taxYear}` and `{firmName}`: the screen fills them with `fillIntakeText()` (the
// tax year comes with the draft or intake; the firm's name from its portal branding).

/** The six services' forms: ServiceKind without OTHER. */
export const IntakeFormKey = ServiceKind.exclude(['OTHER']);
export type IntakeFormKey = z.infer<typeof IntakeFormKey>;

/** Words that are never keys: they are an object's own machinery in JavaScript. */
const RESERVED_KEYS: readonly string[] = ['constructor', 'prototype'];

/**
 * A step's, section's or field's key (and an answer's): camelCase, starting with a letter, at
 * most 64 characters, never `constructor` or `prototype` (`__proto__` is not this shape).
 */
export const IntakeKey = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]{0,63}$/, 'Not a valid key')
  .refine((key) => !RESERVED_KEYS.includes(key), 'Not a valid key');
/** An option's stored value: upper-case letters, digits and `_` (e.g. `MARRIED_FILING_JOINTLY`). */
export const IntakeOptionValue = z.string().regex(/^[A-Z0-9][A-Z0-9_]{0,63}$/, 'Not a valid code');

/** Limits every definition and answer keeps. */
export const INTAKE_LIMITS = {
  /** The longest text answer (a textarea's `maxLength` is at most this). */
  maxText: 10_000,
  /** The longest "Please explain why" for a document the person doesn't have. */
  maxReason: 1000,
  /** The largest currency answer, in cents: $999,999,999.99. */
  maxCents: 99_999_999_999,
  /** The most answers in one form. */
  maxAnswers: 500,
  /** The most rows a group (dependents, assets...) can hold. */
  maxRows: 50,
  /** The most keys in one group row: its `id` and up to 30 fields. */
  maxRowKeys: 31,
  /** The most rows and columns a grid can have. */
  maxGridRows: 50,
  maxGridColumns: 10,
  /**
   * The most files one upload field can allow (its `maxFiles`, which is the limit that applies).
   * Every file counts, a blocked one too, until it is removed.
   */
  maxFilesPerSlot: 20,
  /** The most files in one draft or intake, every file counted. */
  maxFiles: 50,
  /**
   * The most fields in one form, a group's own fields counted too (the largest built-in form,
   * Bookkeeping, has 95 at the top level and 102 in all).
   */
  maxFields: 200,
  /** The longest label, title, placeholder or button text (built-in: 246 characters). */
  maxLabel: 300,
  /** The longest help, subtitle, info text or option help (built-in: 285). */
  maxHelp: 500,
  /** The longest option label, card tag, card bullet or upload example (built-in: 66). */
  maxOptionLabel: 200,
  /** The most options of one choice field (built-in: 23), as many as an answer can tick. */
  maxOptions: 100,
  /** The most bullets on a card or examples next to a drop zone (built-in: 13). */
  maxBullets: 30,
} as const;

/** A label, title, placeholder or button text. */
const Label = z.string().max(INTAKE_LIMITS.maxLabel);
/** A help line, subtitle or text to read. */
const Help = z.string().max(INTAKE_LIMITS.maxHelp);
/** An option's label, a card's tag or bullet, an upload example. */
const OptionText = z.string().max(INTAKE_LIMITS.maxOptionLabel);

export const IntakeOption = z.object({
  value: IntakeOptionValue,
  label: OptionText,
  /** A line under the label: a card's description, a payment option's terms. */
  help: Help.optional(),
  /** Bullet points on a card (the bookkeeping packages). */
  details: z.array(OptionText).max(INTAKE_LIMITS.maxBullets).optional(),
  /** A tag on a card, e.g. "Most Popular". */
  badge: OptionText.optional(),
});
export type IntakeOption = z.infer<typeof IntakeOption>;

/** The codes a condition lists: at least one, at most as many as a field has options. */
const ConditionCodes = z.array(IntakeOptionValue).min(1).max(INTAKE_LIMITS.maxOptions);

/**
 * Shown only while an earlier field (in the form, or in the same group row) has this answer:
 * `equals` a yes/no, checkbox or single choice (an option's code or a state code); `oneOf`
 * single-choice codes; `includesAny` of the codes ticked in a multiple choice. A field that is
 * itself hidden has no answer.
 */
export const IntakeCondition = z.union([
  z.object({ field: IntakeKey, equals: z.union([IntakeOptionValue, z.boolean()]) }),
  z.object({ field: IntakeKey, oneOf: ConditionCodes }),
  z.object({ field: IntakeKey, includesAny: ConditionCodes }),
]);
export type IntakeCondition = z.infer<typeof IntakeCondition>;

const base = {
  key: IntakeKey,
  label: Label,
  /** A hint under the label. */
  help: Help.optional(),
  placeholder: Label.optional(),
  /** Checked on submit only, and only while the field is shown. */
  required: z.boolean(),
  showIf: IntakeCondition.optional(),
};
const field = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ ...base, type: z.literal(type), ...shape });
const Display = z.enum(['list', 'cards']).optional();

// ---------- Field types ----------
// The answer each type takes is in answers.ts (`checkIntakeAnswers`).

/** One line of text. */
export const IntakeTextField = field('text', { maxLength: z.number().int().min(1).max(1000) });
/** Several lines; the screen shows a counter ("0/1,000"). */
export const IntakeTextareaField = field('textarea', {
  maxLength: z.number().int().min(1).max(INTAKE_LIMITS.maxText),
});
export const IntakeEmailField = field('email', {});
/** Stored as E.164; a US number may be typed without +1. */
export const IntakePhoneField = field('phone', {});
/** A website; `example.com` is stored as `https://example.com`. */
export const IntakeUrlField = field('url', {});
/** YYYY-MM-DD. `past`: no date after today (a date of birth). */
export const IntakeDateField = field('date', { past: z.boolean() });
/** A month of a year, YYYY-MM ("MM/YYYY" on screen). */
export const IntakeMonthField = field('month', {});
/** A year, 1900 to 2100 (the screen offers recent years). */
export const IntakeYearField = field('year', {});
/** A whole number (counts). */
export const IntakeNumberField = field('number', {
  min: z.number().int(),
  max: z.number().int(),
});
/** An amount in whole cents ($1,234.56 is 123456). */
export const IntakeCurrencyField = field('currency', {
  min: z.number().int().min(-INTAKE_LIMITS.maxCents),
  max: z.number().int().max(INTAKE_LIMITS.maxCents),
});
/** 9 digits, masked on screen. Only the last 4 ever come back from the API. */
export const IntakeSsnField = field('ssn', {});
/** 9 digits (XX-XXXXXXX). Only the last 4 ever come back from the API. */
export const IntakeEinField = field('ein', {});
/** A US ZIP code: 5 digits, or ZIP+4. */
export const IntakeZipField = field('zip', {});
/** A US state or DC by its two-letter code (US_STATES); `multiple` for "select all that apply". */
export const IntakeStateField = field('state', { multiple: z.boolean() });
/** Yes or No (radios). */
export const IntakeYesNoField = field('yesNo', {});
/** One tick box; a required one must be ticked (a consent or a certification). */
export const IntakeCheckboxField = field('checkbox', {});
/** One choice as radios (`display: 'cards'` for the bookkeeping packages). */
export const IntakeRadioField = field('radio', {
  options: z.array(IntakeOption).min(2).max(INTAKE_LIMITS.maxOptions),
  display: Display,
  /** Chosen when the form opens (the "Most Popular" package). */
  defaultValue: IntakeOptionValue.optional(),
});
/** One choice from a dropdown. */
export const IntakeSelectField = field('select', {
  options: z.array(IntakeOption).min(1).max(INTAKE_LIMITS.maxOptions),
});
/** Any number of choices ("Select all that apply"). */
export const IntakeCheckboxesField = field('checkboxes', {
  options: z.array(IntakeOption).min(1).max(INTAKE_LIMITS.maxOptions),
  display: Display,
  /** At least this many when required (1 if left out). */
  minItems: z.number().int().min(1).optional(),
  /** A "select all" shortcut's label, e.g. "Select All or Most". */
  selectAll: Label.optional(),
});

const SCALAR_FIELDS = [
  IntakeTextField,
  IntakeTextareaField,
  IntakeEmailField,
  IntakePhoneField,
  IntakeUrlField,
  IntakeDateField,
  IntakeMonthField,
  IntakeYearField,
  IntakeNumberField,
  IntakeCurrencyField,
  IntakeSsnField,
  IntakeEinField,
  IntakeZipField,
  IntakeStateField,
  IntakeYesNoField,
  IntakeCheckboxField,
  IntakeRadioField,
  IntakeSelectField,
  IntakeCheckboxesField,
] as const;

/** A field that holds one value: the only kinds a group row can hold. */
export const IntakeScalarField = z.discriminatedUnion('type', [...SCALAR_FIELDS]);
export type IntakeScalarField = z.infer<typeof IntakeScalarField>;

/**
 * A table of amounts, dates or notes: rows by columns, e.g. income sources by Q1 to Q4 and Total
 * Annual. With `totalLabel` the screen adds a footer row that sums each currency column (shown,
 * never stored).
 */
export const IntakeGridField = field('grid', {
  rows: z
    .array(
      z.object({
        key: IntakeKey,
        label: Label,
        help: Help.optional(),
        /** The placeholder of this row's text cells ("e.g., physical products"). */
        placeholder: Label.optional(),
      }),
    )
    .min(1)
    .max(INTAKE_LIMITS.maxGridRows),
  columns: z
    .array(
      z.object({
        key: IntakeKey,
        label: Label,
        type: z.enum(['currency', 'date', 'text']),
        /** Text columns: at most this many characters (200 if left out). */
        maxLength: z.number().int().min(1).max(1000).optional(),
      }),
    )
    .min(1)
    .max(INTAKE_LIMITS.maxGridColumns),
  totalLabel: Label.optional(),
});
export type IntakeGridField = z.infer<typeof IntakeGridField>;

/**
 * Repeating rows of the same fields ("Dependent 1", "+ Add Another Dependent"). A required group
 * needs at least one row (or `minItems`); each row's own required fields are checked on submit.
 */
export const IntakeGroupField = field('group', {
  fields: z
    .array(IntakeScalarField)
    .min(1)
    .max(INTAKE_LIMITS.maxRowKeys - 1),
  minItems: z.number().int().min(0).max(INTAKE_LIMITS.maxRows),
  maxItems: z.number().int().min(1).max(INTAKE_LIMITS.maxRows),
  /** "Dependent": the screen numbers the rows ("Dependent 1"). */
  itemLabel: Label,
  /** "Add Another Dependent". */
  addLabel: Label,
});
export type IntakeGroupField = z.infer<typeof IntakeGroupField>;

/**
 * An upload slot. The files are uploaded on their own (the draft's or intake's `createUpload`
 * with this key as `slot`); the answer holds only "I don't have this document" and the reason. A
 * required slot needs a file that is not blocked, or that box ticked with a reason. On submit the
 * files of a slot the answers hide are taken out of the form (`hiddenSlotUploads`).
 */
export const IntakeUploadField = field('upload', {
  /** Offer "I don't have this document" with a "Please explain why" box. */
  notAvailable: z.boolean(),
  /** "Examples of Income Documents": shown next to the drop zone. */
  examples: z.array(OptionText).max(INTAKE_LIMITS.maxBullets).optional(),
  /**
   * The most files this slot takes (409 TOO_MANY_FILES after that): this limit applies, at most
   * INTAKE_LIMITS.maxFilesPerSlot. Every file counts, a blocked one too, until it is removed.
   */
  maxFiles: z.number().int().min(1).max(INTAKE_LIMITS.maxFilesPerSlot),
});
export type IntakeUploadField = z.infer<typeof IntakeUploadField>;

/** Text to read, with no answer ("For your security, please do not enter passwords"). */
export const IntakeInfoField = z.object({
  key: IntakeKey,
  type: z.literal('info'),
  label: Label,
  text: Help,
  required: z.literal(false),
  showIf: IntakeCondition.optional(),
});
export type IntakeInfoField = z.infer<typeof IntakeInfoField>;

export const IntakeField = z.discriminatedUnion('type', [
  ...SCALAR_FIELDS,
  IntakeGridField,
  IntakeGroupField,
  IntakeUploadField,
  IntakeInfoField,
]);
export type IntakeField = z.infer<typeof IntakeField>;
export type IntakeFieldType = IntakeField['type'];

/** A numbered panel of a step. */
export const IntakeSection = z.object({
  key: IntakeKey,
  title: Label,
  subtitle: Help.optional(),
  showIf: IntakeCondition.optional(),
  fields: z.array(IntakeField).min(1).max(100),
});
export type IntakeSection = z.infer<typeof IntakeSection>;

/** One step of the stepper. The review step is the last one. */
export const IntakeStep = z.object({
  key: IntakeKey,
  title: Label,
  subtitle: Help.optional(),
  /** A hidden step is skipped (Annual Tax step 2 only for business returns). */
  showIf: IntakeCondition.optional(),
  review: z.boolean(),
  sections: z.array(IntakeSection).min(1).max(30),
});
export type IntakeStep = z.infer<typeof IntakeStep>;

type Ctx = z.RefinementCtx;
const problem = (ctx: Ctx, path: (string | number)[], message: string) =>
  ctx.addIssue({ code: 'custom', path, message });

/** The field kinds a condition can read, and what it can ask of them. */
function checkCondition(
  ctx: Ctx,
  path: (string | number)[],
  condition: IntakeCondition,
  earlier: ReadonlyMap<string, IntakeField>,
) {
  const target = earlier.get(condition.field);
  if (!target) {
    problem(ctx, path, `showIf reads "${condition.field}", which is not an earlier field`);
    return;
  }
  const codes =
    target.type === 'radio' || target.type === 'select' || target.type === 'checkboxes'
      ? target.options.map((o) => o.value)
      : null;
  const known = (values: readonly string[]) =>
    codes === null || values.every((v) => codes.includes(v));
  if ('equals' in condition) {
    const ok =
      typeof condition.equals === 'boolean'
        ? target.type === 'yesNo' || target.type === 'checkbox'
        : ['radio', 'select'].includes(target.type) ||
          (target.type === 'state' && !target.multiple);
    if (!ok || (typeof condition.equals === 'string' && !known([condition.equals]))) {
      problem(ctx, path, `showIf cannot compare "${condition.field}" with that value`);
    }
  } else if ('oneOf' in condition) {
    const ok =
      ['radio', 'select'].includes(target.type) || (target.type === 'state' && !target.multiple);
    if (!ok || !known(condition.oneOf)) {
      problem(ctx, path, `showIf "oneOf" needs a single choice field: "${condition.field}"`);
    }
  } else {
    const ok = target.type === 'checkboxes' || (target.type === 'state' && target.multiple);
    if (!ok || !known(condition.includesAny)) {
      problem(
        ctx,
        path,
        `showIf "includesAny" needs a multiple choice field: "${condition.field}"`,
      );
    }
  }
}

function checkOptions(ctx: Ctx, path: (string | number)[], f: IntakeField) {
  if (f.type !== 'radio' && f.type !== 'select' && f.type !== 'checkboxes') return;
  const values = f.options.map((o) => o.value);
  if (new Set(values).size !== values.length) problem(ctx, path, `"${f.key}" repeats an option`);
  if (f.type === 'radio' && f.defaultValue && !values.includes(f.defaultValue)) {
    problem(ctx, path, `"${f.key}" defaults to an option it does not have`);
  }
}

function checkField(
  ctx: Ctx,
  path: (string | number)[],
  f: IntakeField,
  earlier: ReadonlyMap<string, IntakeField>,
) {
  if (f.showIf) checkCondition(ctx, [...path, 'showIf'], f.showIf, earlier);
  checkOptions(ctx, path, f);
  if ((f.type === 'number' || f.type === 'currency') && f.min > f.max) {
    problem(ctx, path, `"${f.key}" has min above max`);
  }
  if (f.type === 'grid') {
    for (const [list, name] of [
      [f.rows, 'row'],
      [f.columns, 'column'],
    ] as const) {
      const keys = list.map((r) => r.key);
      if (new Set(keys).size !== keys.length) problem(ctx, path, `"${f.key}" repeats a ${name}`);
    }
  }
  if (f.type === 'group') {
    if (f.minItems > f.maxItems) problem(ctx, path, `"${f.key}" has minItems above maxItems`);
    const inRow = new Map<string, IntakeField>();
    f.fields.forEach((sub, i) => {
      const subPath = [...path, 'fields', i];
      if (sub.key === 'id' || inRow.has(sub.key)) {
        problem(ctx, subPath, `"${f.key}" has a repeated or reserved field key "${sub.key}"`);
      }
      checkField(ctx, subPath, sub, inRow);
      inRow.set(sub.key, sub);
    });
  }
}

/**
 * A form definition. Checked as it is read: keys unique in the form (and in each group row),
 * conditions that read an earlier field with values it can have, options unique, and only the
 * last step is the review step (the API parses a definition with it before publishing a version).
 */
export const IntakeFormDefinition = z
  .object({
    /**
     * The service kind and the version: the API overwrites both from the IntakeForm row's columns
     * (the service's kind, IntakeForm.version) when it stores and when it returns a definition.
     */
    key: IntakeFormKey,
    version: z.number().int().min(1),
    title: Label,
    subtitle: Help.optional(),
    steps: z.array(IntakeStep).min(1).max(10),
  })
  .superRefine((definition, ctx) => {
    const fields = definition.steps
      .flatMap((step) => step.sections.flatMap((section) => section.fields))
      .reduce((n, f) => n + 1 + (f.type === 'group' ? f.fields.length : 0), 0);
    if (fields > INTAKE_LIMITS.maxFields) {
      problem(ctx, ['steps'], `A form has at most ${String(INTAKE_LIMITS.maxFields)} fields`);
      return;
    }
    const earlier = new Map<string, IntakeField>();
    const stepKeys = new Set<string>();
    definition.steps.forEach((step, s) => {
      const stepPath = ['steps', s];
      if (stepKeys.has(step.key)) problem(ctx, stepPath, `Step "${step.key}" is repeated`);
      stepKeys.add(step.key);
      if (step.review && s !== definition.steps.length - 1) {
        problem(ctx, stepPath, 'Only the last step can be the review step');
      }
      if (step.showIf) checkCondition(ctx, [...stepPath, 'showIf'], step.showIf, earlier);
      const sectionKeys = new Set<string>();
      step.sections.forEach((section, c) => {
        const sectionPath = [...stepPath, 'sections', c];
        if (sectionKeys.has(section.key)) {
          problem(ctx, sectionPath, `Section "${section.key}" is repeated`);
        }
        sectionKeys.add(section.key);
        if (section.showIf) {
          checkCondition(ctx, [...sectionPath, 'showIf'], section.showIf, earlier);
        }
        section.fields.forEach((f, i) => {
          const fieldPath = [...sectionPath, 'fields', i];
          if (earlier.has(f.key)) problem(ctx, fieldPath, `Field "${f.key}" is repeated`);
          checkField(ctx, fieldPath, f, earlier);
          earlier.set(f.key, f);
        });
      });
    });
  });
export type IntakeFormDefinition = z.infer<typeof IntakeFormDefinition>;

/** Every field of a step, in order. */
export const intakeStepFields = (step: IntakeStep): IntakeField[] =>
  step.sections.flatMap((s) => s.fields);

/** Every field of a form, in order. */
export const intakeFields = (definition: IntakeFormDefinition): IntakeField[] =>
  definition.steps.flatMap(intakeStepFields);

/**
 * The text of a label, title or help with `{taxYear}` and `{firmName}` filled in. A placeholder
 * without a value stays as it is.
 */
export function fillIntakeText(
  value: string,
  values: { taxYear?: number | null; firmName?: string | null },
): string {
  return value.replace(/\{(taxYear|firmName)\}/g, (match, name: 'taxYear' | 'firmName') => {
    const v = values[name];
    return v === undefined || v === null ? match : String(v);
  });
}
