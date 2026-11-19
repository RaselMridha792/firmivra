import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  STAFF_DRAFT_FILE_LIMIT,
  type StaffDraftAttachment,
  type UploadTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  multipartIdOf,
  uploadTicket,
} from '../storage/document-storage.js';
import { MultipartUploadId, uploadTokenSeconds } from '../storage/upload-token.js';
import type { ScanOutcome, ScanResult } from '../storage/scan-results.service.js';
import { notFound } from '../workspaces/common.js';
import type { CreateStaffDraftUploadBody } from './staff-input.js';
import {
  checkStoredUpload,
  FILE_REASON,
  refusal,
  SCAN_REFUSALS_SINCE_MS,
  unavailable,
  UUID,
} from './staff-documents.service.js';
import { requireManager, type StaffActor, staffConflict } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;

/** HKDF label for draft file upload tokens: a token opens only here. */
export const STAFF_DRAFT_UPLOAD_LABEL = 'fv-staff-draft-upload-v1';

const DraftUploadClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  draftId: z.uuid(),
  /** tenant/{businessId}/staff-drafts/{draftId}/{uuid}, chosen by the API. */
  key: z.string(),
  type: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadId: MultipartUploadId.nullable().optional(),
});
type DraftUploadClaim = z.infer<typeof DraftUploadClaim>;

export class StaffDraftUploadTokens extends Sealer<DraftUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super(STAFF_DRAFT_UPLOAD_LABEL, DraftUploadClaim as never, secrets);
  }
}

/** tenant/{businessId}/staff-drafts/{draftId}/{uploadId}, as ticket() names a new object. */
const KEY = new RegExp(`^tenant/(${UUID})/staff-drafts/(${UUID})/(${UUID})$`);

const fileSelect = {
  id: true,
  documentType: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  scanStatus: true,
  s3Key: true,
  createdAt: true,
} satisfies Prisma.StaffDraftAttachmentSelect;
type FileRow = Prisma.StaffDraftAttachmentGetPayload<{ select: typeof fileSelect }>;

export const draftFileView = (f: FileRow): StaffDraftAttachment => ({
  id: f.id,
  type: f.documentType as StaffDraftAttachment['type'],
  fileName: f.fileName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  scanStatus: f.scanStatus,
  createdAt: f.createdAt.toISOString(),
});

/** A draft's files, oldest first, for its GET. */
export const draftFilesOf = async (tx: TxClient, businessId: string, draftId: string) =>
  (
    await tx.staffDraftAttachment.findMany({
      where: { businessId, staffDraftId: draftId },
      select: fileSelect,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(draftFileView);

/** What Create Staff hands over after its commit: the draft's files, read before it went. */
export type DraftFileMove = Pick<
  FileRow,
  'id' | 'documentType' | 'fileName' | 'contentType' | 'sizeBytes' | 'scanStatus' | 's3Key'
>;

/** The draft's files, in Create Staff's transaction, before the draft is deleted. */
export const draftFilesToMove = (
  tx: TxClient,
  businessId: string,
  draftId: string,
): Promise<DraftFileMove[]> =>
  tx.staffDraftAttachment.findMany({
    where: { businessId, staffDraftId: draftId },
    select: {
      id: true,
      documentType: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      scanStatus: true,
      s3Key: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

/**
 * SM17 (Staff Management Review 2, decision 2a): Create Staff's Save under Remove. A file and its
 * type are kept with the draft (staff_draft_attachments, under
 * tenant/{businessId}/staff-drafts/{draftId}/), with the same three-step upload and checks as a
 * member's documents. A draft and its files are its creator's alone: every route checks the draft
 * is the actor's own (404 otherwise), as the firm's RLS does for the firm. Removing a file or the
 * draft deletes its rows and the stored files; a stored file storage could not delete (or never
 * had) is logged with ids and left for a sweep, never an error for the person. When the account
 * is created, the CLEAN files become the member's documents and the draft's copies go.
 * The audit log gets ids and types, never a file name.
 */
@Injectable()
export class StaffDraftFilesService {
  private readonly logger = new Logger(StaffDraftFilesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: StaffDraftUploadTokens,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(actor: StaffActor, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: actor.businessId }, fn);
  }

  /** The actor's own draft (another's, or another firm's, is 404): the actor's membership id. */
  private async ownDraft(tx: TxClient, actor: StaffActor, draftId: string): Promise<string> {
    const by = await requireManager(tx, actor);
    const draft = await tx.staffDraft.findFirst({
      where: { businessId: actor.businessId, id: draftId, createdById: by },
      select: { id: true },
    });
    if (!draft) throw notFound();
    return by;
  }

  async ticket(
    actor: StaffActor,
    draftId: string,
    body: Out<typeof CreateStaffDraftUploadBody>,
  ): Promise<UploadTicket> {
    const { businessId } = actor;
    await this.inFirm(actor, async (tx) => {
      await this.ownDraft(tx, actor, draftId);
      const n = await tx.staffDraftAttachment.count({
        where: { businessId, staffDraftId: draftId },
      });
      if (n >= STAFF_DRAFT_FILE_LIMIT)
        throw staffConflict(
          'DRAFT_FILE_LIMIT',
          `A draft keeps up to ${STAFF_DRAFT_FILE_LIMIT} files. Remove one first.`,
        );
    });
    const key = `tenant/${businessId}/staff-drafts/${draftId}/${randomUUID()}`;
    const presigned = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const uploadId = multipartIdOf(presigned);
    const claim: DraftUploadClaim = {
      pool: 'STAFF',
      businessId,
      userId: actor.userId,
      draftId,
      key,
      type: body.type,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      uploadId,
    };
    const uploadToken = await this.tokens.seal(claim, uploadTokenSeconds(uploadId));
    return uploadTicket(uploadToken, presigned);
  }

  async confirm(
    actor: StaffActor,
    draftId: string,
    uploadToken: string,
  ): Promise<StaffDraftAttachment> {
    const { businessId } = actor;
    // The draft first: another's draft is 404 whatever the token holds.
    const claim = await this.inFirm(actor, async (tx) => {
      await this.ownDraft(tx, actor, draftId);
      const opened = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
      if (
        opened?.businessId !== businessId ||
        opened.userId !== actor.userId ||
        opened.draftId !== draftId
      )
        throw refusal('UPLOAD_EXPIRED');
      const saved = await tx.staffDraftAttachment.findFirst({
        where: { businessId, s3Key: opened.key },
        select: { id: true },
      });
      if (saved) throw refusal('UPLOAD_EXPIRED');
      return opened;
    });
    const refused = await checkStoredUpload(claim, this.storage, (call) => this.s3(call));
    if (refused) {
      if (claim.uploadId) {
        await this.storage.abortUpload(claim.key, claim.uploadId).catch(() => {
          this.logger.warn(`Could not drop a refused draft multipart upload in firm ${businessId}`);
        });
      }
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete a refused draft upload in firm ${businessId}`);
      });
      await this.audit.log(
        'staff_draft.file_refused',
        { type: 'staff_draft', id: draftId },
        { uploadId: claim.key.slice(claim.key.lastIndexOf('/') + 1), code: refused },
        { businessId },
      );
      throw refusal(refused);
    }
    let fileId: string;
    try {
      fileId = await this.inFirm(actor, async (tx) => {
        await this.ownDraft(tx, actor, draftId);
        const row = await tx.staffDraftAttachment.create({
          data: {
            businessId,
            staffDraftId: draftId,
            s3Key: claim.key,
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            documentType: claim.type,
            createdByUserId: actor.userId,
          },
          select: { id: true },
        });
        await this.audit.logIn(
          tx,
          'staff_draft.file_saved',
          { type: 'staff_draft', id: draftId },
          { fileId: row.id, type: claim.type, scanMode: this.config.scanMode },
          { businessId },
        );
        return row.id;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw refusal('UPLOAD_EXPIRED');
      throw error;
    }
    // A new file starts PENDING; locally it is scanned at once, as the scanner would.
    return this.inFirm(actor, async (tx) => {
      if (this.config.scanMode === 'local')
        await tx.staffDraftAttachment.updateMany({
          where: { businessId, id: fileId, scanStatus: 'PENDING' },
          data: { scanStatus: 'CLEAN' },
        });
      return draftFileView(
        await tx.staffDraftAttachment.findFirstOrThrow({
          where: { businessId, id: fileId },
          select: fileSelect,
        }),
      );
    });
  }

  /** Remove: the row and the stored file (see dropStored). Another's draft or file is 404. */
  async remove(actor: StaffActor, draftId: string, fileId: string): Promise<{ ok: true }> {
    const { businessId } = actor;
    const file = await this.inFirm(actor, async (tx) => {
      await this.ownDraft(tx, actor, draftId);
      const row = await tx.staffDraftAttachment.findFirst({
        where: { businessId, staffDraftId: draftId, id: fileId },
        select: { id: true, s3Key: true },
      });
      if (!row) throw notFound();
      return row;
    });
    await this.inFirm(actor, async (tx) => {
      await tx.staffDraftAttachment.deleteMany({ where: { businessId, id: file.id } });
      await this.audit.logIn(
        tx,
        'staff_draft.file_removed',
        { type: 'staff_draft', id: draftId },
        { fileId },
        { businessId },
      );
    });
    await this.dropStored(businessId, file.id, file.s3Key);
    return { ok: true };
  }

  /**
   * Deletes a draft file's stored copy. A missing one is already gone (S3 answers a delete of a
   * missing key with success); any other failure is logged with ids and left for a sweep, never
   * an error for the person: the row is already gone.
   */
  private async dropStored(businessId: string, fileId: string, key: string): Promise<void> {
    await this.storage.remove(key).catch((error: unknown) => {
      this.logger.warn(
        `Draft file ${fileId}'s stored copy in firm ${businessId} was not deleted (${(error as Error).name}); left for a sweep`,
      );
    });
  }

  /**
   * Delete Draft: the draft's files, read before the draft goes (its rows go with it, cascade),
   * for `dropAll` once it is deleted.
   */
  filesOf(actor: StaffActor, draftId: string): Promise<{ id: string; s3Key: string }[]> {
    return this.inFirm(actor, async (tx) => {
      await this.ownDraft(tx, actor, draftId);
      return tx.staffDraftAttachment.findMany({
        where: { businessId: actor.businessId, staffDraftId: draftId },
        select: { id: true, s3Key: true },
      });
    });
  }

  /** After Delete Draft: each stored file deleted, or logged and left for a sweep. */
  async dropAll(businessId: string, files: readonly { id: string; s3Key: string }[]) {
    for (const f of files) await this.dropStored(businessId, f.id, f.s3Key);
  }

  /**
   * After Create Staff committed (the draft and its rows are gone): each CLEAN file is copied to
   * tenant/{businessId}/staff/{membershipId}/ and becomes one of the member's documents (PENDING
   * until the copy's own scan, CLEAN at once locally); every draft copy is then deleted. A file
   * that can't move is logged with ids and left out: the account stands. Returns the files moved.
   */
  async moveToMember(
    actor: StaffActor,
    membershipId: string,
    uploadedById: string,
    files: readonly DraftFileMove[],
  ): Promise<number> {
    const { businessId } = actor;
    let moved = 0;
    for (const f of files) {
      try {
        if (f.scanStatus === 'CLEAN' && this.storage.copy) {
          // The SHA-256 the confirm checked the bytes against (S3's own, or the metadata).
          const stored = await this.storage.head(f.s3Key, { checksum: true });
          if (stored?.sizeBytes !== f.sizeBytes || !stored.sha256)
            throw new Error('stored file differs');
          const key = `tenant/${businessId}/staff/${membershipId}/${randomUUID()}`;
          await this.storage.copy(f.s3Key, key, {
            contentType: f.contentType,
            sha256: stored.sha256,
          });
          const local = this.config.scanMode === 'local';
          await this.database.withScope(
            { kind: 'business', businessId, actorUserId: actor.userId },
            async (tx) => {
              const doc = await tx.staffDocument.create({
                data: {
                  businessId,
                  membershipId,
                  type: f.documentType as Prisma.StaffDocumentCreateInput['type'],
                  fileName: f.fileName,
                  contentType: f.contentType,
                  sizeBytes: f.sizeBytes,
                  sha256: stored.sha256 as string,
                  s3Key: key,
                  uploadedById,
                  ...(local ? { scanStatus: 'CLEAN' as const, scannedAt: new Date() } : {}),
                },
                select: { id: true },
              });
              await this.audit.logIn(
                tx,
                'staff_document.uploaded',
                { type: 'staff_document', id: doc.id },
                {
                  membershipId,
                  type: f.documentType,
                  fromDraftFile: f.id,
                  scanMode: this.config.scanMode,
                },
                { businessId },
              );
            },
          );
          moved++;
        }
      } catch (error) {
        this.logger.warn(
          `Draft file ${f.id} did not move to member ${membershipId} (${(error as Error).name})`,
        );
      }
      await this.dropStored(businessId, f.id, f.s3Key);
    }
    return moved;
  }

  /**
   * A GuardDuty result for tenant/{businessId}/staff-drafts/{draftId}/{uploadId}, for the scan
   * router, as a member's documents: CLEAN, INFECTED or FAILED; PENDING when the scan broke on our
   * side; UNKNOWN when no file has the key yet; IGNORED for another key, a result already set, or
   * an upload the confirm refused.
   */
  async recordScan(result: ScanResult): Promise<ScanOutcome> {
    const [, businessId, draftId, uploadId] = KEY.exec(result.key) ?? [];
    if (!businessId || !draftId || !uploadId) return 'IGNORED';
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const file = await tx.staffDraftAttachment.findFirst({
        where: { businessId, s3Key: result.key },
        select: { id: true, scanStatus: true },
      });
      if (!file) {
        const refused = await tx.auditLog.findFirst({
          where: {
            businessId,
            createdAt: { gte: new Date(Date.now() - SCAN_REFUSALS_SINCE_MS) },
            action: 'staff_draft.file_refused',
            metadata: { path: ['uploadId'], equals: uploadId },
          },
          select: { id: true },
        });
        return refused ? 'IGNORED' : 'UNKNOWN';
      }
      if (file.scanStatus !== 'PENDING') return 'IGNORED';
      const fileReason = (result.reasons ?? []).some((r) => FILE_REASON.test(r));
      const next =
        result.status === 'NO_THREATS_FOUND'
          ? 'CLEAN'
          : result.status === 'THREATS_FOUND'
            ? 'INFECTED'
            : result.status === 'UNSUPPORTED' && fileReason
              ? 'FAILED'
              : null;
      if (!next) {
        this.logger.warn(`Scan of draft file ${file.id} did not finish: ${result.status}`);
        return 'PENDING';
      }
      const { count } = await tx.staffDraftAttachment.updateMany({
        where: { businessId, id: file.id, scanStatus: 'PENDING' },
        data: { scanStatus: next },
      });
      if (!count) return 'IGNORED';
      await this.audit.logIn(
        tx,
        'staff_draft.file_scanned',
        { type: 'staff_draft', id: draftId },
        { fileId: file.id, scanStatus: next, result: result.status },
        { businessId },
      );
      return next;
    });
  }

  /** A storage call; any failure is 503 with Retry-After (nothing deleted). */
  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Staff draft file storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
