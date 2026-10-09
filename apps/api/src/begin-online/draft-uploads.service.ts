import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  type Provider,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateDraftUploadRequest,
  type DraftUpload,
  INTAKE_LIMITS,
  intakeFields,
  type UploadTicket,
  UploadContentType,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, poolSecrets, Sealer } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import { refusal, storageUnavailable } from '../storage/document-records.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  type DocumentStorage,
  PUT_URL_SECONDS,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { checkFile, type FileRefusal } from '../storage/file-checks.js';
import { UPLOAD_TOKEN_SECONDS } from '../storage/upload-token.js';
import { CHECKS_AT_ONCE } from '../storage/uploads.service.js';
import { BeginOnlineService, type Draft, draftUpload } from './begin-online.service.js';
import { draftErrors } from './drafts.js';

/** What `createUpload` decided, sealed into the ticket: confirm takes everything from here. */
const LeadUploadClaim = z.object({
  pool: z.literal('CLIENT'),
  businessId: z.uuid(),
  leadId: z.uuid(),
  slot: z.string(),
  /** tenant/{businessId}/leads/{leadId}/{uuid}, chosen by the API. */
  key: z.string(),
  fileName: z.string(),
  contentType: UploadContentType,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type LeadUploadClaim = z.infer<typeof LeadUploadClaim>;

export class LeadUploadTokens extends Sealer<LeadUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-lead-upload-v1', LeadUploadClaim, secrets);
  }
}

/** R5's storage, provided here as in DocumentsModule (which does not export it). */
export const DRAFT_UPLOAD_PROVIDERS: Provider[] = [
  { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
  {
    provide: DOCUMENT_STORAGE,
    inject: [DOCUMENTS_CONFIG],
    useFactory: (config: DocumentsConfig) =>
      new S3DocumentStorage(createS3Client(config), config.bucket),
  },
  {
    provide: LeadUploadTokens,
    inject: [ENV],
    useFactory: (env: Env) => new LeadUploadTokens(poolSecrets(env)),
  },
];

const tooMany = () =>
  new ConflictException({ code: 'TOO_MANY_FILES', message: 'No more files can be added here.' });
const uploadIdOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);
let checking = 0;

/**
 * A draft's files (R11 step 3), in R5's three steps with R5's storage and file checks: a ticket
 * for an upload slot of the draft's form (`tenant/{businessId}/leads/{leadId}/{uuid}`), the
 * browser's PUT, then confirm, which checks the stored bytes and saves a lead_uploads row. Only
 * while the lead is a live draft (the database refuses files for any other lead). The audit
 * holds ids and slot keys, never a file name.
 */
@Injectable()
export class DraftUploadsService {
  private readonly logger = new Logger(DraftUploadsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: LeadUploadTokens,
    private readonly drafts: BeginOnlineService,
    private readonly audit: AuditService,
  ) {}

  async ticket(slug: string, req: Request, body: CreateDraftUploadRequest): Promise<UploadTicket> {
    const draft = await this.drafts.draftOf(slug, req);
    const field = intakeFields(draft.definition).find((f) => f.key === body.slot);
    if (field?.type !== 'upload') {
      const issue = {
        step: '',
        path: ['slot'],
        label: 'slot',
        message: 'Not an upload of this form',
      };
      throw draftErrors.invalid([issue]);
    }
    const inSlot = draft.uploads.filter((u) => u.slot === body.slot).length;
    if (inSlot >= field.maxFiles || draft.uploads.length >= INTAKE_LIMITS.maxFiles) throw tooMany();
    const businessId = draft.firm.id;
    const claim: LeadUploadClaim = {
      pool: 'CLIENT',
      businessId,
      leadId: draft.leadId,
      slot: body.slot,
      key: `tenant/${businessId}/leads/${draft.leadId}/${randomUUID()}`,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    const put = await this.s3(() => this.storage.presignUpload(claim));
    const uploadToken = await this.tokens.seal(claim, UPLOAD_TOKEN_SECONDS);
    await this.audit.log(
      'begin_online.upload_started',
      { type: 'lead', id: draft.leadId },
      { slot: body.slot, uploadId: uploadIdOf(claim.key) },
      { businessId },
    );
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  async confirm(slug: string, req: Request, uploadToken: string): Promise<DraftUpload> {
    const draft = await this.drafts.draftOf(slug, req);
    const claim = (await this.tokens.open(uploadToken, 'CLIENT'))?.value;
    if (claim?.businessId !== draft.firm.id || claim.leadId !== draft.leadId) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const db = this.database.forBusiness(claim.businessId);
    if (await db.leadUpload.findFirst({ where: { s3Key: claim.key }, select: { id: true } })) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const refused = await this.checkStored(claim);
    if (refused) return this.refuse(claim, refusal(refused));
    try {
      return await this.database.withScope(
        { kind: 'business', businessId: claim.businessId },
        async (tx) => {
          await lockKey(tx, claim.key);
          if (await tx.leadUpload.findFirst({ where: { s3Key: claim.key } })) {
            throw refusal('UPLOAD_EXPIRED');
          }
          if (await this.refusedBefore(tx, claim)) throw refusal('UPLOAD_MISMATCH');
          await holdDraft(tx, draft);
          const files = await tx.leadUpload.findMany({
            where: { leadId: claim.leadId },
            select: { slot: true },
          });
          const field = intakeFields(draft.definition).find((f) => f.key === claim.slot);
          const inSlot = files.filter((f) => f.slot === claim.slot).length;
          const max = field?.type === 'upload' ? field.maxFiles : 0;
          if (inSlot >= max || files.length >= INTAKE_LIMITS.maxFiles) throw tooMany();
          const { pool: _pool, key, leadId, ...file } = claim;
          const scanned = this.config.scanMode === 'local';
          const row = await tx.leadUpload.create({
            data: { ...file, leadId, s3Key: key },
            select: { id: true },
          });
          // A new upload starts PENDING (the database insists); local mode scans it at once.
          const saved = await tx.leadUpload.update({
            where: { id: row.id },
            data: scanned ? { scanStatus: 'CLEAN', scannedAt: new Date() } : {},
          });
          await this.audit.logIn(
            tx,
            'begin_online.upload_confirmed',
            { type: 'lead', id: leadId },
            { uploadId: uploadIdOf(key), leadUploadId: row.id, slot: claim.slot },
            { businessId: claim.businessId },
          );
          return draftUpload(saved);
        },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      const code = codeOf(error);
      if (code === 'TOO_MANY_FILES') return this.refuse(claim, tooMany());
      throw error;
    }
  }

  async remove(slug: string, req: Request, id: string): Promise<{ ok: true }> {
    const draft = await this.drafts.draftOf(slug, req);
    const key = await this.database.withScope(
      { kind: 'business', businessId: draft.firm.id },
      async (tx) => {
        await holdDraft(tx, draft);
        const row = z.uuid().safeParse(id).success
          ? await tx.leadUpload.findFirst({ where: { id, leadId: draft.leadId } })
          : null;
        if (!row) throw draftErrors.notFound();
        await tx.leadUpload.delete({ where: { id } });
        await this.audit.logIn(
          tx,
          'begin_online.upload_deleted',
          { type: 'lead', id: draft.leadId },
          { leadUploadId: id, slot: row.slot },
          { businessId: draft.firm.id },
        );
        return row.s3Key;
      },
    );
    await this.storage.remove(key).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.warn(`Could not delete the file of lead upload ${id}: ${name}`);
    });
    return { ok: true };
  }

  /** Why the stored object is not the described file, or null (R5's checks). */
  private async checkStored(claim: LeadUploadClaim): Promise<FileRefusal | null> {
    if (checking >= CHECKS_AT_ONCE) throw storageUnavailable();
    checking += 1;
    try {
      const head = await this.s3(() => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null) {
        return 'UPLOAD_MISMATCH';
      }
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== claim.sha256) return 'UPLOAD_MISMATCH';
      return checkFile(claim.contentType, bytes);
    } finally {
      checking -= 1;
    }
  }

  private async refusedBefore(tx: TxClient, claim: LeadUploadClaim): Promise<boolean> {
    const row = await tx.auditLog.findFirst({
      where: {
        action: 'begin_online.upload_refused',
        entityId: claim.leadId,
        metadata: { path: ['uploadId'], equals: uploadIdOf(claim.key) },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Under the key's lock, unless a row has the key by now (then 410), the refusal is audited and
   * commits; then the object is deleted. A later confirm of the key finds the refusal.
   */
  private async refuse(claim: LeadUploadClaim, error: HttpException): Promise<never> {
    const { businessId } = claim;
    const saved = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await lockKey(tx, claim.key);
      if (await tx.leadUpload.findFirst({ where: { s3Key: claim.key } })) return true;
      await this.audit.logIn(
        tx,
        'begin_online.upload_refused',
        { type: 'lead', id: claim.leadId },
        { uploadId: uploadIdOf(claim.key), code: codeOf(error) },
        { businessId },
      );
      return false;
    });
    if (saved) throw refusal('UPLOAD_EXPIRED');
    await this.storage.remove(claim.key).catch(() => {
      this.logger.warn(`Could not delete the refused upload ${uploadIdOf(claim.key)}`);
    });
    throw error;
  }

  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Storage failed: ${error instanceof Error ? error.name : typeof error}`);
      throw storageUnavailable();
    }
  }
}

/** One confirm or refusal of a key at a time, until the transaction ends. */
async function lockKey(tx: TxClient, key: string): Promise<void> {
  const lockName = `lead-upload:${key}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`;
}

/** Locks the lead while it is still this live draft with this key, or 404 / 410. */
async function holdDraft(tx: TxClient, draft: Draft): Promise<void> {
  const rows = await tx.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM leads
     WHERE id = ${draft.leadId}::uuid AND status = 'DRAFT' AND draft_expires_at > now()
       AND resume_token_hash = ${draft.hash}
       FOR UPDATE`;
  if (rows.length === 0) throw draftErrors.noDraft();
}

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object' ? (body as { code?: string }).code : undefined;
}
