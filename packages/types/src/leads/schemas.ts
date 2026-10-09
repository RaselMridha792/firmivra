import { z } from 'zod';
import { ClientAccountType, IntakeStatus, LeadStatus, ScanStatus } from '../db-enums.js';
import { MemberRef } from '../clients/schemas.js';
import { SearchText, text } from '../clients/text.js';
import { DownloadLink } from '../documents/schemas.js';
import { ServiceRef } from '../engagements/schemas.js';
import { IntakeAnswers } from '../intake/answers.js';
import { IntakeFormDefinition } from '../intake/definition.js';

export { DownloadLink, LeadStatus };

// Leads (R11): Begin Online requests as the firm reviews them. Firm routes under
// /api/v1/business/leads, Owner, Admin and Staff (a lead has no client yet, so every member of
// the firm sees every lead; another firm's lead is 404). A lead the visitor has not sent yet
// (DRAFT, or a draft that ran out: EXPIRED) is never shown to the firm. Converting creates the
// client (or uses an existing one), an ACTIVE engagement for the lead's service, carries the
// intake and its files over, and emails the visitor an invitation to the client portal.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

export const LeadId = z.uuid();

/** The statuses the firm sees: a lead the visitor sent, and what the firm did with it. */
export const ReviewedLeadStatus = LeadStatus.exclude(['DRAFT', 'EXPIRED']);
export type ReviewedLeadStatus = z.infer<typeof ReviewedLeadStatus>;

/** One row of the leads inbox. */
export const LeadListItem = z.object({
  id: z.uuid(),
  status: ReviewedLeadStatus,
  service: ServiceRef,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  /** The year the firm prepares, for tax services. */
  taxYear: z.number().int().nullable(),
  submittedAt: DateTime,
  createdAt: DateTime,
});
export type LeadListItem = z.infer<typeof LeadListItem>;

/**
 * GET /business/leads. Newest sent first. Search matches the name, email and phone. All the
 * statuses the firm sees unless one is given.
 */
export const ListLeadsQuery = z.strictObject({
  status: ReviewedLeadStatus.optional(),
  serviceId: z.uuid().optional(),
  search: SearchText.optional(),
  /** From the previous page's nextCursor. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListLeadsQuery = z.input<typeof ListLeadsQuery>;

export const LeadList = z.object({
  items: z.array(LeadListItem).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type LeadList = z.infer<typeof LeadList>;

/** GET /business/leads/count: the leads waiting for the firm (SUBMITTED and IN_REVIEW). */
export const LeadCounts = z.object({ submitted: z.number().int(), inReview: z.number().int() });
export type LeadCounts = z.infer<typeof LeadCounts>;

/** A file the visitor uploaded into one of the form's upload slots. */
export const LeadUpload = z.object({
  id: z.uuid(),
  /** The upload field's key in the definition. */
  slot: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  /** Only CLEAN files can be downloaded. */
  scanStatus: ScanStatus,
  createdAt: DateTime,
});
export type LeadUpload = z.infer<typeof LeadUpload>;

/** The lead's intake: the form version the visitor filled and the answers they sent. */
export const LeadIntake = z.object({
  id: z.uuid(),
  status: IntakeStatus,
  formVersion: z.number().int(),
  /** The definition the answers follow, to lay them out step by step. */
  definition: IntakeFormDefinition,
  /** SSN and EIN answers come back as `{ last4 }` only. */
  answers: IntakeAnswers,
  uploads: z.array(LeadUpload),
});
export type LeadIntake = z.infer<typeof LeadIntake>;

/** GET /business/leads/{id}: the lead with its answers, for review. */
export const LeadDetail = LeadListItem.extend({
  intake: LeadIntake.nullable(),
  reviewedAt: DateTime.nullable(),
  reviewedBy: MemberRef.nullable(),
  /** The firm's reason, when DECLINED. Never sent to the visitor. */
  declineReason: z.string().nullable(),
  /** Set when CONVERTED: the client and the engagement the lead became. */
  client: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  engagementId: z.uuid().nullable(),
});
export type LeadDetail = z.infer<typeof LeadDetail>;

/**
 * POST /business/leads/{id}/convert, from SUBMITTED or IN_REVIEW. Without `clientId` a new
 * client is created from the lead's name, email and phone (409 DUPLICATE_EMAIL when another
 * client has that email: pick that client instead). With it, the engagement goes to that
 * existing, not archived client. The engagement title defaults to the service's name (and tax
 * year). Staff are assigned their new client and engagement; Owner and Admin may name a member.
 */
export const ConvertLeadRequest = z.strictObject({
  clientId: z.uuid().optional(),
  /** For a new client; default INDIVIDUAL. */
  accountType: ClientAccountType.optional(),
  title: text(200).optional(),
  assignedUserId: z.uuid().optional(),
  /** Email the visitor an invitation to sign up on the client portal. Default true. */
  sendPortalInvite: z.boolean().optional().default(true),
});
export type ConvertLeadRequest = z.input<typeof ConvertLeadRequest>;

export const ConvertLeadResponse = z.object({
  lead: LeadDetail,
  clientId: z.uuid(),
  engagementId: z.uuid(),
  /** False when the invitation email could not be sent (the conversion still stands). */
  inviteSent: z.boolean(),
});
export type ConvertLeadResponse = z.infer<typeof ConvertLeadResponse>;

/** POST /business/leads/{id}/decline, from SUBMITTED or IN_REVIEW. The reason stays in the firm. */
export const DeclineLeadRequest = z.strictObject({ reason: text(1000, 'many') });
export type DeclineLeadRequest = z.input<typeof DeclineLeadRequest>;

export const LeadErrorCode = z.enum([
  'NOT_FOUND',
  'VALIDATION_FAILED',
  /** Not SUBMITTED or IN_REVIEW (already converted or declined). */
  'INVALID_STATUS',
  'DUPLICATE_EMAIL',
  'CLIENT_ARCHIVED',
  /** The file is not CLEAN (still scanning, infected or failed). */
  'FILE_NOT_AVAILABLE',
  'FORBIDDEN',
]);
export type LeadErrorCode = z.infer<typeof LeadErrorCode>;
