import { BadRequestException } from '@nestjs/common';
import {
  INTAKE_LIMITS,
  IntakeFormDefinition,
  type FormSettingsInput,
  type IntakeFormKey,
  type QuestionType,
  type SaveIntakeFormRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { TYPE_OF_ENGINE } from './workspace.common.js';

// The form builder's sections and questions, saved as the form engine's definition (what the
// portal renders). A draft keeps the builder's shape as far as the engine can hold it; publishing
// checks the whole definition with the engine's own schema (400 FORM_INCOMPLETE otherwise).
//
// - A builder section is a step with one section (more than 10 sections share the 10 steps).
// - A question whose key and type match a field the form already has starts from that field, so
//   what the builder does not show (an SSN field shown as a short answer, a grid or repeating group
//   shown as a section break, option codes, limits) is kept.
// - Any other section break starts a new section of the step, titled with its label.
// - The form's description is the definition's subtitle; Form Settings ride along as
//   `formSettings` (the engine ignores the key).

type Section = NonNullable<z.output<typeof SaveIntakeFormRequest>['sections']>[number];
type Question = Section['questions'][number];
type Json = Record<string, unknown>;

export interface StoredDefinition {
  title: string;
  subtitle?: string;
  steps: { key: string; title: string; subtitle?: string; review: boolean; sections: Json[] }[];
  formSettings?: FormSettingsStored;
  key?: string;
  version?: number;
}

export interface FormSettingsStored {
  requireAllQuestions?: boolean;
  allowFileUploads?: boolean;
  requireSignature?: boolean;
  showProgressBar?: boolean;
  expiresAfterDays?: number | null;
  successMessage?: string | null;
}

const MAX_STEPS = 10;
const CHOICE: QuestionType[] = ['MULTIPLE_CHOICE', 'CHECKBOXES', 'DROPDOWN'];

export const signatureRefused = () =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message:
      'A form is signed when it is submitted: turn on Require signature in Form Settings instead',
  });

/** The fields of a stored definition by key (top level; a group's own fields stay inside it). */
function fieldsByKey(definition: unknown): Map<string, Json> {
  const out = new Map<string, Json>();
  const steps = (definition as { steps?: { sections?: { fields?: Json[] }[] }[] } | null)?.steps;
  for (const step of steps ?? []) {
    for (const section of step.sections ?? []) {
      for (const f of section.fields ?? []) {
        if (typeof f['key'] === 'string') out.set(f['key'], f);
      }
    }
  }
  return out;
}

/** An option's code from its label: MARRIED_FILING_JOINTLY. */
function codeOf(label: string, taken: Set<string>, n: number): string {
  let code = label
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 56);
  if (!/^[A-Z0-9]/.test(code)) code = `OPTION_${String(n + 1)}`;
  let unique = code;
  for (let i = 2; taken.has(unique); i++) unique = `${code}_${String(i)}`;
  taken.add(unique);
  return unique;
}

/** The options, keeping the codes of options whose label is unchanged. */
function optionsOf(labels: string[], before: unknown): { value: string; label: string }[] {
  const known = new Map<string, string>();
  for (const o of Array.isArray(before) ? (before as Json[]) : []) {
    if (typeof o['label'] === 'string' && typeof o['value'] === 'string') {
      known.set(o['label'], o['value']);
    }
  }
  const taken = new Set<string>();
  return labels.map((label, n) => {
    const kept = known.get(label);
    if (kept && !taken.has(kept)) {
      taken.add(kept);
      return { ...((before as Json[]).find((o) => o['value'] === kept) ?? {}), value: kept, label };
    }
    return { value: codeOf(label, taken, n), label };
  });
}

/** A new field of the builder's type, with the engine's defaults. */
function freshField(q: Question): Json {
  const base = { key: q.key, label: q.label, required: q.required };
  switch (q.type) {
    case 'SHORT_ANSWER':
      return { ...base, type: 'text', maxLength: 1000 };
    case 'PARAGRAPH':
      return { ...base, type: 'textarea', maxLength: INTAKE_LIMITS.maxText };
    case 'MULTIPLE_CHOICE':
      return { ...base, type: 'radio' };
    case 'CHECKBOXES':
      return { ...base, type: 'checkboxes' };
    case 'DROPDOWN':
      return { ...base, type: 'select' };
    case 'DATE':
      return { ...base, type: 'date', past: false };
    case 'FILE_UPLOAD':
      return { ...base, type: 'upload', notAvailable: true, maxFiles: 10 };
    case 'NUMBER':
      return { ...base, type: 'number', min: -1_000_000_000, max: 1_000_000_000 };
    case 'CURRENCY':
      return { ...base, type: 'currency', min: 0, max: INTAKE_LIMITS.maxCents };
    case 'EMAIL':
      return { ...base, type: 'email' };
    case 'PHONE':
      return { ...base, type: 'phone' };
    case 'YES_NO':
      return { ...base, type: 'yesNo' };
    case 'INSTRUCTION_TEXT':
      return { key: q.key, type: 'info', label: q.label, required: false };
    default:
      throw signatureRefused();
  }
}

/** The engine's condition: a choice's label is read as that option's code. */
function conditionOf(q: Question, byKey: Map<string, Question>, codes: Map<string, Json[]>) {
  if (!q.showIf) return undefined;
  const { questionKey, equals } = q.showIf;
  if (typeof equals !== 'string') return { field: questionKey, equals };
  const target = byKey.get(questionKey);
  const options = codes.get(questionKey) ?? [];
  const match = options.find((o) => o['label'] === equals || o['value'] === equals);
  return {
    field: questionKey,
    equals: match && target && CHOICE.includes(target.type) ? match['value'] : equals,
  };
}

function settingsOf(input: FormSettingsInput | undefined, before: unknown): FormSettingsStored {
  const kept = ((before as { formSettings?: FormSettingsStored } | null)?.formSettings ??
    {}) as FormSettingsStored;
  const out: FormSettingsStored = { ...kept };
  for (const [k, v] of Object.entries(input ?? {})) {
    if (v !== undefined) (out as Json)[k] = v;
  }
  return out;
}

/**
 * The definition a draft stores: the builder's sections over the form's current definition
 * (`before`, null for a new form). Sections left out keep the current ones.
 */
export function toDefinition(
  input: {
    title: string;
    description?: string | null;
    sections?: Section[];
    settings?: FormSettingsInput;
  },
  before: unknown,
): StoredDefinition {
  const prev = (before ?? {}) as Partial<StoredDefinition>;
  const settings = settingsOf(input.settings, before);
  const description =
    input.description === undefined ? prev.subtitle : (input.description ?? undefined);
  if (!input.sections) {
    return {
      title: input.title,
      ...(description ? { subtitle: description } : {}),
      steps: prev.steps ?? [],
      formSettings: settings,
    };
  }
  const existing = fieldsByKey(before);
  const all = input.sections.flatMap((s) => s.questions);
  const byKey = new Map(all.map((q) => [q.key, q]));
  const codes = new Map<string, Json[]>();
  const allRequired = settings.requireAllQuestions === true;

  const field = (q: Question): Json | null => {
    const old = existing.get(q.key);
    const keep = old && TYPE_OF_ENGINE[old['type'] as string] === q.type;
    if (q.type === 'SECTION_BREAK' && !keep) return null;
    if (q.type === 'SIGNATURE') throw signatureRefused();
    const f: Json = keep ? { ...old } : freshField(q);
    f['label'] = q.label;
    if (f['type'] === 'info') {
      f['text'] = q.help ?? '';
    } else {
      f['required'] = allRequired || q.required;
      if (q.help) f['help'] = q.help;
      else delete f['help'];
    }
    if (['radio', 'select', 'checkboxes'].includes(f['type'] as string)) {
      f['options'] = optionsOf(q.options ?? [], old?.['options']);
      codes.set(q.key, f['options'] as Json[]);
    }
    return f;
  };

  // Options first, so a condition can read a later question's codes too (publish refuses that).
  const fields = new Map(all.map((q) => [q.key, field(q)]));
  const engineSections = input.sections.map((s) => {
    const parts: Json[] = [];
    let current: Json = {
      key: s.key,
      title: s.title,
      ...(s.description ? { subtitle: s.description } : {}),
      fields: [] as Json[],
    };
    parts.push(current);
    for (const q of s.questions) {
      const f = fields.get(q.key);
      if (f === null) {
        current = {
          key: q.key,
          title: q.label,
          ...(q.help ? { subtitle: q.help } : {}),
          fields: [] as Json[],
        };
        parts.push(current);
        continue;
      }
      const showIf = conditionOf(q, byKey, codes);
      if (showIf) f!['showIf'] = showIf;
      else delete f!['showIf'];
      (current['fields'] as Json[]).push(f!);
    }
    // A section break at the very start leaves the section's own part empty.
    return parts.filter((p, i) => i === parts.length - 1 || (p['fields'] as Json[]).length > 0);
  });

  const per = Math.ceil(engineSections.length / MAX_STEPS) || 1;
  const steps: StoredDefinition['steps'] = [];
  for (let i = 0; i < input.sections.length; i += per) {
    const group = input.sections.slice(i, i + per);
    const first = group[0]!;
    steps.push({
      key: first.key,
      title: first.title,
      ...(first.description ? { subtitle: first.description } : {}),
      review: false,
      sections: engineSections.slice(i, i + per).flat(),
    });
  }
  return {
    title: input.title,
    ...(description ? { subtitle: description } : {}),
    steps,
    formSettings: settings,
  };
}

export class FormIncompleteError extends BadRequestException {
  constructor(problems: string[]) {
    super({
      code: 'FORM_INCOMPLETE',
      message: problems[0] ?? 'The form is not complete',
      details: { problems: problems.slice(0, 20) },
    });
  }
}

/**
 * The definition as it is published: the engine's key and version added, checked by the engine's
 * schema. Throws 400 FORM_INCOMPLETE with the problems a person can fix first.
 */
export function publishable(
  stored: unknown,
  meta: { key: IntakeFormKey; version: number; title: string },
): IntakeFormDefinition {
  const def: Json = { ...((stored ?? {}) as Json), key: meta.key, version: meta.version };
  def['title'] = meta.title;
  const problems: string[] = [];
  const steps = (def['steps'] as StoredDefinition['steps'] | undefined) ?? [];
  const fields = steps.flatMap((s) => s.sections.flatMap((c) => (c['fields'] as Json[]) ?? []));
  if (fields.length === 0) problems.push('Add at least one question');
  for (const step of steps) {
    for (const section of step.sections) {
      if (((section['fields'] as Json[]) ?? []).length === 0) {
        problems.push(`Add a question to "${String(section['title'])}" or remove it`);
      }
    }
  }
  for (const f of fields) {
    const label = typeof f['label'] === 'string' ? f['label'].trim() : '';
    if (!label) problems.push('Every question needs a label');
    const options = f['options'];
    if (['radio', 'select', 'checkboxes'].includes(f['type'] as string)) {
      const n = Array.isArray(options) ? options.length : 0;
      if (n < (f['type'] === 'radio' ? 2 : 1)) {
        problems.push(
          `Add ${f['type'] === 'radio' ? 'at least two options' : 'an option'} to "${label}"`,
        );
      }
    }
  }
  if (problems.length) throw new FormIncompleteError([...new Set(problems)]);
  const parsed = IntakeFormDefinition.safeParse(def);
  if (!parsed.success) {
    throw new FormIncompleteError(parsed.error.issues.map((i) => i.message));
  }
  // Keep formSettings next to the engine's fields (the engine's schema drops unknown keys).
  return { ...parsed.data, ...(def['formSettings'] ? { formSettings: def['formSettings'] } : {}) };
}
