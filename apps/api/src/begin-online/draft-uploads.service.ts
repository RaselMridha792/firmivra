import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger, type Provider } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateIntakeUploadRequest,
  INTAKE_LIMITS,
  type IntakeUpload,
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
import { CHECKS_AT_ONCE, REFUSALS_SINCE_MS } from '../storage/uploads.service.js';
import { BeginOnlineService, intakeUpload } from './begin-online.service.js';
import {
  draftErrors,
  expiredDraftRefusal,
  holdDraft,
  renewDraft,
  rethrowExpired,
} from './drafts.js';
import { leadUploadKey, openTickets, UPLOAD_ACTIONS, uploadIdOf } from './upload-tickets.js';

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

const tooMany = draftErrors.tooManyFiles;
let checking = 0;

/**
 * A draft's files (R11 step 3), in R5's three steps with R5's storage and file checks: a ticket
 * for an upload slot of the draft's form (`tenant/{businessId}/leads/{leadId}/{uuid}`), the
 * browser's PUT, then confirm, which checks the stored bytes and saves a lead_uploads row. Only
 * while the lead is a live draft (the database refuses files for any other lead). A ticket belongs
 * to the draft (lead) that asked for it: confirm checks the token's lead is this browser's draft
 * for the service, so once a start or a resume replaced it, the ticket is 410 UPLOAD_EXPIRED. A
 * ticket not yet confirmed or refused takes a place in its slot and the draft until it expires
 * (`openTickets`), and a genuine ticket that can no longer be confirmed (replaced draft, draft
 * expired or sent) has its object deleted like any refused upload. A confirm or a removal renews
 * the draft. The audit holds ids and slot keys, never a file name.
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

  async list(slug: string, path: string, req: Request): Promise<IntakeUpload[]> {
    const draft = await this.drafts.draftOf(slug, path, req);
    return draft.uploads.map(intakeUpload);
  }

  async ticket(
    slug: string,
    path: string,
    req: Request,
    body: CreateIntakeUploadRequest,
  ): Promise<UploadTicket> {
    const draft = await this.drafts.draftOf(slug, path, req);
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
    const businessId = draft.firm.id;
    const claim: LeadUploadClaim = {
      pool: 'CLIENT',
      businessId,
      leadId: draft.leadId,
      slot: body.slot,
      key: leadUploadKey(businessId, draft.leadId, randomUUID()),
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    const put = await this.s3(() => this.storage.presignUpload(claim));
    const uploadToken = await this.tokens.seal(claim, UPLOAD_TOKEN_SECONDS);
    // Holding the lead (the intake, then the lead: the lock order of confirm, submit and expiry),
    // the slot's and the draft's files and open tickets are counted and this ticket is recorded:
    // parallel tickets count one by one. The PUT URL is handed out only after that commits.
    await this.database
      .withScope({ kind: 'business', businessId }, async (tx) => {
        await holdDraft(tx, draft.leadId);
        const files = await tx.leadUpload.findMany({
          where: { leadId: draft.leadId },
          select: { slot: true },
        });
        const taken = [...files, ...(await openTickets(tx, draft.leadId))];
        const inSlot = taken.filter((f) => f.slot === body.slot).length;
        if (inSlot >= field.maxFiles || taken.length >= INTAKE_LIMITS.maxFiles) throw tooMany();
        await this.audit.logIn(
          tx,
          UPLOAD_ACTIONS.started,
          { type: 'lead', id: draft.leadId },
          { slot: body.slot, uploadId: uploadIdOf(claim.key) },
          { businessId },
        );
      })
      .catch(rethrowExpired);
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  async confirm(
    slug: string,
    path: string,
    req: Request,
    res: Response,
    uploadToken: string,
  ): Promise<IntakeUpload> {
    const claim = (await this.tokens.open(uploadToken, 'CLIENT'))?.value;
    const draft = await this.drafts
      .draftOf(slug, path, req)
      .catch((error: unknown) => this.refuseEnded(slug, claim, error));
    if (claim?.businessId !== draft.firm.id) throw refusal('UPLOAD_EXPIRED');
    // A genuine ticket of another draft (this browser started again): it can never be confirmed.
    if (claim.leadId !== draft.leadId) return this.refuse(claim, refusal('UPLOAD_EXPIRED'));
    const db = this.database.forBusiness(claim.businessId);
    if (await db.leadUpload.findFirst({ where: { s3Key: claim.key }, select: { id: true } })) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const refused = await this.checkStored(claim);
    if (refused) return this.refuse(claim, refusal(refused));
    try {
      const done = await this.database.withScope(
        { kind: 'business', businessId: claim.businessId },
        async (tx) => {
          await lockKey(tx, claim.key);
          if (await tx.leadUpload.findFirst({ where: { s3Key: claim.key } })) {
            throw refusal('UPLOAD_EXPIRED');
          }
          if (await this.refusedBefore(tx, claim)) throw refusal('UPLOAD_MISMATCH');
          // The lead's row first (FOR UPDATE), then count: parallel confirms count one by one.
          await holdDraft(tx, draft.leadId);
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
            UPLOAD_ACTIONS.confirmed,
            { type: 'lead', id: leadId },
            { uploadId: uploadIdOf(key), leadUploadId: row.id, slot: claim.slot },
            { businessId: claim.businessId },
          );
          const renewed = await renewDraft(tx, leadId);
          if (!renewed) throw draftErrors.expired();
          return { file: intakeUpload(saved), expiresAt: renewed.expiresAt };
        },
      );
      await this.drafts.cookies.write(
        res,
        draft.firm,
        draft.form,
        draft.leadId,
        done.expiresAt,
        this.drafts.secure,
      );
      return done.file;
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      // The draft ended (expired or sent) while this confirm waited: the file can't be kept.
      const expired = expiredDraftRefusal(error);
      if (expired) return this.refuse(claim, expired);
      const code = codeOf(error);
      if (code === 'TOO_MANY_FILES') return this.refuse(claim, tooMany());
      if (code === 'DRAFT_EXPIRED' || code === 'DRAFT_SUBMITTED') {
        return this.refuse(claim, error as HttpException);
      }
      throw error;
    }
  }

  async remove(slug: string, path: string, req: Request, id: string): Promise<{ ok: true }> {
    const draft = await this.drafts.draftOf(slug, path, req);
    const key = await this.database.withScope(
      { kind: 'business', businessId: draft.firm.id },
      async (tx) => {
        await holdDraft(tx, draft.leadId);
        const row = z.uuid().safeParse(id).success
          ? await tx.leadUpload.findFirst({ where: { id, leadId: draft.leadId } })
          : null;
        if (!row) throw draftErrors.notFound();
        await tx.leadUpload.delete({ where: { id } });
        await renewDraft(tx, draft.leadId);
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

  /**
   * Confirm found no live draft for this browser (`error`). When the token is a genuine ticket of
   * this firm whose own lead is no longer a live draft (expired or sent), its object is refused
   * and deleted as `refuse` does; either way the visitor gets `error`.
   */
  private async refuseEnded(
    slug: string,
    claim: LeadUploadClaim | undefined,
    error: unknown,
  ): Promise<never> {
    if (!claim || !(error instanceof HttpException)) throw error;
    const firm = await this.drafts.firm(slug).catch(() => null);
    if (claim.businessId !== firm?.id) throw error;
    const rows = await this.database.withScope(
      { kind: 'business', businessId: claim.businessId },
      (tx) => tx.$queryRaw<{ live: boolean }[]>`
        SELECT (status = 'DRAFT' AND coalesce(draft_expires_at > now(), false)) AS live
          FROM leads WHERE id = ${claim.leadId}::uuid`,
    );
    if (rows[0]?.live !== false) throw error;
    return this.refuse(claim, error);
  }

  /**
   * Whether this key was refused before (the mark `refuse` leaves before it deletes). Only in the
   * last REFUSALS_SINCE_MS (R5's bound: longer than a ticket lives), so the search stays on the
   * (business_id, created_at) index.
   */
  private async refusedBefore(tx: TxClient, claim: LeadUploadClaim): Promise<boolean> {
    const row = await tx.auditLog.findFirst({
      where: {
        businessId: claim.businessId,
        createdAt: { gte: new Date(Date.now() - REFUSALS_SINCE_MS) },
        action: UPLOAD_ACTIONS.refused,
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
        UPLOAD_ACTIONS.refused,
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

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object' ? (body as { code?: string }).code : undefined;
}
