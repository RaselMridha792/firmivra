import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';

// Tax Returns Review 2, Messaging (approved addition): the new-message email to a client. The
// message itself always reaches the client's portal, and the client always gets an email that one
// is waiting (her review: always on; TR-4). The email may also carry the message text (off unless
// chosen, with a warning) and the message's documents as sign-in links into the portal (never a
// file or its contents). Each of those two comes from the send, else the client's saved
// preference, else the firm's default (Messages Settings).

/** What the composer shows when the message text is to go in the email. */
export const MESSAGE_BODY_EMAIL_WARNING =
  "The message text will be in the email; don't include SSNs, account numbers or document contents.";

/** Why documents are only links (our security rule), shown wherever the choice is made. */
export const MESSAGE_DOCUMENTS_AS_LINKS_NOTE =
  'Documents are never attached: the email links to them, and they open after signing in to the portal.';

/**
 * The choices, as resolved for one message. `emailNotice` is always true for a firm message (the
 * one exception is New Message's Email channel, which sends its own email).
 */
export const MessageEmailChoices = z.object({
  emailNotice: z.boolean(),
  emailIncludesBody: z.boolean(),
  emailIncludesDocuments: z.boolean(),
});
export type MessageEmailChoices = z.infer<typeof MessageEmailChoices>;

type Extras = {
  emailIncludesBody?: boolean | null;
  emailIncludesDocuments?: boolean | null;
};

/**
 * The choices for one message: the notice always; the text and the documents from the send, else
 * the client's saved preference, else the firm's default.
 */
export function resolveEmailChoices(
  firm: MessageEmailChoices,
  saved: Extras | null,
  send: Extras = {},
): MessageEmailChoices {
  const pick = (k: keyof Extras) => send[k] ?? saved?.[k] ?? firm[k];
  return {
    emailNotice: true,
    emailIncludesBody: pick('emailIncludesBody'),
    emailIncludesDocuments: pick('emailIncludesDocuments'),
  };
}

/**
 * A firm message's email choices for this send (New Message and a reply): the text and the
 * documents. Each one left out comes from the client's preference, else the firm's default.
 * `saveForClient` keeps this send's choices as the client's preference; without it they apply to
 * this message only. The notice itself is always sent.
 */
export const MessageDelivery = z.strictObject({
  emailIncludesBody: z.boolean().optional(),
  emailIncludesDocuments: z.boolean().optional(),
  saveForClient: z.boolean().optional(),
});
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
 * firm's default, and both null removes the saved preference. Audited.
 */
export const SetClientMessagePreferenceRequest = z.strictObject({
  emailIncludesBody: z.boolean().nullable(),
  emailIncludesDocuments: z.boolean().nullable(),
});
export type SetClientMessagePreferenceRequest = z.input<typeof SetClientMessagePreferenceRequest>;
