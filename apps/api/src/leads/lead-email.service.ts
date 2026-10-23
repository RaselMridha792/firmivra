import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { Database } from '@firmivra/db';
import {
  type ConfirmEmailImageUploadRequest,
  type CreateEmailImageUploadRequest,
  EMAIL_IMAGE_LIMITS,
  EMAIL_SIGNATURE_MAX,
  type EmailImage,
  type MessageSignature,
  type SaveMessageSignatureRequest,
  type UploadPutTicket,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { DATABASE } from '../database/database.module.js';
import type { NotifyConfig } from '../notify/config.js';
import { cleanEmailHtml, emailHtmlHasContent, firmImages } from '../notify/email-html.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { brandAssetUrl } from '../settings/brand-assets.service.js';
import { logoUrl } from '../settings/logo-checks.js';
import { notFound, refusal, storageUnavailable } from '../storage/document-records.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  onlyPut,
  PUT_URL_SECONDS,
  statusOf,
} from '../storage/document-storage.js';
import { UPLOAD_TOKEN_SECONDS } from '../storage/upload-token.js';

// The lead email composer's saved signature and inline images (L4; contract in
// packages/types/src/leads/email.ts). A signature is the member's own row in message_signatures,
// cleaned by the email's rules (notify/email-html.ts). An image goes up in the documents' three
// steps under tenant/{business}/email-images/, and is served publicly at the firm's portal
// address, as any image in an email must be: there is no table, so the public route checks the
// stored bytes are a PNG, JPEG or GIF within the limit every time, and confirm deletes a file
// that is not what its ticket announced. Audit and logs: ids only, never the signature or a file.

type EmailImageType = (typeof EMAIL_IMAGE_LIMITS.contentTypes)[number];

const EXTENSION: Record<EmailImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
};
const TYPE_OF_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSION).map(([type, ext]) => [ext, type]),
) as Record<string, EmailImageType>;

const ImageClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  id: z.uuid(),
  key: z.string(),
  contentType: z.enum(EMAIL_IMAGE_LIMITS.contentTypes),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type ImageClaim = z.infer<typeof ImageClaim>;

export class EmailImageTokens extends Sealer<ImageClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-email-image-upload-v1', ImageClaim, secrets);
  }
}

const starts = (bytes: Uint8Array, text: number[]) =>
  bytes.length >= text.length && text.every((b, i) => bytes[i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** What the bytes really are: PNG, JPEG or GIF; null for anything else. */
export function sniffEmailImage(bytes: Uint8Array): EmailImageType | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) return 'image/gif';
  return null;
}

/** `{id}.{png|jpg|gif}` from the public address; null for anything else. */
export function emailImageFile(file: string): { id: string; type: EmailImageType } | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|gif)$/.exec(
    file,
  );
  return m ? { id: m[1]!, type: TYPE_OF_EXTENSION[m[2]!]! } : null;
}

const keyOf = (businessId: string, id: string, type: EmailImageType) =>
  `tenant/${businessId}/email-images/${id}.${EXTENSION[type]}`;

const signatureRefusal = (code: 'SIGNATURE_TOO_LONG' | 'SIGNATURE_EMPTY', message: string) =>
  new BadRequestException({ code, message });
const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

@Injectable()
export class LeadEmailService {
  private readonly logger = new Logger(LeadEmailService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(NOTIFY_CONFIG) private readonly config: NotifyConfig,
    private readonly tokens: EmailImageTokens,
    private readonly portal: PortalInfoService,
    private readonly audit: AuditService,
  ) {}

  /** The image rule for this firm's emails: its own images and logos on the portal's host. */
  async imageRule(businessId: string): Promise<(src: string) => boolean> {
    const origin = this.config.portalOrigin;
    if (!origin) return () => false;
    return firmImages(origin, await this.slugOf(businessId));
  }

  /** A lead email's HTML as it is sent: cleaned, or null when nothing would show. */
  async cleanForSending(businessId: string, html: string): Promise<string | null> {
    const clean = cleanEmailHtml(html, await this.imageRule(businessId));
    return emailHtmlHasContent(clean) ? clean : null;
  }

  async signature(businessId: string, userId: string): Promise<MessageSignature> {
    const db = this.database.forBusiness(businessId);
    const [row, firm, settings, profile] = await Promise.all([
      db.messageSignature.findUnique({
        where: { businessId_userId: { businessId, userId } },
        select: { body: true, updatedAt: true },
      }),
      db.business.findUnique({ where: { id: businessId }, select: { slug: true } }),
      db.businessSettings.findUnique({ where: { businessId }, select: { logoLightKey: true } }),
      db.businessBrandProfile.findUnique({ where: { businessId }, select: { emailLogoKey: true } }),
    ]);
    const origin = this.config.portalOrigin;
    const logo =
      origin && firm
        ? (brandAssetUrl(origin, firm.slug, 'EMAIL_LOGO', profile?.emailLogoKey) ??
          logoUrl(origin, firm.slug, settings?.logoLightKey, 'light'))
        : null;
    return {
      html: row?.body ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      logoUrl: logo,
    };
  }

  /** Save or replace: 400 SIGNATURE_EMPTY or SIGNATURE_TOO_LONG, judged on the cleaned HTML. */
  async saveSignature(
    businessId: string,
    userId: string,
    body: SaveMessageSignatureRequest,
  ): Promise<MessageSignature> {
    const clean = cleanEmailHtml(body.html, await this.imageRule(businessId));
    if (!emailHtmlHasContent(clean)) {
      throw signatureRefusal('SIGNATURE_EMPTY', 'Write a signature first');
    }
    if (clean.length > EMAIL_SIGNATURE_MAX) {
      throw signatureRefusal(
        'SIGNATURE_TOO_LONG',
        `The signature is too long to save: shorten it to about ${String(EMAIL_SIGNATURE_MAX)} characters of formatted text`,
      );
    }
    const row = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      tx.messageSignature.upsert({
        where: { businessId_userId: { businessId, userId } },
        create: { businessId, userId, body: clean },
        update: { body: clean },
        select: { id: true },
      }),
    );
    await this.audit.log('message_signature.saved', { type: 'message_signature', id: row.id });
    return this.signature(businessId, userId);
  }

  /** Step 1: the firm's key for a new image, and where the browser PUTs it. */
  async imageTicket(
    businessId: string,
    userId: string,
    body: CreateEmailImageUploadRequest,
  ): Promise<UploadPutTicket> {
    const id = randomUUID();
    const claim: ImageClaim = {
      pool: 'STAFF',
      businessId,
      userId,
      id,
      key: keyOf(businessId, id, body.contentType),
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    };
    const presigned = await this.s3('presign PUT', () =>
      this.storage.presignUpload({ ...claim, contentType: body.contentType }),
    );
    // At most 2 MB: always one PUT.
    const put = onlyPut(presigned);
    return {
      uploadToken: await this.tokens.seal(claim, UPLOAD_TOKEN_SECONDS),
      method: 'PUT',
      url: put.url,
      headers: put.headers,
      expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
    };
  }

  /** Step 3: 410 for an old or another member's ticket; 409 (and deleted) for other bytes. */
  async confirmImage(
    businessId: string,
    userId: string,
    body: ConfirmEmailImageUploadRequest,
  ): Promise<EmailImage> {
    const claim = (await this.tokens.open(body.uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== userId) {
      throw refusal('UPLOAD_EXPIRED');
    }
    const head = await this.s3('HEAD', () => this.storage.head(claim.key));
    const bytes = head ? await this.s3('GET', () => this.storage.read(claim.key)) : null;
    const fine =
      head &&
      head.contentEncoding === null &&
      bytes?.byteLength === claim.sizeBytes &&
      bytes.byteLength <= EMAIL_IMAGE_LIMITS.maxBytes &&
      createHash('sha256').update(bytes).digest('hex') === claim.sha256 &&
      sniffEmailImage(bytes) === claim.contentType;
    if (!fine) {
      await this.discard(claim.key);
      throw refusal('UPLOAD_MISMATCH', 'The image does not match what was uploaded. Try again.');
    }
    await this.audit.log('lead.email_image_uploaded', { type: 'email_image', id: claim.id });
    const origin = this.config.portalOrigin;
    if (!origin) throw storageUnavailable();
    return {
      id: claim.id,
      url: `${origin}/api/v1/portal/${await this.slugOf(businessId)}/email-images/${claim.id}.${EXTENSION[claim.contentType]}`,
      contentType: claim.contentType,
      sizeBytes: claim.sizeBytes,
    };
  }

  /** The public image: an active firm's, PNG, JPEG or GIF as the name says, within the limit. */
  async publicImage(
    firmSlug: string,
    file: string,
  ): Promise<{ bytes: Uint8Array; contentType: EmailImageType }> {
    const named = emailImageFile(file);
    if (!named) throw notFound();
    const firm = await this.portal.activeFirm(firmSlug);
    // The API role cannot list the bucket, so S3 answers a missing key 403, not 404.
    const bytes = await this.storage
      .read(keyOf(firm.id, named.id, named.type))
      .catch((error: unknown) => {
        if (statusOf(error) === 403) return null;
        this.logger.warn(`Storage GET failed: ${nameOf(error)} (HTTP ${statusOf(error)})`);
        throw storageUnavailable();
      });
    if (
      !bytes ||
      bytes.byteLength > EMAIL_IMAGE_LIMITS.maxBytes ||
      sniffEmailImage(bytes) !== named.type
    ) {
      throw notFound();
    }
    return { bytes, contentType: named.type };
  }

  private async slugOf(businessId: string): Promise<string> {
    const firm = await this.database
      .forBusiness(businessId)
      .business.findUnique({ where: { id: businessId }, select: { slug: true } });
    if (!firm) throw notFound();
    return firm.slug;
  }

  /** A refused file; should the delete fail it stays, and the log says so. */
  private async discard(key: string): Promise<void> {
    await this.storage.remove(key).catch((error: unknown) => {
      this.logger.warn(
        `Could not delete an email image: ${nameOf(error)} (HTTP ${statusOf(error)})`,
      );
    });
  }

  private async s3<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Storage ${operation} failed: ${nameOf(error)} (HTTP ${statusOf(error)})`);
      throw storageUnavailable();
    }
  }
}
