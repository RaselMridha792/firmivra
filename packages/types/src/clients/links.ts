import { z } from 'zod';
import { ClientAccountType, ClientLinkRole } from '../db-enums.js';
import { text } from './text.js';

// Clients Review 2 (G9): two client profiles of one firm linked to each other, e.g. a Business
// and the Personal profile of its owner or responsible party. One link per pair; both profiles
// list it. Staff reach a link only when both clients are theirs (404 otherwise).

/**
 * One link as a profile lists it. `side` says how to read `role`: LINKED, the other profile is
 * the `role` of this one (its Owner); ADDED_TO, this profile is the `role` of the other one (this
 * person owns that business).
 */
export const ClientLink = z.object({
  id: z.uuid(),
  other: z.object({
    id: z.uuid(),
    displayName: z.string(),
    accountType: ClientAccountType,
    /** "CL-10023". */
    clientNumber: z.string(),
    archived: z.boolean(),
  }),
  role: ClientLinkRole,
  side: z.enum(['LINKED', 'ADDED_TO']),
  note: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type ClientLink = z.infer<typeof ClientLink>;

export const ClientLinkList = z.object({ items: z.array(ClientLink).max(200) });
export type ClientLinkList = z.infer<typeof ClientLinkList>;

/**
 * POST /business/clients/{id}/links: `role` is what the linked client is to this one. 409
 * ALREADY_LINKED for a pair already linked (either way), 400 SELF_LINK for the client itself, 404
 * for a client out of reach, 409 CLIENT_ARCHIVED when either is archived.
 */
export const AddClientLinkRequest = z.strictObject({
  linkedClientId: z.uuid(),
  role: ClientLinkRole,
  note: text(200).optional(),
});
export type AddClientLinkRequest = z.input<typeof AddClientLinkRequest>;

/** PATCH /business/clients/{id}/links/{linkId}: the role or the note ("" or null clears it). */
export const UpdateClientLinkRequest = z
  .strictObject({
    role: ClientLinkRole.optional(),
    note: z.union([text(200), z.literal(''), z.null()]).optional(),
  })
  .refine((b) => b.role !== undefined || b.note !== undefined, 'Change the role or the note');
export type UpdateClientLinkRequest = z.input<typeof UpdateClientLinkRequest>;
