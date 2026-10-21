import { randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { multipartIdOf, type PresignedUpload } from '../../storage/document-storage.js';
import { PDF_PARSE_FACTOR } from '../../storage/read-budget.js';
import { uploadTokenSeconds } from '../../storage/upload-token.js';

// Firm Sign's upload tokens (staff source files and signer attachments). Only a token's SHA-256
// is stored (esign_pending_uploads.token_hash), so the multipart upload's id rides in the token
// itself: 32 random bytes in base64url (which has no '.'), then, for a multipart upload, '.' and
// storage's upload id. The whole token is hashed, so a changed or added id finds no upload (410).

/** A new token for this presigned upload. */
export function esignUploadToken(presigned: PresignedUpload): string {
  const token = randomBytes(32).toString('base64url');
  const uploadId = multipartIdOf(presigned);
  return uploadId ? `${token}.${uploadId}` : token;
}

/** The multipart upload's id a token carries, or null for a PUT's token. */
export function multipartIdIn(uploadToken: string): string | null {
  const dot = uploadToken.indexOf('.');
  return dot < 0 ? null : uploadToken.slice(dot + 1) || null;
}

/** Whether the upload's token has outlived its lifetime (15 minutes; 70 for a multipart one). */
export const uploadTooOld = (uploadToken: string, createdAt: Date): boolean =>
  Date.now() - createdAt.getTime() > uploadTokenSeconds(multipartIdIn(uploadToken)) * 1000;

/**
 * 503 with Retry-After: the read budget (storage/read-budget.ts) has no room for the file now.
 * Nothing is used up: the same call (the same upload token) works again later.
 */
export const filesBusy = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'Files are busy right now. Please try again in a moment.',
    retryAfter: 5,
  });

/**
 * What composing or stamping a packet holds of the read budget: the files (the packet is about
 * their size), pdf-lib's parsed copy, and the PDF it saves. A packet of more than about 100 MB of
 * files needs the whole budget, so it runs only when nothing else holds any.
 */
export const packetBudget = (documents: readonly { sizeBytes: number }[]): number =>
  documents.reduce((sum, d) => sum + d.sizeBytes, 0) * (PDF_PARSE_FACTOR + 1);
