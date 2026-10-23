import { createHash, randomUUID } from 'node:crypto';
import {
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  type CreateEsignUploadBody,
  ESIGN_ERRORS,
  ESIGN_MAX_REQUEST_BYTES,
  ESIGN_UPLOAD_TYPES,
  type EsignContentType,
  type EsignDocument,
  type EsignField,
  type EsignRequestDetail,
  type UploadTicket,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { statusOf, uploadTicket } from '../../storage/document-storage.js';
import { type Keep, PDF_PARSE_FACTOR, readBudget } from '../../storage/read-budget.js';
import {
  ESIGN_STORE,
  EsignEngineError,
  type EsignStore,
  PDF_ENGINE,
  type PdfEngine,
} from '../engine/engine.types.js';
import { type DirectoryDocument, ESIGN_DIRECTORY, type EsignDirectory } from './esign-directory.js';
import { esignUploadToken, filesBusy, multipartIdIn, uploadTooOld } from './esign-uploads.js';
import {
  ESIGN_REPOSITORY,
  type EsignPendingUpload,
  type EsignRepository,
  type NewEsignDocument,
} from './esign.repository.js';
import {
  type EsignActor,
  esignRefusal,
  EsignRequestsService,
  savedOrRefused,
  toDocument,
} from './requests.service.js';

type Store = Pick<
  EsignStore,
  | 'keyFor'
  | 'presignUpload'
  | 'completeUpload'
  | 'abortUpload'
  | 'head'
  | 'read'
  | 'put'
  | 'copyFromVault'
  | 'remove'
>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: ESIGN_ERRORS.UPLOAD_EXPIRED });
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const entity = (id: string) => ({ type: 'esign_request', id });
const isEsignType = (type: string): type is EsignContentType =>
  Object.hasOwn(ESIGN_UPLOAD_TYPES, type);
/** S3's missing key on a copy or read (the in-memory store rejects with that message). */
const isNoSuchKey = (error: unknown) =>
  error instanceof Error &&
  (error.name === 'NoSuchKey' ||
    error.message === 'NoSuchKey' ||
    (statusOf(error) === 404 && error.name !== 'NoSuchBucket'));

/** The read budget a file's check holds: a PDF is parsed (pdf-lib copies its streams). */
const budgetFor = (file: { sizeBytes: number; contentType: string }) =>
  file.sizeBytes * (file.contentType === 'application/pdf' ? PDF_PARSE_FACTOR : 1);

/** A CLEAN file's bytes for the page viewer. */
export interface EsignContent {
  bytes: Uint8Array;
  contentType: EsignContentType;
}

/**
 * A DRAFT's files (R13 step 6, parts 1d and 1e): uploads in three steps as in Documents, copies
 * from the client's vault, removal, and the bytes for the page viewer. Every change needs the
 * requests service's write access (an approver who may only read gets 404, like anyone else who
 * may not change the request); the bytes are a read. Files sit under
 * tenant/<businessId>/esign/<requestId>/
 * (EsignStore checks every key). The audit log and the log get ids only. Every whole-file read
 * holds its bytes of the read budget (storage/read-budget.ts); without room: 503, nothing used up.
 */
@Injectable()
export class EsignDocumentsService {
  private readonly logger = new Logger(EsignDocumentsService.name);

  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(ESIGN_STORE) private readonly store: Store,
    @Inject(PDF_ENGINE) private readonly pdf: Pick<PdfEngine, 'inspect'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  /**
   * Step 1: a presigned PUT for exactly the described file (a larger one: a multipart upload),
   * and a single-use upload token (esign-uploads.ts).
   */
  async createUpload(
    businessId: string,
    actor: EsignActor,
    id: string,
    body: z.output<typeof CreateEsignUploadBody>,
  ): Promise<UploadTicket> {
    await this.requests.draft(businessId, actor, id);
    const { contentType, sizeBytes } = body;
    // 100 MB a file (the contract) and 100 MB for the request's files together (Rasel, Oct 22):
    // refused before the upload starts; addDocument checks again when the file is added.
    await this.fits(businessId, id, sizeBytes);
    const documentId = randomUUID();
    const key = this.store.keyFor(businessId, id, `source/${documentId}`);
    const presigned = await this.store.presignUpload(businessId, key, {
      contentType,
      sizeBytes,
      sha256: body.sha256,
    });
    const uploadToken = esignUploadToken(presigned);
    await this.repo.saveUpload(businessId, {
      tokenHash: sha256(uploadToken),
      requestId: id,
      userId: actor.userId,
      documentId,
      key,
      fileName: body.fileName,
      contentType,
      sizeBytes,
      sha256: body.sha256,
      createdAt: new Date(),
    });
    await this.audit.log('esign.upload_started', entity(id), {
      documentId,
      multipart: presigned.method === 'MULTIPART',
    });
    return uploadTicket(uploadToken, presigned);
  }

  /**
   * Step 3: a multipart upload is completed (parts missing or of another size: 409
   * UPLOAD_MISMATCH; storage no longer has it: 410); the stored object must have the described
   * size, type and SHA-256 (409 UPLOAD_MISMATCH); a token that is used, older than 15 minutes (70
   * for a multipart upload), or another firm's, request's or person's is 410 UPLOAD_EXPIRED. The
   * file starts PENDING (the malware scan). Without room in the read budget: 503, and the upload
   * is kept for the retry.
   */
  async confirmUpload(
    businessId: string,
    actor: EsignActor,
    id: string,
    uploadToken: string,
  ): Promise<EsignDocument> {
    await this.requests.draft(businessId, actor, id);
    const upload = await this.repo.takeUpload(businessId, id, actor.userId, sha256(uploadToken));
    if (!upload) throw expired();
    const uploadId = multipartIdIn(uploadToken);
    const release = readBudget.tryTake(budgetFor(upload));
    if (!release) {
      // Busy: the upload goes back, so the browser's retry with the same token finds it.
      await this.repo.saveUpload(businessId, upload);
      throw filesBusy();
    }
    try {
      return await this.removingOnRefusal(businessId, upload.key, uploadId, () =>
        this.checkAndAdd(businessId, actor, id, upload, uploadToken, uploadId),
      );
    } finally {
      release();
    }
  }

  /** Confirm's work once the read budget is held: complete, check, add. */
  private async checkAndAdd(
    businessId: string,
    actor: EsignActor,
    id: string,
    upload: EsignPendingUpload,
    uploadToken: string,
    uploadId: string | null,
  ): Promise<EsignDocument> {
    if (uploadTooOld(uploadToken, upload.createdAt)) throw expired();
    if (uploadId) {
      const { key, sizeBytes } = upload;
      const done = await this.store.completeUpload(businessId, key, uploadId, sizeBytes);
      if (done === 'MISSING') throw expired();
      if (done === 'MISMATCH') throw esignRefusal('UPLOAD_MISMATCH');
    }
    const head = await this.store.head(businessId, upload.key);
    const same =
      head?.sizeBytes === upload.sizeBytes &&
      head.contentType === upload.contentType &&
      head.contentEncoding === null;
    const bytes = same ? await this.store.read(businessId, upload.key) : null;
    if (bytes?.byteLength !== upload.sizeBytes || sha256(bytes) !== upload.sha256) {
      throw esignRefusal('UPLOAD_MISMATCH');
    }
    const { documentId, fileName, contentType, sizeBytes } = upload;
    return this.add(businessId, actor, id, bytes, {
      id: documentId,
      fileName,
      contentType,
      sizeBytes,
      sourceDocumentId: null,
      scanStatus: 'PENDING',
      s3Key: upload.key,
      sha256: upload.sha256,
    });
  }

  /**
   * Copies one of the request's client's documents, when the caller reaches that client (404
   * otherwise, another client's document included): a CLEAN PDF, JPG or PNG.
   */
  async addFromVault(
    businessId: string,
    actor: EsignActor,
    id: string,
    sourceId: string,
  ): Promise<EsignDocument> {
    const record = await this.requests.draft(businessId, actor, id);
    if (!record.clientId) throw notFound();
    await this.requests.reachableClient(businessId, actor, record.clientId);
    const source = await this.directory.document(businessId, sourceId);
    if (!source || source.clientId !== record.clientId) throw notFound();
    const { contentType } = source;
    if (!isEsignType(contentType)) throw esignRefusal('FILE_TYPE_NOT_ALLOWED');
    if (source.scanStatus === 'PENDING') throw esignRefusal('SCAN_PENDING');
    if (source.scanStatus !== 'CLEAN') throw esignRefusal('FILE_BLOCKED');
    // Before reading it: the request's files together stay within 100 MB.
    await this.fits(businessId, id, source.sizeBytes);
    const documentId = randomUUID();
    const key = this.store.keyFor(businessId, id, `source/${documentId}`);
    return readBudget.hold(budgetFor(source), filesBusy, async () => {
      const copied = await this.copySource(businessId, source, key);
      return this.removingOnRefusal(businessId, key, null, async () => {
        const bytes = copied ?? (await this.store.read(businessId, key));
        // The copy must be the file that was scanned.
        if (!bytes || sha256(bytes) !== source.sha256) throw esignRefusal('FILE_BLOCKED');
        return this.add(businessId, actor, id, bytes, {
          id: documentId,
          fileName: source.fileName,
          contentType,
          sizeBytes: bytes.byteLength,
          sourceDocumentId: source.id,
          scanStatus: 'CLEAN',
          s3Key: key,
          sha256: source.sha256,
        });
      });
    });
  }

  /**
   * Copies a vault file into the request's folder. R5's uploads sit under documents/, and Firm
   * Sign's own filed PDFs (final and certificate) under esign/, which EsignStore reads itself.
   * Begin Online uploads carried over at conversion (leads/) EsignStore cannot copy yet (R18):
   * 409 FILE_BLOCKED, never a 500. A vault row whose object is gone answers 404. Gives the
   * bytes when it read them (esign/), so the caller checks those instead of reading the copy.
   */
  private async copySource(
    businessId: string,
    source: DirectoryDocument,
    key: string,
  ): Promise<Uint8Array | null> {
    const { s3Key } = source;
    const under = (area: string) => s3Key.startsWith(`tenant/${businessId}/${area}/`);
    const gone = () => {
      this.logger.warn(`Esign from-vault: document ${source.id} has no stored file`); // ids only
      return notFound();
    };
    try {
      if (under('documents')) {
        await this.store.copyFromVault(businessId, s3Key, key);
        return null;
      }
      if (under('esign')) {
        const bytes = await this.store.read(businessId, s3Key);
        if (!bytes) throw gone();
        // The file must be the one that was scanned; nothing is copied otherwise.
        if (sha256(bytes) !== source.sha256) throw esignRefusal('FILE_BLOCKED');
        await this.store.put(businessId, key, bytes, source.contentType);
        return bytes;
      }
    } catch (error) {
      if (!isNoSuchKey(error)) throw error;
      throw gone();
    }
    this.logger.warn(`Esign from-vault: document ${source.id} is in a folder it can't copy from`);
    throw esignRefusal('FILE_BLOCKED');
  }

  /** Removes the file, its pages and the fields on them, then the stored object. */
  async removeDocument(
    businessId: string,
    actor: EsignActor,
    id: string,
    documentId: string,
  ): Promise<EsignRequestDetail> {
    const record = await this.requests.draft(businessId, actor, id);
    const parts = await this.repo.parts(businessId, id);
    const doc = parts.documents.find((d) => d.id === documentId);
    if (!doc) throw notFound();
    const at = new Map<number, number>();
    const pagePlan = parts.pagePlan.filter((p, i) => {
      if (p.documentId === documentId) return false;
      at.set(i, at.size);
      return true;
    });
    const fields = parts.fields.flatMap((f): EsignField[] => {
      const pageIndex = at.get(f.pageIndex);
      return pageIndex === undefined ? [] : [{ ...f, pageIndex }];
    });
    const { lastActivityAt } = record;
    const saved = savedOrRefused(
      await this.repo.removeDocument(businessId, id, documentId, pagePlan, fields, lastActivityAt),
    );
    // The file is off the draft once removeDocument commits: a failed audit write must not answer
    // 500 and leave the stored file behind (a retry is 404), so it is logged and the file removed.
    await this.auditOrLog(id, 'esign.document_removed', {
      documentId,
      pagesRemoved: parts.pagePlan.length - pagePlan.length,
      fieldsRemoved: parts.fields.length - fields.length,
    });
    await this.removeObject(businessId, doc.id, doc.s3Key);
    return this.requests.answer(businessId, saved);
  }

  /**
   * A CLEAN file's bytes, in any status (409 SCAN_PENDING, FILE_BLOCKED), holding them of the read
   * budget (503 without room). With `keep` (the route that streams them), the hold lasts until it
   * is given back there.
   */
  async content(
    businessId: string,
    actor: EsignActor,
    id: string,
    documentId: string,
    keep?: Keep,
  ): Promise<EsignContent> {
    const reached = await this.requests.reach(businessId, actor, id, 'read');
    const { documents } = reached.parts ?? (await this.repo.parts(businessId, id));
    const doc = documents.find((d) => d.id === documentId);
    if (!doc) throw notFound();
    if (doc.scanStatus === 'PENDING') throw esignRefusal('SCAN_PENDING');
    if (doc.scanStatus !== 'CLEAN') throw esignRefusal('FILE_BLOCKED');
    const read = async (): Promise<EsignContent> => {
      const bytes = await this.store.read(businessId, doc.s3Key);
      if (!bytes || sha256(bytes) !== doc.sha256) {
        this.logger.warn(`Esign document ${doc.id}: the stored file is not the checked one`);
        throw esignRefusal('FILE_BLOCKED');
      }
      await this.audit.log('esign.document_read', entity(id), { documentId });
      return { bytes, contentType: doc.contentType };
    };
    return readBudget.hold(doc.sizeBytes, filesBusy, read, keep);
  }

  /** Reads pages and sizes (409 PDF_ENCRYPTED, PDF_UNREADABLE) and adds the file to the draft. */
  private async add(
    businessId: string,
    actor: EsignActor,
    id: string,
    bytes: Uint8Array,
    file: Omit<NewEsignDocument, 'pageCount' | 'pageSizes' | 'createdAt'>,
  ): Promise<EsignDocument> {
    const { pageCount, pageSizes } = await this.pdf
      .inspect({ contentType: file.contentType, bytes })
      .catch((error: unknown) => {
        throw error instanceof EsignEngineError ? esignRefusal(error.code) : error;
      });
    const added = await this.repo.addDocument(businessId, id, {
      ...file,
      pageCount,
      pageSizes,
      createdAt: new Date(),
    });
    if (added === 'NOT_DRAFT') throw esignRefusal('INVALID_STATE');
    if (added === 'TOO_MANY_PAGES') throw esignRefusal('TOO_MANY_PAGES');
    if (added === 'REQUEST_TOO_LARGE') throw esignRefusal('REQUEST_TOO_LARGE');
    // The file is on the draft once addDocument commits; a retry would be 410 UPLOAD_EXPIRED.
    await this.auditOrLog(id, 'esign.document_added', {
      documentId: added.id,
      sourceDocumentId: added.sourceDocumentId,
      pageCount,
    });
    return toDocument(added);
  }

  /** 409 REQUEST_TOO_LARGE when one more file of `sizeBytes` would pass the request's 100 MB. */
  private async fits(businessId: string, id: string, sizeBytes: number): Promise<void> {
    if ((await this.repo.documentBytes(businessId, id)) + sizeBytes > ESIGN_MAX_REQUEST_BYTES) {
      throw esignRefusal('REQUEST_TOO_LARGE');
    }
  }

  /** An audit entry after a write that has committed: a failure is logged (ids only), not thrown. */
  private async auditOrLog(id: string, action: string, metadata: Record<string, unknown>) {
    try {
      await this.audit.log(action, entity(id), metadata);
    } catch (error) {
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.error(`Could not audit ${action} on esign request ${id}: ${name}`);
    }
  }

  /** Runs `work`; a refusal (4xx) drops the multipart upload and deletes the stored object. */
  private async removingOnRefusal<T>(
    businessId: string,
    key: string,
    uploadId: string | null,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        const documentId = key.slice(key.lastIndexOf('/') + 1);
        if (uploadId) {
          await this.store.abortUpload(businessId, key, uploadId).catch((e: unknown) => {
            const name = e instanceof Error ? e.name : typeof e;
            this.logger.warn(`Could not drop esign upload ${documentId}: ${name}`); // ids only
          });
        }
        await this.removeObject(businessId, documentId, key);
      }
      throw error;
    }
  }

  private async removeObject(businessId: string, documentId: string, key: string): Promise<void> {
    try {
      await this.store.remove(businessId, key);
    } catch (error) {
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.warn(`Could not delete esign document ${documentId}: ${name}`); // ids only
    }
  }
}
