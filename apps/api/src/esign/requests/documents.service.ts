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
  type EsignDocument,
  type EsignField,
  type EsignRequestDetail,
  type UploadTicket,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { PUT_URL_SECONDS } from '../../storage/document-storage.js';
import { UPLOAD_TOKEN_SECONDS } from '../../storage/upload-token.js';
import {
  ESIGN_STORE,
  EsignEngineError,
  type EsignStore,
  PDF_ENGINE,
  type PdfEngine,
} from '../engine/engine.types.js';
import {
  ESIGN_REPOSITORY,
  type EsignRepository,
  type NewEsignDocument,
} from './esign.repository.js';
import { type EsignActor, esignRefusal, EsignRequestsService } from './requests.service.js';

type Store = Pick<EsignStore, 'keyFor' | 'presignUpload' | 'head' | 'read' | 'remove'>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: ESIGN_ERRORS.UPLOAD_EXPIRED });
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const entity = (id: string) => ({ type: 'esign_request', id });

/**
 * A DRAFT's files (R13 step 6, part 1d): uploads in three steps as in Documents, and removal
 * (from-vault and the page viewer's bytes come in part 1e). Every change needs the requests
 * service's write access (an approver who may only read gets 404, like anyone else who may not
 * change the request). Files sit under tenant/<businessId>/esign/<requestId>/
 * (EsignStore checks every key). The audit log and the log get ids only.
 */
@Injectable()
export class EsignDocumentsService {
  private readonly logger = new Logger(EsignDocumentsService.name);

  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
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
    const write = this.repo.removeDocument(
      businessId,
      id,
      documentId,
      pagePlan,
      fields,
      lastActivityAt,
    );
    await this.requests.drafted(write);
    await this.audit.log('esign.document_removed', entity(id), {
      documentId,
      pagesRemoved: parts.pagePlan.length - pagePlan.length,
      fieldsRemoved: parts.fields.length - fields.length,
    });
    await this.removeObject(businessId, doc.id, doc.s3Key);
    return this.requests.current(businessId, id);
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
    const { documents } = await this.requests.current(businessId, id);
    return documents.find((d) => d.id === added.id)!;
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
