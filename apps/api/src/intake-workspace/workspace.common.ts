import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import {
  UPLOAD_LIMITS,
  type FormCategory,
  type IntakeStatus,
  type QuestionType,
  type ServiceKind,
} from '@firmivra/types';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';

export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
export const day = (d: Date | null | undefined) => d?.toISOString().slice(0, 10) ?? null;

export const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' });

/** Staff reach only forms of their own clients and leads, and forms assigned to them. */
export function reachOf(tenant: TenantContext, userId: string): Prisma.IntakeWhereInput {
  if (legacyFirmRole(tenant.role as Parameters<typeof legacyFirmRole>[0]) !== 'STAFF') return {};
  return {
    OR: [
      { assignedUserId: userId },
      { engagement: { client: { assignedUserId: userId } } },
      { lead: { assignedUserId: userId } },
    ],
  };
}

/** The tab's statuses; "all" is every form that was sent and not archived. */
export const TAB_STATUSES: Record<string, IntakeStatus[]> = {
  all: [
    'SENT',
    'IN_PROGRESS',
    'SUBMITTED',
    'NEEDS_CORRECTION',
    'UNDER_REVIEW',
    'COMPLETED',
    'EXPIRED',
  ],
  sent: ['SENT'],
  in_progress: ['IN_PROGRESS', 'NEEDS_CORRECTION'],
  submitted: ['SUBMITTED', 'UNDER_REVIEW'],
  completed: ['COMPLETED'],
  expired: ['EXPIRED'],
};

/** The category tab a service's forms sit under. */
export function categoryOf(kind: ServiceKind): FormCategory {
  switch (kind) {
    case 'ANNUAL_TAX':
      return 'PERSONAL_TAX';
    case 'QUARTERLY_TAX':
      return 'BUSINESS_TAX';
    case 'BOOKKEEPING':
      return 'BOOKKEEPING';
    case 'PAYROLL':
      return 'PAYROLL';
    case 'TAX_PLANNING':
      return 'TAX_PLANNING';
    case 'BUSINESS_DEVELOPMENT':
      return 'ADVISORY';
    default:
      return 'OTHER';
  }
}

// ---------- The form engine's definition as sections and questions ----------

interface EngineField {
  key: string;
  type: string;
  label: string;
  help?: string;
  text?: string;
  required?: boolean;
  options?: { label: string; value?: string }[];
  fields?: EngineField[];
  showIf?: { field: string; equals?: string | boolean };
}
interface EngineSection {
  key: string;
  title: string;
  subtitle?: string;
  fields: EngineField[];
}
interface EngineStep {
  title: string;
  sections: EngineSection[];
}

/** The builder's question type of each engine field type. */
export const TYPE_OF_ENGINE: Record<string, QuestionType> = {
  text: 'SHORT_ANSWER',
  ssn: 'SHORT_ANSWER',
  ein: 'SHORT_ANSWER',
  zip: 'SHORT_ANSWER',
  url: 'SHORT_ANSWER',
  textarea: 'PARAGRAPH',
  email: 'EMAIL',
  phone: 'PHONE',
  date: 'DATE',
  month: 'DATE',
  year: 'DATE',
  number: 'NUMBER',
  currency: 'CURRENCY',
  yesNo: 'YES_NO',
  checkbox: 'YES_NO',
  radio: 'MULTIPLE_CHOICE',
  select: 'DROPDOWN',
  state: 'DROPDOWN',
  checkboxes: 'CHECKBOXES',
  upload: 'FILE_UPLOAD',
  info: 'INSTRUCTION_TEXT',
  grid: 'SECTION_BREAK',
  group: 'SECTION_BREAK',
};

/** How many fields a definition has, counting those inside repeating groups. */
export function questionCount(definition: unknown): number {
  const steps = ((definition as { steps?: EngineStep[] } | null)?.steps ?? []) as EngineStep[];
  return steps
    .flatMap((s) => s.sections.flatMap((sec) => sec.fields))
    .reduce((n, f) => n + 1 + (f.type === 'group' ? (f.fields?.length ?? 0) : 0), 0);
}

/**
 * The definition the way the form builder shows it: a step's sections become sections, a field a
 * question. A grid or a repeating group shows as a section break (the builder cannot edit them);
 * a condition other than "equals" is not shown.
 */
export function sectionsOf(definition: unknown) {
  const steps = ((definition as { steps?: EngineStep[] } | null)?.steps ?? []) as EngineStep[];
  const fields = new Map(
    steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields.map((f) => [f.key, f] as const))),
  );
  // A choice's condition shows the option's label, as the builder edits it (it saves it back).
  const shown = (field: string, equals: string | boolean) =>
    typeof equals === 'string'
      ? (fields.get(field)?.options?.find((o) => o.value === equals)?.label ?? equals)
      : equals;
  return steps.flatMap((step) =>
    step.sections.map((section) => ({
      key: section.key,
      title: section.title || step.title,
      description: section.subtitle ?? null,
      questions: section.fields.map((f) => ({
        key: f.key,
        type: TYPE_OF_ENGINE[f.type] ?? 'SHORT_ANSWER',
        label: f.label,
        help: f.type === 'info' ? (f.text ?? null) : (f.help ?? null),
        required: f.required === true,
        ...(f.options ? { options: f.options.map((o) => o.label) } : {}),
        ...(f.showIf && f.showIf.equals !== undefined
          ? {
              showIf: {
                questionKey: f.showIf.field,
                equals: shown(f.showIf.field, f.showIf.equals),
              },
            }
          : {}),
      })),
    })),
  );
}

/** The form's description (the definition's subtitle) and its Form Settings, as saved. */
export function formMetaOf(definition: unknown): {
  description: string | null;
  settings: Record<string, unknown>;
} {
  const d = (definition ?? {}) as { subtitle?: unknown; formSettings?: unknown };
  return {
    description: typeof d.subtitle === 'string' ? d.subtitle : null,
    settings:
      d.formSettings && typeof d.formSettings === 'object'
        ? (d.formSettings as Record<string, unknown>)
        : {},
  };
}

// ---------- Upload types ----------

/** The contract's short names for the types the platform accepts. */
export const FILE_TYPE_CODES: Record<string, string> = {
  PDF: 'application/pdf',
  JPG: 'image/jpeg',
  PNG: 'image/png',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MIME_TO_CODE = new Map(Object.entries(FILE_TYPE_CODES).map(([c, m]) => [m, c]));
export const codeOfMime = (mime: string): string | null => MIME_TO_CODE.get(mime) ?? null;
export const PLATFORM_MIMES: readonly string[] = Object.keys(UPLOAD_LIMITS.types);
