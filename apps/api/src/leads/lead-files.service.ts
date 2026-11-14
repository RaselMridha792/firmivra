import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  type CreateLeadFileRequest,
  type LeadDocument,
  type UploadTicket,
  UploadContentType,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { legacyFirmRole } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { leadUploadKey, uploadIdOf } from '../begin-online/upload-tickets.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import { refusal, storageUnavailable } from '../storage/document-records.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  multipartIdOf,
  uploadTicket,
} from '../storage/document-storage.js';
import { checkFile, type FileRefusal } from '../storage/file-checks.js';
import { readBudget } from '../storage/read-budget.js';
import { MultipartUploadId, uploadTokenSeconds } from '../storage/upload-token.js';
import { notFound } from './leads.service.js';
import { type PipelineActor, reach, visibleLead } from './pipeline.shared.js';

/** Staff files on one lead, at most (the lead's own Begin Online files are counted apart). */
export const MAX_STAFF_FILES = 50;
const STAFF_SLOT = 'staff';

/** What the ticket decided, sealed: confirm takes everything from here. */
const LeadFileClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  leadId: z.uuid(),
  userId: z.uuid(),
  /** tenant/{businessId}/leads/{leadId}/{uuid}: the leads prefix, so the lead scan handler scans it. */
  key: z.string(),
  fileName: z.string(),
  contentType: UploadContentType,
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadId: MultipartUploadId.nullable().optional(),
});
type LeadFileClaim = z.infer<typeof LeadFileClaim>;

export class LeadFileTokens extends Sealer<LeadFileClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-lead-staff-file-v1', LeadFileClaim, secrets);
  }
}

const closedLead = () =>
  new ConflictException({
    code: 'LEAD_CLOSED',
    message: 'Files can be added to an open lead only (not a converted or archived one)',
  });
const tooMany = () =>
  new ConflictException({
    code: 'TOO_MANY_FILES',
    message: `A lead can hold at most ${MAX_STAFF_FILES} files added by the firm`,
  });

const fileSelect = {
  id: true,
  fileName: true,
  createdAt: true,
  scanStatus: true,
  uploadedBy: { select: { userId: true, user: { select: { name: true } } } },
} as const;

type FileRow = {
  id: string;
  fileName: string;
  createdAt: Date;
  scanStatus: string;
  uploadedBy: { userId: string; user: { name: string } } | null;
};

/** One lead file as the Documents & Forms tab shows it. */
export const toLeadDocument = (f: FileRow): LeadDocument => ({
  id: f.id,
  fileName: f.fileName,
  uploadedAt: f.createdAt.toISOString(),
  scanStatus: f.scanStatus,
  addedBy: f.uploadedBy ? { userId: f.uploadedBy.userId, name: f.uploadedBy.user.name } : null,
});

/**
 * Leads R2 4: files staff add to a lead (Documents & Forms > Upload Document), in R5's three steps
 * with R5's storage and file checks: a ticket (`tenant/{businessId}/leads/{leadId}/{uuid}`), the
 * browser's PUT, then confirm, which checks the stored bytes and saves a lead_uploads row in the
 * 'staff' slot with who added it. Only on an open lead the member reaches (the database refuses a
 * draft, an expired, converted or archived one). The lead scan handler scans it as it does the
 * lead's own files; at conversion it becomes a firm-only (INTERNAL) document of the new client
 * (lead-convert.service.ts). The member who added it, or an Owner or Admin, may remove it until
 * the lead is converted. Audit rows hold ids, never a file name.
 */
@Injectable()
export class LeadFilesService {
  private readonly logger = new Logger(LeadFilesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: LeadFileTokens,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The open lead the member reaches, held FOR UPDATE: 404, or 409 LEAD_CLOSED. */
  private async openLead(tx: TxClient, businessId: string, actor: PipelineActor, id: string) {
    const rows = await tx.$queryRaw<{ status: string; archived: boolean }[]>`
      SELECT status::text AS status, archived_at IS NOT NULL AS archived FROM leads
       WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const lead = await tx.lead.findFirst({
      where: { AND: [visibleLead(businessId), reach(actor), { id }] },
      select: { id: true },
    });
    const row = rows[0];
    if (!row || !lead || row.archived) throw notFound();
    if (row.status === 'CONVERTED') throw closedLead();
  }

  async ticket(
    businessId: string,
    actor: PipelineActor,
    id: string,
    body: CreateLeadFileRequest,
  ): Promise<UploadTicket> {
    const claim: LeadFileClaim = {
      pool: 'STAFF',
      businessId,
      leadId: id,
      userId: actor.userId,
      key: leadUploadKey(businessId, id, randomUUID()),
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    await this.inFirm(businessId, async (tx) => {
      await this.openLead(tx, businessId, actor, id);
      const count = await tx.leadUpload.count({
        where: { businessId, leadId: id, uploadedByUserId: { not: null } },
      });
      if (count >= MAX_STAFF_FILES) throw tooMany();
    });
    const presigned = await this.s3(() => this.storage.presignUpload(claim));
    const uploadId = multipartIdOf(presigned);
    const uploadToken = await this.tokens.seal(
      { ...claim, uploadId },
      uploadTokenSeconds(uploadId),
    );
    await this.audit.log(
      'lead.file_upload_started',
      { type: 'lead', id },
      { uploadId: uploadIdOf(claim.key) },
    );
    return uploadTicket(uploadToken, presigned);
  }

  async confirm(
    businessId: string,
    actor: PipelineActor,
    id: string,
    uploadToken: string,
  ): Promise<LeadDocument> {
    // The lead first: another firm's or an unreachable lead is 404 whatever the token.
    await this.inFirm(businessId, (tx) => this.openLead(tx, businessId, actor, id));
    const claim = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.leadId !== id || claim.userId !== actor.userId) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const db = this.database.forBusiness(businessId);
    if (await db.leadUpload.findFirst({ where: { s3Key: claim.key }, select: { id: true } })) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const refused = await this.checkStored(claim);
    if (refused) return this.refuse(claim, refusal(refused));
    try {
      return await this.inFirm(businessId, async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-upload:${claim.key}`}, 0))`;
        if (await tx.leadUpload.findFirst({ where: { s3Key: claim.key } })) {
          throw refusal('UPLOAD_EXPIRED');
        }
        await this.openLead(tx, businessId, actor, id);
        const count = await tx.leadUpload.count({
          where: { businessId, leadId: id, uploadedByUserId: { not: null } },
        });
        if (count >= MAX_STAFF_FILES) throw tooMany();
        const row = await tx.leadUpload.create({
          data: {
            businessId,
            leadId: id,
            slot: STAFF_SLOT,
            uploadedByUserId: actor.userId,
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            sha256: claim.sha256,
            s3Key: claim.key,
          },
          select: { id: true },
        });
        // A new upload starts PENDING (the database insists); local mode scans it at once.
        const saved = await tx.leadUpload.update({
          where: { id: row.id },
          data:
            this.config.scanMode === 'local' ? { scanStatus: 'CLEAN', scannedAt: new Date() } : {},
          select: fileSelect,
        });
        await this.audit.logIn(
          tx,
          'lead.file_added',
          { type: 'lead', id },
          { leadUploadId: row.id, uploadId: uploadIdOf(claim.key) },
        );
        return toLeadDocument(saved);
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      const code = codeOf(error);
      if (code === 'LEAD_CLOSED' || code === 'TOO_MANY_FILES') {
        return this.refuse(claim, error as HttpException);
      }
      throw error;
    }
  }

  /** A file staff added, by the member who added it or an Owner or Admin, until conversion. */
  async remove(
    businessId: string,
    actor: PipelineActor,
    id: string,
    fileId: string,
  ): Promise<{ ok: true }> {
    const key = await this.inFirm(businessId, async (tx) => {
      await this.openLead(tx, businessId, actor, id);
      const row = await tx.leadUpload.findFirst({
        where: { businessId, id: fileId, leadId: id, uploadedByUserId: { not: null } },
        select: { s3Key: true, uploadedByUserId: true },
      });
      if (!row) throw notFound();
      const manager = legacyFirmRole(actor.role) !== 'STAFF';
      if (!manager && row.uploadedByUserId !== actor.userId) throw notFound();
      await tx.leadUpload.delete({ where: { id: fileId } });
      await this.audit.logIn(
        tx,
        'lead.file_removed',
        { type: 'lead', id },
        { leadUploadId: fileId },
      );
      return row.s3Key;
    });
    await this.storage.remove(key).catch((error: unknown) => {
      this.logger.warn(`Could not delete the file of lead upload ${fileId}: ${nameOf(error)}`);
    });
    return { ok: true };
  }

  /** Why the stored object is not the described file, or null (R5's checks, as Begin Online's). */
  private checkStored(claim: LeadFileClaim): Promise<FileRefusal | null> {
    return readBudget.hold(claim.sizeBytes, storageUnavailable, async () => {
      const { uploadId } = claim;
      if (uploadId) {
        const done = await this.s3(() =>
          this.storage.completeUpload(claim.key, uploadId, claim.sizeBytes),
        );
        if (done === 'MISSING') throw refusal('UPLOAD_EXPIRED');
        if (done === 'MISMATCH') return 'UPLOAD_MISMATCH';
      }
      const head = await this.s3(() => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null) {
        return 'UPLOAD_MISMATCH';
      }
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256) {
        return 'UPLOAD_MISMATCH';
      }
      return checkFile(claim.contentType, bytes);
    });
  }

  /** The refusal is audited, then the object is deleted (unless a row holds the key by now). */
  private async refuse(claim: LeadFileClaim, error: HttpException): Promise<never> {
    const kept = await this.inFirm(claim.businessId, async (tx) => {
      if (await tx.leadUpload.findFirst({ where: { s3Key: claim.key }, select: { id: true } })) {
        return true;
      }
      await this.audit.logIn(
        tx,
        'lead.file_refused',
        { type: 'lead', id: claim.leadId },
        { uploadId: uploadIdOf(claim.key), code: codeOf(error) },
      );
      return false;
    });
    if (kept) throw refusal('UPLOAD_EXPIRED');
    if (claim.uploadId) {
      await this.storage.abortUpload(claim.key, claim.uploadId).catch(() => {
        this.logger.warn(`Could not drop the refused multipart upload ${uploadIdOf(claim.key)}`);
      });
    }
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
      this.logger.warn(`Storage failed: ${nameOf(error)}`);
      throw storageUnavailable();
    }
  }
}

const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

function codeOf(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const body = error.getResponse();
  return typeof body === 'object' ? (body as { code?: string }).code : undefined;
}
