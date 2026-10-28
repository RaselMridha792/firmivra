import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, Prisma, ScanStatus, TxClient } from '@firmivra/db';
import {
  type DownloadLink,
  fileNameFitsType,
  MESSAGE_SETTINGS_DEFAULTS,
  OUTBOUND_FILES_MAX,
  type OutboundFile,
  type StartOutboundFileRequest,
  type UploadContentType,
  type UploadTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  multipartIdOf,
  uploadTicket,
} from '../storage/document-storage.js';
import { checkFile } from '../storage/file-checks.js';
import { readBudget } from '../storage/read-budget.js';
import {
  type InFirm,
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import { type ScanOutcome, scanVerdict } from '../storage/scan-results.service.js';
import { MultipartUploadId, uploadTokenSeconds } from '../storage/upload-token.js';

/** HKDF label for New Message file tokens: a token opens only here. */
export const OUTBOUND_UPLOAD_LABEL = 'fv-outbound-upload-v1';

const Claim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  outboundMessageId: z.uuid(),
  /** tenant/{businessId}/messages/{uuid}, chosen by the API (the table's check). */
  key: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadId: MultipartUploadId.nullable(),
});
type Claim = z.infer<typeof Claim>;

export class OutboundUploadTokens extends Sealer<Claim> {
  constructor(secrets: PoolSecrets) {
    super(OUTBOUND_UPLOAD_LABEL, Claim as never, secrets);
  }
}

const MB = 1024 * 1024;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: 'The upload took too long. Add it again.' });
const badRequest = (code: string, message: string) => new BadRequestException({ code, message });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const REFUSED: Record<string, string> = {
  UPLOAD_MISMATCH: 'The file did not upload correctly. Add it again.',
  FILE_PASSWORD_PROTECTED: 'Remove the password from the file, then add it again.',
  FILE_HAS_MACROS: 'Files with macros cannot be sent.',
};
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

const fileSelect = {
  id: true,
  outboundMessageId: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  s3Key: true,
  scanStatus: true,
  createdAt: true,
} satisfies Prisma.OutboundMessageFileSelect;
type FileRow = Prisma.OutboundMessageFileGetPayload<{ select: typeof fileSelect }>;

/** CHECKING while the scan runs; READY once clean; BLOCKED when infected or the scan failed. */
export const fileStatus = (scan: ScanStatus): OutboundFile['status'] =>
  scan === 'CLEAN' ? 'READY' : scan === 'PENDING' ? 'CHECKING' : 'BLOCKED';
export const toOutboundFile = (f: {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  scanStatus: ScanStatus;
  createdAt: Date;
}): OutboundFile => ({
  id: f.id,
  fileName: f.fileName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  status: fileStatus(f.scanStatus),
  createdAt: f.createdAt.toISOString(),
});

/**
 * Files sent with New Message (R60, MSG-F12), on R36's outbound_message_files: Documents' three
 * steps under tenant/{businessId}/messages/. Messages Settings decide the types and the size; the
 * confirm checks the stored bytes (size, SHA-256, and that the file is what its type says) and
 * deletes a refused upload. A file is added and removed only while its message is a draft or
 * scheduled (the database agrees), and starts PENDING: GuardDuty's result comes through the scan
 * router (`messages` prefix), and locally (SCAN_MODE=local) it is clean at once. A client opens a
 * file only once it reached them through their portal; links only for a CLEAN file. Staff reach
 * only their own messages. The audit log gets ids, never a file name.
 */
@Injectable()
export class OutboundFilesService implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'messages';
  private readonly logger = new Logger(OutboundFilesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: OutboundUploadTokens,
    private readonly audit: AuditService,
    private readonly router: ScanResultRouter,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** A direct message the actor reaches (Staff: their own), still a draft or scheduled. */
  private async editable(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const m = await tx.outboundMessage.findFirst({
      where: {
        businessId,
        id,
        kind: 'DIRECT',
        ...(actor.role === 'STAFF' ? { createdByUserId: actor.userId } : {}),
      },
      select: { id: true, status: true },
    });
    if (!m) throw notFound();
    if (m.status !== 'DRAFT' && m.status !== 'SCHEDULED')
      throw conflict('NOT_EDITABLE', 'This message was already sent or canceled.');
    return m;
  }

  /** Messages Settings' file types and size (the defaults until the first save). */
  private async limits(tx: TxClient, businessId: string) {
    const s = await tx.messageSettings.findUnique({
      where: { businessId },
      select: { attachmentMaxMb: true, allowedAttachmentTypes: true },
    });
    return {
      types: (s?.allowedAttachmentTypes ??
        MESSAGE_SETTINGS_DEFAULTS.allowedAttachmentTypes) as readonly string[],
      maxMb: s?.attachmentMaxMb ?? MESSAGE_SETTINGS_DEFAULTS.attachmentMaxMb,
    };
  }

  /** The files of messages, oldest first, for their answers. */
  async filesOf(
    tx: TxClient,
    businessId: string,
    outboundMessageIds: string[],
  ): Promise<Map<string, OutboundFile[]>> {
    const byMessage = new Map<string, OutboundFile[]>();
    if (outboundMessageIds.length === 0) return byMessage;
    const rows = await tx.outboundMessageFile.findMany({
      where: { businessId, outboundMessageId: { in: outboundMessageIds } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: fileSelect,
    });
    for (const r of rows) {
      const list = byMessage.get(r.outboundMessageId) ?? [];
      list.push(toOutboundFile(r));
      byMessage.set(r.outboundMessageId, list);
    }
    return byMessage;
  }

  /**
   * A draft replaced by a new one (other people or another channel, OutboundMessagesService.update)
   * keeps its files: each row moves to the new draft with its object and its scan result. Call in
   * the update's transaction, before the old draft is canceled (rows change only on a draft).
   */
  async move(tx: TxClient, businessId: string, fromId: string, toId: string): Promise<void> {
    const rows = await tx.outboundMessageFile.findMany({
      where: { businessId, outboundMessageId: fromId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const r of rows) {
      await tx.outboundMessageFile.delete({ where: { id: r.id } });
      const moved = await tx.outboundMessageFile.create({
        data: {
          businessId,
          outboundMessageId: toId,
          fileName: r.fileName,
          contentType: r.contentType,
          sizeBytes: r.sizeBytes,
          sha256: r.sha256,
          s3Key: r.s3Key,
          uploadedByUserId: r.uploadedByUserId,
        },
        select: { id: true },
      });
      // A file starts unscanned; one already scanned keeps its result, set once.
      if (r.scanStatus !== 'PENDING')
        await tx.outboundMessageFile.update({
          where: { id: moved.id },
          data: { scanStatus: r.scanStatus, scannedAt: r.scannedAt ?? new Date() },
        });
    }
  }

  /** Step 1: where to send the file. */
  async ticket(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: StartOutboundFileRequest,
  ): Promise<UploadTicket> {
    const contentType = body.contentType as UploadContentType;
    await this.inFirm(businessId, async (tx) => {
      await this.editable(tx, businessId, actor, id);
      const { types, maxMb } = await this.limits(tx, businessId);
      const ext = body.fileName.trim().toLowerCase().split('.').pop() ?? '';
      if (!fileNameFitsType(body.fileName, contentType) || !types.includes(ext))
        throw badRequest('ATTACHMENT_TYPE', `Messages Settings don't allow .${ext} files`);
      if (body.sizeBytes > maxMb * MB)
        throw badRequest('ATTACHMENT_TOO_LARGE', `A file is at most ${maxMb} MB`);
      const n = await tx.outboundMessageFile.count({
        where: { businessId, outboundMessageId: id },
      });
      if (n >= OUTBOUND_FILES_MAX)
        throw badRequest('TOO_MANY_FILES', `A message carries at most ${OUTBOUND_FILES_MAX} files`);
    });
    const key = `tenant/${businessId}/messages/${randomUUID()}`;
    const presigned = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const uploadId = multipartIdOf(presigned);
    const claim: Claim = {
      pool: 'STAFF',
      businessId,
      userId: actor.userId,
      outboundMessageId: id,
      key,
      fileName: body.fileName.trim(),
      contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      uploadId,
    };
    return uploadTicket(await this.tokens.seal(claim, uploadTokenSeconds(uploadId)), presigned);
  }

  /** Step 3: the stored bytes checked, the file is on the message (CHECKING until its scan). */
  async confirm(
    businessId: string,
    actor: ClientsActor,
    id: string,
    uploadToken: string,
  ): Promise<OutboundFile> {
    const claim = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
    if (
      claim?.businessId !== businessId ||
      claim.userId !== actor.userId ||
      claim.outboundMessageId !== id
    )
      throw expired();
    const known = await this.inFirm(businessId, async (tx) => {
      await this.editable(tx, businessId, actor, id);
      return tx.outboundMessageFile.findFirst({
        where: { businessId, s3Key: claim.key },
        select: { id: true },
      });
    });
    if (known) throw expired();
    const why = await this.checkStored(claim);
    if (why) {
      if (claim.uploadId)
        await this.storage.abortUpload(claim.key, claim.uploadId).catch(() => {
          this.logger.warn(
            `Could not drop a refused message multipart upload in firm ${businessId}`,
          );
        });
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete a refused message upload in firm ${businessId}`);
      });
      await this.audit.log(
        'outbound_file.upload_refused',
        { type: 'outbound_message', id },
        { code: why },
      );
      throw conflict(why, REFUSED[why] ?? 'The file can’t be used');
    }
    let row: FileRow;
    try {
      row = await this.inFirm(businessId, async (tx) => {
        await this.editable(tx, businessId, actor, id);
        const created = await tx.outboundMessageFile.create({
          data: {
            businessId,
            outboundMessageId: id,
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            sha256: claim.sha256,
            s3Key: claim.key,
            uploadedByUserId: actor.userId,
          },
          select: fileSelect,
        });
        await this.audit.logIn(
          tx,
          'outbound_file.added',
          { type: 'outbound_message_file', id: created.id },
          { outboundMessageId: id, scanMode: this.config.scanMode },
        );
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw expired();
      throw error;
    }
    // Locally the file is scanned at once, as the scanner would record it.
    if (this.config.scanMode === 'local') {
      row = await this.inFirm(businessId, async (tx) => {
        await tx.outboundMessageFile.updateMany({
          where: { businessId, id: row.id, scanStatus: 'PENDING' },
          data: { scanStatus: 'CLEAN', scannedAt: new Date() },
        });
        return tx.outboundMessageFile.findFirstOrThrow({
          where: { businessId, id: row.id },
          select: fileSelect,
        });
      });
    }
    return toOutboundFile(row);
  }

  async remove(businessId: string, actor: ClientsActor, id: string, fileId: string) {
    const key = await this.inFirm(businessId, async (tx) => {
      await this.editable(tx, businessId, actor, id);
      const f = await tx.outboundMessageFile.findFirst({
        where: { businessId, outboundMessageId: id, id: fileId },
        select: { id: true, s3Key: true },
      });
      if (!f) throw notFound();
      await tx.outboundMessageFile.delete({ where: { id: f.id } });
      await this.audit.logIn(
        tx,
        'outbound_file.removed',
        { type: 'outbound_message_file', id: f.id },
        { outboundMessageId: id },
      );
      return f.s3Key;
    });
    await this.storage.remove(key).catch(() => {
      this.logger.warn(`Could not delete a removed message file in firm ${businessId}`);
    });
    return { ok: true as const };
  }

  /**
   * The firm's link: the author, the Owner and Admins, and Staff whose client the message reached
   * (another file is 404).
   */
  async firmDownload(businessId: string, actor: ClientsActor, fileId: string) {
    const file = await this.inFirm(businessId, async (tx) =>
      tx.outboundMessageFile.findFirst({
        where: {
          businessId,
          id: fileId,
          ...(actor.role === 'STAFF'
            ? {
                outbound: {
                  OR: [
                    { createdByUserId: actor.userId },
                    {
                      recipients: {
                        some: {
                          client: { assignedUserId: actor.userId },
                          messageId: { not: null },
                        },
                      },
                    },
                  ],
                },
              }
            : {}),
        },
        select: fileSelect,
      }),
    );
    if (!file) throw notFound();
    return this.link(businessId, file);
  }

  /**
   * The portal's link: only a file whose message reached this client through their portal, and,
   * as the firm's shared documents in My Documents, only for a PRIMARY or SPOUSE login.
   */
  async portalDownload(businessId: string, clientAccountId: string, fileId: string) {
    const file = await this.inFirm(businessId, async (tx) => {
      const me = await tx.clientAccount.findFirst({
        where: {
          businessId,
          id: clientAccountId,
          status: 'ACTIVE',
          portalRole: { in: ['PRIMARY', 'SPOUSE'] },
        },
        select: { clientId: true },
      });
      if (!me) throw notFound();
      return tx.outboundMessageFile.findFirst({
        where: {
          businessId,
          id: fileId,
          outbound: {
            recipients: {
              some: { clientId: me.clientId, channel: 'PORTAL', messageId: { not: null } },
            },
          },
        },
        select: fileSelect,
      });
    });
    if (!file) throw notFound();
    return this.link(businessId, file);
  }

  /** A 5-minute link to a CLEAN file whose stored bytes are still the confirmed ones. */
  private async link(businessId: string, file: FileRow): Promise<DownloadLink> {
    if (file.scanStatus === 'PENDING')
      throw conflict('SCAN_PENDING', 'The file is still being checked for viruses.');
    if (file.scanStatus !== 'CLEAN')
      throw conflict('FILE_BLOCKED', 'This file failed its security check.');
    const stored = await this.s3(() => this.storage.head(file.s3Key, { checksum: true }));
    if (
      stored?.sizeBytes !== file.sizeBytes ||
      (stored.sha256 !== null && stored.sha256 !== file.sha256) ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(`Message file ${file.id}: the stored file is not the confirmed one`);
      throw conflict('FILE_BLOCKED', 'This file is not available.');
    }
    const url = await this.s3(() =>
      this.storage.presignDownload({
        key: file.s3Key,
        fileName: file.fileName,
        contentType: file.contentType,
      }),
    );
    await this.audit.log(
      'outbound_file.download_link_issued',
      { type: 'outbound_message_file', id: file.id },
      { outboundMessageId: file.outboundMessageId },
      { businessId },
    );
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }

  /**
   * GuardDuty's result for tenant/{businessId}/messages/{uploadId}, in the key's own firm, only on
   * a PENDING file (the database sets a result once).
   */
  async handle(result: RoutedScanResult, inFirm: InFirm): Promise<ScanOutcome> {
    const outcome = await inFirm(async (tx): Promise<ScanOutcome> => {
      const file = await tx.outboundMessageFile.findFirst({
        where: { businessId: result.businessId, s3Key: result.key },
        select: { id: true, outboundMessageId: true, contentType: true, scanStatus: true },
      });
      if (!file) return 'UNKNOWN';
      if (file.scanStatus !== 'PENDING') return 'IGNORED';
      const entity = { type: 'outbound_message_file', id: file.id };
      const verdict = scanVerdict(
        { key: result.key, status: result.status, reasons: [...result.reasons] },
        file.contentType,
      );
      if (!verdict) {
        await this.audit.logIn(
          tx,
          'outbound_file.scan_unfinished',
          entity,
          { outboundMessageId: file.outboundMessageId, result: result.status },
          { businessId: result.businessId },
        );
        return 'PENDING';
      }
      const { count } = await tx.outboundMessageFile.updateMany({
        where: { businessId: result.businessId, id: file.id, scanStatus: 'PENDING' },
        data: { scanStatus: verdict.scan, scannedAt: new Date() },
      });
      if (!count) return 'IGNORED';
      await this.audit.logIn(
        tx,
        'outbound_file.scanned',
        entity,
        {
          outboundMessageId: file.outboundMessageId,
          scanStatus: verdict.scan,
          result: result.status,
          ...(verdict.unscanned && { unscanned: true }),
        },
        { businessId: result.businessId },
      );
      return verdict.unscanned ? 'UNSCANNED' : verdict.scan;
    });
    return ignoreOrphan(outcome, result, this.logger, result.path.split('/').at(-1) ?? '');
  }

  /**
   * Holding the file's size of the read budget (no room: 503, nothing deleted or completed). A
   * multipart upload is completed first: 410 when storage no longer has it.
   */
  private checkStored(claim: Claim): Promise<string | null> {
    return readBudget.hold(claim.sizeBytes, unavailable, async () => {
      const { uploadId } = claim;
      if (uploadId) {
        const done = await this.s3(() =>
          this.storage.completeUpload(claim.key, uploadId, claim.sizeBytes),
        );
        if (done === 'MISSING') throw expired();
        if (done === 'MISMATCH') return 'UPLOAD_MISMATCH';
      }
      const head = await this.s3(() => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null)
        return 'UPLOAD_MISMATCH';
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256)
        return 'UPLOAD_MISMATCH';
      return checkFile(claim.contentType as UploadContentType, bytes);
    });
  }

  /** A storage call; any failure is 503 with Retry-After (nothing deleted). */
  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof GoneException) throw error;
      this.logger.warn(`Message file storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
