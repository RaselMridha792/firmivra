'use client';

import {
  type FormCategory,
  type IntakeFormDetail,
  type QuestionType,
  SaveIntakeFormRequest,
} from '@firmivra/types';
import { useSyncExternalStore } from 'react';

/** One question as the builder edits it: text is '' when empty. */
export interface DraftQuestion {
  key: string;
  type: QuestionType;
  label: string;
  help: string;
  required: boolean;
  options: string[];
  showIf?: { questionKey: string; equals: string | boolean | number };
  /**
   * A field of the saved form that the builder shows but cannot edit, and the API keeps as it is
   * (form-builder.ts): a grid or repeating group, shown as a section break (the API turns a break
   * added here into a new section, so a saved form never comes back with one), or a list the
   * form engine fills, shown as a dropdown with no choices (State). Publish takes it as it is.
   */
  stored?: true;
}

export interface DraftSection {
  key: string;
  title: string;
  description: string;
  questions: DraftQuestion[];
}

/** Form Settings (4.): Set expiration date is `expires` with its days. */
export interface DraftSettings {
  requireAllQuestions: boolean;
  allowFileUploads: boolean;
  requireSignature: boolean;
  showProgressBar: boolean;
  expires: boolean;
  expiresAfterDays: number;
  successMessage: string;
}

export type StartFrom = 'SCRATCH' | 'TEMPLATE' | 'DUPLICATE';

export interface FormDraft {
  name: string;
  category: FormCategory;
  description: string;
  internalNotes: string;
  isTemplate: boolean;
  start: StartFrom;
  sections: DraftSection[];
  settings: DraftSettings;
}

/** Types that take choices. */
export const CHOICE_TYPES: readonly QuestionType[] = ['MULTIPLE_CHOICE', 'CHECKBOXES', 'DROPDOWN'];
/** Types that organise the form and take no answer. */
export const LAYOUT_TYPES: readonly QuestionType[] = ['SECTION_BREAK', 'INSTRUCTION_TEXT'];

const DEFAULT_EXPIRY_DAYS = 30;

let counter = 0;
/** A new camelCase key, unique in the form (the contract's `^[a-z][A-Za-z0-9]{0,63}$`). */
export function newKey(prefix: 'q' | 's') {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function fromDetail(form: IntakeFormDetail): FormDraft {
  return {
    name: form.name,
    category: form.category,
    description: form.description ?? '',
    internalNotes: form.internalNotes ?? '',
    isTemplate: form.isTemplate,
    start: 'SCRATCH',
    sections: form.sections.map((s) => ({
      key: s.key,
      title: s.title,
      description: s.description ?? '',
      questions: s.questions.map((q) => ({
        key: q.key,
        type: q.type,
        label: q.label,
        help: q.help ?? '',
        required: q.required,
        options: q.options ?? [],
        ...(q.showIf ? { showIf: q.showIf } : {}),
        ...(q.type === 'SECTION_BREAK' || (CHOICE_TYPES.includes(q.type) && !q.options?.length)
          ? { stored: true as const }
          : {}),
      })),
    })),
    settings: {
      requireAllQuestions: form.settings.requireAllQuestions,
      allowFileUploads: form.settings.allowFileUploads,
      requireSignature: form.settings.requireSignature,
      showProgressBar: form.settings.showProgressBar,
      expires: form.settings.expiresAfterDays !== null,
      expiresAfterDays: form.settings.expiresAfterDays ?? DEFAULT_EXPIRY_DAYS,
      successMessage: form.settings.successMessage ?? '',
    },
  };
}

/** A blank question of a type, as Add Questions adds it. */
export function blankQuestion(type: QuestionType, label: string): DraftQuestion {
  return {
    key: newKey('q'),
    type,
    label,
    help: '',
    required: false,
    options: CHOICE_TYPES.includes(type) ? ['Option 1', 'Option 2'] : [],
  };
}

/** The draft as the contract's save body. */
export function toRequest(d: FormDraft): SaveIntakeFormRequest {
  return {
    name: d.name,
    category: d.category,
    description: d.description,
    internalNotes: d.internalNotes,
    isTemplate: d.isTemplate,
    sections: d.sections.map((s) => ({
      key: s.key,
      title: s.title,
      description: s.description,
      questions: s.questions.map((q) => ({
        key: q.key,
        type: q.type,
        label: q.label,
        help: q.help,
        required: LAYOUT_TYPES.includes(q.type) ? false : q.required,
        ...(CHOICE_TYPES.includes(q.type) ? { options: q.options } : {}),
        ...(q.showIf ? { showIf: q.showIf } : {}),
      })),
    })),
    settings: {
      requireAllQuestions: d.settings.requireAllQuestions,
      allowFileUploads: d.settings.allowFileUploads,
      requireSignature: d.settings.requireSignature,
      showProgressBar: d.settings.showProgressBar,
      expiresAfterDays: d.settings.expires ? d.settings.expiresAfterDays : null,
      successMessage: d.settings.successMessage,
    },
  };
}

/**
 * The draft's problems, keyed by where they show: `name`, `category`, `description`,
 * `internalNotes`, `successMessage`, `expiresAfterDays`, `section:<key>`, `question:<key>`.
 * The contract's schema decides; a choice question also needs at least one choice to publish.
 */
export function checkDraft(d: FormDraft, publishing: boolean): Record<string, string> {
  const found: Record<string, string> = {};
  const r = SaveIntakeFormRequest.safeParse(toRequest(d));
  if (!r.success) {
    for (const issue of r.error.issues) {
      const [head, a, b, c] = issue.path;
      let at = String(head ?? 'form');
      if (head === 'sections' && typeof a === 'number') {
        const section = d.sections[a];
        const question = typeof c === 'number' ? section?.questions[c] : undefined;
        at =
          b === 'questions' && question
            ? `question:${question.key}`
            : `section:${section?.key ?? ''}`;
      } else if (head === 'settings') {
        at = String(a ?? 'settings');
      }
      found[at] ??= issue.message;
    }
  }
  // Plain words for the fields the person types in (the schema's own words are generic).
  if (!d.name.trim()) found.name = 'Enter a form name';
  if (found.expiresAfterDays) found.expiresAfterDays = 'Enter a number of days from 1 to 365';
  // Publishing checks what the API's publish refuses (form-builder.ts `publishable`), so each
  // problem shows on its own section or question (Octavia's review, I3).
  if (publishing) {
    if (!d.sections.length) found.form ??= 'Add at least one section';
    for (const s of d.sections) {
      for (const q of s.questions) {
        const choices = q.options.filter((o) => o.trim()).length;
        if (q.stored && choices === 0) continue;
        if (q.type === 'MULTIPLE_CHOICE' && choices < 2) {
          found[`question:${q.key}`] ??= 'Add at least two choices';
        } else if (CHOICE_TYPES.includes(q.type) && choices < 1) {
          found[`question:${q.key}`] ??= 'Add at least one choice';
        }
      }
      // The API splits a section at each section break added here; the last part needs a
      // question. A stored break is a grid or repeating group: it is content, not a split.
      const lastBreak = s.questions.findLastIndex((q) => q.type === 'SECTION_BREAK' && !q.stored);
      const after = s.questions.slice(lastBreak + 1);
      if (!after.length) {
        const breakQuestion = s.questions[lastBreak];
        if (breakQuestion) {
          found[`question:${breakQuestion.key}`] ??=
            'Add a question after this section break, or remove the break';
        } else {
          found[`section:${s.key}`] ??= 'Add a question to this section, or remove the section';
        }
      }
    }
  }
  return found;
}

/** The element id of a problem's section or question row (`section:x` -> `problem-section-x`). */
export const problemDomId = (key: string) => `problem-${key.replace(':', '-')}`;

/** Where a problem key of `checkDraft` is, in words, and the section it belongs to. */
export function problemPlace(
  d: FormDraft,
  key: string,
): { label: string; sectionKey: string | null } {
  if (key.startsWith('section:')) {
    const s = d.sections.find((x) => `section:${x.key}` === key);
    return { label: `Section "${s?.title || 'Untitled section'}"`, sectionKey: s?.key ?? null };
  }
  if (key.startsWith('question:')) {
    for (const s of d.sections) {
      const q = s.questions.find((x) => `question:${x.key}` === key);
      if (q) {
        return {
          label: `"${q.label || 'Untitled'}" in ${s.title || 'Untitled section'}`,
          sectionKey: s.key,
        };
      }
    }
  }
  return { label: FIELD_PLACES[key] ?? 'The form', sectionKey: null };
}

/** The Form Details and Form Settings fields a problem can be on, in the screen's words. */
const FIELD_PLACES: Record<string, string> = {
  form: 'The form',
  name: 'Form name',
  category: 'Category',
  description: 'Description',
  internalNotes: 'Internal notes',
  expiresAfterDays: 'Expires after',
  successMessage: 'Success message',
};

/** Questions that take an answer (counts leave out Section Break and Instruction Text). */
export const answerable = (s: DraftSection) =>
  s.questions.filter((q) => !LAYOUT_TYPES.includes(q.type)).length;

/**
 * The sections without the Logic & Rules conditions that point at `removed` question keys (a
 * deleted question or section must not leave a rule behind that the API cannot resolve).
 */
export function withoutRulesOn(sections: DraftSection[], removed: ReadonlySet<string>) {
  if (!removed.size) return sections;
  return sections.map((s) => ({
    ...s,
    questions: s.questions.map((q) => {
      if (!q.showIf || !removed.has(q.showIf.questionKey)) return q;
      const { showIf: _gone, ...rest } = q;
      return rest;
    }),
  }));
}

/** The line under the page title after a save ("Draft saved."), kept across a move to a copy. */
export interface DraftNotice {
  text: string;
  tone: 'success' | 'danger';
}

interface Held {
  draft: FormDraft;
  dirty: boolean;
  savedAt: string;
  notice: DraftNotice | null;
  /** The published form this draft copy was saved from; its stale entry is dropped. */
  replaces?: string;
}

// The draft lives here, per form, so the Form Builder, Preview and Logic & Rules tabs (three
// routes) share the unsaved work while the person moves between them. Memory only: nothing is
// kept in the browser's storage.
const drafts = new Map<string, Held>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Load a form into the store unless there is unsaved work for it from a newer copy. */
export function loadDraft(id: string, form: IntakeFormDetail) {
  const held = drafts.get(id);
  if (held && (held.dirty || held.savedAt === form.updatedAt)) return;
  drafts.set(id, { draft: fromDetail(form), dirty: false, savedAt: form.updatedAt, notice: null });
  emit();
}

/**
 * Replace the stored draft after a save. `edited` is work done while the save ran (or work a
 * failed save did not store): it stays as unsaved changes. `notice` shows under the title, also
 * after the screen moves to a new draft copy; `replaces` is the form the copy was made from.
 */
export function savedDraft(
  id: string,
  form: IntakeFormDetail,
  start?: StartFrom,
  extra: { edited?: FormDraft | null; notice?: DraftNotice; replaces?: string } = {},
) {
  const draft = fromDetail(form);
  drafts.set(id, {
    draft: extra.edited ?? (start ? { ...draft, start } : draft),
    dirty: Boolean(extra.edited),
    savedAt: form.updatedAt,
    notice: extra.notice ?? null,
    ...(extra.replaces && extra.replaces !== id ? { replaces: extra.replaces } : {}),
  });
  emit();
}

export function updateDraft(id: string, change: (d: FormDraft) => FormDraft) {
  const held = drafts.get(id);
  if (!held) return;
  drafts.set(id, { ...held, draft: change(held.draft), dirty: true, notice: null });
  emit();
}

/** The stored draft now, outside React (a save compares it with what it sent). */
export const peekDraft = (id: string): FormDraft | null => drafts.get(id)?.draft ?? null;

/** Drop a form's stored draft: it loads again from the API next time it is opened. */
export function forgetDraft(id: string) {
  if (drafts.delete(id)) emit();
}

/** The form's draft and whether it has unsaved work; null until the form has loaded. */
export function useDraft(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => drafts.get(id) ?? null,
    () => null,
  );
}
