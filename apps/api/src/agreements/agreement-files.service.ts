import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import {
  AGREEMENT_ERRORS,
  AGREEMENT_PDF_LIMITS,
  type AgreementErrorCode,
  type AgreementFile,
  type CreateAgreementUploadRequest,
  type DownloadLink,
  type UploadTicket,
} from '@firmivra/types';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';

/** HKDF label for agreement upload tokens (not the documents' label: a token opens only here). */
export const AGREEMENT_UPLOAD_LABEL = 'fv-agreement-upload-v1';
/** As documents: the confirm comes within 15 minutes of the ticket. */
export const AGREEMENT_UPLOAD_SECONDS = 900;

const AgreementUploadClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  /** tenant/{businessId}/agreements/{uuid}, chosen by the API. */
  key: z.string(),
  fileName: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type AgreementUploadClaim = z.infer<typeof AgreementUploadClaim>;

export class AgreementUploadTokens extends Sealer<AgreementUploadClaim> {
  constructor(secrets: PoolSecrets) {
    super(AGREEMENT_UPLOAD_LABEL, AgreementUploadClaim as never, secrets);
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

type PdfRefusal = Extract<
  AgreementErrorCode,
  'UPLOAD_MISMATCH' | 'NOT_A_PDF' | 'FILE_PASSWORD_PROTECTED' | 'TOO_MANY_PAGES'
>;

/**
 * Why stored bytes can't be a PDF original, or null: the %PDF- magic, a pdf-lib parse (encrypted
 * files refused) and at most AGREEMENT_PDF_LIMITS.maxPages pages.
 */
export async function inspectAgreementPdf(bytes: Uint8Array): Promise<PdfRefusal | null> {
  if (!PDF_MAGIC.every((b, i) => bytes[i] === b)) return 'NOT_A_PDF';
  let pages: number;
  try {
    // Loaded with ignoreEncryption so an encrypted file is told apart from a broken one.
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (pdf.isEncrypted) return 'FILE_PASSWORD_PROTECTED';
    pages = pdf.getPageCount(); // throws on a file without a readable page tree
  } catch {
    return 'NOT_A_PDF';
  }
  if (pages < 1) return 'NOT_A_PDF';
  return pages > AGREEMENT_PDF_LIMITS.maxPages ? 'TOO_MANY_PAGES' : null;
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const refusal = (code: AgreementErrorCode, message: string = AGREEMENT_ERRORS[code]) =>
  code === 'UPLOAD_EXPIRED'
    ? new GoneException({ code, message })
    : new ConflictException({ code, message });
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });
const fileSelect = {
  id: true,
  fileName: true,
  sizeBytes: true,
  sha256: true,
  s3Key: true,
  scanStatus: true,
} as const;

/**
 * PDF originals of agreement versions (R14 step 10, Rasel's decision 3): the documents upload in
 * three steps, under tenant/{businessId}/agreements/. Confirm checks the stored bytes (size,
 * SHA-256, a real unencrypted PDF of at most 200 pages); a refused file is deleted. A new file is
 * PENDING until the scan (SCAN_MODE=local: CLEAN at once); downloads only when CLEAN. Only ids go
 * to the audit log, never a file name.
 */
@Injectable()
export class AgreementFilesService {
  private readonly logger = new Logger(AgreementFilesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(DOCUMENTS_CONFIG) private readonly config: DocumentsConfig,
    private readonly tokens: AgreementUploadTokens,
    private readonly audit: AuditService,
    private readonly portal: PortalInfoService,
  ) {}

  async ticket(
    businessId: string,
    userId: string,
    body: CreateAgreementUploadRequest,
  ): Promise<UploadTicket> {
    const key = `tenant/${businessId}/agreements/${randomUUID()}`;
    const put = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: 'application/pdf',
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const claim = { pool: 'STAFF' as const, businessId, userId, key, ...body };
    const uploadToken = await this.tokens.seal(claim, AGREEMENT_UPLOAD_SECONDS);
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  async confirm(businessId: string, userId: string, uploadToken: string): Promise<AgreementFile> {
    const claim = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== userId) {
      throw refusal('UPLOAD_EXPIRED', 'This upload has expired');
    }
    const scope = this.db.forBusiness(businessId);
    const saved = await scope.firmAgreementFile.findUnique({
      where: { s3Key: claim.key },
      select: { id: true },
    });
    if (saved) throw refusal('UPLOAD_EXPIRED', 'This upload has expired');
    const refused = await this.checkStored(claim);
    if (refused) {
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete a refused agreement upload in firm ${businessId}`);
      });
      await this.audit.log(
        'agreement_file.upload_refused',
        { type: 'business', id: businessId },
        { uploadId: claim.key.slice(claim.key.lastIndexOf('/') + 1), code: refused },
      );
      throw refusal(refused);
    }
    const local = this.config.scanMode === 'local';
    let row;
    try {
      row = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
        const file = await tx.firmAgreementFile.create({
          data: {
            businessId,
            fileName: claim.fileName,
            sizeBytes: claim.sizeBytes,
            sha256: claim.sha256,
            s3Key: claim.key,
            uploadedByUserId: userId,
          },
          select: fileSelect,
        });
        // A new file starts PENDING (the database insists); local mode scans it at once.
        if (!local) return file;
        return tx.firmAgreementFile.update({
          where: { id: file.id },
          data: { scanStatus: 'CLEAN', scannedAt: new Date() },
          select: fileSelect,
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw refusal('UPLOAD_EXPIRED', 'This upload has expired');
      }
      throw error;
    }
    await this.audit.log(
      'agreement_file.uploaded',
      { type: 'firm_agreement_file', id: row.id },
      { scanMode: this.config.scanMode },
    );
    return view(row);
  }

  async file(businessId: string, fileId: string): Promise<AgreementFile> {
    return view(await this.find(businessId, fileId));
  }

  async download(businessId: string, fileId: string): Promise<DownloadLink> {
    const link = await this.linkFor(await this.find(businessId, fileId));
    await this.audit.log('agreement_file.download_link_issued', {
      type: 'firm_agreement_file',
      id: fileId,
    });
    return link;
  }

  /**
   * The PDF original of an agreement's CURRENT version, for the signer before they sign. An older
   * version, an archived agreement, a missing PDF or one that isn't CLEAN: 404.
   */
  async publicDownload(firmSlug: string, agreementId: string, version: number) {
    const firm = await this.portal.activeFirm(firmSlug);
    const current = await this.db.forBusiness(firm.id).firmAgreementVersion.findFirst({
      where: { agreementId, agreement: { archivedAt: null } },
      orderBy: { version: 'desc' },
      select: { version: true, pdfFile: { select: fileSelect } },
    });
    const file = current?.pdfFile;
    if (current?.version !== version || !file || file.scanStatus !== 'CLEAN') throw notFound();
    return this.linkFor(file);
  }

  /**
   * The malware scan's result for an object under tenant/{businessId}/agreements/, for the scan
   * router (R1): sets it once, on a PENDING file. Returns false when no such file waits for one.
   */
  async recordScan(key: string, result: 'CLEAN' | 'INFECTED' | 'FAILED'): Promise<boolean> {
    const match = /^tenant\/([0-9a-f-]{36})\/agreements\/[0-9a-f-]{36}$/.exec(key);
    if (!match) return false;
    const { count } = await this.db.forBusiness(match[1]!).firmAgreementFile.updateMany({
      where: { s3Key: key, scanStatus: 'PENDING' },
      data: { scanStatus: result, scannedAt: new Date() },
    });
    return count > 0;
  }

  private async find(businessId: string, fileId: string) {
    const row = await this.db
      .forBusiness(businessId)
      .firmAgreementFile.findUnique({ where: { id: fileId }, select: fileSelect });
    if (!row) throw notFound();
    return row;
  }

  /** A 5-minute attachment link to a CLEAN file whose stored bytes are still the confirmed ones. */
  private async linkFor(file: {
    id: string;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    s3Key: string;
    scanStatus: string;
  }): Promise<DownloadLink> {
    if (file.scanStatus === 'PENDING') throw refusal('SCAN_PENDING', 'Still being checked');
    if (file.scanStatus !== 'CLEAN') throw refusal('FILE_BLOCKED', 'The file can’t be used');
    const stored = await this.s3(() => this.storage.head(file.s3Key, { checksum: true }));
    if (
      stored?.sizeBytes !== file.sizeBytes ||
      stored.sha256 !== file.sha256 ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(`Agreement file ${file.id}: the stored file is not the confirmed one`);
      throw refusal('FILE_BLOCKED', 'The file can’t be used');
    }
    const url = await this.s3(() =>
      this.storage.presignDownload({
        key: file.s3Key,
        fileName: file.fileName,
        contentType: 'application/pdf',
      }),
    );
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }

  private async checkStored(claim: AgreementUploadClaim): Promise<PdfRefusal | null> {
    const head = await this.s3(() => this.storage.head(claim.key));
    if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null) {
      return 'UPLOAD_MISMATCH';
    }
    const bytes = await this.s3(() => this.storage.read(claim.key));
    if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
    if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256) return 'UPLOAD_MISMATCH';
    return inspectAgreementPdf(bytes);
  }

  /** A storage call; any failure is 503 with Retry-After (nothing deleted). */
  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Agreement file storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}

function view(row: {
  id: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: AgreementFile['scanStatus'];
}): AgreementFile {
  return {
    fileId: row.id,
    fileName: row.fileName,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    scanStatus: row.scanStatus,
  };
}
