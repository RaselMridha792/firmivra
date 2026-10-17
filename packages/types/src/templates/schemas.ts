import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  DeliveryChannel,
  MessageTemplateAccess,
  MessageTemplateKind,
  MessageTemplateStatus,
} from '../db-enums.js';

// Templates (R55 contract, for the Templates screens): the library page with its tabs, category
// cards and recent templates; the category library with filters, favourites and actions; Create /
// Edit Template with merge fields, attachments, preview, test send, sharing and automation
// eligibility; categories, merge fields, Branding & Letterhead, import and the 48 starter
// templates. Designs: docs/mockups/firm-workspace/templates/source/ and the developer guide.
//
// A template is a reusable system object: Communications, Automations, Appointments and the other
// modules choose one and render it with live data at use time (the master is never rewritten with
// one client's data). Every save adds a version; a send records the template and version it used,
// so a later edit never rewrites what was sent. Archived, never deleted. Firm routes under
// /api/v1/business (`@Access('TEMPLATES')`): everyone with the grid's view reads the templates
// they may see (their own, the team's, and those shared with them); changes need Create, Edit or
// Manage (403 FORBIDDEN); only a template's owner, or an Owner or Admin, edits a PRIVATE or
// SELECTED one. Responses are plain objects; requests are strict. Merge fields are `[Client First
// Name]` tokens. Audited with ids, versions and field names only, never a body or a subject.

const DateTime = z.iso.datetime({ offset: true });

export const MessageTemplateId = z.uuid();
export const TemplateCategoryId = z.uuid();
export const TemplateAttachmentId = z.uuid();
export const CustomMergeFieldId = z.uuid();
/** A version number in a path. */
export const TemplateVersionNumber = z.number().int().min(1);

const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };

const Tag = z.string().trim().min(1).max(40);
/** Up to 20 tags, none twice in any case. */
const Tags = z
  .array(Tag)
  .max(20)
  .refine((t) => new Set(t.map((x) => x.toLowerCase())).size === t.length, 'Use each tag once');

// ---------- Categories ----------

/** A firm's own category inside one template kind ("Tax Season", "Appointments"). */
export const TemplateCategory = z.object({
  id: z.uuid(),
  kind: MessageTemplateKind,
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  archivedAt: DateTime.nullable(),
  /** Templates in it that are not archived and that the caller may see. */
  templateCount: z.number().int(),
});
export type TemplateCategory = z.infer<typeof TemplateCategory>;
export const TemplateCategoryList = z.object({ items: z.array(TemplateCategory) });
export type TemplateCategoryList = z.infer<typeof TemplateCategoryList>;

export const TemplateCategoriesQuery = z.strictObject({
  kind: MessageTemplateKind.optional(),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
});
export type TemplateCategoriesQuery = z.input<typeof TemplateCategoriesQuery>;

/** Names are unique within a kind, ignoring case (409 DUPLICATE_NAME). */
export const CreateTemplateCategoryRequest = z.strictObject({
  kind: MessageTemplateKind,
  name: text(100),
  description: clearable(text(500, 'many')),
});
export type CreateTemplateCategoryRequest = z.input<typeof CreateTemplateCategoryRequest>;

/** The kind never changes. */
export const UpdateTemplateCategoryRequest = z
  .strictObject({ name: text(100).optional(), description: clearable(text(500, 'many')) })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateTemplateCategoryRequest = z.input<typeof UpdateTemplateCategoryRequest>;

/** PUT .../order: the category ids of one kind, in the new order. */
export const ReorderTemplateCategoriesRequest = z.strictObject({
  kind: MessageTemplateKind,
  ids: z.array(z.uuid()).min(1).max(100),
});
export type ReorderTemplateCategoriesRequest = z.input<typeof ReorderTemplateCategoriesRequest>;

/** POST .../{id}/merge: the templates move to `intoId` (the same kind), then this one is archived. */
export const MergeTemplateCategoryRequest = z.strictObject({ intoId: z.uuid() });
export type MergeTemplateCategoryRequest = z.input<typeof MergeTemplateCategoryRequest>;

// ---------- Templates ----------

export const TemplateAttachment = z.object({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: DateTime,
});
export type TemplateAttachment = z.infer<typeof TemplateAttachment>;

/** One row of the library table, the Recent Templates list and the pickers. */
export const MessageTemplateRow = z.object({
  id: z.uuid(),
  kind: MessageTemplateKind,
  category: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  name: z.string(),
  description: z.string().nullable(),
  subject: z.string().nullable(),
  tags: z.array(z.string()),
  status: MessageTemplateStatus,
  access: MessageTemplateAccess,
  /** One of the preloaded starter templates (still editable). */
  starter: z.boolean(),
  includeInAutomations: z.boolean(),
  owner: MemberRef,
  updatedBy: MemberRef.nullable(),
  /** The newest version number. */
  version: z.number().int(),
  /** The caller's own favourite. */
  favorite: z.boolean(),
  /** Real uses and sends; never a preview, a test or an edit. */
  useCount: z.number().int(),
  updatedAt: DateTime,
});
export type MessageTemplateRow = z.infer<typeof MessageTemplateRow>;

export const MessageTemplateDetail = MessageTemplateRow.extend({
  previewText: z.string().nullable(),
  body: z.string(),
  /** People a SELECTED template is shared with. */
  sharedWith: z.array(MemberRef),
  attachments: z.array(TemplateAttachment),
  /** The merge fields used in the subject and body, and which of them no field provides. */
  mergeFields: z.object({ used: z.array(z.string()), unknown: z.array(z.string()) }),
  /** Active automations that use it: warn before a disruptive change or an archive. */
  automationCount: z.number().int(),
  lastUsedAt: DateTime.nullable(),
  createdAt: DateTime,
  /** Send the version back on a save: 409 SAVE_CONFLICT when someone saved after it was loaded. */
  etag: z.string(),
});
export type MessageTemplateDetail = z.infer<typeof MessageTemplateDetail>;

export const TemplateTab = z.enum(['all', 'mine', 'shared', 'favorites']);
export const TemplateSort = z.enum(['name', 'updated', 'category', 'uses', 'status']);

/**
 * GET /business/templates: the library. `tab`: all (what the caller may see), mine (their own),
 * shared (shared with them by another person), favorites (their favourites). `status` defaults to
 * everything but archived. `search` matches the name, description, subject and tags. Default
 * order: last updated, newest first.
 */
export const MessageTemplatesQuery = z.strictObject({
  tab: TemplateTab.optional().default('all'),
  kind: MessageTemplateKind.optional(),
  categoryId: z.uuid().optional(),
  status: MessageTemplateStatus.optional(),
  ownerUserId: z.uuid().optional(),
  tag: Tag.optional(),
  /** Only templates offered to Automations. */
  automations: z.union([z.boolean(), z.stringbool()]).optional(),
  search: SearchText.optional(),
  sort: TemplateSort.optional().default('updated'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(10),
});
export type MessageTemplatesQuery = z.input<typeof MessageTemplatesQuery>;
export const MessageTemplatePage = z.object({
  items: z.array(MessageTemplateRow).max(100),
  ...Page,
});
export type MessageTemplatePage = z.infer<typeof MessageTemplatePage>;

/**
 * GET /business/templates/summary: the main page. The tab counts, the category cards with their
 * counts, and the latest edited templates (5). All of it is over what the caller may see.
 */
export const TemplatesSummary = z.object({
  total: z.number().int(),
  mine: z.number().int(),
  shared: z.number().int(),
  favorites: z.number().int(),
  categories: z.array(TemplateCategory),
  /** Templates that belong to no category, by kind. */
  uncategorized: z.array(z.object({ kind: MessageTemplateKind, templateCount: z.number().int() })),
  recent: z.array(MessageTemplateRow).max(5),
});
export type TemplatesSummary = z.infer<typeof TemplatesSummary>;

const templateFields = {
  categoryId: z.uuid().nullable().optional(),
  name: text(200),
  description: clearable(text(500, 'many')),
  /** Required for an email, a letter and a notice, when it is made ACTIVE (400 VALIDATION_FAILED). */
  subject: clearable(text(300)),
  previewText: clearable(text(200)),
  body: z.string().trim().min(1, 'Write the template').max(50_000),
  status: z.enum(['DRAFT', 'ACTIVE']).optional(),
  access: MessageTemplateAccess.optional(),
  /** With SELECTED: the people it is shared with (members of the firm). */
  sharedWithUserIds: z.array(z.uuid()).max(100).optional(),
  tags: Tags.optional(),
  /** Offered to Automations: only an ACTIVE template of a kind automations support. */
  includeInAutomations: z.boolean().optional(),
};

/** POST /business/templates: Save Draft, or Save Template. The caller becomes the owner. */
export const CreateMessageTemplateRequest = z.strictObject({
  kind: MessageTemplateKind,
  ...templateFields,
});
export type CreateMessageTemplateRequest = z.input<typeof CreateMessageTemplateRequest>;

/**
 * PATCH /business/templates/{id}: only the fields sent change; every save that changes the name,
 * subject or body adds a version. `etag` guards a concurrent save. The kind never changes. Changing
 * or archiving a template that active automations use asks to confirm first: send
 * `confirmAutomationImpact: true` (409 AUTOMATION_IN_USE otherwise).
 */
export const UpdateMessageTemplateRequest = z
  .strictObject({
    ...templateFields,
    name: templateFields.name.optional(),
    body: templateFields.body.optional(),
    etag: z.string().min(1).max(100),
    confirmAutomationImpact: z.boolean().optional(),
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag' && k !== 'confirmAutomationImpact').length > 0,
    'Change at least one field',
  );
export type UpdateMessageTemplateRequest = z.input<typeof UpdateMessageTemplateRequest>;

/** POST .../{id}/archive: confirms when automations use it (409 AUTOMATION_IN_USE). */
export const ArchiveMessageTemplateRequest = z.strictObject({
  confirmAutomationImpact: z.boolean().optional(),
});
export type ArchiveMessageTemplateRequest = z.input<typeof ArchiveMessageTemplateRequest>;

/** PUT .../{id}/shares: who a SELECTED template is shared with (and makes it SELECTED). */
export const SetTemplateSharesRequest = z.strictObject({
  userIds: z.array(z.uuid()).max(100),
});
export type SetTemplateSharesRequest = z.input<typeof SetTemplateSharesRequest>;

/** One saved version, newest first. */
export const TemplateVersionRow = z.object({
  version: z.number().int(),
  name: z.string(),
  savedBy: MemberRef,
  savedAt: DateTime,
});
export type TemplateVersionRow = z.infer<typeof TemplateVersionRow>;
export const TemplateVersionList = z.object({ items: z.array(TemplateVersionRow) });
export type TemplateVersionList = z.infer<typeof TemplateVersionList>;
export const TemplateVersion = TemplateVersionRow.extend({
  subject: z.string().nullable(),
  body: z.string(),
});
export type TemplateVersion = z.infer<typeof TemplateVersion>;

/**
 * POST /business/templates/bulk: one action on up to 100 templates the caller may change; a
 * template they may not is skipped (NOT_FOUND). Archiving needs the confirmation.
 */
export const BulkTemplatesRequest = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('ARCHIVE'),
    ids: z.array(z.uuid()).min(1).max(100),
    confirm: z.literal(true),
  }),
  z.strictObject({
    action: z.literal('SET_CATEGORY'),
    ids: z.array(z.uuid()).min(1).max(100),
    categoryId: z.uuid().nullable(),
  }),
  z.strictObject({
    action: z.literal('ADD_TAG'),
    ids: z.array(z.uuid()).min(1).max(100),
    tag: Tag,
  }),
  z.strictObject({
    action: z.literal('REMOVE_TAG'),
    ids: z.array(z.uuid()).min(1).max(100),
    tag: Tag,
  }),
]);
export type BulkTemplatesRequest = z.input<typeof BulkTemplatesRequest>;
export const BulkTemplatesResult = z.object({
  updated: z.number().int(),
  skipped: z.array(z.object({ id: z.uuid(), reason: z.string() })),
});
export type BulkTemplatesResult = z.infer<typeof BulkTemplatesResult>;

// ---------- Preview, render, test send ----------

/**
 * POST .../{id}/preview: the template rendered with sample data, or with a client's real data
 * (`clientId`, and the record ids a field needs). Nothing is sent or recorded. Fields no value
 * resolves are listed in `unresolved`, never left silently in the text.
 */
export const PreviewTemplateRequest = z.strictObject({
  clientId: z.uuid().optional(),
  appointmentId: z.uuid().optional(),
  invoiceId: z.uuid().optional(),
  taskId: z.uuid().optional(),
  /** Values for the preview only, by field name without brackets. */
  sample: z.record(z.string().max(60), z.string().max(500)).optional(),
});
export type PreviewTemplateRequest = z.input<typeof PreviewTemplateRequest>;
export const RenderedTemplate = z.object({
  subject: z.string().nullable(),
  previewText: z.string().nullable(),
  /** Safe HTML for an email or letter, plain text for an SMS. */
  body: z.string(),
  /** Fields with no value: block or confirm before a real send. */
  unresolved: z.array(z.string()),
  /** The data was made up (no `clientId`), not a client's. */
  sample: z.boolean(),
  /** An SMS: its length and how many parts it takes. */
  sms: z.object({ characters: z.number().int(), parts: z.number().int() }).nullable(),
});
export type RenderedTemplate = z.infer<typeof RenderedTemplate>;

/**
 * POST .../{id}/test-send: sends the rendered template (sample data) to the caller's own address
 * or number, marked as a test. It never creates client activity or counts as a use. Email
 * templates take `toEmail` (default: the caller's), SMS templates `toPhone` (E.164).
 */
export const TestSendTemplateRequest = z.strictObject({
  channel: DeliveryChannel,
  toEmail: z.email().max(254).optional(),
  toPhone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use the international format, +15551234567')
    .optional(),
});
export type TestSendTemplateRequest = z.input<typeof TestSendTemplateRequest>;

// ---------- Attachments ----------

export const TEMPLATE_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export const TEMPLATE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Step 1 of an attachment upload: POST .../{id}/attachments/uploads. The answer is the same
 * UploadTicket documents use (PUT the file, then confirm with the token). 400 for a type or size
 * outside the rule above.
 */
export const StartTemplateAttachmentRequest = z.strictObject({
  fileName: text(255),
  contentType: z.enum(TEMPLATE_ATTACHMENT_TYPES),
  sizeBytes: z.number().int().min(1).max(TEMPLATE_ATTACHMENT_MAX_BYTES),
  /** SHA-256 of the file, hex. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Use the lower-case hex SHA-256'),
});
export type StartTemplateAttachmentRequest = z.input<typeof StartTemplateAttachmentRequest>;

// ---------- Merge fields ----------

export const MergeFieldGroup = z.enum([
  'CLIENT',
  'COMPANY',
  'STAFF',
  'APPOINTMENT',
  'INVOICE',
  'TAX',
  'WORKFLOW',
  'CUSTOM',
]);
export type MergeFieldGroup = z.infer<typeof MergeFieldGroup>;

export const MergeField = z.object({
  /** What sits between the brackets, "Client First Name". */
  key: z.string(),
  token: z.string(),
  label: z.string(),
  group: MergeFieldGroup,
  /** Restricted by role: shown to those who may use it, and only where genuinely needed. */
  sensitive: z.boolean(),
  /** The made-up value a preview shows. */
  example: z.string(),
  /** A custom field's id (the others are built in). */
  customId: z.uuid().nullable(),
  /** A custom field's value when a record has none. */
  fallback: z.string().nullable(),
});
export type MergeField = z.infer<typeof MergeField>;
export const MergeFieldList = z.object({ items: z.array(MergeField) });
export type MergeFieldList = z.infer<typeof MergeFieldList>;

/** A key is letters and digits with single spaces, up to 40 characters, unique in the firm. */
export const SaveCustomMergeFieldRequest = z.strictObject({
  key: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z][A-Za-z0-9]*( [A-Za-z0-9]+)*$/, 'Use letters, digits and single spaces'),
  label: text(100),
  fallback: clearable(text(200)),
});
export type SaveCustomMergeFieldRequest = z.input<typeof SaveCustomMergeFieldRequest>;

// ---------- Branding & Letterhead ----------

/**
 * GET and PUT /business/template-branding: the footer, disclaimer and signature letters and emails
 * carry. The logo, business name and colours come from Settings (read-only here).
 */
export const TemplateBranding = z.object({
  footerText: z.string().nullable(),
  disclaimer: z.string().nullable(),
  signatureText: z.string().nullable(),
  letterheadEnabled: z.boolean(),
  businessName: z.string().nullable(),
  logoUrl: z.string().nullable(),
  updatedAt: DateTime.nullable(),
});
export type TemplateBranding = z.infer<typeof TemplateBranding>;
export const SaveTemplateBrandingRequest = z
  .strictObject({
    footerText: clearable(text(1_000, 'many')),
    disclaimer: clearable(text(2_000, 'many')),
    signatureText: clearable(text(1_000, 'many')),
    letterheadEnabled: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type SaveTemplateBrandingRequest = z.input<typeof SaveTemplateBrandingRequest>;

// ---------- Import and starter templates ----------

/**
 * POST /business/templates/import: a template from HTML or plain text (a .docx is converted by the
 * screen to HTML first). The content is sanitized: scripts, event handlers, forms and unsafe links
 * are removed, and what was removed is counted in `removed`. The result is a DRAFT.
 */
export const ImportTemplateRequest = z.strictObject({
  kind: MessageTemplateKind,
  name: text(200),
  categoryId: z.uuid().nullable().optional(),
  format: z.enum(['HTML', 'TEXT']),
  content: z.string().min(1).max(200_000),
});
export type ImportTemplateRequest = z.input<typeof ImportTemplateRequest>;
export const ImportTemplateResult = z.object({
  template: MessageTemplateDetail,
  /** Parts of the content the sanitizer removed (scripts, handlers, unsafe links...). */
  removed: z.number().int(),
});
export type ImportTemplateResult = z.infer<typeof ImportTemplateResult>;

/** GET /business/templates/starters: the preloaded templates and how many this firm has. */
export const StarterTemplatesStatus = z.object({
  available: z.number().int(),
  installed: z.number().int(),
});
export type StarterTemplatesStatus = z.infer<typeof StarterTemplatesStatus>;
/** POST /business/templates/starters: adds the ones missing (Active, editable); safe to repeat. */
export const InstallStartersResult = z.object({
  installed: z.number().int(),
  alreadyThere: z.number().int(),
});
export type InstallStartersResult = z.infer<typeof InstallStartersResult>;

export const TemplateErrorCode = z.enum([
  /** 409: the name is used (a category in the kind, a template, a custom field's key). */
  'DUPLICATE_NAME',
  /** 409: someone saved after it was loaded. */
  'SAVE_CONFLICT',
  /** 409: active automations use the template: confirm to change or archive it. */
  'AUTOMATION_IN_USE',
  /** 409: the category is of another kind, or archived. */
  'CATEGORY_NOT_ALLOWED',
  /** 400: the subject is required for this kind when it is made ACTIVE. */
  'SUBJECT_REQUIRED',
  /** 409: automations support only ACTIVE templates of certain kinds. */
  'NOT_AUTOMATION_ELIGIBLE',
  /** 409: the person is not a member of the firm. */
  'NOT_A_MEMBER',
  /** 403: the template is private or shared with others: its owner or an Owner or Admin changes it. */
  'NOT_THE_OWNER',
  /** 409: the template is archived: restore it first. */
  'TEMPLATE_ARCHIVED',
  /** 409: a custom merge field is used by templates, or the key is a built-in one. */
  'FIELD_IN_USE',
  /** 400: the test destination is not allowed (use your own address or number). */
  'TEST_SEND_REFUSED',
]);
export type TemplateErrorCode = z.infer<typeof TemplateErrorCode>;
