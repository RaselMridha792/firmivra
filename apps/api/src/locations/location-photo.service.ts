import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Database } from '@firmivra/db';
import { LOCATION_PHOTO_LIMITS, type LocationProfile, type UploadPutTicket } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { DATABASE } from '../database/database.module.js';
import { sniffImage } from '../settings/brand-assets.service.js';
import { logoIdOf } from '../settings/logo-checks.js';
import { refusal, storageUnavailable } from '../storage/document-records.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  onlyPut,
  PUT_URL_SECONDS,
  statusOf,
} from '../storage/document-storage.js';
import { UPLOAD_TOKEN_SECONDS } from '../storage/upload-token.js';
import type { ConfirmLocationPhotoBody, LocationPhotoUploadBody, Out } from './locations-input.js';
import { invalid } from './locations-common.js';
import { lockLocations } from './location-actions.js';
import { liveOffice, LocationsReadService } from './locations-read.service.js';

// The location photo (Settings > Locations, Add and Edit): the same three steps and checks as the
// brand images (settings/brand-assets.service.ts). The API picks the key under the firm's prefix
// (tenant/{businessId}/offices/, the database's CHECK), the browser PUTs exactly that file, and
// confirm checks its size, SHA-256 and real type (JPG, PNG or WebP by its first bytes) before the
// location points at it. A refused file is deleted, and so is the photo it replaces (after the row
// no longer names it). Audit: the location's and the file's ids only.

const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const PhotoClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  officeId: z.uuid(),
  key: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type PhotoClaim = z.infer<typeof PhotoClaim>;

export class LocationPhotoTokens extends Sealer<PhotoClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-location-photo-upload-v1', PhotoClaim, secrets);
  }
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

@Injectable()
export class LocationPhotoService {
  private readonly logger = new Logger(LocationPhotoService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly tokens: LocationPhotoTokens,
    private readonly audit: AuditService,
    private readonly reads: LocationsReadService,
  ) {}

  /** Step 1: a PUT ticket for a live location of the firm (404 otherwise). */
  async ticket(
    businessId: string,
    userId: string,
    officeId: string,
    body: Out<typeof LocationPhotoUploadBody>,
  ): Promise<UploadPutTicket> {
    await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      liveOffice(tx, businessId, officeId),
    );
    const ext = EXTENSION[body.contentType];
    if (!ext || body.sizeBytes > LOCATION_PHOTO_LIMITS.maxBytes)
      throw invalid('contentType', 'Upload a JPG, PNG or WebP image of at most 5 MB');
    const key = `tenant/${businessId}/offices/${randomUUID()}.${ext}`;
    const claim: PhotoClaim = {
      pool: 'STAFF',
      businessId,
      userId,
      officeId,
      key,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    const presigned = await this.s3('presign PUT', () =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    // At most 5 MB: always one PUT.
    const put = onlyPut(presigned);
    return {
      uploadToken: await this.tokens.seal(claim, UPLOAD_TOKEN_SECONDS),
      method: 'PUT',
      url: put.url,
      headers: put.headers,
      expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
    };
  }

  /** Step 3: the stored file becomes the location's photo; 410 for someone else's or an old ticket. */
  async confirm(
    businessId: string,
    userId: string,
    officeId: string,
    body: Out<typeof ConfirmLocationPhotoBody>,
  ): Promise<LocationProfile> {
    // The location first: another firm's id is 404 whatever the ticket.
    await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      liveOffice(tx, businessId, officeId),
    );
    const claim = (await this.tokens.open(body.uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== userId || claim.officeId !== officeId)
      throw refusal('UPLOAD_EXPIRED');
    const head = await this.s3('HEAD', () => this.storage.head(claim.key));
    const bytes = head ? await this.s3('GET', () => this.storage.read(claim.key)) : null;
    const fine =
      head &&
      head.contentEncoding === null &&
      bytes?.byteLength === claim.sizeBytes &&
      bytes.byteLength <= LOCATION_PHOTO_LIMITS.maxBytes &&
      createHash('sha256').update(bytes).digest('hex') === claim.sha256 &&
      sniffImage(bytes) === claim.contentType;
    if (!fine) {
      await this.discard(claim.key);
      throw invalid(
        'uploadToken',
        "The photo doesn't match what was uploaded, or it is not a JPG, PNG or WebP image",
      );
    }
    const { old, draft } = await this.set(businessId, officeId, claim.key);
    if (old && old !== claim.key) await this.discard(old);
    return this.reads.withPhoto(draft);
  }

  /** Remove Photo: repeating is harmless. */
  async remove(businessId: string, officeId: string): Promise<LocationProfile> {
    const { old, draft } = await this.set(businessId, officeId, null);
    if (old) await this.discard(old);
    return this.reads.withPhoto(draft);
  }

  /** Sets the location's photo and audits it in one transaction; returns the key it replaced. */
  private set(businessId: string, officeId: string, key: string | null) {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await lockLocations(tx, businessId);
      const office = await liveOffice(tx, businessId, officeId);
      const old = office.photoKey;
      if (old !== key) {
        await tx.firmOffice.update({ where: { id: office.id }, data: { photoKey: key } });
        await this.audit.logIn(
          tx,
          key ? 'firm_office.photo_set' : 'firm_office.photo_removed',
          { type: 'firm_office', id: office.id },
          { officeId: office.id, photoId: logoIdOf(key ?? old!) },
          { businessId },
        );
      }
      return { old, draft: await this.reads.profileIn(tx, businessId, office.id) };
    });
  }

  /** A file nobody uses; should the delete fail it stays (private) and the log says so. */
  private async discard(key: string): Promise<void> {
    await this.storage.remove(key).catch((error: unknown) => {
      this.logger.warn(
        `Could not delete a location photo: ${nameOf(error)} (HTTP ${statusOf(error)})`,
      );
    });
  }

  private async s3<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Storage ${operation} failed: ${nameOf(error)} (HTTP ${statusOf(error)})`);
      throw storageUnavailable();
    }
  }
}
