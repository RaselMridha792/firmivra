import { z } from 'zod';
import { PublicLink } from '../public-links/schemas.js';

// Intake Forms Review Two, INTAKE-ACCESS-02 (Octavia; decisions approved Nov 15): a published form
// can be shared with anyone by a stable link and a website button, and published in the client
// portal (off by default). The link starts the form for a visitor without an account as Begin
// Online does (a lead, source Website Form, routed when sent). A draft or an archived form takes
// no new use; turning sharing off makes the link refuse at once.

/** The share link's page on the portal: `/{firmSlug}/start/{token}`. */
export const INTAKE_SHARE_PATH = 'start';

/**
 * GET /business/intake-forms/{id}/share: how the form is shared. A main form (a service's
 * default, one of the six) is reached through its Begin Online page as before (`main`); every other
 * published form has its own share link while `sharing` is on.
 */
export const IntakeShare = z.object({
  templateId: z.uuid(),
  /** The service's main form: its link is the Begin Online page, always on while published. */
  main: z.boolean(),
  /** Published (a live version), not archived, and one of the six intake forms. */
  shareable: z.boolean(),
  /** Its share link answers (another form's: always false for a main form). */
  sharing: z.boolean(),
  /** Publish in client portal: listed for every client of the firm, whatever their services. */
  portalPublished: z.boolean(),
  /** The link and the website button: the share link, or a main form's Begin Online page. */
  link: PublicLink.nullable(),
});
export type IntakeShare = z.infer<typeof IntakeShare>;

/** PUT /business/intake-forms/{id}/share (Owner and Admin). 409 NOT_SHAREABLE for a draft. */
export const SaveIntakeShareRequest = z.strictObject({
  sharing: z.boolean(),
  portalPublished: z.boolean(),
});
export type SaveIntakeShareRequest = z.input<typeof SaveIntakeShareRequest>;

/** The share link's token: 32 bytes, base64url (43 characters). */
export const IntakeShareToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Not a valid link');
