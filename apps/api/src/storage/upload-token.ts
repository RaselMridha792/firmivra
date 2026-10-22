import { z } from 'zod';
import { DocumentDirection, IntakeKey, UploadContentType } from '@firmivra/types';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';

/** HKDF label for upload-token keys. A new label (v2) ends every open upload. */
export const UPLOAD_KEY_LABEL = 'fv-document-upload-v1';
/**
 * A PUT upload is confirmed within 15 minutes of its ticket. The PUT URL itself lasts 4 minutes,
 * but a PUT that starts near its end can take up to the browser's 10-minute timeout
 * (apps/web/src/lib/upload.ts), and the confirm comes after it.
 */
export const UPLOAD_TOKEN_SECONDS = 900;
/**
 * A multipart upload is confirmed within 70 minutes: its part URLs last an hour
 * (MULTIPART_URL_SECONDS), and a part that starts near their end has the browser's 10 minutes.
 */
export const MULTIPART_TOKEN_SECONDS = 4_200;
/** The longest any upload ticket lives: how far back anything that counts open tickets looks. */
export const LONGEST_UPLOAD_SECONDS = MULTIPART_TOKEN_SECONDS;

/** How long the token of an upload lives: a multipart one (it has an upload id) longer. */
export const uploadTokenSeconds = (uploadId: string | null | undefined): number =>
  uploadId ? MULTIPART_TOKEN_SECONDS : UPLOAD_TOKEN_SECONDS;

/** Storage's id of a multipart upload, as a token carries it. */
export const MultipartUploadId = z.string().min(1).max(1024);

/**
 * Everything step 1 decided, sealed into the ticket's `uploadToken` (JWE, A256GCM, 15 minutes for
 * a PUT, 70 for a multipart upload): the browser can neither read nor change it, and it opens
 * only on the side (pool) it was made for. Confirm takes the file's owner, place and facts from
 * here, never from the request.
 */
const UploadClaim = z
  .object({
    /** STAFF: the firm workspace; CLIENT: the portal. */
    pool: z.enum(['STAFF', 'CLIENT']),
    businessId: z.uuid(),
    /** Who uploads (users.id): only they can confirm. */
    userId: z.uuid(),
    /** The portal login that uploads; null on the firm side. */
    clientAccountId: z.uuid().nullable(),
    clientId: z.uuid(),
    engagementId: z.uuid(),
    /** The open request the portal's upload answers (SUBMITTED at confirm); null otherwise. */
    requestId: z.uuid().nullable(),
    categoryId: z.uuid().nullable(),
    direction: DocumentDirection,
    taxYear: z.number().int().nullable(),
    /** tenant/{businessId}/documents/{uuid}, chosen by the API. */
    key: z.string(),
    fileName: z.string(),
    contentType: UploadContentType,
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /**
     * The multipart upload confirm completes; null or absent for a PUT (tokens sealed before
     * multipart uploads have none).
     */
    uploadId: MultipartUploadId.nullable().optional(),
    /**
     * A portal intake's upload slot (R11): the intake (of this engagement, open for changes) and the
     * slot's field key, checked by the caller before the ticket. The document gets both on insert.
     */
    intakeId: z.uuid().optional(),
    intakeSlot: IntakeKey.optional(),
    /**
     * The firm-wide library's upload (R55, Frame 1): folder, description, tags, reviewer, the
     * document's own expiry, the client's notice and the version it replaces, all checked by the
     * library before the ticket. The document gets them on insert.
     */
    library: z
      .object({
        folderId: z.uuid().nullable(),
        description: z.string().nullable(),
        tags: z.array(z.string()),
        reviewerUserId: z.uuid().nullable(),
        expiresOn: z.string().nullable(),
        notifyClient: z.boolean(),
        replacesId: z.uuid().nullable(),
      })
      .optional(),
  })
  .refine((c) => (c.intakeId === undefined) === (c.intakeSlot === undefined), {
    message: 'intakeId and intakeSlot come together',
  });
export type UploadClaim = z.infer<typeof UploadClaim>;

export class UploadTokens extends Sealer<UploadClaim> {
  constructor(secrets: PoolSecrets) {
    super(UPLOAD_KEY_LABEL, UploadClaim, secrets);
  }
}
