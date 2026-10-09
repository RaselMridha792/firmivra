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
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFObject, PDFRef } from 'pdf-lib';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { DATABASE } from '../database/database.module.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig } from '../storage/config.js';
import type { ScanOutcome, ScanResult } from '../storage/scan-results.service.js';
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

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/** tenant/{businessId}/agreements/{uploadId}, as ticket() names a new object. */
const KEY = new RegExp(`^tenant/(${UUID})/agreements/(${UUID})$`);
/** As documents: a late scan result still finds its upload's refusal. */
const SCAN_REFUSALS_SINCE_MS = 24 * 60 * 60_000;
/** UNSUPPORTED because of the file itself (as documents); anything else is our side. */
const FILE_REASON =
  /^(PASSWORD_PROTECTED|OBJECT_SIZE_LIMIT_EXCEEDED|EXTRACTED_[A-Z_]+_LIMIT_EXCEEDED|EXTRACTION_RATIO_LIMIT_EXCEEDED)$/;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
/** More indirect objects than this is not an agreement (as esign's pdf-compose.ts). */
const MAX_OBJECTS = 200_000;
/** At most this many confirms check stored bytes at once; one more is 503 (as documents). */
export const AGREEMENT_CHECKS_AT_ONCE = 4;
let checking = 0;

class PdfRefused extends Error {
  constructor(readonly code: 'NOT_A_PDF' | 'TOO_MANY_PAGES') {
    super(code);
  }
}

/**
 * Counts the leaf pages without pdf-lib's own walk, which follows a node listed twice every time
 * (a few KB can then take minutes), as esign's countPages: a node met twice or past depth 64 is
 * NOT_A_PDF; past the page limit it stops with TOO_MANY_PAGES.
 */
function countPages(doc: PDFDocument): number {
  const seen = new Set<PDFObject>();
  let count = 0;
  const walk = (ref: PDFObject | undefined, depth: number): void => {
    if (!(ref instanceof PDFRef) || seen.has(ref) || depth > 64) throw new PdfRefused('NOT_A_PDF');
    seen.add(ref);
    const node = doc.context.lookup(ref, PDFDict);
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (node.get(PDFName.of('Type')) === PDFName.of('Page') || !kids) {
      if (++count > AGREEMENT_PDF_LIMITS.maxPages) throw new PdfRefused('TOO_MANY_PAGES');
      return;
    }
    for (let i = 0; i < kids.size(); i++) walk(kids.get(i), depth + 1);
  };
  walk(doc.catalog.get(PDFName.of('Pages')), 0);
  return count;
}

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
  try {
    // Loaded with ignoreEncryption so an encrypted file is told apart from a broken one.
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (pdf.isEncrypted) return 'FILE_PASSWORD_PROTECTED';
    if (pdf.context.largestObjectNumber > MAX_OBJECTS) return 'NOT_A_PDF';
    return countPages(pdf) < 1 ? 'NOT_A_PDF' : null;
  } catch (error) {
    return error instanceof PdfRefused ? error.code : 'NOT_A_PDF';
  }
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
        const saved = local
          ? await tx.firmAgreementFile.update({
              where: { id: file.id },
              data: { scanStatus: 'CLEAN', scannedAt: new Date() },
              select: fileSelect,
            })
          : file;
        await this.audit.logIn(
          tx,
          'agreement_file.uploaded',
          { type: 'firm_agreement_file', id: saved.id },
          { scanMode: this.config.scanMode },
        );
        return saved;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw refusal('UPLOAD_EXPIRED', 'This upload has expired');
      }
      throw error;
    }
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
   * A GuardDuty result for an object under tenant/{businessId}/agreements/, for the scan router
   * (R1), with ScanResultsService's outcomes: CLEAN or INFECTED; FAILED for a file the scan can't
   * read (a file reason of UNSUPPORTED); PENDING when the scan broke on our side (the alarm and a
   * rescan); UNKNOWN when no file has the key yet (the confirm may still come: redeliver);
   * IGNORED for another key, a result already set, or an upload the confirm refused. The file is
   * found by its key in the firm the key names. Audited with ids and codes only.
   */
  async recordScan(result: ScanResult): Promise<ScanOutcome> {
    const [, businessId, uploadId] = KEY.exec(result.key) ?? [];
    if (!businessId || !uploadId) return 'IGNORED';
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const [file] = await tx.$queryRaw<{ id: string; scan_status: string }[]>`
        SELECT id, scan_status::text AS scan_status FROM firm_agreement_files
        WHERE business_id = ${businessId}::uuid AND s3_key = ${result.key} FOR UPDATE`;
      if (!file) {
        const refused = await tx.auditLog.findFirst({
          where: {
            businessId,
            createdAt: { gte: new Date(Date.now() - SCAN_REFUSALS_SINCE_MS) },
            action: 'agreement_file.upload_refused',
            metadata: { path: ['uploadId'], equals: uploadId },
          },
          select: { id: true },
        });
        if (refused) return 'IGNORED';
        this.logger.warn(`Scan result for agreement upload ${uploadId} has no file yet; redeliver`);
        return 'UNKNOWN';
      }
      if (file.scan_status !== 'PENDING') return 'IGNORED';
      const fileReason = (result.reasons ?? []).some((r) => FILE_REASON.test(r));
      const next =
        result.status === 'NO_THREATS_FOUND'
          ? 'CLEAN'
          : result.status === 'THREATS_FOUND'
            ? 'INFECTED'
            : result.status === 'UNSUPPORTED' && fileReason
              ? 'FAILED'
              : null;
      const entity = { type: 'firm_agreement_file', id: file.id };
      if (!next) {
        this.logger.warn(`Scan of agreement file ${file.id} did not finish: ${result.status}`);
        await this.audit.logIn(
          tx,
          'agreement_file.scan_unfinished',
          entity,
          { result: result.status },
          { businessId },
        );
        return 'PENDING';
      }
      await tx.firmAgreementFile.update({
        where: { id: file.id },
        data: { scanStatus: next, scannedAt: new Date() },
      });
      await this.audit.logIn(
        tx,
        'agreement_file.scanned',
        entity,
        { scanStatus: next, result: result.status },
        { businessId },
      );
      return next;
    });
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

  /** At most AGREEMENT_CHECKS_AT_ONCE at a time; one more is 503 (nothing deleted). */
  private async checkStored(claim: AgreementUploadClaim): Promise<PdfRefusal | null> {
    if (checking >= AGREEMENT_CHECKS_AT_ONCE) {
      this.logger.warn(`Confirm refused: ${AGREEMENT_CHECKS_AT_ONCE} checks already running; 503`);
      throw unavailable();
    }
    checking += 1;
    try {
      return await this.inspectStored(claim);
    } finally {
      checking -= 1;
    }
  }

  private async inspectStored(claim: AgreementUploadClaim): Promise<PdfRefusal | null> {
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
