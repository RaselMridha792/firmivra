import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  EsignChosenAuthMethod,
  EsignDelivery,
  EsignFieldType,
  EsignMergeKey,
  EsignRecipientKind,
  EsignRecipientRole,
  EsignRouting,
} from './enums.js';
import {
  EsignAccessCode,
  EsignExpiryDays,
  EsignExpiryWarningDays,
  EsignReminders,
  EsignWhoClientLogin,
  EsignWhoExternal,
  EsignWhoStaff,
} from './schemas.js';

// Firm Sign (R13), firm side, contract 2: Signing Settings and templates (save as template, use a
// template). Same access rules as the requests (schemas.ts); settings change only by Owner and
// Admin (403 FORBIDDEN otherwise). Template versions, duplicate and Firm Sign roles are in
// extras.ts.

const DateTime = z.iso.datetime({ offset: true });

// ---------- Settings ----------
/** The firm's defaults for new requests. */
export const EsignDefaults = z.object({
  expiryDays: EsignExpiryDays,
  reminders: z.object(EsignReminders.shape),
  /** Days before expiry that open signers get a warning; 0 for none. */
  expiryWarningDays: EsignExpiryWarningDays,
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
    expiryDays: EsignExpiryDays.optional(),
    reminders: EsignReminders.optional(),
    expiryWarningDays: EsignExpiryWarningDays.optional(),
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
/**
 * FIRM: everyone in Firm Sign may use it (and a Firm Sign Manager may change it). PRIVATE: only its
 * owner (and Owner and Admin).
 */
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
  /** The caller may rename, change or archive it (its owner, Owner, Admin, or a Manager for FIRM). */
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
  /**
   * Same-site address of the template's packet, `/api/v1/esign/templates/{id}/packet`
   * (`api.esign.templates.packetUrl(id)` builds the same): the page viewer reads it with the
   * session. Only CLEAN bytes, as a template only ever holds CLEAN files.
   */
  packetUrl: z.string(),
  pageSizes: z.array(z.object({ width: z.number(), height: z.number() })),
  roles: z.array(EsignTemplateRole),
  fields: z.array(EsignTemplateField),
  routing: EsignRouting,
  expiryDays: EsignExpiryDays,
  reminders: z.object(EsignReminders.shape),
  expiryWarningDays: EsignExpiryWarningDays,
  emailSubject: z.string().nullable(),
  emailMessage: z.string().nullable(),
});
export type EsignTemplateDetail = z.infer<typeof EsignTemplateDetail>;

/**
 * POST /esign/requests/{id}/save-as-template: a new template the caller owns, PRIVATE unless
 * `visibility` says FIRM. Nothing of one client may reach a template, so exactly this is copied:
 * - Copied: the files the sender uploaded (their pages, order and rotation), the recipients as
 *   roles (kind, role, label, routing order, auth method, colour; never who they were), every
 *   field's place, type, label, options and merge key, the sender's own typed values (fields with
 *   no recipient and no merge key), and routing, expiry, reminders, email subject and message.
 * - Not copied: the client, service, internal note and recipients' names, emails and access
 *   codes; values filled from merge fields (the merge key stays, so the next request fills it
 *   from its own client); anything a signer entered.
 * - Refused: a file copied from the client's documents (`from-vault`, INTERNAL ones included):
 *   409 TEMPLATE_HAS_CLIENT_FILES; remove it and upload a blank copy instead. Files still being
 *   checked or blocked: 409 SCAN_PENDING, FILE_BLOCKED.
 * 409 TEMPLATE_NAME_TAKEN. save-as-version (extras.ts) copies and refuses the same way.
 */
export const SaveEsignTemplateBody = z.strictObject({
  name: text(200, 'one', 'Name the template'),
  description: text(1000, 'many').optional(),
  visibility: EsignTemplateVisibility.default('PRIVATE'),
});
export type SaveEsignTemplateBody = z.input<typeof SaveEsignTemplateBody>;

/** PATCH /esign/templates/{id} (its owner, Owner, Admin, a Manager for FIRM): only keys sent change. */
export const UpdateEsignTemplateBody = z
  .strictObject({
    name: text(200, 'one', 'Name the template').optional(),
    description: clearable(text(1000, 'many')).optional(),
    visibility: EsignTemplateVisibility.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Change at least one thing');
export type UpdateEsignTemplateBody = z.input<typeof UpdateEsignTemplateBody>;

type RoleFillInput = {
  who?: { type: string } | undefined;
  delivery?: EsignDelivery | undefined;
  authMethod?: EsignChosenAuthMethod | undefined;
  accessCode?: string | undefined;
};
/** EsignPutRecipient's rules for the parts of a role fill the body can check on its own. */
const checkRoleFill = (r: RoleFillInput, ctx: z.RefinementCtx) => {
  if (!r.who && !r.delivery && !r.authMethod && !r.accessCode) {
    ctx.addIssue({ code: 'custom', path: ['who'], message: 'Choose who fills this role' });
  }
  if (r.delivery === 'PORTAL' && r.who && r.who.type !== 'CLIENT_LOGIN') {
    ctx.addIssue({
      code: 'custom',
      path: ['delivery'],
      message: 'Only the client’s own login can sign in the portal',
    });
  }
  if (r.authMethod === 'ACCESS_CODE' && r.delivery !== 'IN_PERSON' && !r.accessCode) {
    ctx.addIssue({ code: 'custom', path: ['accessCode'], message: 'Set an access code' });
  }
};
const roleFillShape = {
  key: z.string().min(1).max(40),
  /** EMAIL when left out. PORTAL only for a client's login; IN_PERSON only for a SIGNER role. */
  delivery: EsignDelivery.optional(),
  /** The role's own method when left out. */
  authMethod: EsignChosenAuthMethod.optional(),
  /** Needed when the method is ACCESS_CODE, unless IN_PERSON. Ignored for any other method. */
  accessCode: EsignAccessCode.optional(),
};

/**
 * How one template role is filled when the template is used, with EsignPutRecipient's rules:
 * - `who`: the person. Leave it out on a CLIENT, SPOUSE or PREPARER role to keep the automatic
 *   fill (for example to give only its access code); every other role needs it.
 * - A role whose method (the fill's `authMethod`, else the template's) is ACCESS_CODE needs an
 *   `accessCode` unless its `delivery` is IN_PERSON: the body refuses one with `authMethod`
 *   ACCESS_CODE and no code (400), and the API counts a template ACCESS_CODE role without one as
 *   unfilled (409 TEMPLATE_ROLES_UNFILLED). The code is never stored on the template.
 */
export const EsignTemplateRoleFill = z
  .strictObject({
    ...roleFillShape,
    who: z
      .discriminatedUnion('type', [EsignWhoClientLogin, EsignWhoStaff, EsignWhoExternal])
      .optional(),
  })
  .superRefine(checkRoleFill);
export type EsignTemplateRoleFill = z.input<typeof EsignTemplateRoleFill>;

/** A bulk send's role fill: as EsignTemplateRoleFill, but never a client login (extras.ts). */
export const EsignBulkRoleFill = z
  .strictObject({
    ...roleFillShape,
    who: z.discriminatedUnion('type', [EsignWhoStaff, EsignWhoExternal]).optional(),
  })
  .superRefine(checkRoleFill);
export type EsignBulkRoleFill = z.input<typeof EsignBulkRoleFill>;

/**
 * POST /esign/templates/{id}/use: a new DRAFT (source TEMPLATE) with a copy of the template; the
 * template itself never changes. CLIENT, SPOUSE and PREPARER roles fill themselves when they can;
 * `roles` fills every other role and sets delivery and access codes (EsignTemplateRoleFill).
 * 409 TEMPLATE_ROLES_UNFILLED names the keys still open (no one, or no access code), and
 * TEMPLATE_ARCHIVED, ENGAGEMENT_MISMATCH.
 */
export const UseEsignTemplateBody = z
  .strictObject({
    clientId: z.uuid().optional(),
    engagementId: z.uuid().optional(),
    /** The request's name; the template's name when left out. */
    title: text(200).optional(),
    roles: z.array(EsignTemplateRoleFill).max(20).default([]),
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
