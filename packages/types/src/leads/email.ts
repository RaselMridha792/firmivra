import { z } from 'zod';

// Lead email formatting (L4 of Octavia's Oct 20 Leads review): the Send Email composer writes
// HTML (bold, italic, the fonts and sizes below, images the firm uploaded), the member keeps a
// saved signature that may carry the firm's email logo, and the recipient gets the same
// formatting. The API cleans the HTML to exactly these rules; anything else is removed, never
// sent. Images are served from a public address (as any emailed image is) under the firm's
// portal: `{PORTAL_BASE_URL}/api/v1/portal/{firmSlug}/email-images/{id}.{png|jpg|gif}`.

const DateTime = z.iso.datetime({ offset: true });

/** The fonts the composer offers. `stack` is the CSS font-family the email carries. */
export const EMAIL_FONTS = [
  { key: 'ARIAL', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { key: 'GEORGIA', label: 'Georgia', stack: 'Georgia, serif' },
  { key: 'TIMES', label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { key: 'VERDANA', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { key: 'TAHOMA', label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
  { key: 'TREBUCHET', label: 'Trebuchet MS', stack: '"Trebuchet MS", Helvetica, sans-serif' },
  { key: 'COURIER', label: 'Courier New', stack: '"Courier New", Courier, monospace' },
] as const;
export type EmailFont = (typeof EMAIL_FONTS)[number];

/** The font sizes the composer offers, in pixels. 16 is the email's default. */
export const EMAIL_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32] as const;

/** Inline image rules: the upload, and the width an image may be placed at (the email is 600 px wide). */
export const EMAIL_IMAGE_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  /** WebP and SVG are left out: Outlook and some phones do not show them. */
  contentTypes: ['image/png', 'image/jpeg', 'image/gif'],
  minWidth: 24,
  maxWidth: 600,
} as const;

/** The longest email HTML the API takes, in characters (the text itself stays within 5000). */
export const EMAIL_HTML_MAX = 100_000;

/** A saved signature, as cleaned HTML, in characters (message_signatures allows 1000). */
export const EMAIL_SIGNATURE_MAX = 1000;

/**
 * GET /business/me/message-signature: the signed-in member's own email signature, inserted at
 * the end of a new email (the member can change it there before sending). `logoUrl` is the
 * firm's email logo (or its logo) for "Insert firm logo"; null when the firm has none.
 */
export const MessageSignature = z.object({
  /** Cleaned HTML, by the same rules as an email; null until the member saves one. */
  html: z.string().nullable(),
  updatedAt: DateTime.nullable(),
  logoUrl: z.string().nullable(),
});
export type MessageSignature = z.infer<typeof MessageSignature>;

/**
 * PUT /business/me/message-signature. 400 SIGNATURE_TOO_LONG when the cleaned HTML is over
 * EMAIL_SIGNATURE_MAX; 400 SIGNATURE_EMPTY when cleaning leaves no text and no image. A saved
 * signature can be replaced, not removed (a member leaves it out of an email instead).
 */
export const SaveMessageSignatureRequest = z.strictObject({
  html: z.string().trim().min(1, 'Write a signature first').max(EMAIL_HTML_MAX),
});
export type SaveMessageSignatureRequest = z.input<typeof SaveMessageSignatureRequest>;

/** The `error.code` values of the signature and the email images. */
export const LeadEmailErrorCode = z.enum([
  'SIGNATURE_TOO_LONG',
  'SIGNATURE_EMPTY',
  'UPLOAD_MISMATCH',
  'UPLOAD_EXPIRED',
]);
export type LeadEmailErrorCode = z.infer<typeof LeadEmailErrorCode>;

/**
 * Step 1 of an inline image: POST /business/leads/messages/images answers an UploadPutTicket
 * (documents/schemas.ts). Another type or a larger file is 400 VALIDATION_FAILED.
 */
export const CreateEmailImageUploadRequest = z.strictObject({
  contentType: z.enum(EMAIL_IMAGE_LIMITS.contentTypes),
  sizeBytes: z.number().int().positive().max(EMAIL_IMAGE_LIMITS.maxBytes),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CreateEmailImageUploadRequest = z.input<typeof CreateEmailImageUploadRequest>;

/**
 * Step 3: POST /business/leads/messages/images/confirm. The API checks the stored bytes are the
 * image announced (409 UPLOAD_MISMATCH otherwise; 410 UPLOAD_EXPIRED after 15 minutes) and
 * only then serves it at `url`.
 */
export const ConfirmEmailImageUploadRequest = z.strictObject({
  uploadToken: z.string().min(1).max(8192),
});
export type ConfirmEmailImageUploadRequest = z.input<typeof ConfirmEmailImageUploadRequest>;

export const EmailImage = z.object({
  id: z.uuid(),
  /** The public address the email's <img> uses. */
  url: z.string(),
  contentType: z.enum(EMAIL_IMAGE_LIMITS.contentTypes),
  sizeBytes: z.number().int(),
});
export type EmailImage = z.infer<typeof EmailImage>;
