import { randomUUID } from 'node:crypto';
import {
  GoneException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  CreateSupportUploadRequest,
  type UploadContentType,
  type UploadTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { DATABASE } from '../database/database.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import { checkFile } from '../storage/file-checks.js';
import {
  type RoutedScanResult,
  type ScanResultHandler,
  ScanResultRouter,
} from '../storage/scan-queue/scan-router.js';
import { ignoreOrphan } from '../storage/scan-record.js';
import { type ScanOutcome, scanVerdict } from '../storage/scan-results.service.js';
import { notFound, supportError } from './support-context.js';

/** HKDF label for Support upload tokens: a token opens only here. */
export const SUPPORT_UPLOAD_LABEL = 'fv-support-upload-v1';
/** As documents: the action that adds the file comes within 15 minutes of the ticket. */
const UPLOAD_SECONDS = 900;
/** At most this many stored-file checks at once; one more is 503 (as documents). */
const CHECKS_AT_ONCE = 4;
let checking = 0;

const SupportUploadClaim = z.object({
  pool: z.literal('ADMIN'),
  userId: z.uuid(),
  businessId: z.uuid(),
  /** tenant/{businessId}/support/{uuid}, chosen by the API. */
  key: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SupportUploadClaim = z.infer<typeof SupportUploadClaim>;

export class SupportUploadTokens extends Sealer<SupportUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super(SUPPORT_UPLOAD_LABEL, SupportUploadClaim as never, secrets);
  }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^tenant/(${UUID})/support/(${UUID})$`);

type Refusal = 'UPLOAD_MISMATCH' | 'FILE_PASSWORD_PROTECTED' | 'FILE_HAS_MACROS';
const MESSAGES: Record<Refusal | 'UPLOAD_EXPIRED', string> = {
  UPLOAD_EXPIRED: 'The upload took too long. Attach the file again.',
  UPLOAD_MISMATCH: 'The file did not upload correctly. Attach it again.',
  FILE_PASSWORD_PROTECTED: 'Remove the password from the file, then attach it again.',
  FILE_HAS_MACROS: 'Files with macros cannot be attached.',
};
const refusal = (code: Refusal | 'UPLOAD_EXPIRED') =>
  code === 'UPLOAD_EXPIRED'
    ? new GoneException({ code, message: MESSAGES[code] })
    : supportError(409, code, MESSAGES[code]);
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

export interface StoredFile {
  claim: SupportUploadClaim;
}

/**
 * Files on Support tickets (R60 on R0's B2): the documents module's three steps, under the firm's
 * own prefix tenant/{businessId}/support/. `ticket` answers where to PUT; the ticket action that
 * adds the files calls `check` (the stored bytes are the declared ones) and inserts the rows; a
 * refused file is deleted. A new file is PENDING until the scan: GuardDuty's result comes through
 * the scan router (`support` prefix) and is recorded in platform scope, the scanner's place in
 * B2's rules; locally (`SCAN_MODE=local`) the file is clean at once. Downloads only when CLEAN.
 * The audit log gets ids, never a file name.
 */
@Injectable()
export class SupportFilesService implements ScanResultHandler, OnModuleInit {
  readonly prefix = 'support';
  private readonly logger = new Logger(SupportFilesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: SupportUploadTokens,
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    private readonly router: ScanResultRouter,
  ) {}

  onModuleInit(): void {
    this.router.register(this);
  }

  /** Step 1: where to PUT the file, for one firm's ticket. */
  async ticket(body: z.output<typeof CreateSupportUploadRequest>): Promise<UploadTicket> {
    const firm = await this.admin.db.business.findUnique({
      where: { id: body.firmId },
      select: { id: true },
    });
    if (!firm) throw notFound('Firm');
    const key = `tenant/${firm.id}/support/${randomUUID()}`;
    const put = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const claim: SupportUploadClaim = {
      pool: 'ADMIN',
      userId: this.admin.adminUserId,
      businessId: firm.id,
      key,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    const uploadToken = await this.tokens.seal(claim, UPLOAD_SECONDS);
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  /**
   * The files an action adds, checked: each token is this member's, for this firm and unused, and
   * the stored bytes are what was declared. Call before the action's transaction (S3 is outside).
   */
  async check(uploadTokens: readonly string[], businessId: string): Promise<SupportUploadClaim[]> {
    const claims: SupportUploadClaim[] = [];
    for (const token of uploadTokens) {
      const claim = (await this.tokens.open(token, 'ADMIN'))?.value;
      if (
        claim?.userId !== this.admin.adminUserId ||
        claim.businessId !== businessId ||
        !KEY.test(claim.key)
      )
        throw refusal('UPLOAD_EXPIRED');
      if (claims.some((c) => c.key === claim.key)) continue;
      claims.push(claim);
    }
    if (claims.length === 0) return claims;
    const used = await this.admin.db.supportTicketAttachment.findMany({
      where: { s3Key: { in: claims.map((c) => c.key) } },
      select: { id: true },
    });
    if (used.length > 0) throw refusal('UPLOAD_EXPIRED');
    for (const claim of claims) {
      const refused = await this.checkStored(claim);
      if (refused) {
        await this.storage.remove(claim.key).catch(() => {
          this.logger.warn(`Could not delete a refused support upload in firm ${claim.businessId}`);
        });
        await this.audit.log(
          'support_attachment.upload_refused',
          { type: 'support_upload', id: claim.key.slice(claim.key.lastIndexOf('/') + 1) },
          { businessId: claim.businessId, code: refused },
          { businessId: null },
        );
        throw refusal(refused);
      }
    }
    return claims;
  }

  /** The rows for checked files, inside the action's admin transaction. */
  async insert(
    tx: TxClient,
    claims: readonly SupportUploadClaim[],
    on: { businessId: string; ticketId: string; messageId?: string; noteId?: string },
  ): Promise<{ id: string; name: string }[]> {
    const rows: { id: string; name: string }[] = [];
    for (const claim of claims) {
      const row = await tx.supportTicketAttachment.create({
        data: {
          businessId: on.businessId,
          ticketId: on.ticketId,
          messageId: on.messageId ?? null,
          noteId: on.noteId ?? null,
          uploadedByUserId: claim.userId,
          fileName: claim.fileName,
          contentType: claim.contentType,
          sizeBytes: claim.sizeBytes,
          sha256: claim.sha256,
          s3Key: claim.key,
        },
        select: { id: true, fileName: true },
      });
      rows.push({ id: row.id, name: row.fileName });
    }
    return rows;
  }

  /** Locally (SCAN_MODE=local) a new file is clean at once, as the scanner would record it. */
  async afterInsert(ids: readonly string[]): Promise<void> {
    if (this.config.scanMode !== 'local' || ids.length === 0) return;
    await this.admin.db.supportTicketAttachment.updateMany({
      where: { id: { in: [...ids] }, scanStatus: 'PENDING' },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
  }

  /** A 5-minute link to a CLEAN file whose stored bytes are still the confirmed ones. */
  async link(file: {
    id: string;
    ticketId: string;
    businessId: string;
    s3Key: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    scanStatus: string;
  }): Promise<{ url: string; expiresAt: string }> {
    if (file.scanStatus === 'PENDING')
      throw supportError(409, 'SCAN_PENDING', 'The file is still being checked for viruses');
    if (file.scanStatus !== 'CLEAN')
      throw supportError(409, 'FILE_BLOCKED', 'This file was blocked by the virus check');
    const stored = await this.s3(() => this.storage.head(file.s3Key, { checksum: true }));
    if (
      stored?.sizeBytes !== file.sizeBytes ||
      stored.sha256 !== file.sha256 ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(`Support attachment ${file.id}: the stored file is not the confirmed one`);
      throw supportError(409, 'SCAN_PENDING', 'The file is not available right now');
    }
    const url = await this.s3(() =>
      this.storage.presignDownload({
        key: file.s3Key,
        fileName: file.fileName,
        contentType: file.contentType,
      }),
    );
    await this.audit.log(
      'support_attachment.download_link_issued',
      { type: 'support_attachment', id: file.id },
      { ticketId: file.ticketId, businessId: file.businessId },
      { businessId: null },
    );
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }

  /**
   * GuardDuty's result for tenant/{businessId}/support/{uploadId}: recorded in platform scope (the
   * scanner's, B2), found by the key in the key's own firm, only on a PENDING file.
   */
  async handle(result: RoutedScanResult): Promise<ScanOutcome> {
    const outcome = await this.database.withScope({ kind: 'platform' }, async (tx) => {
      const file = await tx.supportTicketAttachment.findFirst({
        where: { businessId: result.businessId, s3Key: result.key },
        select: { id: true, ticketId: true, contentType: true, scanStatus: true },
      });
      if (!file) return 'UNKNOWN' as const;
      if (file.scanStatus !== 'PENDING') return 'IGNORED' as const;
      const verdict = scanVerdict(
        { key: result.key, status: result.status, reasons: [...result.reasons] },
        file.contentType,
      );
      if (!verdict) {
        await this.audit.logIn(
          tx,
          'support_attachment.scan_unfinished',
          { type: 'support_attachment', id: file.id },
          { ticketId: file.ticketId, businessId: result.businessId, status: result.status },
          { businessId: null },
        );
        return 'PENDING' as const;
      }
      await tx.supportTicketAttachment.updateMany({
        where: { id: file.id, scanStatus: 'PENDING' },
        data: { scanStatus: verdict.scan, scannedAt: new Date() },
      });
      await this.audit.logIn(
        tx,
        'support_attachment.scanned',
        { type: 'support_attachment', id: file.id },
        {
          ticketId: file.ticketId,
          businessId: result.businessId,
          scan: verdict.scan,
          unscanned: verdict.unscanned,
        },
        { businessId: null },
      );
      const outcome: ScanOutcome = verdict.unscanned
        ? 'UNSCANNED'
        : verdict.scan === 'CLEAN'
          ? 'CLEAN'
          : verdict.scan === 'INFECTED'
            ? 'INFECTED'
            : 'FAILED';
      return outcome;
    });
    return ignoreOrphan(outcome, result, this.logger, result.path.split('/').at(-1) ?? '');
  }

  private async checkStored(claim: SupportUploadClaim): Promise<Refusal | null> {
    const stored = await this.s3(() => this.storage.head(claim.key, { checksum: true }));
    if (!stored) throw refusal('UPLOAD_EXPIRED');
    if (
      stored.sizeBytes !== claim.sizeBytes ||
      stored.sha256 !== claim.sha256 ||
      stored.contentEncoding !== null
    )
      return 'UPLOAD_MISMATCH';
    if (checking >= CHECKS_AT_ONCE) throw unavailable();
    checking++;
    try {
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (!bytes) throw refusal('UPLOAD_EXPIRED');
      return checkFile(claim.contentType as UploadContentType, bytes);
    } finally {
      checking--;
    }
  }

  private async s3<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GoneException || (error as { status?: number }).status === 409)
        throw error;
      this.logger.warn(`Support file storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
