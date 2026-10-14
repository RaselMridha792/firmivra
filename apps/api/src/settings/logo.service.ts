import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Database } from '@firmivra/db';
import {
  type ConfirmLogoUploadRequest,
  type CreateLogoUploadRequest,
  LOGO_ERRORS,
  LogoContentType,
  type UploadTicket,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { DATABASE } from '../database/database.module.js';
import { notFound, refusal, storageUnavailable } from '../storage/document-records.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  PUT_URL_SECONDS,
  statusOf,
} from '../storage/document-storage.js';
import { UPLOAD_TOKEN_SECONDS } from '../storage/upload-token.js';
import { checkLogo, logoExtension, logoIdOf, logoTypeOfKey } from './logo-checks.js';

/** What the ticket decided, sealed so that confirm trusts it and not the request. */
const LogoClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  /** Only the person who asked can confirm. */
  userId: z.uuid(),
  /** tenant/{businessId}/logo/{uuid}.{ext}, chosen by the API. */
  key: z.string(),
  contentType: LogoContentType,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type LogoClaim = z.infer<typeof LogoClaim>;

export class LogoUploadTokens extends Sealer<LogoClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-logo-upload-v1', LogoClaim, secrets);
  }
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * The firm's logo in R5's three steps with R5's storage: a ticket (the API picks the key under
 * the firm's own prefix and presigns a PUT for exactly that file), the browser's PUT, then
 * confirm, which checks size, SHA-256 and the real image type (never the name) before `logo_key`
 * changes. A refused file is deleted, and so is the logo it replaces. Audit: the file's id only.
 */
@Injectable()
export class LogoService {
  private readonly logger = new Logger(LogoService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly tokens: LogoUploadTokens,
    private readonly audit: AuditService,
  ) {}

  async ticket(businessId: string, userId: string, body: CreateLogoUploadRequest) {
    const key = `tenant/${businessId}/logo/${randomUUID()}.${logoExtension(body.contentType)}`;
    const claim: LogoClaim = { pool: 'STAFF', businessId, userId, key, ...body };
    const put = await this.s3('presign PUT', () => this.storage.presignUpload(claim));
    const ticket: UploadTicket = {
      uploadToken: await this.tokens.seal(claim, UPLOAD_TOKEN_SECONDS),
      url: put.url,
      method: 'PUT',
      headers: put.headers,
      expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
    };
    return ticket;
  }

  /** Makes the stored file the logo; 410 for a ticket that is not this person's in this firm. */
  async confirm(businessId: string, userId: string, body: ConfirmLogoUploadRequest) {
    const claim = (await this.tokens.open(body.uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== userId)
      throw refusal('UPLOAD_EXPIRED');
    const head = await this.s3('HEAD', () => this.storage.head(claim.key));
    const bytes = head ? await this.s3('GET', () => this.storage.read(claim.key)) : null;
    const problem =
      !head ||
      head.contentEncoding !== null ||
      bytes?.byteLength !== claim.sizeBytes ||
      createHash('sha256').update(bytes).digest('hex') !== claim.sha256
        ? ('UPLOAD_MISMATCH' as const)
        : checkLogo(claim.contentType, bytes);
    if (problem) {
      await this.discard(claim.key);
      throw refusal('UPLOAD_MISMATCH', LOGO_ERRORS[problem]);
    }
    const old = await this.set(businessId, claim.key, 'business.logo_uploaded');
    if (old && old !== claim.key) await this.discard(old);
  }

  async remove(businessId: string): Promise<void> {
    const old = await this.set(businessId, null, 'business.logo_removed');
    if (old) await this.discard(old);
  }

  /** The firm's logo for its public address; 404 when it has none. */
  async stored(businessId: string) {
    const settings = await this.database.forBusiness(businessId).businessSettings.findUnique({
      where: { businessId },
      select: { logoKey: true },
    });
    const key = settings?.logoKey;
    const bytes = key ? await this.s3('GET', () => this.storage.read(key)) : null;
    if (!key || !bytes) throw notFound();
    return { bytes, contentType: logoTypeOfKey(key), version: logoIdOf(key) };
  }

  /** Sets `logo_key` and audits it in one transaction; returns the key it replaced. */
  private set(businessId: string, key: string | null, action: string): Promise<string | null> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      // ON CONFLICT DO NOTHING, as the settings do: two first saves at once must not collide.
      await tx.$executeRaw`
        INSERT INTO business_settings (business_id, updated_at) VALUES (${businessId}::uuid, now())
        ON CONFLICT (business_id) DO NOTHING`;
      const row = await tx.businessSettings.findUnique({
        where: { businessId },
        select: { logoKey: true },
      });
      const old = row?.logoKey ?? null;
      if (key === null && old === null) return null; // nothing to remove, nothing to audit
      await tx.businessSettings.update({ where: { businessId }, data: { logoKey: key } });
      const entity = { type: 'business', id: businessId };
      await this.audit.logIn(tx, action, entity, { logoId: logoIdOf(key ?? old!) }, { businessId });
      return old;
    });
  }

  /** A file nobody uses. Should the delete fail it stays (private) and the log says so. */
  private async discard(key: string): Promise<void> {
    await this.storage.remove(key).catch((error: unknown) => {
      this.logger.warn(`Could not delete a logo file: ${nameOf(error)} (HTTP ${statusOf(error)})`);
    });
  }

  /** A storage failure is 503 with Retry-After; the log names the step and the error only. */
  private async s3<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Storage ${operation} failed: ${nameOf(error)} (HTTP ${statusOf(error)})`);
      throw storageUnavailable();
    }
  }
}
