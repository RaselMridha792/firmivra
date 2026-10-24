import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { text } from '../clients/text.js';
import { SupportTicketStatus } from '../db-enums.js';
import { Ein } from '../firm-applications/schemas.js';

// Company Profile "Request Change" (settings review of Oct 20, P3; her Company Profile guide B2,
// B3 and E4). The legal company name, the EIN and the professional licensing details are never
// edited by the firm: an Owner or Admin asks Firmivra to change them. Rasel's default (Oct 24):
// the request is a support ticket to the Super Admin team (source Portal, unassigned, in the
// queue) with the current and proposed values and the reason; the card shows its number and
// status. Nothing on the profile changes until Firmivra applies it.
// API: /api/v1/business/settings/profile/change-requests. Owner and Admin, also while the firm is
// Pending Setup. Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });

/** Refused by the support tickets' check but not by `text`: the soft hyphen, U+034F, U+17B4,
 * U+17B5 and the line and paragraph separators. */
const TICKET_REFUSED = new Set([0xad, 0x34f, 0x17b4, 0x17b5, 0x2028, 0x2029]);
/** What that check counts as blank: spaces, the invisible spaces and the variation selectors. */
const blank = (c: string) => {
  const cp = c.codePointAt(0) ?? 0;
  return (
    /\s/.test(c) ||
    [0xa0, 0x1680, 0x202f, 0x205f, 0x2800, 0x3000].includes(cp) ||
    (cp >= 0x2000 && cp <= 0x200f) ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  );
};

/**
 * `text`, with the support tickets' own check (`platform_text_ok`), so such a value is a 400 here
 * rather than a database error: none of those characters, and one visible character.
 */
const ticketText = (max: number, lines: 'one' | 'many' = 'one', empty = 'Enter a value') =>
  text(max, lines, empty)
    .refine(
      (v) => ![...v].some((c) => TICKET_REFUSED.has(c.codePointAt(0) ?? 0)),
      'Remove the special characters',
    )
    .refine((v) => [...v].some((c) => !blank(c)), empty);

export const ProfileChangeKind = z.enum(['COMPANY', 'LICENSING']);
export type ProfileChangeKind = z.infer<typeof ProfileChangeKind>;

/** Each card's title: the request's subject starts with it. */
export const PROFILE_CHANGE_KIND_LABELS: Readonly<Record<ProfileChangeKind, string>> = {
  COMPANY: 'Company Information',
  LICENSING: 'Professional Licensing',
};

/** The locked fields, in the cards' order, with the card each belongs to and its label. */
export const PROFILE_CHANGE_FIELDS = {
  legalName: { kind: 'COMPANY', label: 'Legal Company Name' },
  ein: { kind: 'COMPANY', label: 'EIN (Tax ID)' },
  regulatoryBody: { kind: 'LICENSING', label: 'Regulatory Body' },
  licenseType: { kind: 'LICENSING', label: 'License Type' },
  licenseNumber: { kind: 'LICENSING', label: 'License Number' },
  expirationDate: { kind: 'LICENSING', label: 'Expiration Date' },
} as const satisfies Record<string, { kind: ProfileChangeKind; label: string }>;
export type ProfileChangeField = keyof typeof PROFILE_CHANGE_FIELDS;
export const ProfileChangeField = z.enum(
  Object.keys(PROFILE_CHANGE_FIELDS) as [ProfileChangeField, ...ProfileChangeField[]],
);

/** What the firm reads for each support status (the Super Admin queue's own words differ). */
export const PROFILE_CHANGE_STATUS_LABELS: Readonly<Record<SupportTicketStatus, string>> = {
  OPEN: 'Submitted',
  IN_PROGRESS: 'In Review',
  WAITING_ON_CUSTOMER: 'Waiting on You',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

/**
 * POST: Submit in the Request Change dialog. Only the fields to change, each with its proposed
 * value, all of one card (`kind`); at least one. The current values come from the server.
 */
export const CreateProfileChangeRequest = z
  .strictObject({
    /** One per dialog opening: a double click or a retry never makes two requests. */
    requestId: z.uuid(),
    kind: ProfileChangeKind,
    changes: z.strictObject({
      legalName: ticketText(200).optional(),
      ein: Ein.optional(),
      regulatoryBody: ticketText(120).optional(),
      licenseType: ticketText(80).optional(),
      licenseNumber: ticketText(60).optional(),
      expirationDate: z.iso.date('Enter a date').optional(),
    }),
    reason: ticketText(2000, 'many', 'Say why the change is needed'),
  })
  .superRefine((body, ctx) => {
    const fields = Object.keys(body.changes) as ProfileChangeField[];
    if (fields.length === 0)
      ctx.addIssue({ code: 'custom', path: ['changes'], message: 'Enter at least one new value' });
    for (const field of fields)
      if (PROFILE_CHANGE_FIELDS[field].kind !== body.kind)
        ctx.addIssue({
          code: 'custom',
          path: ['changes', field],
          message: `Ask for this on the ${PROFILE_CHANGE_KIND_LABELS[PROFILE_CHANGE_FIELDS[field].kind]} card`,
        });
  });
export type CreateProfileChangeRequest = z.input<typeof CreateProfileChangeRequest>;

/** A change request as the firm sees it. */
export const ProfileChange = z.object({
  id: z.uuid(),
  /** The support ticket's number ("#1004"), the reference Firmivra uses. */
  number: z.string(),
  kind: ProfileChangeKind,
  /** The fields asked about, in the cards' order. */
  fields: z.array(ProfileChangeField),
  status: SupportTicketStatus,
  submittedAt: DateTime,
  /** The member who asked. */
  submittedBy: z.string(),
  /** When Firmivra resolved or closed it; null while it is open. */
  closedAt: DateTime.nullable(),
  /** Firmivra's latest reply sent to the firm; null until there is one. */
  latestReply: z.object({ body: z.string(), at: DateTime }).nullable(),
});
export type ProfileChange = z.infer<typeof ProfileChange>;

/** The firm's change requests, newest first, at most 20. */
export const ProfileChangeList = z.object({ items: z.array(ProfileChange).max(20) });
export type ProfileChangeList = z.infer<typeof ProfileChangeList>;

const BASE = '/business/settings/profile/change-requests';

/**
 * `api.profileChanges` (apps/web/src/lib/api.ts): Company Profile's Request Change. Owner and
 * Admin only (403 for staff). Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED')
 * before anything is sent.
 */
export function createProfileChangesClient(request: ApiRequest) {
  return {
    list: async (): Promise<ProfileChangeList> => request(ProfileChangeList, BASE),
    /**
     * Sends the request to Firmivra's Super Admin team. The same `requestId` again answers the
     * first request. 400 VALIDATION_FAILED when a proposed value is already the current one.
     */
    create: async (body: CreateProfileChangeRequest): Promise<ProfileChange> =>
      request(ProfileChange, BASE, {
        method: 'POST',
        body: parseInput(CreateProfileChangeRequest, body),
      }),
  };
}
export type ProfileChangesClient = ReturnType<typeof createProfileChangesClient>;
