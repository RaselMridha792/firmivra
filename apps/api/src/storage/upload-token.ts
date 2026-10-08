import { z } from 'zod';
import { DocumentDirection, UploadContentType } from '@firmivra/types';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';

/** HKDF label for upload-token keys. A new label (v2) ends every open upload. */
export const UPLOAD_KEY_LABEL = 'fv-document-upload-v1';
/**
 * An upload is confirmed within 15 minutes of its ticket. The PUT URL itself lasts 4 minutes, but
 * a 10 MB PUT that starts near its end can take up to the browser's 10-minute timeout
 * (apps/web/src/lib/upload.ts), and the confirm comes after it.
 */
export const UPLOAD_TOKEN_SECONDS = 900;

/**
 * Everything step 1 decided, sealed into the ticket's `uploadToken` (JWE, A256GCM, 15 minutes):
 * the browser can neither read nor change it, and it opens only on the side (pool) it was made
 * for. Confirm takes the file's owner, place and facts from here, never from the request.
 */
const UploadClaim = z.object({
  /** STAFF: the firm workspace; CLIENT: the portal. */
  pool: z.enum(['STAFF', 'CLIENT']),
  businessId: z.uuid(),
  /** Who uploads (users.id): only they can confirm. */
  userId: z.uuid(),
  /** The portal login that uploads; null on the firm side. */
  clientAccountId: z.uuid().nullable(),
  clientId: z.uuid(),
  engagementId: z.uuid(),
  // A requestId (the portal's upload for a request) comes with part 2.
  categoryId: z.uuid().nullable(),
  direction: DocumentDirection,
  taxYear: z.number().int().nullable(),
  /** tenant/{businessId}/documents/{uuid}, chosen by the API. */
  key: z.string(),
  fileName: z.string(),
  contentType: UploadContentType,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type UploadClaim = z.infer<typeof UploadClaim>;

export class UploadTokens extends Sealer<UploadClaim> {
  constructor(secrets: PoolSecrets) {
    super(UPLOAD_KEY_LABEL, UploadClaim, secrets);
  }
}
