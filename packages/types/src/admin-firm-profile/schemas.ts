import { z } from 'zod';
import { BusinessStatus, SupportTicketStatus } from '../db-enums.js';
import { Ein } from '../firm-applications/schemas.js';
import { ProfileChangeField, ProfileChangeKind } from '../settings/profile-changes.js';
import { ticketText } from '../settings/ticket-text.js';

// The Super Admin applies a firm's approved Request Change (R56, Rasel Oct 24; R60's Needs). A
// firm never edits its legal name, EIN or licensing after activation: on Company Profile it asks
// Firmivra with a support ticket that holds the current and proposed values (R60). On the firm's
// page the Super Admin sees those requests and applies one, the values prefilled from the ticket
// and confirmed; then resolves the ticket, which is how the firm hears of it. Today the legal
// name and the EIN apply; licensing once its table lands (R1, R60's item 7).
// API: /api/v1/admin/firms/{id}/profile-changes. Super Admin only (403 for anyone else); another
// firm's ticket is 404. Requests are strict; responses are plain objects.

const DateTime = z.iso.datetime({ offset: true });

export const AdminFirmId = z.uuid();
export const ProfileChangeTicketId = z.uuid();

/** What applying changes today. Licensing fields are read and shown, not applied yet. */
export const APPLICABLE_PROFILE_FIELDS = [
  'legalName',
  'ein',
] as const satisfies readonly ProfileChangeField[];
export type ApplicableProfileField = (typeof APPLICABLE_PROFILE_FIELDS)[number];

const Values = z.partialRecord(ProfileChangeField, z.string());

/** One Request Change of the firm, read from its support ticket. */
export const FirmProfileChangeRequest = z.object({
  ticketId: z.uuid(),
  /** The ticket's number ("#1004"). */
  number: z.string(),
  kind: ProfileChangeKind,
  /** The fields asked about, in the cards' order. */
  fields: z.array(ProfileChangeField),
  status: SupportTicketStatus,
  submittedAt: DateTime,
  /** As the ticket shows them when it was raised ("Not on file", "Ending in 6789"). */
  current: Values,
  /** The proposed values as the firm wrote them (an EIN as "98-7654321"). */
  proposed: Values,
  reason: z.string().nullable(),
  /** The latest time it was applied; null until then. */
  applied: z
    .object({ at: DateTime, by: z.string().nullable(), fields: z.array(ProfileChangeField) })
    .nullable(),
});
export type FirmProfileChangeRequest = z.infer<typeof FirmProfileChangeRequest>;

/** GET: the firm as the Super Admin sees it, and its Request Change tickets, newest first. */
export const FirmProfileChanges = z.object({
  firm: z.object({
    id: z.uuid(),
    name: z.string(),
    legalName: z.string().nullable(),
    status: BusinessStatus,
  }),
  requests: z.array(FirmProfileChangeRequest),
});
export type FirmProfileChanges = z.infer<typeof FirmProfileChanges>;

/**
 * POST .../{ticketId}/apply: the values to apply, each one of the fields the ticket asks about
 * (400 NOT_REQUESTED otherwise). At least one.
 */
export const ApplyProfileChangeRequest = z
  .strictObject({
    legalName: ticketText(200, 'one', 'Enter the legal name').optional(),
    ein: Ein.optional(),
  })
  .refine((b) => b.legalName !== undefined || b.ein !== undefined, {
    message: 'Enter a value to apply',
  });
export type ApplyProfileChangeRequest = z.input<typeof ApplyProfileChangeRequest>;

export const AppliedProfileChange = z.object({
  ticketId: z.uuid(),
  fields: z.array(ProfileChangeField),
  legalName: z.string().nullable(),
  /** The applied EIN's last four digits; the EIN itself is never returned. */
  einLast4: z.string().nullable(),
  appliedAt: DateTime,
});
export type AppliedProfileChange = z.infer<typeof AppliedProfileChange>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const FirmProfileErrorCode = z.enum([
  /** 409: the firm is still in setup (it edits these itself) or closed. */
  'FIRM_NOT_ACTIVE',
  /** 409: the ticket is closed; reopen it first. */
  'TICKET_CLOSED',
  /** 400: a value for a field the ticket does not ask about, or one that cannot apply yet. */
  'NOT_REQUESTED',
  /** 409: another firm's application has this EIN. */
  'DUPLICATE_EIN',
  /** 503: the EIN cannot be sealed with the firm's key right now. */
  'ENCRYPTION_UNAVAILABLE',
]);
export type FirmProfileErrorCode = z.infer<typeof FirmProfileErrorCode>;

/** The screen's words for this module's errors (`errorMessage(error, FIRM_PROFILE_ERRORS)`). */
export const FIRM_PROFILE_ERRORS: Readonly<Record<string, string>> = {
  FIRM_NOT_ACTIVE:
    'This firm is still in setup or closed. It changes these details itself in setup.',
  TICKET_CLOSED: 'This request is closed. Reopen the ticket to apply it.',
  NOT_REQUESTED: 'Apply only what the request asks for.',
  DUPLICATE_EIN: "Another firm's application has this EIN. Check it with the firm before applying.",
  ENCRYPTION_UNAVAILABLE: 'The EIN cannot be saved right now. Try again later.',
  NOT_FOUND: 'This request is not one of this firm’s.',
};
