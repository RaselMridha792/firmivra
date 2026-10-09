import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  EsignChosenAuthMethod,
  EsignFieldType,
  EsignMergeKey,
  EsignRecipientKind,
  EsignRecipientRole,
  EsignRouting,
} from './enums.js';
import { EsignPutRecipient, EsignReminders } from './schemas.js';

// Firm Sign (R13), firm side, contract 2: Signing Settings and templates (save as template, use a
// template). Same access rules as the requests (schemas.ts); settings change only by Owner and
// Admin (403 FORBIDDEN otherwise). Template versions, duplicate and Firm Sign roles are in
// extras.ts.

const DateTime = z.iso.datetime({ offset: true });

// ---------- Settings ----------
/** The firm's defaults for new requests. */
export const EsignDefaults = z.object({
  expiryDays: z.number().int().min(1).max(365),
  reminders: z.object(EsignReminders.shape),
  /** Days before expiry that open signers get a warning; 0 for none. */
  expiryWarningDays: z.number().int().min(0).max(30),
  authMethod: EsignChosenAuthMethod,
  /** New requests need an approver's yes before they go out (extras.ts). */
  requireApproval: z.boolean(),
  /** The email message new requests start with; null for none. */
  emailMessage: z.string().nullable(),
});
export type EsignDefaults = z.infer<typeof EsignDefaults>;

/** One published version of the firm's e-signature consent text. Insert-only. */
export const EsignConsentVersion = z.object({
  id: z.uuid(),
  version: z.number().int().min(1),
  bodyMarkdown: z.string(),
  sha256: z.string(),
  publishedAt: DateTime,
  publishedBy: MemberRef.nullable(),
});
export type EsignConsentVersion = z.infer<typeof EsignConsentVersion>;

/**
 * GET /esign/settings: the defaults, the consent text signers accept now (null until the firm
 * publishes one: nothing can be sent before that, readiness NO_CONSENT), and whether the caller
 * may change them (Owner and Admin).
 */
export const EsignSettings = z.object({
  defaults: EsignDefaults,
  consent: EsignConsentVersion.nullable(),
  canEdit: z.boolean(),
  /** The caller's own job title, used for the Staff Title merge field. */
  myJobTitle: z.string().nullable(),
});
export type EsignSettings = z.infer<typeof EsignSettings>;

/** PUT /esign/settings (Owner, Admin): only the keys sent change. */
export const UpdateEsignSettingsBody = z
  .strictObject({
    expiryDays: z.number().int().min(1).max(365).optional(),
    reminders: EsignReminders.optional(),
    expiryWarningDays: z.number().int().min(0).max(30).optional(),
    authMethod: EsignChosenAuthMethod.optional(),
    requireApproval: z.boolean().optional(),
    emailMessage: clearable(text(1000, 'many')).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Change at least one setting');
export type UpdateEsignSettingsBody = z.input<typeof UpdateEsignSettingsBody>;

/** GET /esign/settings/consent-versions: every version, newest first. */
export const EsignConsentVersionList = z.object({ items: z.array(EsignConsentVersion) });
export type EsignConsentVersionList = z.infer<typeof EsignConsentVersionList>;

/**
 * POST /esign/settings/consent-versions (Owner, Admin): publish a new version, which signers
 * accept from then on. Signers who already accepted keep the version they accepted.
 */
export const PublishEsignConsentBody = z.strictObject({
  bodyMarkdown: text(20_000, 'many', 'Enter the consent text'),
});
export type PublishEsignConsentBody = z.input<typeof PublishEsignConsentBody>;

/** PUT /esign/me/profile: the caller's own job title (Staff Title), up to 100 characters. */
export const UpdateEsignProfileBody = z.strictObject({
  jobTitle: clearable(text(100)),
});
export type UpdateEsignProfileBody = z.input<typeof UpdateEsignProfileBody>;

// ---------- Templates ----------
/** FIRM: everyone in Firm Sign may use it. PRIVATE: only its owner (and Owner and Admin). */
export const EsignTemplateVisibility = z.enum(['FIRM', 'PRIVATE']);
export type EsignTemplateVisibility = z.infer<typeof EsignTemplateVisibility>;

export const EsignTemplateId = z.uuid();

/** One template in the list. */
export const EsignTemplateRow = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: EsignTemplateVisibility,
  owner: MemberRef,
  pageCount: z.number().int().min(1),
  roleCount: z.number().int().min(0),
  /** The newest version: the one `use` copies (contract 3). */
  version: z.number().int().min(1),
  updatedAt: DateTime,
  archivedAt: DateTime.nullable(),
  /** The caller may rename, change or archive it (its owner, Owner and Admin). */
  canEdit: z.boolean(),
});
export type EsignTemplateRow = z.infer<typeof EsignTemplateRow>;

/** GET /esign/templates?q=&archived=: newest first. */
export const ListEsignTemplatesQuery = z.strictObject({
  q: SearchText.optional(),
  archived: z
    .preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean())
    .optional()
    .default(false),
});
export type ListEsignTemplatesQuery = z.input<typeof ListEsignTemplatesQuery>;

export const EsignTemplateList = z.object({ items: z.array(EsignTemplateRow) });
export type EsignTemplateList = z.infer<typeof EsignTemplateList>;

/**
 * A recipient slot in a template: who fills it is chosen when the template is used. CLIENT and
 * SPOUSE fill from the client's PRIMARY and SPOUSE logins, PREPARER from the sender.
 */
export const EsignTemplateRole = z.object({
  key: z.string(),
  kind: EsignRecipientKind,
  role: EsignRecipientRole,
  roleLabel: z.string().nullable(),
  routingOrder: z.number().int().min(1),
  /** How the recipient filling this role proves who they are. */
  authMethod: EsignChosenAuthMethod,
  /** The colour the field editor shows. */
  colorIndex: z.number().int().min(0).max(7),
});
export type EsignTemplateRole = z.infer<typeof EsignTemplateRole>;

/** A template's field: the same as a request's, owned by a role instead of a recipient. */
export const EsignTemplateField = z.object({
  id: z.uuid(),
  /** The role that fills it; null when the sender fills it. */
  roleKey: z.string().nullable(),
  type: EsignFieldType,
  pageIndex: z.number().int().min(0),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  required: z.boolean(),
  label: z.string().nullable(),
  mergeKey: EsignMergeKey.nullable(),
  options: z.array(z.string()),
  groupKey: z.string().nullable(),
  value: z.string().nullable(),
});
export type EsignTemplateField = z.infer<typeof EsignTemplateField>;

/** GET /esign/templates/{id}: the template as using it would copy it. */
export const EsignTemplateDetail = EsignTemplateRow.extend({
  /** Same-site address of the template's packet (the page viewer reads it with the session). */
  packetUrl: z.string(),
  pageSizes: z.array(z.object({ width: z.number(), height: z.number() })),
  roles: z.array(EsignTemplateRole),
  fields: z.array(EsignTemplateField),
  routing: EsignRouting,
  expiryDays: z.number().int().min(1).max(365),
  reminders: z.object(EsignReminders.shape),
  expiryWarningDays: z.number().int().min(0).max(30),
  emailSubject: z.string().nullable(),
  emailMessage: z.string().nullable(),
});
export type EsignTemplateDetail = z.infer<typeof EsignTemplateDetail>;

/**
 * POST /esign/requests/{id}/save-as-template: copies the request's packet, recipients (as roles),
 * fields and settings into a new template the caller owns. A DRAFT needs all its files CLEAN
 * (409 SCAN_PENDING). Merge fields stay merge fields; the client's own values are not kept.
 * 409 TEMPLATE_NAME_TAKEN.
 */
export const SaveEsignTemplateBody = z.strictObject({
  name: text(200, 'one', 'Name the template'),
  description: text(1000, 'many').optional(),
  visibility: EsignTemplateVisibility.default('FIRM'),
});
export type SaveEsignTemplateBody = z.input<typeof SaveEsignTemplateBody>;

/** PATCH /esign/templates/{id} (its owner, Owner, Admin): only the keys sent change. */
export const UpdateEsignTemplateBody = z
  .strictObject({
    name: text(200, 'one', 'Name the template').optional(),
    description: clearable(text(1000, 'many')).optional(),
    visibility: EsignTemplateVisibility.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Change at least one thing');
export type UpdateEsignTemplateBody = z.input<typeof UpdateEsignTemplateBody>;

/**
 * POST /esign/templates/{id}/use: a new DRAFT (source TEMPLATE) with a copy of the template; the
 * template itself never changes. CLIENT, SPOUSE and PREPARER roles fill themselves when they can;
 * give `who` for every other role (409 TEMPLATE_ROLES_UNFILLED names the keys still open).
 * 409 TEMPLATE_ARCHIVED, ENGAGEMENT_MISMATCH.
 */
export const UseEsignTemplateBody = z
  .strictObject({
    clientId: z.uuid().optional(),
    engagementId: z.uuid().optional(),
    /** The request's name; the template's name when left out. */
    title: text(200).optional(),
    roles: z
      .array(
        z.strictObject({
          key: z.string().min(1).max(40),
          who: EsignPutRecipient.shape.who,
        }),
      )
      .max(20)
      .default([]),
  })
  .refine((b) => !b.engagementId || b.clientId, {
    path: ['engagementId'],
    message: 'Choose the client first',
  })
  .refine((b) => new Set(b.roles.map((r) => r.key)).size === b.roles.length, {
    path: ['roles'],
    message: 'Each role at most once',
  });
export type UseEsignTemplateBody = z.input<typeof UseEsignTemplateBody>;
