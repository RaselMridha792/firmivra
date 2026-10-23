import { z } from 'zod';
import { text } from '../clients/text.js';

// The firm's tags (L5 and L6 of Octavia's Oct 20 Leads review): one list shared by Leads and
// Clients (the `tags` table). A name is unique among the firm's tags ignoring case and outer
// spaces, so a name typed in another case is that tag, never a second one. Owner and Admin add
// tags; every member applies the existing ones to the leads and clients they may edit. Firm
// routes: GET and POST /api/v1/business/tags; a client's tags at /business/clients/{id}/tags.

/** The longest tag name (the leads contract's limit; the database allows 50). */
export const TAG_NAME_MAX = 40;
export const TagName = text(TAG_NAME_MAX, 'one', 'Enter a tag name');

/** One of the firm's tags, with how many open leads and clients carry it. */
export const FirmTag = z.object({
  id: z.uuid(),
  name: z.string(),
  leads: z.number().int(),
  clients: z.number().int(),
});
export type FirmTag = z.infer<typeof FirmTag>;

/** GET /business/tags: every live tag of the firm, by name. */
export const FirmTagList = z.object({ items: z.array(FirmTag) });
export type FirmTagList = z.infer<typeof FirmTagList>;

/**
 * POST /business/tags (Add New Tag): Owner and Admin, 201 with the tag. 409 TAG_EXISTS when the
 * firm has the name already (in any case); 403 for other members.
 */
export const CreateTagRequest = z.strictObject({ name: TagName });
export type CreateTagRequest = z.input<typeof CreateTagRequest>;

/** GET /business/clients/{id}/tags: the client's tag names, by name. */
export const ClientTags = z.object({ tags: z.array(z.string()) });
export type ClientTags = z.infer<typeof ClientTags>;

/**
 * PUT /business/clients/{id}/tags: the client's tags, replaced (an empty list removes them all).
 * A name the firm has (any case) is that tag; a new name is added to the firm's list for Owner and
 * Admin, and 400 UNKNOWN_TAG for other members. Repeats are kept once. Staff: their own clients.
 */
export const SetClientTagsRequest = z.strictObject({ tags: z.array(TagName).max(20) });
export type SetClientTagsRequest = z.input<typeof SetClientTagsRequest>;

/** The `error.code` values of the tag routes. */
export const TagErrorCode = z.enum(['TAG_EXISTS', 'UNKNOWN_TAG']);
export type TagErrorCode = z.infer<typeof TagErrorCode>;

/** The tag routes' refusals in words. */
export const TAG_ERRORS: Record<TagErrorCode, string> = {
  TAG_EXISTS: 'The firm already has a tag with this name.',
  UNKNOWN_TAG: 'Only an Owner or Admin can add a new tag. Choose one from the list.',
};
