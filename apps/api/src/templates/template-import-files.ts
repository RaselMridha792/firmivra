import { createHash, randomUUID } from 'node:crypto';
import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { StartTemplateImportRequest, UploadTicket } from '@firmivra/types';
import mammoth from 'mammoth';
import { z } from 'zod';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import type { ClientsActor } from '../clients/clients.service.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  onlyPut,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import { TEMPLATE_UPLOAD_SECONDS } from './template-attachments.service.js';
import { templateErrors } from './templates.common.js';

// TP-F16 (the lead's Nov 7 answer): a Word document imported as a template's content. Up to the
// module's existing 10 MB, it is uploaded in the usual three steps under the firm's own prefix,
// read once on import, converted to HTML (mammoth: no network, embedded images dropped), and then
// deleted: the DOCX itself is never kept. The HTML goes through the template sanitizer after.

/** HKDF label for DOCX import tokens: a token opens only here. */
export const TEMPLATE_IMPORT_LABEL = 'fv-template-import-v1';

const Claim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  /** tenant/{businessId}/template-imports/{uuid}, chosen by the API. */
  key: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type Claim = z.infer<typeof Claim>;

export class TemplateImportTokens extends Sealer<Claim> {
  constructor(secrets: PoolSecrets) {
    super(TEMPLATE_IMPORT_LABEL, Claim as never, secrets);
  }
}

const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: 'This upload has expired' });
const mismatch = () =>
  new ConflictException({
    code: 'UPLOAD_MISMATCH',
    message: 'The file does not match what was uploaded. Try again.',
  });
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });
/** A .docx is a zip: it starts "PK\x03\x04". */
const ZIP = [0x50, 0x4b, 0x03, 0x04];

@Injectable()
export class TemplateImportFilesService {
  private readonly logger = new Logger(TemplateImportFilesService.name);

  constructor(
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly tokens: TemplateImportTokens,
  ) {}

  /** Step 1: where the browser PUTs the Word document (one PUT: at most 10 MB). */
  async ticket(
    businessId: string,
    actor: ClientsActor,
    body: StartTemplateImportRequest,
  ): Promise<UploadTicket> {
    if (!/\.docx$/i.test(body.fileName)) {
      throw templateErrors.invalid('fileName', 'Choose a Word document (.docx)');
    }
    const key = `tenant/${businessId}/template-imports/${randomUUID()}`;
    const presigned = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    const put = onlyPut(presigned);
    const uploadToken = await this.tokens.seal(
      {
        pool: 'STAFF',
        businessId,
        userId: actor.userId,
        key,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      },
      TEMPLATE_UPLOAD_SECONDS,
    );
    const expiresAt = new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString();
    return { uploadToken, url: put.url, method: 'PUT', headers: put.headers, expiresAt };
  }

  /**
   * The uploaded Word document as HTML, images dropped, and the file deleted whatever happens.
   * 410 for an old or another member's ticket; 409 for other bytes; 400 for a file Word can't open.
   */
  async html(businessId: string, actor: ClientsActor, uploadToken: string): Promise<string> {
    const claim = (await this.tokens.open(uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== actor.userId) throw expired();
    try {
      const head = await this.s3(() => this.storage.head(claim.key));
      const bytes = head ? await this.s3(() => this.storage.read(claim.key)) : null;
      if (!bytes) throw expired();
      const fine =
        bytes.byteLength === claim.sizeBytes &&
        createHash('sha256').update(bytes).digest('hex') === claim.sha256 &&
        ZIP.every((b, i) => bytes[i] === b);
      if (!fine) throw mismatch();
      let value: string;
      try {
        ({ value } = await mammoth.convertToHtml(
          { buffer: Buffer.from(bytes) },
          // Embedded images are dropped (the lead's answer): an empty image, removed below.
          { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) },
        ));
      } catch {
        throw templateErrors.invalid('uploadToken', 'That Word document could not be read');
      }
      return value.replace(/<img\b[^>]*>/gi, '');
    } finally {
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete an imported Word document in firm ${businessId}`);
      });
    }
  }

  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Template import storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
