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
  type DownloadLink,
  ESIGN_ERRORS,
  type SignerAttachmentUploadBody,
  type SignerCopy,
  type SignerCopyFile,
  type SignerField,
  type UploadTicket,
} from '@firmivra/types';
import { GET_URL_SECONDS, PUT_URL_SECONDS } from '../../storage/document-storage.js';
import { UPLOAD_TOKEN_SECONDS } from '../../storage/upload-token.js';
import { COMPLETION_REPOSITORY } from '../completion/completion.repository.js';
import type { EsignCompletionRepository } from '../completion/completion.repository.js';
import { ESIGN_STORE, type EsignStore } from '../engine/engine.types.js';
import { ESIGN_REPOSITORY, type EsignRepository } from '../requests/esign.repository.js';
import { esignRefusal, invalid } from '../requests/requests.service.js';
import { SIGNER_REPOSITORY } from './signer.repository.js';
import type { EsignSignerRepository, SignerAttachment } from './signer.repository.js';
import { type SignerCall, EsignSignerService } from './signer.service.js';

type Store = Pick<
  EsignStore,
  'keyFor' | 'presignUpload' | 'head' | 'read' | 'remove' | 'presignDownload'
>;

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: ESIGN_ERRORS.UPLOAD_EXPIRED });
/** The first bytes each allowed type starts with: a file must be what it says it is. */
const MAGIC: Record<SignerAttachment['contentType'], number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

/**
 * The signer's files (R13 signer slice 3): attachments for their own ATTACHMENT fields while
 * they sign (presigned PUT, confirm with the size, type, SHA-256 and first bytes checked; replace
 * and remove until they finish), and the completed copy's final PDF and certificate for a copy
 * link. Files sit under the request's attachments/ folder (EsignStore checks every key) and stay
 * PENDING until the malware scan. The audit log gets ids only, never a file name or content.
 */
@Injectable()
export class EsignSignerFilesService {
  private readonly logger = new Logger(EsignSignerFilesService.name);

  constructor(
    @Inject(EsignSignerService)
    private readonly signer: Pick<EsignSignerService, 'myFields' | 'log'>,
    @Inject(SIGNER_REPOSITORY) private readonly repo: EsignSignerRepository,
    @Inject(ESIGN_REPOSITORY) private readonly requests: Pick<EsignRepository, 'parts'>,
    @Inject(COMPLETION_REPOSITORY)
    private readonly completed: Pick<EsignCompletionRepository, 'files'>,
    @Inject(ESIGN_STORE) private readonly store: Store,
  ) {}

  /** POST attachments/uploads: a presigned PUT for exactly this file and a one-time token. */
  async createUpload(
    c: SignerCall,
    body: z.output<typeof SignerAttachmentUploadBody>,
  ): Promise<UploadTicket> {
    const { request: q, recipient: me } = c.signer;
    await this.field(c, body.fieldId, () => invalid('fieldId', 'Not your attachment field'));
    const { fieldId, fileName, contentType, sizeBytes } = body;
    const key = this.store.keyFor(c.firm.id, q.id, `attachments/${randomUUID()}`);
    const put = await this.store.presignUpload(c.firm.id, key, {
      ...{ contentType, sizeBytes, sha256: body.sha256 },
    });
    const uploadToken = randomBytes(32).toString('base64url');
    await this.repo.saveAttachmentUpload(c.firm.id, {
      ...{ tokenHash: sha256(uploadToken), requestId: q.id, recipientId: me.id, fieldId, key },
      ...{ fileName, contentType, sizeBytes, sha256: body.sha256, createdAt: new Date() },
    });
    await this.signer.log(c, 'esign.signer_attachment_started', { fieldId });
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  /**
   * POST attachments/uploads/confirm: the stored object must be the described file (409
   * UPLOAD_MISMATCH); a token that is used, older than 15 minutes, for another field or another
   * signer's is 410 UPLOAD_EXPIRED. Replaces the field's earlier file.
   */
  async confirmUpload(c: SignerCall, fieldId: string, uploadToken: string): Promise<SignerField> {
    const { request: q, recipient: me } = c.signer;
    await this.field(c, fieldId, () => invalid('fieldId', 'Not your attachment field'));
    const tokenHash = sha256(uploadToken);
    const upload = await this.repo.takeAttachmentUpload(c.firm.id, q.id, me.id, tokenHash);
    if (!upload) throw expired();
    const before = (await this.repo.attachments(c.firm.id, q.id, me.id)).find(
      (a) => a.fieldId === fieldId,
    );
    try {
      const old = Date.now() - upload.createdAt.getTime() > UPLOAD_TOKEN_SECONDS * 1000;
      if (old || upload.fieldId !== fieldId) throw expired();
      const head = await this.store.head(c.firm.id, upload.key);
      const same =
        head?.sizeBytes === upload.sizeBytes &&
        head.contentType === upload.contentType &&
        head.contentEncoding === null;
      const bytes = same ? await this.store.read(c.firm.id, upload.key) : null;
      const magic = MAGIC[upload.contentType];
      if (
        bytes?.byteLength !== upload.sizeBytes ||
        sha256(bytes) !== upload.sha256 ||
        magic.some((b, i) => bytes[i] !== b)
      ) {
        throw esignRefusal('UPLOAD_MISMATCH');
      }
      const { tokenHash: _t, requestId: _q, recipientId: _r, ...file } = upload;
      const attachment: SignerAttachment = { ...file, scanStatus: 'PENDING' };
      if (!(await this.repo.setAttachment(c.firm.id, q.id, me.id, fieldId, attachment))) {
        throw esignRefusal('REQUEST_CLOSED');
      }
    } catch (error) {
      // A refusal: the object goes (the token is used up either way).
      if (error instanceof HttpException && error.getStatus() < 500) {
        await this.removeObject(c.firm.id, upload.key);
      }
      throw error;
    }
    if (before) await this.removeObject(c.firm.id, before.key);
    await this.signer.log(c, 'esign.signer_attachment_added', { fieldId });
    return this.field(c, fieldId, notFound);
  }

  /** DELETE attachments/{fieldId}: removes their file from that field before they finish. */
  async remove(c: SignerCall, fieldId: string): Promise<SignerField> {
    const { request: q, recipient: me } = c.signer;
    const field = await this.field(c, fieldId, notFound);
    const attached = await this.repo.attachments(c.firm.id, q.id, me.id);
    const file = attached.find((a) => a.fieldId === field.id);
    if (!file) throw notFound();
    if (!(await this.repo.setAttachment(c.firm.id, q.id, me.id, fieldId, null))) {
      throw esignRefusal('REQUEST_CLOSED');
    }
    await this.removeObject(c.firm.id, file.key);
    await this.signer.log(c, 'esign.signer_attachment_removed', { fieldId });
    return { ...field, attachmentName: null };
  }

  /** GET copy (step COPY): the completed request's two files. */
  async copy(c: SignerCall): Promise<SignerCopy> {
    const { request: q } = c.signer;
    const files = await this.files(c);
    await this.signer.log(c, 'esign.signer_copy_viewed');
    return {
      title: q.title,
      completedAt: (q.completedAt ?? new Date()).toISOString(),
      files: [
        { file: 'final', fileName: files.final.fileName },
        { file: 'certificate', fileName: files.certificate.fileName },
      ],
    };
  }

  /** GET copy/download: a 5-minute link that saves the file as an attachment. */
  async download(c: SignerCall, file: SignerCopyFile): Promise<DownloadLink> {
    const { key, fileName } = (await this.files(c))[file];
    const contentType = 'application/pdf';
    const url = await this.store.presignDownload(c.firm.id, { key, fileName, contentType });
    await this.signer.log(c, 'esign.signer_copy_downloaded', { file });
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }

  private async files(c: SignerCall) {
    const files = await this.completed.files(c.firm.id, c.signer.request.id);
    if (!files) throw esignRefusal('INVALID_STATE');
    return files;
  }

  /** One of the signer's own ATTACHMENT fields, with its file's name; else `refuse()`. */
  private async field(c: SignerCall, fieldId: string, refuse: () => Error): Promise<SignerField> {
    const { request: q, recipient: me } = c.signer;
    const [parts, attached] = await Promise.all([
      this.requests.parts(c.firm.id, q.id),
      this.repo.attachments(c.firm.id, q.id, me.id),
    ]);
    const mine = this.signer.myFields(parts, me, attached);
    const field = mine.find((f) => f.id === fieldId && f.type === 'ATTACHMENT');
    if (!field) throw refuse();
    return field;
  }

  private async removeObject(businessId: string, key: string): Promise<void> {
    try {
      await this.store.remove(businessId, key);
    } catch (error) {
      const name = error instanceof Error ? error.name : typeof error;
      const id = key.slice(key.lastIndexOf('/') + 1);
      this.logger.warn(`Could not delete esign attachment ${id}: ${name}`); // ids only
    }
  }
}
