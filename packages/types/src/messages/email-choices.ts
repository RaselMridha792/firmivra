import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';

// Tax Returns Review 2, Messaging (approved addition): the new-message email to a client. The
// message itself always reaches the client's portal; separately, the email says one is waiting
// (on by default), and may carry the message text (off unless chosen, with a warning) and the
// message's documents as sign-in links into the portal (never a file or its contents). Each
// choice comes from the send, else the client's saved preference, else the firm's default
// (Messages Settings).

/** What the composer shows when the message text is to go in the email. */
export const MESSAGE_BODY_EMAIL_WARNING =
  "The message text will be in the email; don't include SSNs, account numbers or document contents.";

/** The three choices, as resolved for one message. */
export const MessageEmailChoices = z.object({
  emailNotice: z.boolean(),
  emailIncludesBody: z.boolean(),
  emailIncludesDocuments: z.boolean(),
});
export type MessageEmailChoices = z.infer<typeof MessageEmailChoices>;

type Partial3 = {
  emailNotice?: boolean | null;
  emailIncludesBody?: boolean | null;
  emailIncludesDocuments?: boolean | null;
};

/** The message text and documents go only in an email that is sent. */
const extrasNeedEmail = (b: Partial3) =>
  b.emailNotice !== false || (b.emailIncludesBody !== true && b.emailIncludesDocuments !== true);
const EXTRAS_NEED_EMAIL = {
  message: 'The message text and documents go only in an email that is sent',
  path: ['emailNotice'],
};

/**
 * The choices for one message: the send's, else the client's saved preference, else the firm's
 * default. No extra without the email.
 */
export function resolveEmailChoices(
  firm: MessageEmailChoices,
  saved: Partial3 | null,
  send: Partial3 = {},
): MessageEmailChoices {
  const pick = (k: keyof MessageEmailChoices) => send[k] ?? saved?.[k] ?? firm[k];
  const emailNotice = pick('emailNotice');
  return {
    emailNotice,
    emailIncludesBody: emailNotice && pick('emailIncludesBody'),
    emailIncludesDocuments: emailNotice && pick('emailIncludesDocuments'),
  };
}

/**
 * A firm message's email choices for this send (New Message and a reply). Each one left out
 * comes from the client's preference, else the firm's default. `saveForClient` keeps this send's
 * resolved choices as the client's preference; without it they apply to this message only.
 */
export const MessageDelivery = z
  .strictObject({
    emailNotice: z.boolean().optional(),
    emailIncludesBody: z.boolean().optional(),
    emailIncludesDocuments: z.boolean().optional(),
    saveForClient: z.boolean().optional(),
  })
  .refine(extrasNeedEmail, EXTRAS_NEED_EMAIL);
export type MessageDelivery = z.input<typeof MessageDelivery>;

/**
 * GET /business/clients/{id}/message-preference: the firm's defaults, the client's saved choices
 * (each null keeps the firm's), and what a message to this client gets unless the send says
 * otherwise. Staff who reach the client.
 */
export const ClientMessagePreference = z.object({
  firm: MessageEmailChoices,
  saved: z
    .object({
      emailNotice: z.boolean().nullable(),
      emailIncludesBody: z.boolean().nullable(),
      emailIncludesDocuments: z.boolean().nullable(),
      updatedAt: z.iso.datetime({ offset: true }),
      updatedBy: MemberRef.nullable(),
    })
    .nullable(),
  effective: MessageEmailChoices,
  /** Whether a message's text may go in an email at all (the platform's switch); off hides it. */
  bodyAllowed: z.boolean(),
});
export type ClientMessagePreference = z.infer<typeof ClientMessagePreference>;

/**
 * PUT /business/clients/{id}/message-preference: the client's saved choices; null keeps the
 * firm's default, and all three null removes the saved preference. Audited.
 */
export const SetClientMessagePreferenceRequest = z
  .strictObject({
    emailNotice: z.boolean().nullable(),
    emailIncludesBody: z.boolean().nullable(),
    emailIncludesDocuments: z.boolean().nullable(),
  })
  .refine(extrasNeedEmail, EXTRAS_NEED_EMAIL);
export type SetClientMessagePreferenceRequest = z.input<typeof SetClientMessagePreferenceRequest>;
