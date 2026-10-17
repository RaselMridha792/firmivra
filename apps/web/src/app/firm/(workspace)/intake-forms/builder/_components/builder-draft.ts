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
  if (publishing) {
    if (!d.sections.length) found.form ??= 'Add at least one section';
    for (const s of d.sections) {
      for (const q of s.questions) {
        if (CHOICE_TYPES.includes(q.type) && !q.options.some((o) => o.trim())) {
          found[`question:${q.key}`] ??= 'Add at least one choice';
        }
      }
    }
  }
  return found;
}

/** Questions that take an answer (counts leave out Section Break and Instruction Text). */
export const answerable = (s: DraftSection) =>
  s.questions.filter((q) => !LAYOUT_TYPES.includes(q.type)).length;

// The draft lives here, per form, so the Form Builder, Preview and Logic & Rules tabs (three
// routes) share the unsaved work while the person moves between them.
const drafts = new Map<string, { draft: FormDraft; dirty: boolean; savedAt: string }>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Load a form into the store unless there is unsaved work for it from a newer copy. */
export function loadDraft(id: string, form: IntakeFormDetail) {
  const held = drafts.get(id);
  if (held && (held.dirty || held.savedAt === form.updatedAt)) return;
  drafts.set(id, { draft: fromDetail(form), dirty: false, savedAt: form.updatedAt });
  emit();
}

/** Replace the stored draft after a save (no unsaved work left). */
export function savedDraft(id: string, form: IntakeFormDetail, start?: StartFrom) {
  const draft = fromDetail(form);
  drafts.set(id, {
    draft: start ? { ...draft, start } : draft,
    dirty: false,
    savedAt: form.updatedAt,
  });
  emit();
}

export function updateDraft(id: string, change: (d: FormDraft) => FormDraft) {
  const held = drafts.get(id);
  if (!held) return;
  drafts.set(id, { ...held, draft: change(held.draft), dirty: true });
  emit();
}

/** The form's draft and whether it has unsaved work; null until the form has loaded. */
export function useDraft(id: string) {
  return useSyncExternalStore(
    subscribe,
    () => drafts.get(id) ?? null,
    () => null,
  );
}
