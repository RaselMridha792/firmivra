import { z } from 'zod';

// The firm's logo (Settings > Branding and the setup wizard's branding step). Three steps, as in
// documents/schemas.ts: `createLogoUpload` (type, size, SHA-256) answers an `UploadTicket`, the
// browser PUTs the file to the ticket's URL, then `confirmLogoUpload` checks the stored bytes and
// makes it the firm's logo. `removeLogo` clears it. The logo is public by design (it shows on the
// sign-in page): `FirmSettings.logoUrl`, the portal's `branding.logoUrl` and emails all use
// `GET /api/v1/portal/{slug}/logo`, an address that does not expire. Null when there is no logo.

/** 2 MB; PNG, JPEG and WebP only. No SVG: it can carry scripts. */
export const LOGO_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  typeNames: 'PNG, JPG or WebP',
  /** Content type and the file name endings that go with it (for the picker's `accept`). */
  types: {
    'image/png': ['.png'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/webp': ['.webp'],
  },
} as const;

export const LogoContentType = z.enum(
  Object.keys(LOGO_LIMITS.types) as [keyof typeof LOGO_LIMITS.types],
  `Upload a ${LOGO_LIMITS.typeNames} image`,
);
export type LogoContentType = z.infer<typeof LogoContentType>;

/** The words shown for a refused logo, by API error code. */
export const LOGO_ERRORS = {
  LOGO_TOO_BIG: 'The logo must be 2 MB or smaller.',
  LOGO_WRONG_TYPE: `The logo must be a ${LOGO_LIMITS.typeNames} image.`,
  UPLOAD_EXPIRED: 'This upload has expired. Please try again.',
  UPLOAD_MISMATCH: "This file doesn't match its type. Check the image and upload it again.",
} as const;

/** The type for a picked file: the browser's, when it is one of ours, else null. */
export function logoContentTypeFor(browserType: string): LogoContentType | null {
  return Object.hasOwn(LOGO_LIMITS.types, browserType) ? (browserType as LogoContentType) : null;
}

/** Why a picked file cannot be the logo (screens check before sending), or null when it can. */
export function logoFileProblem(file: {
  type: string;
  size: number;
}): 'LOGO_WRONG_TYPE' | 'LOGO_TOO_BIG' | null {
  if (logoContentTypeFor(file.type) === null) return 'LOGO_WRONG_TYPE';
  return file.size > LOGO_LIMITS.maxBytes ? 'LOGO_TOO_BIG' : null;
}

export const CreateLogoUploadRequest = z.object({
  contentType: LogoContentType,
  sizeBytes: z.number().int().positive().max(LOGO_LIMITS.maxBytes),
  /** Hex SHA-256 of the file; storage refuses other bytes. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CreateLogoUploadRequest = z.infer<typeof CreateLogoUploadRequest>;

export const ConfirmLogoUploadRequest = z.object({ uploadToken: z.string().min(1).max(8192) });
export type ConfirmLogoUploadRequest = z.infer<typeof ConfirmLogoUploadRequest>;
