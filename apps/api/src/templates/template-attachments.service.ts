import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  fileNameFitsType,
  type DownloadLink,
  type StartTemplateAttachmentRequest,
  type TemplateAttachment,
  type UploadContentType,
  type UploadTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  GET_URL_SECONDS,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import { checkFile } from '../storage/file-checks.js';
import { notFound } from '../workspaces/common.js';
import { canEdit, templateErrors, visibleTo } from './templates.common.js';

/** HKDF label for template attachment tokens: a token opens only here. */
export const TEMPLATE_UPLOAD_LABEL = 'fv-template-upload-v1';
/** As documents: the confirm comes within 15 minutes of the ticket. */
export const TEMPLATE_UPLOAD_SECONDS = 900;
/** At most this many files on one template. */
export const MAX_ATTACHMENTS = 10;
/** At most this many confirms read stored bytes at once; one more is 503 (as documents). */
export const TEMPLATE_CHECKS_AT_ONCE = 4;
let checking = 0;

const Claim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  templateId: z.uuid(),
  /** tenant/{businessId}/templates/{uuid}, chosen by the API. */
  key: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type Claim = z.infer<typeof Claim>;

export class TemplateUploadTokens extends Sealer<Claim> {
  constructor(secrets: PoolSecrets) {
    super(TEMPLATE_UPLOAD_LABEL, Claim as never, secrets);
  }
}

const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: 'This upload has expired' });
const refused = (code: string) =>
  new ConflictException({ code, message: 'The file can’t be used' });
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

const toAttachment = (a: {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}): TemplateAttachment => ({
  id: a.id,
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  createdAt: a.createdAt.toISOString(),
});

/**
 * Files attached to a template (a guide, a form to send with a message): the documents' three-step
 * upload under tenant/{businessId}/templates/. Confirm checks the stored bytes (size, SHA-256 and
 * that the file is what its type says; Office files with a password or macros are refused) and
 * deletes a refused upload. Only ids go to the audit log, never a file name.
 */
@Injectable()
export class TemplateAttachmentsService {
  private readonly logger = new Logger(TemplateAttachmentsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly tokens: TemplateUploadTokens,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** A template the actor may change, not archived, with room for another file. */
  private async editable(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const t = await tx.messageTemplate.findFirst({
      where: { businessId, id, ...visibleTo(actor) },
      select: { id: true, status: true, ownerUserId: true, access: true },
    });
    if (!t) throw notFound();
    if (!canEdit(t, actor)) throw templateErrors.notTheOwner();
    if (t.status === 'ARCHIVED') throw templateErrors.archived();
    return t;
  }

  async ticket(
    businessId: string,
    actor: ClientsActor,
    templateId: string,
    body: StartTemplateAttachmentRequest,
  ): Promise<UploadTicket> {
    if (!fileNameFitsType(body.fileName, body.contentType as UploadContentType)) {
      throw templateErrors.invalid('fileName', 'The file name does not fit its type');
    }
    await this.inFirm(businessId, async (tx) => {
      await this.editable(tx, businessId, actor, templateId);
      const n = await tx.messageTemplateAttachment.count({ where: { businessId, templateId } });
      if (n >= MAX_ATTACHMENTS) {
        throw templateErrors.invalid(
          'fileName',
          `A template holds at most ${MAX_ATTACHMENTS} files`,
        );
      }
    });
    const key = `tenant/${businessId}/templates/${randomUUID()}`;
    const put = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const uploadToken = await this.tokens.seal(
      { pool: 'STAFF', businessId, userId: actor.userId, templateId, key, ...body },
      TEMPLATE_UPLOAD_SECONDS,
    );
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  async confirm(
    businessId: string,
    actor: ClientsActor,
    uploadToken: string,
  ): Promise<TemplateAttachment> {
    const claim = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== actor.userId) throw expired();
    const known = await this.inFirm(businessId, async (tx) => {
      await this.editable(tx, businessId, actor, claim.templateId);
      return tx.messageTemplateAttachment.findUnique({
        where: { s3Key: claim.key },
        select: { id: true },
      });
    });
    if (known) throw expired();

    const why = await this.checkStored(claim);
    if (why) {
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete a refused template upload in firm ${businessId}`);
      });
      await this.audit.log(
        'template_attachment.upload_refused',
        { type: 'business', id: businessId },
        {
          templateId: claim.templateId,
          code: why,
        },
      );
      throw refused(why);
    }
    let row;
    try {
      row = await this.inFirm(businessId, async (tx) => {
        const created = await tx.messageTemplateAttachment.create({
          data: {
            businessId,
            templateId: claim.templateId,
            fileName: claim.fileName,
            contentType: claim.contentType,
            sizeBytes: claim.sizeBytes,
            s3Key: claim.key,
          },
        });
        await this.audit.logIn(
          tx,
          'template_attachment.added',
          {
            type: 'message_template_attachment',
            id: created.id,
          },
          { templateId: claim.templateId },
        );
        return created;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw expired();
      throw error;
    }
    return toAttachment(row);
  }

  async download(
    businessId: string,
    actor: ClientsActor,
    templateId: string,
    attachmentId: string,
  ): Promise<DownloadLink> {
    const file = await this.inFirm(businessId, async (tx) => {
      const t = await tx.messageTemplate.findFirst({
        where: { businessId, id: templateId, ...visibleTo(actor) },
        select: { id: true },
      });
      if (!t) throw notFound();
      const a = await tx.messageTemplateAttachment.findFirst({
        where: { businessId, templateId, id: attachmentId },
      });
      if (!a) throw notFound();
      return a;
    });
    const stored = await this.s3(() => this.storage.head(file.s3Key));
    if (stored?.sizeBytes !== file.sizeBytes || stored.contentEncoding !== null) {
      this.logger.warn(`Template attachment ${file.id}: the stored file is not the confirmed one`);
      throw refused('FILE_BLOCKED');
    }
    const url = await this.s3(() =>
      this.storage.presignDownload({
        key: file.s3Key,
        fileName: file.fileName,
        contentType: file.contentType,
      }),
    );
    await this.audit.log('template_attachment.download_link_issued', {
      type: 'message_template_attachment',
      id: file.id,
    });
    return { url, expiresAt: new Date(Date.now() + GET_URL_SECONDS * 1000).toISOString() };
  }

  async remove(
    businessId: string,
    actor: ClientsActor,
    templateId: string,
    attachmentId: string,
  ): Promise<void> {
    const key = await this.inFirm(businessId, async (tx) => {
      await this.editable(tx, businessId, actor, templateId);
      const a = await tx.messageTemplateAttachment.findFirst({
        where: { businessId, templateId, id: attachmentId },
      });
      if (!a) throw notFound();
      await tx.messageTemplateAttachment.delete({ where: { id: a.id } });
      await this.audit.logIn(
        tx,
        'template_attachment.removed',
        { type: 'message_template_attachment', id: a.id },
        { templateId },
      );
      return a.s3Key;
    });
    await this.storage.remove(key).catch(() => {
      this.logger.warn(`Could not delete a removed template attachment in firm ${businessId}`);
    });
  }

  /** At most TEMPLATE_CHECKS_AT_ONCE at a time; one more is 503 (nothing deleted). */
  private async checkStored(claim: Claim): Promise<string | null> {
    if (checking >= TEMPLATE_CHECKS_AT_ONCE) throw unavailable();
    checking += 1;
    try {
      const head = await this.s3(() => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null) {
        return 'UPLOAD_MISMATCH';
      }
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256) {
        return 'UPLOAD_MISMATCH';
      }
      return checkFile(claim.contentType as UploadContentType, bytes);
    } finally {
      checking -= 1;
    }
  }

  /** A storage call; any failure is 503 with Retry-After (nothing deleted). */
  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Template attachment storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
