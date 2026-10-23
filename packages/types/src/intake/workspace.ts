import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { CalendarDate, MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { IntakeFormStatus, IntakeStatus } from '../db-enums.js';
import { UPLOAD_LIMITS } from '../documents/schemas.js';

/** The most a firm may set as its intake files' size limit: the documents' limit, in MB. */
export const INTAKE_MAX_FILE_SIZE_MB = UPLOAD_LIMITS.maxBytes / (1024 * 1024);

/**
 * Max file size per file, in MB, as Intake Form Settings offers it (Octavia's I10, review of Oct
 * 21: keep 2, 5 and 10 MB, add 50 and 100 MB). A firm that saved another size before (the API took
 * any size from 1 to 100 MB, so 25 MB) keeps it, enforced, until it changes the setting: the API
 * takes a save that leaves the size as it is, and refuses a change to a size not listed here.
 */
export const INTAKE_FILE_SIZE_CHOICES = [2, 5, 10, 50, 100] as const;

// Intake Forms workspace (R43 contract, for Arfan's screens): the dashboard (KPIs, status tabs,
// table, status chart, templates sidebar), Frame 1 the form builder, Frame 2 Send Intake Form,
// Frame 3 the form detail / submission review, Frame 4 the template library and Frame 5 the
// firm's intake settings. Designs: docs/mockups/firm-workspace/intake-forms/source/. Brief:
// docs/work/briefs/intake-forms-contract.md.
// It adds to R11's intake contract (definition.ts, answers.ts, intakes.ts), which stays as it
// is: an assigned form is an `intakes` row (status IntakeStatus, SENT shows as Not Started), a
// form or template is an `intake_forms` row (IntakeFormStatus). The responses of one assigned
// form are R11's IntakeView (GET /business/intakes/{id}), unchanged.
// Firm routes under /api/v1/business (`@Access('INTAKE_FORMS')`); Staff see the forms of their
// own clients and leads (others 404). Every send, reminder, review and setting change is
// audited. Answers and files are never sent by plain email: recipients get a secure link or
// the portal. Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const IntakeFormId = z.uuid();
export const AssignedFormId = z.uuid();

/** The library's category tabs (Personal Tax, Business Tax, ... Client Onboarding). */
export const FormCategory = z.enum([
  'PERSONAL_TAX',
  'BUSINESS_TAX',
  'BOOKKEEPING',
  'PAYROLL',
  'TAX_PLANNING',
  'ADVISORY',
  'CLIENT_ONBOARDING',
  'OTHER',
]);
export type FormCategory = z.infer<typeof FormCategory>;

export const FORM_CATEGORY_LABELS: Record<FormCategory, string> = {
  PERSONAL_TAX: 'Personal Tax',
  BUSINESS_TAX: 'Business Tax',
  BOOKKEEPING: 'Bookkeeping',
  PAYROLL: 'Payroll',
  TAX_PLANNING: 'Tax Planning',
  ADVISORY: 'Advisory',
  CLIENT_ONBOARDING: 'Client Onboarding',
  OTHER: 'Other',
};

const NamedRef = z.object({ id: z.uuid(), name: z.string() });

/** Who a form is for. */
export const FormRecipient = z.object({
  kind: z.enum(['CLIENT', 'LEAD']),
  id: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type FormRecipient = z.infer<typeof FormRecipient>;

// ---------- Dashboard ----------

/** Status tabs: All Forms, Sent (= Not Started), In Progress, Submitted, Completed, Expired. */
export const AssignedFormTab = z.enum([
  'all',
  'sent',
  'in_progress',
  'submitted',
  'completed',
  'expired',
]);
export type AssignedFormTab = z.infer<typeof AssignedFormTab>;

/** One row of the dashboard table. */
export const AssignedFormRow = z.object({
  id: z.uuid(),
  recipient: FormRecipient,
  form: NamedRef,
  service: NamedRef.nullable(),
  /** R11's IntakeStatus; INTAKE_STATUS_LABELS has the words (SENT = Not Started). */
  status: IntakeStatus,
  sentAt: DateTime.nullable(),
  lastActivityAt: DateTime.nullable(),
  assignedTo: MemberRef.nullable(),
  dueOn: CalendarDate.nullable(),
  expiresOn: CalendarDate.nullable(),
});
export type AssignedFormRow = z.infer<typeof AssignedFormRow>;

/**
 * GET /business/intakes: every assigned form (R11 lists only one client's). Search matches the
 * client or lead, email, form name, service and status. Newest sent first.
 */
export const AssignedFormsQuery = z.strictObject({
  tab: AssignedFormTab.optional().default('all'),
  search: SearchText.optional(),
  assignedUserId: z.uuid().optional(),
  formId: z.uuid().optional(),
  serviceId: z.uuid().optional(),
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(8),
});
export type AssignedFormsQuery = z.input<typeof AssignedFormsQuery>;

export const AssignedFormPage = z.object({
  items: z.array(AssignedFormRow).max(100),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AssignedFormPage = z.infer<typeof AssignedFormPage>;

const Count = z.object({ value: z.number().int(), previous: z.number().int().nullable() });

/** GET /business/intakes/summary: the five cards and the Form Status Chart (same dataset). */
export const IntakeDashboardSummary = z.object({
  total: Count,
  sent: Count,
  inProgress: Count,
  completed: Count,
  expired: Count,
  /** Current counts per status for the chart; the chart's legend and total reconcile with it. */
  byStatus: z.object({
    notStarted: z.number().int(),
    inProgress: z.number().int(),
    submitted: z.number().int(),
    completed: z.number().int(),
    expired: z.number().int(),
  }),
});
export type IntakeDashboardSummary = z.infer<typeof IntakeDashboardSummary>;

// ---------- Forms and templates (builder, library) ----------

/** The builder's question types (Add Questions). */
export const QuestionType = z.enum([
  'SHORT_ANSWER',
  'PARAGRAPH',
  'MULTIPLE_CHOICE',
  'CHECKBOXES',
  'DROPDOWN',
  'DATE',
  'FILE_UPLOAD',
  'NUMBER',
  'CURRENCY',
  'EMAIL',
  'PHONE',
  'YES_NO',
  'SIGNATURE',
  'SECTION_BREAK',
  'INSTRUCTION_TEXT',
]);
export type QuestionType = z.infer<typeof QuestionType>;

/** A camelCase key, unique in the form (the answers' key, as in R11's engine). */
const Key = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/, 'Not a valid key');

/** "Show this question only when ..." (Logic & Rules). Only "equals" until more is designed. */
export const QuestionCondition = z.strictObject({
  questionKey: Key,
  equals: z.union([z.string().max(200), z.boolean(), z.number()]),
});
export type QuestionCondition = z.infer<typeof QuestionCondition>;

export const FormQuestion = z.strictObject({
  key: Key,
  type: QuestionType,
  label: text(300),
  help: clearable(text(500, 'many')),
  required: z.boolean().default(false),
  /** MULTIPLE_CHOICE, CHECKBOXES, DROPDOWN. */
  options: z.array(text(200)).max(100).optional(),
  showIf: QuestionCondition.optional(),
});
export type FormQuestion = z.input<typeof FormQuestion>;

export const FormSection = z.strictObject({
  key: Key,
  title: text(120),
  description: clearable(text(500, 'many')),
  questions: z.array(FormQuestion).max(100),
});
export type FormSection = z.input<typeof FormSection>;

/** Form Settings (Frame 1); the firm's defaults (Frame 5) fill what is not set. */
export const FormSettingsInput = z.strictObject({
  requireAllQuestions: z.boolean().optional(),
  allowFileUploads: z.boolean().optional(),
  requireSignature: z.boolean().optional(),
  showProgressBar: z.boolean().optional(),
  /** Days after sending; null = no expiration. */
  expiresAfterDays: z.number().int().min(1).max(365).nullable().optional(),
  successMessage: clearable(text(200, 'many')),
});
export type FormSettingsInput = z.input<typeof FormSettingsInput>;

export const FormSettings = z.object({
  requireAllQuestions: z.boolean(),
  allowFileUploads: z.boolean(),
  requireSignature: z.boolean(),
  showProgressBar: z.boolean(),
  expiresAfterDays: z.number().int().nullable(),
  successMessage: z.string().nullable(),
});
export type FormSettings = z.infer<typeof FormSettings>;

/** A form or template in a list (library cards, the dashboard's Form Templates). */
export const IntakeFormListItem = z.object({
  id: z.uuid(),
  name: z.string(),
  category: FormCategory,
  service: NamedRef.nullable(),
  description: z.string().nullable(),
  isTemplate: z.boolean(),
  /** Firm-made (Custom Templates) or a Firmivra starter. */
  custom: z.boolean(),
  status: IntakeFormStatus,
  questionCount: z.number().int(),
  usageCount: z.number().int(),
  lastUsedAt: DateTime.nullable(),
  updatedAt: DateTime,
  /** The owner shown on the card (the last editor until Octavia says otherwise). */
  owner: MemberRef.nullable(),
});
export type IntakeFormListItem = z.infer<typeof IntakeFormListItem>;

/** GET /business/intake-forms. */
export const IntakeFormsQuery = z.strictObject({
  templates: z.enum(['true', 'false', 'all']).optional().default('all'),
  category: FormCategory.optional(),
  search: SearchText.optional(),
  status: IntakeFormStatus.optional(),
  sort: z.enum(['updated', 'name', 'used', 'recent']).optional().default('updated'),
});
export type IntakeFormsQuery = z.input<typeof IntakeFormsQuery>;

export const IntakeFormList = z.object({ items: z.array(IntakeFormListItem).max(500) });
export type IntakeFormList = z.infer<typeof IntakeFormList>;

/** GET /business/intake-forms/{id}: the builder's form. */
export const IntakeFormDetail = IntakeFormListItem.extend({
  internalNotes: z.string().nullable(),
  sections: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      questions: z.array(
        z.object({
          key: z.string(),
          type: QuestionType,
          label: z.string(),
          help: z.string().nullable(),
          required: z.boolean(),
          options: z.array(z.string()).optional(),
          showIf: z
            .object({
              questionKey: z.string(),
              equals: z.union([z.string(), z.boolean(), z.number()]),
            })
            .optional(),
        }),
      ),
    }),
  ),
  settings: FormSettings,
  /** Published versions are frozen; sent forms keep the version they were sent with. */
  version: z.number().int(),
  publishedAt: DateTime.nullable(),
});
export type IntakeFormDetail = z.infer<typeof IntakeFormDetail>;

/** POST /business/intake-forms (Save as Draft on a new form) and PUT .../{id} (save the draft). */
export const SaveIntakeFormRequest = z.strictObject({
  name: text(120),
  category: FormCategory,
  serviceId: z.uuid().nullable().optional(),
  /** Visible to the client. */
  description: clearable(text(500, 'many')),
  internalNotes: clearable(text(500, 'many')),
  isTemplate: z.boolean().default(false),
  /** Starting point: copy a template's or another form's sections (new forms only). */
  startFrom: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('SCRATCH') }),
      z.strictObject({ kind: z.literal('TEMPLATE'), formId: z.uuid() }),
      z.strictObject({ kind: z.literal('DUPLICATE'), formId: z.uuid() }),
    ])
    .optional(),
  sections: z.array(FormSection).max(30).optional(),
  settings: FormSettingsInput.optional(),
});
export type SaveIntakeFormRequest = z.input<typeof SaveIntakeFormRequest>;

export const IntakeFormLibrarySummary = z.object({
  total: z.number().int(),
  /** Templates used at least 50 times (a proposal: Octavia to define "Most Used"). */
  mostUsed: z.number().int(),
  custom: z.number().int(),
  updatedLast30Days: z.number().int(),
  /** Template Categories sidebar counts. */
  byCategory: z.array(z.object({ category: FormCategory, count: z.number().int() })),
});
export type IntakeFormLibrarySummary = z.infer<typeof IntakeFormLibrarySummary>;

// ---------- Public link (Octavia's I3; Rasel, Oct 22) ----------
// GET /business/intake-forms/{id}/public-link answers a `PublicLink` (public-links/schemas.ts):
// the link and embed code a firm puts behind a button on its own website. Only a service's main
// form has one: its default template (`isTemplate`) of a service of one of the six Begin Online
// kinds. The link is that service's Begin Online page, `{PORTAL_BASE_URL}/{firmSlug}/begin/{path}`
// (`beginOnlinePageUrl`), not a page of its own, and the embed code is `publicEmbedCode` of it.
// Every other form or template answers 404 NOT_FOUND, and so does a main form whose kind's page
// belongs to another of the firm's services (one Begin Online service per kind). `state`, the
// first that applies: ARCHIVED when the service is archived, DRAFT when no version is published,
// INACTIVE when the service is not active, HIDDEN when it is not on Begin Online, else LIVE.
// Every member who can open the form can read its link; reading it changes nothing.

// ---------- Send Intake Form ----------

export const FormDeliveryChannel = z.enum(['EMAIL', 'SMS', 'PORTAL']);
export type FormDeliveryChannel = z.infer<typeof FormDeliveryChannel>;

/** Reminder schedule (Edit Schedule): after sending, and before expiration. */
export const ReminderSchedule = z.strictObject({
  enabled: z.boolean(),
  firstAfterDays: z.number().int().min(1).max(60).optional(),
  finalAfterDays: z.number().int().min(1).max(90).optional(),
  hoursBeforeExpiration: z.number().int().min(1).max(168).optional(),
});
export type ReminderSchedule = z.input<typeof ReminderSchedule>;

/**
 * POST /business/intakes/send (Send Form). One assigned form per recipient and form: sending
 * again what is already open resends it (409 FORM_ALREADY_OPEN unless `resend`). Retry-safe.
 */
export const SendIntakeFormRequest = z.strictObject({
  idempotencyKey: z.uuid(),
  recipient: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('CLIENT'), id: z.uuid() }),
    z.strictObject({ kind: z.literal('LEAD'), id: z.uuid() }),
    z.strictObject({
      kind: z.literal('NEW_CONTACT'),
      name: text(120),
      email: Email,
      phone: clearable(text(40)),
    }),
  ]),
  formId: z.uuid(),
  /** The client's engagement it belongs to; the API picks the open one for the form's service. */
  engagementId: z.uuid().optional(),
  channel: FormDeliveryChannel,
  subject: text(200),
  message: text(500, 'many'),
  dueOn: CalendarDate.nullable().optional(),
  expiresOn: CalendarDate.nullable().optional(),
  assignedUserId: z.uuid().nullable().optional(),
  reminders: ReminderSchedule.optional(),
  allowSaveAndContinue: z.boolean().default(true),
  /** Email only: a copy to the signed-in member. */
  sendMeCopy: z.boolean().default(false),
});
export type SendIntakeFormRequest = z.input<typeof SendIntakeFormRequest>;

/** Save as Draft on the send screen: nothing is sent. */
export const SaveSendDraftRequest = SendIntakeFormRequest.omit({ idempotencyKey: true }).partial();
export type SaveSendDraftRequest = z.input<typeof SaveSendDraftRequest>;

export const SendDraft = z.object({
  id: z.uuid(),
  data: z.record(z.string(), z.unknown()),
  updatedAt: DateTime,
});
export type SendDraft = z.infer<typeof SendDraft>;

export const SendIntakeFormResult = z.object({
  form: AssignedFormRow,
  delivery: z.object({
    channel: FormDeliveryChannel,
    /** FAILED keeps the assigned form; offer Resend. */
    status: z.enum(['SENT', 'FAILED']),
    /** Masked address: "d***@example.test". */
    to: z.string(),
  }),
});
export type SendIntakeFormResult = z.infer<typeof SendIntakeFormResult>;

// ---------- Detail / submission review ----------

export const AssignedFormEvent = z.object({
  id: z.uuid(),
  at: DateTime,
  kind: z.enum([
    'SENT',
    'RESENT',
    'REMINDER',
    'OPENED',
    'SAVED',
    'UPLOADED',
    'SUBMITTED',
    'REVIEW_STARTED',
    'REVISION_REQUESTED',
    'COMPLETED',
    'ASSIGNED',
    'EXTENDED',
    'ARCHIVED',
  ]),
  label: z.string(),
  by: z.string().nullable(),
});
export type AssignedFormEvent = z.infer<typeof AssignedFormEvent>;

export const FormDocument = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  /** The upload question it answers. */
  questionLabel: z.string().nullable(),
  uploadedAt: DateTime,
  scanStatus: z.enum(['PENDING', 'CLEAN', 'INFECTED', 'FAILED']),
});
export type FormDocument = z.infer<typeof FormDocument>;

export const FormNote = z.object({
  id: z.uuid(),
  text: z.string(),
  by: MemberRef.nullable(),
  at: DateTime,
});
export type FormNote = z.infer<typeof FormNote>;

/**
 * GET /business/intakes/{id}/record: the header, the Submission Summary, documents, notes and
 * history. The answers themselves are R11's IntakeView (`api.intakeForms.responses`).
 */
export const AssignedFormRecord = AssignedFormRow.extend({
  submittedAt: DateTime.nullable(),
  completedAt: DateTime.nullable(),
  completedBy: MemberRef.nullable(),
  /** Submission Summary: answerable questions answered and required uploads, 0 to 100. */
  progress: z.object({
    percent: z.number().int().min(0).max(100),
    allQuestionsAnswered: z.boolean(),
    requiredDocumentsUploaded: z.boolean(),
    submitted: z.boolean(),
    readyForReview: z.boolean(),
  }),
  documents: z.array(FormDocument),
  notes: z.array(FormNote),
  history: z.array(AssignedFormEvent),
  /** Communication tab: sends, reminders and follow-ups. */
  communications: z.array(AssignedFormEvent),
  revisionNote: z.string().nullable(),
});
export type AssignedFormRecord = z.infer<typeof AssignedFormRecord>;

export const AddFormNoteRequest = z.strictObject({ text: text(2000, 'many') });
export type AddFormNoteRequest = z.input<typeof AddFormNoteRequest>;

/** Row More menu: assign, extend expiration. */
export const UpdateAssignedFormRequest = z
  .strictObject({
    assignedUserId: z.uuid().nullable(),
    dueOn: CalendarDate.nullable(),
    expiresOn: CalendarDate.nullable(),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Change something first');
export type UpdateAssignedFormRequest = z.input<typeof UpdateAssignedFormRequest>;

/** A short-lived link (Export PDF). */
export const FormFileLink = z.object({ url: z.string(), expiresAt: DateTime });
export type FormFileLink = z.infer<typeof FormFileLink>;

// ---------- Intake Form Settings (Frame 5) ----------

export const IntakeSettings = z.object({
  general: z.object({
    defaultExpirationDays: z.number().int().nullable(),
    allowSaveAndResume: z.boolean(),
    requireSignature: z.boolean(),
    autoSubmissionId: z.boolean(),
    defaultOwner: MemberRef.nullable(),
  }),
  clientExperience: z.object({
    showProgressBar: z.boolean(),
    mobileFriendly: z.boolean(),
    thankYouMessage: z.string().nullable(),
    redirectAfterCompletion: z.boolean(),
    redirectUrl: z.string().nullable(),
  }),
  notifications: z.object({
    sendClientConfirmation: z.boolean(),
    notifyAssignedStaff: z.boolean(),
    firstReminderAfterDays: z.number().int().nullable(),
    finalReminderAfterDays: z.number().int().nullable(),
    expirationAlertHours: z.number().int().nullable(),
  }),
  automation: z.object({
    /** Trigger not defined yet (Octavia): kept off until it is. */
    autoCreateClient: z.boolean(),
    autoCreateFollowUpTask: z.boolean(),
    routeByServiceType: z.boolean(),
    defaultFollowUpOwner: MemberRef.nullable(),
    /** Automation Rules card: rules in the Automations module that use intake events. */
    automationRuleCount: z.number().int().optional(),
  }),
  branding: z.object({
    /** The firm's logo and colours (Settings); forms use them when on. */
    useFirmBranding: z.boolean(),
  }),
  security: z.object({
    /** Always true: files are always stored encrypted (shown, not a switch). */
    encryptedUploads: z.literal(true),
    acceptedFileTypes: z.array(z.string()),
    /**
     * The firm's largest intake file, in MB: portal intakes and Begin Online refuse a bigger one
     * at the upload ticket (400 VALIDATION_FAILED at `sizeBytes`). It may be a size no longer
     * offered (a 25 MB saved before INTAKE_FILE_SIZE_CHOICES): show it as it is.
     */
    maxFileSizeMb: z.number().int(),
    consentRequired: z.boolean(),
  }),
  updatedAt: DateTime.nullable(),
  version: z.string(),
});
export type IntakeSettings = z.infer<typeof IntakeSettings>;

/** PUT /business/intake-settings: Save Changes / Save Settings. Only the groups sent change. */
export const UpdateIntakeSettingsRequest = z.strictObject({
  version: z.string().min(1).max(100),
  general: z
    .strictObject({
      defaultExpirationDays: z.number().int().min(1).max(365).nullable(),
      allowSaveAndResume: z.boolean(),
      requireSignature: z.boolean(),
      autoSubmissionId: z.boolean(),
      defaultOwnerUserId: z.uuid().nullable(),
    })
    .partial()
    .optional(),
  clientExperience: z
    .strictObject({
      showProgressBar: z.boolean(),
      mobileFriendly: z.boolean(),
      thankYouMessage: clearable(text(500, 'many')),
      redirectAfterCompletion: z.boolean(),
      redirectUrl: clearable(z.url({ protocol: /^https$/ }).max(2048)),
    })
    .partial()
    .optional(),
  notifications: z
    .strictObject({
      sendClientConfirmation: z.boolean(),
      notifyAssignedStaff: z.boolean(),
      firstReminderAfterDays: z.number().int().min(1).max(60).nullable(),
      finalReminderAfterDays: z.number().int().min(1).max(90).nullable(),
      expirationAlertHours: z.number().int().min(1).max(168).nullable(),
    })
    .partial()
    .optional(),
  automation: z
    .strictObject({
      autoCreateClient: z.boolean(),
      autoCreateFollowUpTask: z.boolean(),
      routeByServiceType: z.boolean(),
      defaultFollowUpOwnerUserId: z.uuid().nullable(),
    })
    .partial()
    .optional(),
  branding: z.strictObject({ useFirmBranding: z.boolean() }).optional(),
  security: z
    .strictObject({
      acceptedFileTypes: z
        .array(z.enum(['PDF', 'JPG', 'PNG', 'HEIC', 'DOC', 'DOCX', 'XLS', 'XLSX', 'CSV']))
        .min(1),
      /**
       * One of INTAKE_FILE_SIZE_CHOICES, or the size the firm already has (so a saved 25 MB can
       * be sent back unchanged). The API decides, since it depends on the saved value: any other
       * size is 400 VALIDATION_FAILED at `security.maxFileSizeMb` ("Choose 2, 5, 10, 50 or 100 MB").
       */
      maxFileSizeMb: z.number().int().min(1).max(INTAKE_MAX_FILE_SIZE_MB),
      consentRequired: z.boolean(),
    })
    .partial()
    .optional(),
});
export type UpdateIntakeSettingsRequest = z.input<typeof UpdateIntakeSettingsRequest>;

/** Recent Changes. */
export const IntakeSettingsChange = z.object({
  id: z.uuid(),
  at: DateTime,
  label: z.string(),
  by: z.string().nullable(),
});
export type IntakeSettingsChange = z.infer<typeof IntakeSettingsChange>;

export const IntakeSettingsChangeList = z.object({ items: z.array(IntakeSettingsChange).max(100) });
export type IntakeSettingsChangeList = z.infer<typeof IntakeSettingsChangeList>;

export const ResetIntakeSettingsRequest = z.strictObject({
  confirm: z.literal(true, { error: 'Confirm the reset first' }),
});
export type ResetIntakeSettingsRequest = z.input<typeof ResetIntakeSettingsRequest>;

export const IntakeWorkspaceErrorCode = z.enum([
  /** 409: this recipient already has this form open; resend it instead. */
  'FORM_ALREADY_OPEN',
  /** 409: a published version cannot be edited: save a new draft version. */
  'FORM_PUBLISHED',
  /** 400: a question with no label or a choice question with no options (publish). */
  'FORM_INCOMPLETE',
  /** 400: SMS without the firm's SMS sender or the recipient's mobile number. */
  'SMS_UNAVAILABLE',
  /** 409: a lead has no portal access; choose Email or SMS. */
  'PORTAL_UNAVAILABLE',
  /** 409: someone saved the settings after they were loaded. */
  'SAVE_CONFLICT',
  /** 409: the form has no published version yet: publish it before sending. */
  'FORM_NOT_PUBLISHED',
  /** 409: the client has no active engagement for the form's service. */
  'NO_ENGAGEMENT',
  /** 409: not possible in the form's status (remind a submitted form, change an archived one). */
  'INVALID_STATUS',
  /** 503: leads and new contacts need the secure link page, which does not exist yet. */
  'LEAD_LINK_UNAVAILABLE',
  /** 503: assigned-form notes need their table (schema request). */
  'NOTES_UNAVAILABLE',
]);
export type IntakeWorkspaceErrorCode = z.infer<typeof IntakeWorkspaceErrorCode>;
