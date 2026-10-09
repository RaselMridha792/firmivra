import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
  ESIGN_UPLOAD_TYPES,
  type EsignContentType,
  type EsignDocument,
  type EsignField,
  type EsignRequestDetail,
  type UploadTicket,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { PUT_URL_SECONDS, statusOf } from '../../storage/document-storage.js';
import { UPLOAD_TOKEN_SECONDS } from '../../storage/upload-token.js';
import {
  ESIGN_STORE,
  EsignEngineError,
  type EsignStore,
  PDF_ENGINE,
  type PdfEngine,
} from '../engine/engine.types.js';
import { type DirectoryDocument, ESIGN_DIRECTORY, type EsignDirectory } from './esign-directory.js';
import {
  ESIGN_REPOSITORY,
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
  'keyFor' | 'presignUpload' | 'head' | 'read' | 'put' | 'copyFromVault' | 'remove'
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
  (error.name === 'NoSuchKey' || error.message === 'NoSuchKey' || statusOf(error) === 404);

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
 * (EsignStore checks every key). The audit log and the log get ids only.
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

  /** Step 1: a presigned PUT for exactly the described file, and a single-use upload token. */
  async createUpload(
    businessId: string,
    actor: EsignActor,
    id: string,
    body: z.output<typeof CreateEsignUploadBody>,
  ): Promise<UploadTicket> {
    await this.requests.draft(businessId, actor, id);
    const documentId = randomUUID();
    const key = this.store.keyFor(businessId, id, `source/${documentId}`);
    const { contentType, sizeBytes } = body;
    const put = await this.store.presignUpload(businessId, key, {
      contentType,
      sizeBytes,
      sha256: body.sha256,
    });
    const uploadToken = randomBytes(32).toString('base64url');
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
    await this.audit.log('esign.upload_started', entity(id), { documentId });
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  /**
   * Step 3: the stored object must have the described size, type and SHA-256 (409
   * UPLOAD_MISMATCH); a token that is used, older than 15 minutes, or another firm's, request's
   * or person's is 410 UPLOAD_EXPIRED. The file starts PENDING (the malware scan).
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
    return this.removingOnRefusal(businessId, upload.key, async () => {
      if (Date.now() - upload.createdAt.getTime() > UPLOAD_TOKEN_SECONDS * 1000) throw expired();
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
    const documentId = randomUUID();
    const key = this.store.keyFor(businessId, id, `source/${documentId}`);
    await this.copySource(businessId, source, key);
    return this.removingOnRefusal(businessId, key, async () => {
      const bytes = await this.store.read(businessId, key);
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
  }

  /**
   * Copies a vault file into the request's folder. R5's uploads sit under documents/, and Firm
   * Sign's own filed PDFs (final and certificate) under esign/, which EsignStore reads itself.
   * Begin Online uploads carried over at conversion (leads/) EsignStore cannot copy yet (R18):
   * 409 FILE_BLOCKED, never a 500. A vault row whose object is gone answers 404.
   */
  private async copySource(businessId: string, source: DirectoryDocument, key: string) {
    const { s3Key } = source;
    const under = (area: string) => s3Key.startsWith(`tenant/${businessId}/${area}/`);
    try {
      if (under('documents')) return await this.store.copyFromVault(businessId, s3Key, key);
      if (under('esign')) {
        const bytes = await this.store.read(businessId, s3Key);
        if (!bytes) throw notFound();
        return await this.store.put(businessId, key, bytes, source.contentType);
      }
    } catch (error) {
      if (!isNoSuchKey(error)) throw error;
      this.logger.warn(`Esign from-vault: document ${source.id} has no stored file`); // ids only
      throw notFound();
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
    await this.audit.log('esign.document_removed', entity(id), {
      documentId,
      pagesRemoved: parts.pagePlan.length - pagePlan.length,
      fieldsRemoved: parts.fields.length - fields.length,
    });
    await this.removeObject(businessId, doc.id, doc.s3Key);
    return this.requests.answer(businessId, saved);
  }

  /** A CLEAN file's bytes, in any status (409 SCAN_PENDING, FILE_BLOCKED). */
  async content(
    businessId: string,
    actor: EsignActor,
    id: string,
    documentId: string,
  ): Promise<EsignContent> {
    const reached = await this.requests.reach(businessId, actor, id, 'read');
    const { documents } = reached.parts ?? (await this.repo.parts(businessId, id));
    const doc = documents.find((d) => d.id === documentId);
    if (!doc) throw notFound();
    if (doc.scanStatus === 'PENDING') throw esignRefusal('SCAN_PENDING');
    if (doc.scanStatus !== 'CLEAN') throw esignRefusal('FILE_BLOCKED');
    const bytes = await this.store.read(businessId, doc.s3Key);
    if (!bytes || sha256(bytes) !== doc.sha256) {
      this.logger.warn(`Esign document ${doc.id}: the stored file is not the checked one`);
      throw esignRefusal('FILE_BLOCKED');
    }
    await this.audit.log('esign.document_read', entity(id), { documentId });
    return { bytes, contentType: doc.contentType };
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
    await this.audit.log('esign.document_added', entity(id), {
      documentId: added.id,
      sourceDocumentId: added.sourceDocumentId,
      pageCount,
    });
    return toDocument(added);
  }

  /** Runs `work`; a refusal (4xx) deletes the stored object first. */
  private async removingOnRefusal<T>(
    businessId: string,
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() < 500) {
        await this.removeObject(businessId, key.slice(key.lastIndexOf('/') + 1), key);
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
